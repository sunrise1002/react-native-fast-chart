/**
 * Test perspective table — ConflatedLayers (layer glue)
 *
 * | Case  | Input / Precondition                                        | Perspective        | Expected                                    |
 * |-------|-------------------------------------------------------------|--------------------|---------------------------------------------|
 * | CL01  | frameGroupSize: wide bars / 0.01 dp / conflationPx 0        | Equivalence / off  | 1 / power of two / 1                        |
 * | CL02  | frameGroupSize: thick wick (3 dp, pr 2 → 6 px)               | Boundary           | slot must reach the wick width              |
 * | CL03  | conflateVisibleCandles                                      | Equivalence        | = conflateCandles on a fresh pyramid        |
 * | CL04  | conflateOutput: existing / missing output                   | Equivalence / inv. | buckets / 0 (length reset)                  |
 * | CL05  | cachedAutoScaleTarget vs computeAutoScaleTarget,            | Equivalence        | identical target (short and long ranges)    |
 * |       | with and without overlay refs                               |                    |                                             |
 * | CL06  | cachedAutoScaleTarget: no data / NaN spacing                | Boundary / invalid | false                                       |
 * | CL07  | cachedPaneRange vs computePaneRange for every scale kind     | Equivalence        | identical ranges                            |
 * | CL08  | cachedPaneRange: no values / invalid fixed spec             | Invalid            | false, NaN out                              |
 */
import { describe, expect, it } from '@jest/globals';
import { createMinMaxPyramid, syncPyramid } from '../../../data/MinMaxPyramid';
import {
  createUiCandleSeries,
  type UiCandleSeries,
} from '../../../data/UiCandleSeries';
import type { IndicatorScaleSpec } from '../../../indicators/IndicatorRegistry';
import type { UiIndicatorSet } from '../../../indicators/UiIndicatorSet';
import { computePaneRange } from '../../../panes/PaneScale';
import { generateCandles } from '../../../testing/fixtures/generateCandles';
import { computeAutoScaleTarget } from '../../../viewport/AutoScaleTarget';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import {
  cachedAutoScaleTarget,
  cachedPaneRange,
  conflateOutput,
  conflateVisibleCandles,
  frameGroupSize,
} from '../ConflatedLayers';
import {
  conflateCandles,
  createConflatedCandles,
  createConflatedValues,
} from '../Conflation';
import { createRenderCache } from '../RenderCache';

function series(n: number): UiCandleSeries {
  const candles = generateCandles({ count: n, seed: 3 });
  const col = (k: 'time' | 'open' | 'high' | 'low' | 'close' | 'volume') =>
    Float64Array.from(candles, (c) => c[k]);
  return createUiCandleSeries({
    time: col('time'),
    open: col('open'),
    high: col('high'),
    low: col('low'),
    close: col('close'),
    volume: col('volume'),
    offset: 0,
    length: n,
  });
}

function withIndicator(data: UiCandleSeries, spike = 0): UiIndicatorSet {
  const values = Float64Array.from({ length: data.length }, (_, i) =>
    i < 5 ? NaN : (data.close[i] as number) + Math.sin(i) * 100 + spike
  );
  return {
    series: {
      ma: {
        outputs: [values],
        length: data.length,
        resetVersion: data.resetVersion,
        firstTime: data.time[0] as number,
      },
    },
    revision: 1,
  };
}

function scale(n: number, barSpacing: number): TimeScaleState {
  return { width: 400, barSpacing, rightOffset: 0, barCount: n };
}

describe('frameGroupSize', () => {
  it('CL01: conflates narrow bars only when enabled', () => {
    // Given / When / Then
    expect(frameGroupSize(8, 2, 1, 2)).toBe(1);
    expect(frameGroupSize(0.01, 2, 1, 1)).toBe(256);
    expect(frameGroupSize(0.01, 0, 1, 1)).toBe(1);
  });

  it('CL02: the slot must also be as wide as the wick', () => {
    // Given: 3 dp wick at pr 2 = 6 px; 2 px slots
    // When / Then: 4 bars per bucket → 8 px ≥ 6 px
    expect(frameGroupSize(1, 2, 3, 2)).toBe(4);
  });
});

