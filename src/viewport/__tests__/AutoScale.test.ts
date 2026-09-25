/**
 * Test perspective table — AutoScale
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                              |
 * |------|----------------------------------------------------|--------------------|---------------------------------------|
 * | C1   | whole store                                        | Equivalence        | min low / max high                    |
 * | C2   | sub-range incl. single bar                         | Boundary (1)       | that bar's low/high                   |
 * | C3   | range beyond data / fractional bounds              | Boundary           | clamped (ceil start, floor end)       |
 * | C4   | reversed / fully outside / empty store             | Boundary (empty)   | false, NaN                            |
 * | C5   | NaN start or end                                   | Abnormal           | false, NaN                            |
 * | C6   | NaN highs with finite lows (raw columns)           | Abnormal           | false                                 |
 * | C7   | store grown at the front (offset > 0)              | Invariant          | matches a naive scan                  |
 * | R1   | plain array with null / undefined / NaN / ±Inf     | Invalid values     | skipped                               |
 * | R2   | all values missing                                 | Boundary (empty)   | false, NaN                            |
 * | R3   | Float64Array with offset / length                  | Equivalence        | window honoured                       |
 * | R4   | negative / single values                           | Boundary           | correct                               |
 * | R5   | positive fractional start                          | Boundary           | rounded up                            |
 * | P1   | 100k store, 10k frames of 500 visible bars         | Performance        | well under budget                     |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceRange } from '../../core/ChartTypes';
import type { CandleColumns } from '../../data/CandleBuffer';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { candleRangeMinMax, rangeMinMax } from '../AutoScale';

const fresh = (): PriceRange => ({ min: 0, max: 0 });

const store = new CandleStore([
  { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 1 },
  { time: 2, open: 11, high: 15, low: 10, close: 14, volume: 1 },
  { time: 3, open: 14, high: 14, low: 5, close: 6, volume: 1 },
  { time: 4, open: 6, high: 8, low: 6, close: 7, volume: 1 },
]);

describe('candleRangeMinMax', () => {
  it('C1: whole store', () => {
    // Given
    const out = fresh();
    // When
    const ok = candleRangeMinMax(store.columns, 0, 3, out);
    // Then
    expect(ok).toBe(true);
    expect(out).toEqual({ min: 5, max: 15 });
  });

  it('C2: single bar', () => {
    // Given
    const out = fresh();
    // When / Then
    expect(candleRangeMinMax(store.columns, 3, 3, out)).toBe(true);
    expect(out).toEqual({ min: 6, max: 8 });
  });

  it('C3: clamps and rounds inward', () => {
    // Given
    const out = fresh();
    // When / Then
    expect(candleRangeMinMax(store.columns, -50, 1e9, out)).toBe(true);
    expect(out).toEqual({ min: 5, max: 15 });
    expect(candleRangeMinMax(store.columns, 0.2, 1.9, out)).toBe(true);
    expect(out).toEqual({ min: 10, max: 15 });
  });

  it.each([
    [3, 1],
    [10, 20],
    [-5, -1],
  ])('C4: empty range (%p, %p)', (a, b) => {
    // Given
    const out = fresh();
    // When / Then
    expect(candleRangeMinMax(store.columns, a, b, out)).toBe(false);
    expect(out.min).toBeNaN();
    expect(out.max).toBeNaN();
  });

  it('C4: empty store', () => {
    // Given / When / Then
    expect(candleRangeMinMax(new CandleStore().columns, 0, 10, fresh())).toBe(
      false
    );
  });

  it.each([
    [NaN, 3],
    [0, NaN],
  ])('C5: NaN bound (%p, %p)', (a, b) => {
    // Given / When / Then
    expect(candleRangeMinMax(store.columns, a, b, fresh())).toBe(false);
  });

  it('C6: non-finite highs in raw columns', () => {
    // Given: hand-made columns with NaN highs
    const n = 2;
    const columns: CandleColumns = {
      time: new Float64Array([1, 2]),
      open: new Float64Array(n),
      high: new Float64Array([NaN, NaN]),
      low: new Float64Array([1, 2]),
      close: new Float64Array(n),
      volume: new Float64Array(n),
      offset: 0,
      length: n,
    };
    // When / Then
    expect(candleRangeMinMax(columns, 0, 1, fresh())).toBe(false);
  });

  it('C7: matches a naive scan after front growth', () => {
    // Given
    const candles = generateCandles({ count: 3000, seed: 5 });
    const s = new CandleStore(candles.slice(2000));
    s.prepend(candles.slice(0, 2000));
    const out = fresh();
    // When
    candleRangeMinMax(s.columns, 1234, 2345, out);
    // Then
    const window = candles.slice(1234, 2346);
    expect(out.min).toBe(Math.min(...window.map((c) => c.low)));
    expect(out.max).toBe(Math.max(...window.map((c) => c.high)));
  });

  it('P1: 10k autoscale frames over 500 bars of a 100k store', () => {
    // Given
    const s = new CandleStore(generateCandles({ count: 100_000, seed: 1 }));
    const out = fresh();
    // When
    const t0 = Date.now();
    for (let f = 0; f < 10_000; f++) {
      const start = (f * 37) % 99_500;
      candleRangeMinMax(s.columns, start, start + 499, out);
    }
    // Then: ~0.5 ms/frame would already fail — generous CI threshold
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('rangeMinMax', () => {
  it('R1: skips missing and non-finite values', () => {
    // Given
    const values = [null, 3, undefined, NaN, -Infinity, 7, Infinity, 5];
    const out = fresh();
    // When / Then
    expect(rangeMinMax(values, 0, 7, out)).toBe(true);
    expect(out).toEqual({ min: 3, max: 7 });
  });

  it.each([[[] as number[]], [[null, undefined, NaN]]])(
    'R2: nothing finite in %p',
    (values) => {
      // Given
      const out = fresh();
      // When / Then
      expect(rangeMinMax(values, 0, 10, out)).toBe(false);
      expect(out.min).toBeNaN();
    }
  );

  it('R3: honours offset and length', () => {
    // Given: logical window [2, 3, 4] inside a bigger buffer
    const buffer = new Float64Array([100, -100, 2, 3, 4, -100, 100]);
    const out = fresh();
    // When
    const ok = rangeMinMax(buffer, 0, 99, out, 2, 3);
    // Then
    expect(ok).toBe(true);
    expect(out).toEqual({ min: 2, max: 4 });
    expect(rangeMinMax(buffer, NaN, 3, out)).toBe(false);
  });

  it('R4: negative and single values', () => {
    // Given
    const out = fresh();
    // When / Then
    expect(rangeMinMax([-5, -2, -9], 0, 2, out)).toBe(true);
    expect(out).toEqual({ min: -9, max: -2 });
    expect(rangeMinMax([42], 0, 0, out)).toBe(true);
    expect(out).toEqual({ min: 42, max: 42 });
  });

  it('R5: positive fractional start is rounded up', () => {
    // Given
    const out = fresh();
    // When / Then
    expect(rangeMinMax([1, 9, 5, 3], 1.5, 3, out)).toBe(true);
    expect(out).toEqual({ min: 3, max: 5 });
  });
});
