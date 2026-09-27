/**
 * Test perspective table — RenderCache (pyramid caching / invalidation)
 *
 * | Case  | Input / Precondition                                        | Perspective        | Expected                                   |
 * |-------|-------------------------------------------------------------|--------------------|--------------------------------------------|
 * | RC01  | candlePyramid twice, same object and revision               | Equivalence        | cached (no resync: silent edit not seen)   |
 * | RC02  | in-place update of the last bar / appends (revision bumps)  | Equivalence        | tail resynced = brute force                |
 * | RC03  | new series object (snapshot)                                | Equivalence        | full rebuild                               |
 * | RC04  | revision jump ≥ built length / revision going backwards     | Boundary / invalid | full rebuild                               |
 * | RC05  | outputPyramid: missing column                               | Invalid            | undefined                                  |
 * | RC06  | outputPyramid: cached / set.revision bump / new series      | Equivalence        | cached / last 512 resynced / rebuilt        |
 * | RC07  | outputPyramid: tail resync shorter than 512 bars            | Boundary (min)     | resync from bar 0                          |
 * | RC08  | pruneOutputPyramids                                         | Equivalence        | removed ids dropped, others kept           |
 * | RC09  | cachedCandleRange: 2047 bars (linear) / 2048 (pyramid)      | Boundary (±1)      | equals candleRangeMinMax                   |
 * | RC10  | cachedCandleRange: long all-NaN range                       | Invalid            | false, NaN out                             |
 * | RC11  | cachedExtendRange short / long range                        | Boundary           | equals the linear extension                |
 * | RC12  | cachedExtendRange: unknown id / output / unaligned series   | Invalid            | ignored                                    |
 * | RC13  | cachedExtendRange: ref offset ±26, short / long, view edges | Equivalence        | equals the linear shifted extension        |
 */
import { describe, expect, it } from '@jest/globals';
import { bucketMax, pyramidRangeMinMax } from '../../../data/MinMaxPyramid';
import {
  createUiCandleSeries,
  writeUiBar,
  type UiCandleSeries,
} from '../../../data/UiCandleSeries';
import {
  extendRangeWithOutputs,
  type UiIndicatorSeries,
  type UiIndicatorSet,
} from '../../../indicators/UiIndicatorSet';
import { candleRangeMinMax } from '../../../viewport/AutoScale';
import {
  cachedCandleRange,
  cachedExtendRange,
  candlePyramid,
  createRenderCache,
  outputPyramid,
  pruneOutputPyramids,
  PYRAMID_QUERY_MIN_BARS,
} from '../RenderCache';

function series(n: number, seed = 1): UiCandleSeries {
  const at = (i: number) => 100 + Math.sin(i * 0.37 + seed) * 20;
  const time = Float64Array.from({ length: n }, (_, i) => 1000 + i * 60);
  const close = Float64Array.from({ length: n }, (_, i) => at(i));
  return createUiCandleSeries({
    time,
    open: close,
    high: close.map((v) => v + 1),
    low: close.map((v) => v - 1),
    close,
    volume: new Float64Array(n),
    offset: 0,
    length: n,
  });
}

function fullRange(data: UiCandleSeries) {
  const cache = createRenderCache();
  const pyramid = candlePyramid(cache, data);
  const out = { min: NaN, max: NaN };
  pyramidRangeMinMax(pyramid, data.low, data.high, 0, 0, data.length, out);
  return out;
}

function expectSynced(
  cache: ReturnType<typeof createRenderCache>,
  data: UiCandleSeries
) {
  const out = { min: NaN, max: NaN };
  const pyramid = candlePyramid(cache, data);
  pyramidRangeMinMax(pyramid, data.low, data.high, 0, 0, data.length, out);
  expect(out).toEqual(fullRange(data));
  expect(pyramid.length).toBe(data.length);
}

function indicatorSet(
  data: UiCandleSeries,
  values: Float64Array,
  id = 'ma'
): UiIndicatorSet {
  const s: UiIndicatorSeries = {
    outputs: [values],
    length: data.length,
    resetVersion: data.resetVersion,
    firstTime: data.time[0] as number,
  };
  return { series: { [id]: s }, revision: 1 };
}

