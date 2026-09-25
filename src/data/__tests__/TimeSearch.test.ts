/**
 * Test perspective table — TimeSearch (binary searches over time columns)
 *
 * | Case | Input / Precondition                         | Perspective        | Expected                                  |
 * |------|----------------------------------------------|--------------------|-------------------------------------------|
 * | B1   | empty column                                 | Boundary (empty)   | bounds 0, exact -1, nearest -1            |
 * | B2   | single element, query below / equal / above  | Boundary (1)       | 0/0/1 lower, 0/1/1 upper                  |
 * | B3   | query equal to every element                 | Equivalence        | exact index found                         |
 * | B4   | query between elements                       | Equivalence        | exact -1, bounds point to next element    |
 * | B5   | query below first / above last               | Boundary (±1)      | 0 / length                                |
 * | B6   | non-zero offset (head room)                  | Equivalence        | logical indices returned                  |
 * | B7   | NaN query                                    | Abnormal           | exact -1, nearest -1                      |
 * | B8   | ±Infinity query                              | Abnormal           | 0 / length, nearest first / last          |
 * | N1   | nearest: closer to next / previous / tie     | Equivalence/Bound. | next / previous / earlier on tie          |
 * | P1   | 1M elements, 100k random queries             | Performance        | matches linear reference, fast            |
 */
import { describe, expect, it } from '@jest/globals';
import {
  findExactIndex,
  findNearest,
  lowerBound,
  upperBound,
} from '../TimeSearch';

const col = (values: number[], offset = 0) => {
  const arr = new Float64Array(values.length + offset + 3);
  arr.fill(-999);
  arr.set(values, offset);
  return { arr, offset, length: values.length };
};

describe('TimeSearch', () => {
  it('B1: empty column', () => {
    // Given: no elements
    const { arr, offset, length } = col([]);
    // When / Then
    expect(lowerBound(arr, offset, length, 5)).toBe(0);
    expect(upperBound(arr, offset, length, 5)).toBe(0);
    expect(findExactIndex(arr, offset, length, 5)).toBe(-1);
    expect(findNearest(arr, offset, length, 5)).toBe(-1);
  });

  it.each([
    [5, 0, 0, -1],
    [10, 0, 1, 0],
    [15, 1, 1, -1],
  ])('B2: single element, query %p', (q, lo, up, exact) => {
    // Given: [10]
    const { arr, offset, length } = col([10]);
    // When / Then
    expect(lowerBound(arr, offset, length, q)).toBe(lo);
    expect(upperBound(arr, offset, length, q)).toBe(up);
    expect(findExactIndex(arr, offset, length, q)).toBe(exact);
    expect(findNearest(arr, offset, length, q)).toBe(0);
  });

  it('B3: finds every existing element', () => {
    // Given: 0,10,...,990
    const values = Array.from({ length: 100 }, (_, i) => i * 10);
    const { arr, offset, length } = col(values);
    // When / Then
    values.forEach((v, i) => {
      expect(findExactIndex(arr, offset, length, v)).toBe(i);
      expect(lowerBound(arr, offset, length, v)).toBe(i);
      expect(upperBound(arr, offset, length, v)).toBe(i + 1);
    });
  });

  it('B4: query between elements', () => {
    // Given
    const { arr, offset, length } = col([10, 20, 30]);
    // When / Then
    expect(findExactIndex(arr, offset, length, 25)).toBe(-1);
    expect(lowerBound(arr, offset, length, 25)).toBe(2);
    expect(upperBound(arr, offset, length, 25)).toBe(2);
  });

  it('B5: query outside the data', () => {
    // Given
    const { arr, offset, length } = col([10, 20, 30]);
    // When / Then
    expect(lowerBound(arr, offset, length, 9)).toBe(0);
    expect(lowerBound(arr, offset, length, 31)).toBe(3);
    expect(upperBound(arr, offset, length, 30)).toBe(3);
    expect(findExactIndex(arr, offset, length, 31)).toBe(-1);
  });

  it('B6: honours the physical offset', () => {
    // Given: data stored after 7 slots of head room (filled with -999)
    const { arr, offset, length } = col([10, 20, 30], 7);
    // When / Then: logical indices
    expect(findExactIndex(arr, offset, length, 20)).toBe(1);
    expect(lowerBound(arr, offset, length, -1000)).toBe(0);
    expect(findNearest(arr, offset, length, 29)).toBe(2);
  });

  it('B7: NaN query', () => {
    // Given
    const { arr, offset, length } = col([10, 20]);
    // When / Then
    expect(findExactIndex(arr, offset, length, NaN)).toBe(-1);
    expect(findNearest(arr, offset, length, NaN)).toBe(-1);
  });

  it('B8: infinite queries', () => {
    // Given
    const { arr, offset, length } = col([10, 20]);
    // When / Then
    expect(lowerBound(arr, offset, length, -Infinity)).toBe(0);
    expect(lowerBound(arr, offset, length, Infinity)).toBe(2);
    expect(findNearest(arr, offset, length, -Infinity)).toBe(0);
    expect(findNearest(arr, offset, length, Infinity)).toBe(1);
  });

  it.each([
    [18, 1],
    [12, 0],
    [15, 0],
    [20, 1],
  ])('N1: nearest to %p is %p', (q, expected) => {
    // Given
    const { arr, offset, length } = col([10, 20, 30]);
    // When / Then
    expect(findNearest(arr, offset, length, q)).toBe(expected);
  });

  it('P1: 1M elements, 100k queries agree with a reference', () => {
    // Given: sorted times with a stride of 2 (odd queries miss)
    const n = 1_000_000;
    const arr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      arr[i] = i * 2;
    }
    // When
    const t0 = Date.now();
    let mismatches = 0;
    for (let k = 0; k < 100_000; k++) {
      const q = (k * 7919) % (2 * n);
      const expected = Math.ceil(q / 2);
      if (lowerBound(arr, 0, n, q) !== expected) {
        mismatches++;
      }
    }
    // Then
    expect(mismatches).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
