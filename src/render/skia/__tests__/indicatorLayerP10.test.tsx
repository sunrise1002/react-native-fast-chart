/**
 * Test perspective table — P10 indicator drawing (shifted outputs, clouds, dots)
 * (Skia mocked, real Reanimated, fake timers; fixtures in layerTestUtils.)
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                        |
 * |------|--------------------------------------------------------|-------------------|-------------------------------------------------|
 * | P1   | draw list of Ichimoku / SAR / Donchian                 | Normal            | cloud downPaint; dots: fill paint + radius;     |
 * |      |                                                        |                   | plain band downPaint null; legend offsets       |
 * | D1   | Ichimoku, 30 empty slots right of the last bar         | Normal            | leading spans reach 25 bars past the last bar,  |
 * |      |                                                        |                   | lagging span ends 25 bars before it             |
 * | D2   | Ichimoku cloud                                         | Normal            | cloud paths (fill / down paint) before lines    |
 * | D3   | Parabolic SAR                                          | Normal            | one path of circles, no polyline                |
 * | D4   | 0.05 dp bars with conflation (group > 1)               | Equivalence       | cloud, shifted lines and dots still drawn,      |
 * |      |                                                        |                   | dots ≤ bucket count                             |
 * | D5   | scrolled so only the future cloud area is visible      | Boundary          | spans drawn, unshifted lines not                |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import {
  PaintStyle,
  type FakePaint,
} from '../../../../jest/mocks/react-native-skia';
import { createUiCandleSeries } from '../../../data/UiCandleSeries';
import { connectIndicatorsToUi } from '../../../engine/IndicatorSync';
import type { IndicatorInput } from '../../../indicators/Indicator';
import { IndicatorEngine } from '../../../indicators/IndicatorEngine';
import { defaultDarkTheme } from '../../../theme/defaultDarkTheme';
import {
  NO_CONFLATION,
  type ConflationStyle,
} from '../../conflation/ConflatedLayers';
import { resolveOverlaySpecs } from '../../indicators/OverlayRenderSpec';
import { createIndicatorDrawList, dotRadius } from '../IndicatorPaints';
import { useIndicatorLayer } from '../useIndicatorLayer';
import { engine, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

function setup(inputs: IndicatorInput[], rightOffset = 0) {
  const e = engine(1000);
  e.state.series.value = createUiCandleSeries(
    e.store.columns,
    0,
    e.store.resetVersion
  );
  e.state.rightOffset.value = rightOffset;
  const ind = new IndicatorEngine(e.store, { requestFrame: () => {} });
  ind.setIndicators(inputs);
  ind.flush();
  act(() => {
    connectIndicatorsToUi(ind, e.state);
  });
  tick();
  const specs = resolveOverlaySpecs(
    ind.getEntries(),
    defaultDarkTheme.indicatorPalette
  );
  return { e, drawList: createIndicatorDrawList(specs) };
}

function draw(
  inputs: IndicatorInput[],
  rightOffset = 0,
  conflation: ConflationStyle = NO_CONFLATION,
  barSpacing?: number
) {
  const { e, drawList } = setup(inputs, rightOffset);
  if (barSpacing !== undefined) {
    e.state.barSpacing.value = barSpacing;
  }
  const { result } = renderHook(() =>
    useIndicatorLayer(e.state, drawList, false, conflation)
  );
  tick();
  const paths = pic(result.current.picture).ops.flatMap((o) =>
    o.op === 'path' ? [o] : []
  );
  return { e, drawList, paths };
}

type PathOp = ReturnType<typeof draw>['paths'][number];
const xs = (op: PathOp | undefined) =>
  (op?.path.commands ?? []).flatMap((c) => (c.cmd === 'Z' ? [] : [c.x]));
const maxX = (op: PathOp | undefined) => Math.max(...xs(op));

const ICHIMOKU: IndicatorInput[] = [{ type: 'ichimoku', id: 'ichi' }];
const SAR: IndicatorInput[] = [{ type: 'parabolicSar', id: 'sar' }];

describe('createIndicatorDrawList (P10)', () => {
  it('P1: cloud, dots and plain band paints', () => {
    // Given / When
    const { drawList } = setup([
      ...ICHIMOKU,
      ...SAR,
      { type: 'donchian', id: 'dc' },
    ]);
    const [ichi, sar, dc] = drawList.items;
    // Then
    expect(ichi?.fills[0]?.downPaint).not.toBeNull();
    expect(ichi?.fills[0]?.offset).toBe(25);
    expect(ichi?.strokes.map((s) => s.offset)).toEqual([0, 0, -25, 25, 25]);
    expect(sar?.strokes[0]?.radius).toBe(dotRadius(1.5));
    expect((sar?.strokes[0]?.paint as unknown as FakePaint).style).toBe(
      PaintStyle.Fill
    );
    expect(dc?.fills[0]?.downPaint).toBeNull();
    expect(dc?.strokes.every((s) => s.radius === 0)).toBe(true);
    expect(drawList.legend[0]?.values.map((v) => v.offset)).toEqual([
      0, 0, -25, 25, 25,
    ]);
    expect(dotRadius(0.5)).toBe(1.5);
    expect(dotRadius(3)).toBe(3);
  });
});

describe('useIndicatorLayer (P10)', () => {
  it('D1: leading spans draw into the future area', () => {
    // Given: 4 dp bars (~100 slots), 30 empty slots on the right
    // When
    const { e, paths, drawList } = draw(ICHIMOKU, 30, NO_CONFLATION, 4);
    const strokes = drawList.items[0]?.strokes ?? [];
    const byPaint = (k: number) =>
      paths.find((p) => (p.paint as unknown) === strokes[k]?.paint);
    // Then
    const spacing = e.state.barSpacing.value;
    const conversion = maxX(byPaint(0));
    expect(maxX(byPaint(3)) - conversion).toBeCloseTo(25 * spacing, 6);
    expect(maxX(byPaint(4)) - conversion).toBeCloseTo(25 * spacing, 6);
    expect(conversion - maxX(byPaint(2))).toBeCloseTo(25 * spacing, 6);
  });

  it('D2: bullish and bearish cloud paths', () => {
    // Given / When
    const { paths, drawList } = draw(ICHIMOKU, 30, NO_CONFLATION, 4);
    const fill = drawList.items[0]?.fills[0];
    // Then: cloud paths (bullish and / or bearish) first, then 5 lines
    const clouds = paths.length - 5;
    expect(clouds).toBeGreaterThanOrEqual(1);
    expect(clouds).toBeLessThanOrEqual(2);
    for (const p of paths.slice(0, clouds)) {
      expect([fill?.paint, fill?.downPaint]).toContain(p.paint);
      expect(p.path.commands.some((c) => c.cmd === 'Z')).toBe(true);
    }
  });

  it('D3: SAR is one path of dots', () => {
    // Given / When
    const { paths, drawList } = draw(SAR);
    // Then
    expect(paths).toHaveLength(1);
    expect(paths[0]?.paint).toBe(drawList.items[0]?.strokes[0]?.paint);
    expect(paths[0]?.path.commands).toEqual([]);
    expect(paths[0]?.path.circles.length).toBeGreaterThan(10);
    expect(paths[0]?.path.circles.every((c) => c.r === 1.5)).toBe(true);
  });

  it('D4: conflated drawing keeps clouds, shifted lines and dots', () => {
    // Given: 1000 bars at 0.05 dp, conflation groups of 64
    const conflation = { conflationPx: 2, wickWidth: 1, pixelRatio: 1 };
    // When
    const ichi = draw(ICHIMOKU, 30, conflation, 0.05);
    const sar = draw(SAR, 0, conflation, 0.05);
    // Then
    expect(ichi.paths.length).toBeGreaterThanOrEqual(6);
    const circles = sar.paths[0]?.path.circles.length ?? 0;
    expect(circles).toBeGreaterThan(0);
    expect(circles).toBeLessThanOrEqual(32);
  });

  it('D5: only the future area in view', () => {
    // Given: the last bar 5 slots left of the plot edge, 25-bar lead
    const { e, drawList } = setup(ICHIMOKU, 0);
    const slots = Math.floor(
      e.state.plotWidth.value / e.state.barSpacing.value
    );
    e.state.rightOffset.value = slots + 20;
    const { result } = renderHook(() =>
      useIndicatorLayer(e.state, drawList, false, NO_CONFLATION)
    );
    tick();
    // When
    const paths = pic(result.current.picture).ops.flatMap((o) =>
      o.op === 'path' ? [o] : []
    );
    // Then: only the two leading spans (+ cloud) have points in view
    const strokes = drawList.items[0]?.strokes ?? [];
    const drawn = strokes.filter((s) =>
      paths.some((p) => (p.paint as unknown) === s.paint)
    );
    expect(drawn.map((s) => s.output)).toEqual([3, 4]);
  });
});