describe('candlePyramid', () => {
  it('RC01: returns the cached pyramid when nothing changed', () => {
    // Given
    const cache = createRenderCache();
    const data = series(100);
    const first = candlePyramid(cache, data);
    const top = bucketMax(first, first.levels, 0);
    // When: a silent edit (no revision bump)
    data.high[5] = 1e6;
    const second = candlePyramid(cache, data);
    // Then
    expect(second).toBe(first);
    expect(bucketMax(second, second.levels, 0)).toBe(top);
  });

  it('RC02: resyncs the tail after in-place writes', () => {
    // Given
    const cache = createRenderCache();
    const data = series(100);
    candlePyramid(cache, data);
    // When: update the last bar, then append 40 bars
    writeUiBar(data, 99, 0, 1, 5000, -5000, 1, 0);
    expectSynced(cache, data);
    for (let i = 100; i < 140; i++) {
      writeUiBar(data, i, 0, 1, 200 + i, 10, 1, 0);
    }
    // Then
    expectSynced(cache, data);
  });

  it('RC03: rebuilds for a new series object', () => {
    // Given
    const cache = createRenderCache();
    candlePyramid(cache, series(100, 1));
    // When
    const next = series(80, 2);
    // Then
    expectSynced(cache, next);
    expect(cache.candleSource).toBe(next);
  });

  it('RC04: rebuilds on large or backward revision jumps', () => {
    // Given
    const cache = createRenderCache();
    const data = series(50);
    candlePyramid(cache, data);
    // When: every bar rewritten with revision += 50 (≥ built)
    data.low.fill(-7);
    data.revision += 50;
    expectSynced(cache, data);
    // When: revision goes backwards
    data.high.fill(9e3);
    data.revision -= 10;
    // Then
    expectSynced(cache, data);
  });
});

describe('outputPyramid', () => {
  it('RC05: returns undefined for a missing output column', () => {
    // Given
    const data = series(10);
    const set = indicatorSet(data, new Float64Array(10));
    const s = set.series.ma as UiIndicatorSeries;
    // When / Then
    expect(outputPyramid(createRenderCache(), set, 'ma', s, 3)).toBeUndefined();
  });

  it('RC06: caches, resyncs the patch tail and rebuilds', () => {
    // Given: 3000 bars
    const data = series(3000);
    const values = Float64Array.from({ length: 3000 }, (_, i) => i);
    const set = indicatorSet(data, values);
    const s = set.series.ma as UiIndicatorSeries;
    const cache = createRenderCache();
    const p = outputPyramid(cache, set, 'ma', s, 0);
    const out = () => {
      const r = { min: NaN, max: NaN };
      const pyr = outputPyramid(cache, set, 'ma', set.series.ma!, 0)!;
      pyramidRangeMinMax(pyr, values, values, 0, 0, 3000, r);
      return r;
    };
    // When: silent edit → cached
    values[10] = -1;
    expect(out()).toEqual({ min: 0, max: 2999 });
    // When: tail edit with a revision bump → resynced
    values[2999] = 1e4;
    set.revision++;
    expect(out()).toEqual({ min: 0, max: 1e4 });
    // When: a new series object → full rebuild (sees the silent edit)
    set.series.ma = { ...s };
    // Then
    expect(out()).toEqual({ min: -1, max: 1e4 });
    expect(outputPyramid(cache, set, 'ma', set.series.ma, 0)).toBe(p);
  });

  it('RC07: short series resync from bar 0', () => {
    // Given
    const data = series(20);
    const values = new Float64Array(20).fill(1);
    const set = indicatorSet(data, values);
    const cache = createRenderCache();
    const s = set.series.ma as UiIndicatorSeries;
    outputPyramid(cache, set, 'ma', s, 0);
    // When
    values[0] = -3;
    set.revision++;
    const p = outputPyramid(cache, set, 'ma', s, 0)!;
    const r = { min: NaN, max: NaN };
    pyramidRangeMinMax(p, values, values, 0, 0, 19, r);
    // Then
    expect(r).toEqual({ min: -3, max: 1 });
  });
});

