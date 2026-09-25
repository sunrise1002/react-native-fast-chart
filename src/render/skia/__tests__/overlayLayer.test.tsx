/**
 * Test perspective table — useOverlayLayer + usePriceAxisWidth
 * (Skia mocked: fake font 0.6 em per glyph, recording picture canvas; real
 * Reanimated, fake timers; fixtures in layerTestUtils.)
 *
 * | Case | Input / Precondition                                | Perspective        | Expected                                     |
 * |------|-----------------------------------------------------|--------------------|----------------------------------------------|
 * | OL1  | crosshair hidden                                    | Equivalence        | empty crosshair picture                      |
 * | OL2  | crosshair shown on a visible bar; daily bars        | Equivalence        | 2 lines, 2 boxes, 2 texts; date-only label   |
 * | OL3  | crosshair shown, bar off-screen                     | Boundary           | empty crosshair picture                      |
 * | OL4  | legend: last bar / crosshair bar                    | Equivalence        | O…C of that bar                              |
 * | OL5  | legend off / no data                                | Equivalence / inv. | empty legend                                 |
 * | PW1  | required > current                                  | Equivalence        | axis grows, plot shrinks                     |
 * | PW2  | required < current (same dataset)                   | Boundary           | grow-only: width kept                        |
 * | PW3  | dataset reset + smaller requirement                 | Equivalence        | axis shrinks                                 |
 * | PW4  | required above 40 % of the canvas / below min       | Boundary (max/min) | clamped                                      |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  makeMutable,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { showCrosshair } from '../../../engine/CrosshairActions';
import { useOverlayLayer, type OverlayStyle } from '../useOverlayLayer';
import { usePriceAxisWidth } from '../usePriceAxisWidth';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const OVERLAY: OverlayStyle = {
  font: FONT,
  paints: PAINTS,
  pixelRatio: 2,
  timeAxisHeight: 24,
  pricePrecision: NaN,
  thousandsSeparator: ',',
  timeZone: 'utc',
  showLegend: true,
  showLegendVolume: true,
};

function overlay(
  e = engine(),
  style: Partial<OverlayStyle> = {},
  barMs = 60_000
) {
  return renderHook(() => {
    const bar = useSharedValue(barMs);
    return useOverlayLayer(e.state, bar, { ...OVERLAY, ...style });
  });
}

describe('useOverlayLayer', () => {
  it('OL1: empty crosshair while hidden', () => {
    // Given / When
    const { result } = overlay();
    tick();
    // Then
    expect(pic(result.current.crosshair).ops).toHaveLength(0);
  });

  it('OL2: draws lines and axis labels while shown', () => {
    // Given
    const e = engine();
    const { result } = overlay(e);
    // When
    act(() => showCrosshair(e.state, 200, 150));
    tick();
    // Then
    const ops = pic(result.current.crosshair).ops;
    expect(ops.filter((o) => o.op === 'line')).toHaveLength(2);
    expect(ops.filter((o) => o.op === 'rrect')).toHaveLength(2);
    const texts = pic(result.current.crosshair).texts();
    expect(texts).toHaveLength(2);
    expect(texts[1]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('OL2: daily bars show the date only', () => {
    // Given
    const e = engine();
    const { result } = overlay(e, {}, 86_400_000);
    // When
    act(() => showCrosshair(e.state, 200, 150));
    tick();
    // Then
    expect(pic(result.current.crosshair).texts()[1]).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it('OL3: empty crosshair for an off-screen bar', () => {
    // Given
    const e = engine();
    const { result } = overlay(e);
    // When
    act(() => {
      showCrosshair(e.state, 200, 150);
      e.state.crosshairIndex.value = 0;
    });
    tick();
    // Then
    expect(pic(result.current.crosshair).ops).toHaveLength(0);
  });

  it('OL4: legend follows the crosshair bar', () => {
    // Given
    const e = engine();
    const s = e.state.series.value;
    const { result } = overlay(e);
    tick();
    const lastTexts = pic(result.current.legend).texts();
    // When
    act(() => showCrosshair(e.state, 200, 150));
    tick();
    // Then
    const index = e.state.crosshairIndex.value;
    const open = (s.open[s.offset + index] as number).toFixed(2);
    expect(lastTexts[0]).toBe('O');
    expect(lastTexts).toContain('V');
    expect(pic(result.current.legend).texts()).toContain(
      open.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    );
  });

  it.each([
    ['legend off', 1000, false],
    ['no data', 0, true],
  ])('OL5: %s → empty legend', (_label, bars, showLegend) => {
    // Given / When
    const { result } = overlay(engine(bars), { showLegend });
    tick();
    // Then
    expect(pic(result.current.legend).ops).toHaveLength(0);
  });
});

describe('usePriceAxisWidth', () => {
  function sized(required: number, min = 64) {
    const e = engine();
    const req = makeMutable(required);
    renderHook(() => {
      const derived = useDerivedValue(() => req.value);
      usePriceAxisWidth(e.state, e.options, derived, min, 24);
    });
    tick();
    const set = (value: number) => {
      act(() => {
        req.value = value;
      });
      tick();
    };
    return { e, set };
  }

  it('PW1: grows the axis and shrinks the plot', () => {
    // Given / When
    const { e } = sized(100);
    // Then
    expect(e.state.priceAxisWidth.value).toBe(100);
    expect(e.state.plotWidth.value).toBe(364);
  });

  it('PW2: never shrinks for the same dataset', () => {
    // Given
    const { e, set } = sized(100);
    // When
    set(70);
    // Then
    expect(e.state.priceAxisWidth.value).toBe(100);
  });

  it('PW3: shrinks after a dataset reset', () => {
    // Given
    const { e, set } = sized(100);
    set(70);
    // When
    act(() => {
      const s = e.state.series.value;
      e.state.series.value = { ...s, resetVersion: s.resetVersion + 1 };
    });
    tick();
    // Then
    expect(e.state.priceAxisWidth.value).toBe(70);
  });

  it.each([
    [1000, 64, 464 * 0.4],
    [10, 64, 64],
  ])('PW4: required %p (min %p) → %p', (required, min, expected) => {
    // Given / When
    const { e } = sized(required, min);
    // Then
    expect(e.state.priceAxisWidth.value).toBeCloseTo(expected, 9);
  });
});