describe('conflateVisibleCandles / conflateOutput', () => {
  it('CL03: matches conflateCandles on a fresh pyramid', () => {
    // Given
    const data = series(3000);
    const time = scale(3000, 0.1);
    const pyramid = createMinMaxPyramid();
    syncPyramid(pyramid, data.low, data.high, 0, data.length, 0);
    const expected = createConflatedCandles();
    conflateCandles(data, pyramid, 100, 2999, time, 16, expected, {
      min: NaN,
      max: NaN,
    });
    // When
    const got = conflateVisibleCandles(
      createRenderCache(),
      data,
      100,
      2999,
      time,
      16
    );
    // Then
    expect(got.length).toBe(expected.length);
    expect(Array.from(got.high.subarray(0, got.length))).toEqual(
      Array.from(expected.high.subarray(0, expected.length))
    );
    expect(got.scale).toEqual(expected.scale);
  });

  it('CL04: conflates an output; a missing output gives 0 buckets', () => {
    // Given
    const data = series(100);
    const set = withIndicator(data);
    const ui = set.series.ma!;
    const cache = createRenderCache();
    const out = createConflatedValues();
    const time = scale(100, 0.1);
    // When
    const n = conflateOutput(cache, set, 'ma', ui, 0, 0, 99, time, 8, out);
    const missing = conflateOutput(
      cache,
      set,
      'ma',
      ui,
      5,
      0,
      99,
      time,
      8,
      out
    );
    // Then
    expect(n).toBe(13);
    expect(missing).toBe(0);
    expect(out.length).toBe(0);
  });
});

describe('cachedAutoScaleTarget', () => {
  it.each([
    ['short range, no refs', 500, 1, false],
    ['short range, refs', 500, 1, true],
    ['long range, no refs', 20_000, 0.01, false],
    ['long range, refs', 20_000, 0.01, true],
  ])('CL05: %s equals computeAutoScaleTarget', (_l, n, spacing, withRefs) => {
    // Given
    const data = series(n);
    const set = withIndicator(data, 500);
    const refs = withRefs ? [{ id: 'ma', output: 0 }] : [];
    const time = scale(n, spacing);
    const want = { min: NaN, max: NaN };
    const extender = {
      extend(start: number, end: number, out: { min: number; max: number }) {
        const col = set.series.ma!.outputs[0]!;
        for (let i = Math.max(0, Math.ceil(start)); i <= end && i < n; i++) {
          const v = col[i] as number;
          if (Number.isFinite(v)) {
            out.min = Math.min(out.min, v);
            out.max = Math.max(out.max, v);
          }
        }
      },
    };
    computeAutoScaleTarget(
      data,
      time,
      want,
      {},
      undefined,
      withRefs ? extender : undefined
    );
    const got = { min: NaN, max: NaN };
    // When
    const ok = cachedAutoScaleTarget(
      createRenderCache(),
      data,
      set,
      refs,
      time,
      got
    );
    // Then
    expect(ok).toBe(true);
    expect(got.min).toBeCloseTo(want.min, 9);
    expect(got.max).toBeCloseTo(want.max, 9);
  });

  it('CL06: returns false without data or with a NaN scale', () => {
    // Given
    const cache = createRenderCache();
    const empty = series(0);
    const data = series(100);
    const set = withIndicator(data);
    const out = { min: 1, max: 2 };
    // When / Then
    expect(cachedAutoScaleTarget(cache, empty, set, [], scale(0, 8), out)).toBe(
      false
    );
    expect(
      cachedAutoScaleTarget(cache, data, set, [], scale(100, NaN), out)
    ).toBe(false);
  });
});

describe('cachedPaneRange', () => {
  const kinds: IndicatorScaleSpec[] = [
    { kind: 'auto' },
    { kind: 'price' },
    { kind: 'volume' },
    { kind: 'zeroCentered' },
    { kind: 'fixed', min: 0, max: 100 },
  ];

  it.each(
    kinds.flatMap((k): [IndicatorScaleSpec, number][] => [
      [k, 300],
      [k, 5000],
    ])
  )('CL07: %p over %p bars equals computePaneRange', (spec, end) => {
    // Given
    const data = series(6000);
    const set = withIndicator(data, -1e5);
    const refs = [{ id: 'ma', output: 0 }];
    const want = { min: NaN, max: NaN };
    const got = { min: NaN, max: NaN };
    computePaneRange(spec, set, data, refs, 10, end, want);
    // When
    const ok = cachedPaneRange(
      createRenderCache(),
      spec,
      set,
      data,
      refs,
      10,
      end,
      got
    );
    // Then
    expect(ok).toBe(true);
    expect(got.min).toBeCloseTo(want.min, 6);
    expect(got.max).toBeCloseTo(want.max, 6);
  });

  it('CL08: false without values or with an invalid fixed spec', () => {
    // Given
    const data = series(100);
    const set = withIndicator(data);
    const out = { min: 1, max: 2 };
    const cache = createRenderCache();
    // When / Then
    expect(
      cachedPaneRange(
        cache,
        { kind: 'auto' },
        set,
        data,
        [{ id: 'x', output: 0 }],
        0,
        99,
        out
      )
    ).toBe(false);
    expect(out).toEqual({ min: NaN, max: NaN });
    expect(
      cachedPaneRange(
        cache,
        { kind: 'fixed', min: 5, max: 5 },
        set,
        data,
        [],
        0,
        99,
        out
      )
    ).toBe(false);
  });
});
