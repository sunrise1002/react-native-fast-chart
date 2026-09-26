/**
 * Test perspective table — MinMaxPyramid
 *
 * | Case  | Input / Precondition                                      | Perspective        | Expected                                     |
 * |-------|-----------------------------------------------------------|--------------------|----------------------------------------------|
 * | MP01  | random 1000 bars, every level bucket                      | Equivalence (prop.)| bucket min/max = brute force                 |
 * | MP02  | random ranges incl. unaligned / single bar                | Equivalence (prop.)| range min/max = brute force                  |
 * | MP03  | tail updates (from = changed bar), appends past capacity  | Equivalence        | same as a full rebuild; capacity doubles      |
 * | MP04  | shrink (length decreases, from ≤ length)                  | Boundary           | levels / length follow; queries clamp         |
 * | MP05  | NaN / ±∞ values, all-NaN bucket                           | Invalid            | skipped; empty bucket = +∞ / −∞               |
 * | MP06  | length 0 / 1 / NaN / ∞; from NaN / > length               | Boundary / invalid | 0 levels; single bar; clamps                  |
 * | MP07  | query start > end, outside data, all-NaN range            | Boundary (empty)   | false, out untouched                          |
 * | MP08  | query widens an existing out range / replaces NaN out     | Equivalence        | min/max widened only                          |
 * | MP09  | bucketCount / levelsFor boundaries (0, 1, 2, 3, 2^k)      | Boundary           | ceil / log2 ceil                              |
 * | MP10  | createMinMaxPyramid capacity 0 / 17 / NaN                 | Boundary           | 16 / 32 / 16                                  |
 * | MP11  | column offset                                             | Equivalence        | reads `source[offset + i]`                    |
 */
import { describe, expect, it } from '@jest/globals';
import {
  bucketCount,
  bucketMax,
  bucketMin,
  createMinMaxPyramid,
  levelsFor,
  pyramidRangeMinMax,
  syncPyramid,
} from '../MinMaxPyramid';
import { createSeededRandom } from '../../testing/fixtures/random';

function randomColumns(seed: number, n: number) {
  const next = createSeededRandom(seed);
  const low = new Float64Array(n);
  const high = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = 100 + next() * 50;
    low[i] = v - next() * 5;
    high[i] = v + next() * 5;
  }
  return { low, high };
}

function brute(
  low: ArrayLike<number>,
  high: ArrayLike<number>,
  from: number,
  to: number
) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    const l = low[i] as number;
    const h = high[i] as number;
    if (Number.isFinite(l) && l < min) min = l;
    if (Number.isFinite(h) && h > max) max = h;
  }
  return { min, max };
}

function expectBucketsMatch(
  p: ReturnType<typeof createMinMaxPyramid>,
  low: Float64Array,
  high: Float64Array,
  n: number
) {
  for (let level = 1; level <= p.levels; level++) {
    const size = 2 ** level;
    for (let b = 0; b < bucketCount(n, level); b++) {
      const e = brute(low, high, b * size, Math.min(n, (b + 1) * size) - 1);
      expect([level, b, bucketMin(p, level, b)]).toEqual([level, b, e.min]);
      expect([level, b, bucketMax(p, level, b)]).toEqual([level, b, e.max]);
    }
  }
}

