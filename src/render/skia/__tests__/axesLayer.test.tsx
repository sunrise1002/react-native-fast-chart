/**
 * Test perspective table — Skia resources + useAxesLayer
 * (Skia mocked: fake font 0.6 em per glyph, recording picture canvas; real
 * Reanimated, fake timers; fixtures in layerTestUtils.)
 *
 * | Case | Input / Precondition                                | Perspective        | Expected                                     |
 * |------|-----------------------------------------------------|--------------------|----------------------------------------------|
 * | SR1  | createChartFont 12                                  | Equivalence        | glyph table 7.2 dp, metrics, line height     |
 * | SR2  | size NaN / 0; family; zero ascent                   | Invalid / boundary | size 10; family forwarded; ascent = size     |
 * | SR3  | createChartPaints                                   | Equivalence        | dashed strokes with path effects             |
 * | SR4  | dash shorter than 2 / width NaN                     | Boundary / invalid | no path effect / width 1                     |
 * | AL1  | valid viewport                                      | Equivalence        | price + time labels, grid rects, width ≥ 12  |
 * | AL2  | last price on                                       | Equivalence        | dashed line, badge rrect, badge text         |
 * | AL3  | last price off                                      | Equivalence        | no line, no badge                            |
 * | AL4  | no data / NaN price range                           | Invalid            | nothing / time labels only, no marker        |
 * | AL5  | unknown bar interval (NaN)                          | Boundary           | no time labels                               |
 * | AL6  | timeLabelSpacing with / without seconds             | Equivalence        | widest sample + gap                          |
 * | AL7  | 1 s bars / daily bars                               | Equivalence        | HH:mm:ss labels / date labels (UTC)          |
 * | AL8  | bearish / bullish last bar                          | Equivalence        | matching badge + line paints                 |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import {
  FakeFont,
  PaintStyle,
  type FakePaint,
  type FakePath,
  type FakePicture,
} from '../../../../jest/mocks/react-native-skia';
import { defaultDarkTheme } from '../../../theme/defaultDarkTheme';
import {
  createChartFont,
  createChartPaints,
  type ChartFont,
} from '../SkiaResources';
import {
  timeLabelSpacing,
  useAxesLayer,
  type AxesStyle,
} from '../useAxesLayer';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const AXES: AxesStyle = {
  font: FONT,
  paints: PAINTS,
  gridLineWidth: 1,
  pixelRatio: 2,
  timeAxisHeight: 24,
  pricePrecision: NaN,
  thousandsSeparator: ',',
  timeZone: 'utc',
  showLastPrice: true,
};

function axes(e = engine(), style: Partial<AxesStyle> = {}, barMs = 60_000) {
  return renderHook(() => {
    const bar = useSharedValue(barMs);
    return useAxesLayer(e.state, bar, { ...AXES, ...style });
  });
}

describe('SkiaResources', () => {
  it('SR1: builds the glyph table and metrics from the font', () => {
    // Given / When
    const font = createChartFont(12);
    // Then
    expect(font.size).toBe(12);
    expect(font.glyphs.widths['0'.charCodeAt(0)]).toBeCloseTo(7.2, 9);
    expect(font.metrics.ascent).toBeCloseTo(10.8, 9);
    expect(font.metrics.descent).toBe(3);
    expect(font.lineHeight).toBeCloseTo(13.8, 9);
  });

  it('SR2: sanitizes the size, forwards the family, falls back on ascent', () => {
    // Given
    const spy = jest
      .spyOn(FakeFont.prototype, 'getMetrics')
      .mockReturnValueOnce({ ascent: 0, descent: 0, leading: 0 });
    // When
    const zeroAscent = createChartFont(14);
    spy.mockRestore();
    // Then
    expect(createChartFont(NaN).size).toBe(10);
    expect(createChartFont(0).size).toBe(10);
    expect(
      (createChartFont(12, 'Menlo').font as unknown as FakeFont).family
    ).toBe('Menlo');
    expect(zeroAscent.metrics.ascent).toBe(14);
  });

  it('SR3: creates dashed stroke paints', () => {
    // Given / When
    const line = PAINTS.crosshairLine as unknown as FakePaint;
    const text = PAINTS.axisText as unknown as FakePaint;
    // Then
    expect(line.style).toBe(PaintStyle.Stroke);
    expect(line.pathEffect).toEqual({ dash: [4, 4], phase: 0 });
    expect(text.style).toBe(PaintStyle.Fill);
    expect(text.color).toBe(defaultDarkTheme.axis.textColor);
  });

  it('SR4: skips short dashes and sanitizes the width', () => {
    // Given
    const theme = {
      ...defaultDarkTheme,
      crosshair: { ...defaultDarkTheme.crosshair, dash: [4], width: NaN },
    };
    // When
    const line = createChartPaints(theme).crosshairLine as unknown as FakePaint;
    // Then
    expect(line.pathEffect).toBeNull();
    expect(line.strokeWidth).toBe(1);
  });
});

describe('useAxesLayer', () => {
  it('AL1: draws price / time labels and the grid', () => {
    // Given / When
    const { result } = axes();
    tick();
    // Then
    const frame = result.current.frame.value;
    const picture = frame.picture as unknown as FakePicture;
    const texts = picture.texts();
    expect(texts.length).toBeGreaterThan(4);
    expect(texts.some((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true);
    expect(
      (result.current.grid.value as unknown as FakePath).rects.length
    ).toBeGreaterThan(4);
    expect(frame.requiredAxisWidth % 4).toBe(0);
    expect(frame.requiredAxisWidth).toBeGreaterThan(12);
    expect(pic(result.current.picture)).toBe(picture);
  });

  it('AL2: draws the last price line and badge', () => {
    // Given
    const e = engine();
    const s = e.state.series.value;
    const last = s.close[s.offset + s.length - 1] as number;
    // When
    const { result } = axes(e);
    tick();
    // Then
    const ops = pic(result.current.picture).ops;
    expect(ops.filter((o) => o.op === 'line')).toHaveLength(1);
    expect(ops.filter((o) => o.op === 'rrect')).toHaveLength(1);
    expect(pic(result.current.picture).texts()).toContain(
      last.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    );
  });

  it('AL3: omits the marker when disabled', () => {
    // Given / When
    const { result } = axes(engine(), { showLastPrice: false });
    tick();
    // Then
    const ops = pic(result.current.picture).ops;
    expect(ops.some((o) => o.op === 'line' || o.op === 'rrect')).toBe(false);
  });

  it('AL4: no data → no labels, empty grid', () => {
    // Given / When
    const { result } = axes(engine(0));
    tick();
    // Then
    expect(pic(result.current.picture).texts()).toEqual([]);
    expect(
      (result.current.grid.value as unknown as FakePath).rects
    ).toHaveLength(0);
  });

  it('AL4: NaN price range → time labels only, no marker', () => {
    // Given
    const e = engine();
    e.state.priceMin.value = NaN;
    // When
    const { result } = axes(e);
    tick();
    // Then
    const picture = pic(result.current.picture);
    expect(picture.texts().length).toBeGreaterThan(0);
    expect(picture.texts().every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true);
    expect(picture.ops.some((o) => o.op === 'rrect')).toBe(false);
  });

  it('AL5: no time labels for an unknown bar interval', () => {
    // Given / When
    const { result } = axes(engine(), {}, NaN);
    tick();
    // Then
    expect(
      pic(result.current.picture)
        .texts()
        .some((t) => t.includes(':'))
    ).toBe(false);
  });

  it.each([
    [1000, /^\d{2}:\d{2}:\d{2}$/],
    [86_400_000, /^(\d{1,2}|[A-Z][a-z]{2}|\d{4})$/],
  ])('AL7: %p ms bars → labels like %p', (barMs, pattern) => {
    // Given
    const e = engine();
    const s = e.state.series.value;
    for (let i = 0; i < s.length; i++) {
      s.time[s.offset + i] = Date.UTC(2020, 0, 1) + i * barMs;
    }
    e.state.barSpacing.value = barMs === 1000 ? 30 : 8;
    // When
    const { result } = axes(e, {}, barMs);
    tick();
    // Then
    const times = pic(result.current.picture)
      .ops.filter((o) => o.op === 'text' && o.y > 300)
      .map((o) => (o.op === 'text' ? o.text : ''));
    expect(times.length).toBeGreaterThan(0);
    expect(times.every((t) => pattern.test(t))).toBe(true);
  });

  it.each([
    ['bearish', -0.01, PAINTS.bearish, PAINTS.lastPriceLineDown],
    ['bullish', 0.01, PAINTS.bullish, PAINTS.lastPriceLineUp],
  ])('AL8: %s last bar picks its paints', (_label, delta, fill, stroke) => {
    // Given
    const e = engine();
    const s = e.state.series.value;
    const at = s.offset + s.length - 1;
    s.close[at] = (s.open[at] as number) + delta;
    // When
    const { result } = axes(e);
    tick();
    // Then
    const ops = pic(result.current.picture).ops;
    expect(ops.find((o) => o.op === 'rrect')?.paint).toBe(fill);
    expect(ops.find((o) => o.op === 'line')?.paint).toBe(stroke);
  });

  it('AL6: time label spacing fits the widest label', () => {
    // Given
    const font: ChartFont = FONT;
    // When / Then: '00:00:00' = 8 × 6 + 1.5 em
    expect(timeLabelSpacing(font, true)).toBeCloseTo(48 + 15, 9);
    expect(timeLabelSpacing(font, false)).toBeCloseTo(30 + 15, 9);
  });
});