describe('pruneOutputPyramids', () => {
  it('RC08: drops pyramids of removed indicators', () => {
    // Given
    const data = series(10);
    const set = indicatorSet(data, new Float64Array(10));
    set.series.rsi = { ...(set.series.ma as UiIndicatorSeries) };
    const cache = createRenderCache();
    outputPyramid(cache, set, 'ma', set.series.ma!, 0);
    outputPyramid(cache, set, 'rsi', set.series.rsi, 0);
    // When
    delete set.series.rsi;
    pruneOutputPyramids(cache, set);
    // Then
    expect(Object.keys(cache.outputs)).toEqual(['ma']);
  });
});

describe('cachedCandleRange', () => {
  it('RC09: matches candleRangeMinMax on both sides of the threshold', () => {
    // Given
    const data = series(5000);
    const cache = createRenderCache();
    for (const len of [PYRAMID_QUERY_MIN_BARS - 1, PYRAMID_QUERY_MIN_BARS]) {
      for (const start of [0, 17.5, 2500]) {
        const got = { min: NaN, max: NaN };
        const want = { min: NaN, max: NaN };
        // When
        const end = start + len - 1;
        const found = cachedCandleRange(cache, data, start, end, got);
        candleRangeMinMax(data, start, end, want);
        // Then
        expect(found).toBe(true);
        expect(got).toEqual(want);
      }
    }
  });

  it('RC10: reports an empty long range', () => {
    // Given
    const data = series(3000);
    data.low.fill(NaN);
    data.high.fill(NaN);
    const out = { min: 1, max: 2 };
    // When
    const found = cachedCandleRange(createRenderCache(), data, 0, 2999, out);
    // Then
    expect(found).toBe(false);
    expect(out).toEqual({ min: NaN, max: NaN });
  });
});

describe('cachedExtendRange', () => {
  it('RC11: matches the linear extension for short and long ranges', () => {
    // Given
    const data = series(5000);
    const values = Float64Array.from({ length: 5000 }, (_, i) =>
      i % 97 === 0 ? NaN : Math.cos(i / 50) * 200
    );
    const set = indicatorSet(data, values);
    const refs = [{ id: 'ma', output: 0 }];
    const cache = createRenderCache();
    for (const [start, end] of [
      [10, 400],
      [0, 4999],
      [123.5, 4000.2],
    ] as const) {
      const got = { min: 90, max: 110 };
      const want = { min: 90, max: 110 };
      // When
      cachedExtendRange(cache, set, data, refs, start, end, got);
      extendRangeWithOutputs(set, data, refs, start, end, want);
      // Then
      expect(got).toEqual(want);
    }
  });

  it('RC12: ignores unknown ids, outputs and unaligned series', () => {
    // Given
    const data = series(3000);
    const set = indicatorSet(data, new Float64Array(3000).fill(1e5));
    set.series.old = {
      ...(set.series.ma as UiIndicatorSeries),
      resetVersion: 99,
    };
    const refs = [
      { id: 'nope', output: 0 },
      { id: 'ma', output: 4 },
      { id: 'old', output: 0 },
    ];
    const out = { min: 1, max: 2 };
    // When
    cachedExtendRange(createRenderCache(), set, data, refs, 0, 2999, out);
    // Then
    expect(out).toEqual({ min: 1, max: 2 });
  });

  it('RC13: shifted refs read [left − offset, right − offset]', () => {
    // Given: a forward (+26) and a backward (−26) shifted output
    const data = series(5000);
    const values = Float64Array.from(
      { length: 5000 },
      (_, i) => Math.sin(i / 40) * 300
    );
    const set = indicatorSet(data, values);
    const refs = [
      { id: 'ma', output: 0, offset: 26 },
      { id: 'ma', output: 0, offset: -26 },
    ];
    const cache = createRenderCache();
    for (const [start, end, left, right] of [
      [4800, 4999, 4800, 5030],
      [0, 4999, -10, 5030],
    ] as const) {
      const got = { min: 90, max: 110 };
      const want = { min: 90, max: 110 };
      // When
      cachedExtendRange(cache, set, data, refs, start, end, got, left, right);
      extendRangeWithOutputs(set, data, refs, start, end, want, left, right);
      // Then
      expect(got).toEqual(want);
      expect(got.max).toBeGreaterThan(110);
    }
  });
});