describe('syncPyramid', () => {
  it('MP01: buckets match brute force at every level', () => {
    // Given
    const n = 1000;
    const { low, high } = randomColumns(1, n);
    const p = createMinMaxPyramid();
    // When
    syncPyramid(p, low, high, 0, n, 0);
    // Then
    expect(p.length).toBe(n);
    expect(p.levels).toBe(10);
    expect(bucketCount(n, p.levels)).toBe(1);
    expectBucketsMatch(p, low, high, n);
  });

  it('MP03: tail updates and growth equal a full rebuild', () => {
    // Given: 20 bars synced (capacity 32)
    const { low, high } = randomColumns(2, 300);
    const p = createMinMaxPyramid();
    syncPyramid(p, low, high, 0, 20, 0);
    expect(p.capacity).toBe(32);
    // When: the last bar changes, then bars are appended in batches
    low[19] = 1;
    high[19] = 999;
    syncPyramid(p, low, high, 0, 20, 19);
    expectBucketsMatch(p, low, high, 20);
    syncPyramid(p, low, high, 0, 32, 20);
    expect(p.capacity).toBe(32);
    syncPyramid(p, low, high, 0, 300, 32);
    // Then
    expect(p.capacity).toBe(512);
    expectBucketsMatch(p, low, high, 300);
  });

  it('MP04: shrinking re-derives the levels', () => {
    // Given
    const { low, high } = randomColumns(3, 64);
    const p = createMinMaxPyramid();
    syncPyramid(p, low, high, 0, 64, 0);
    // When
    syncPyramid(p, low, high, 0, 5, 5);
    // Then
    expect(p.length).toBe(5);
    expect(p.levels).toBe(3);
    expectBucketsMatch(p, low, high, 5);
    const out = { min: NaN, max: NaN };
    expect(pyramidRangeMinMax(p, low, high, 0, 0, 63, out)).toBe(true);
    expect(out).toEqual(brute(low, high, 0, 4));
  });

  it('MP05: skips NaN / ±∞ and marks empty buckets', () => {
    // Given
    const low = Float64Array.from([NaN, NaN, -Infinity, 3, 5, Infinity]);
    const high = Float64Array.from([NaN, NaN, 4, Infinity, -Infinity, 9]);
    const p = createMinMaxPyramid();
    // When
    syncPyramid(p, low, high, 0, 6, 0);
    // Then
    expect([bucketMin(p, 1, 0), bucketMax(p, 1, 0)]).toEqual([
      Infinity,
      -Infinity,
    ]);
    expect([bucketMin(p, 1, 1), bucketMax(p, 1, 1)]).toEqual([3, 4]);
    expect([bucketMin(p, 1, 2), bucketMax(p, 1, 2)]).toEqual([5, 9]);
    expect([bucketMin(p, 3, 0), bucketMax(p, 3, 0)]).toEqual([3, 9]);
  });

  it('MP06: handles degenerate lengths and from values', () => {
    // Given
    const low = Float64Array.from([1, 2, 3]);
    const high = Float64Array.from([4, 5, 6]);
    const p = createMinMaxPyramid();
    // When / Then
    syncPyramid(p, low, high, 0, 0, 0);
    expect([p.length, p.levels]).toEqual([0, 0]);
    syncPyramid(p, low, high, 0, NaN, NaN);
    expect([p.length, p.levels]).toEqual([0, 0]);
    syncPyramid(p, low, high, 0, Infinity, 0);
    expect(p.length).toBe(0);
    syncPyramid(p, low, high, 0, 1, 0);
    expect([p.length, p.levels]).toEqual([1, 0]);
    syncPyramid(p, low, high, 0, 3, 99);
    expect([bucketMin(p, 1, 1), bucketMax(p, 1, 1)]).toEqual([3, 6]);
    syncPyramid(p, low, high, 0, 3, -5);
    expectBucketsMatch(p, low, high, 3);
  });

  it('MP11: reads columns through the offset', () => {
    // Given: 2 padding values
    const low = Float64Array.from([-99, -99, 5, 1, 7]);
    const high = Float64Array.from([99, 99, 6, 2, 8]);
    const p = createMinMaxPyramid();
    // When
    syncPyramid(p, low, high, 2, 3, 0);
    const out = { min: NaN, max: NaN };
    // Then
    expect([bucketMin(p, 2, 0), bucketMax(p, 2, 0)]).toEqual([1, 8]);
    expect(pyramidRangeMinMax(p, low, high, 2, 2, 2, out)).toBe(true);
    expect(out).toEqual({ min: 7, max: 8 });
  });
});

describe('pyramidRangeMinMax', () => {
  it('MP02: random ranges match brute force', () => {
    // Given
    const n = 777;
    const { low, high } = randomColumns(4, n);
    low[100] = NaN;
    high[200] = Infinity;
    const p = createMinMaxPyramid();
    syncPyramid(p, low, high, 0, n, 0);
    const next = createSeededRandom(5);
    for (let r = 0; r < 500; r++) {
      const a = Math.floor(next() * n);
      const b = a + Math.floor(next() * (n - a));
      const out = { min: NaN, max: NaN };
      // When
      const found = pyramidRangeMinMax(p, low, high, 0, a, b, out);
      // Then
      expect(found).toBe(true);
      expect([a, b, out]).toEqual([a, b, brute(low, high, a, b)]);
    }
  });

  it('MP07: returns false for empty or non-finite ranges', () => {
    // Given
    const low = Float64Array.from([NaN, -Infinity, 1, 2]);
    const high = Float64Array.from([NaN, Infinity, 3, 4]);
    const p = createMinMaxPyramid();
    syncPyramid(p, low, high, 0, 4, 0);
    const out = { min: 7, max: 8 };
    // When / Then
    expect(pyramidRangeMinMax(p, low, high, 0, 3, 2, out)).toBe(false);
    expect(pyramidRangeMinMax(p, low, high, 0, 10, 20, out)).toBe(false);
    expect(pyramidRangeMinMax(p, low, high, 0, 0, 1, out)).toBe(false);
    expect(pyramidRangeMinMax(p, low, high, 0, NaN, 3, out)).toBe(false);
    expect(pyramidRangeMinMax(p, low, high, 0, 0, NaN, out)).toBe(false);
    expect(pyramidRangeMinMax(p, low, high, 0, 1, 1, out)).toBe(false);
    expect(out).toEqual({ min: 7, max: 8 });
    expect(
      pyramidRangeMinMax(createMinMaxPyramid(), low, high, 0, 0, 3, out)
    ).toBe(false);
  });

  it('MP08: widens an existing range and replaces NaN bounds', () => {
    // Given
    const low = Float64Array.from([5, 6, 7, 8]);
    const high = Float64Array.from([10, 11, 12, 13]);
    const p = createMinMaxPyramid();
    syncPyramid(p, low, high, 0, 4, 0);
    const wide = { min: 0, max: 100 };
    const narrow = { min: 9, max: 9 };
    const nan = { min: NaN, max: 50 };
    // When
    pyramidRangeMinMax(p, low, high, 0, -3, 99, wide);
    pyramidRangeMinMax(p, low, high, 0, 0.5, 2.5, narrow);
    pyramidRangeMinMax(p, low, high, 0, 0, 3, nan);
    // Then
    expect(wide).toEqual({ min: 0, max: 100 });
    expect(narrow).toEqual({ min: 6, max: 12 });
    expect(nan).toEqual({ min: 5, max: 50 });
  });
});

describe('sizing helpers', () => {
  it('MP09: bucketCount / levelsFor', () => {
    // Given / When / Then
    expect(bucketCount(0, 0)).toBe(0);
    expect(bucketCount(5, 0)).toBe(5);
    expect(bucketCount(5, 1)).toBe(3);
    expect(bucketCount(-1, 1)).toBe(0);
    expect([0, 1, 2, 3, 4, 5, 1024, 1025].map(levelsFor)).toEqual([
      0, 0, 1, 2, 2, 3, 10, 11,
    ]);
  });

  it('MP10: createMinMaxPyramid rounds capacity to a power of two', () => {
    // Given / When / Then
    expect(createMinMaxPyramid().capacity).toBe(16);
    expect(createMinMaxPyramid(17).capacity).toBe(32);
    expect(createMinMaxPyramid(NaN).capacity).toBe(16);
    expect(createMinMaxPyramid(-4).capacity).toBe(16);
  });
});
