/**
 * Test perspective table — TimeAnchor
 *
 * | Case | Input / Precondition                                  | Perspective          | Expected                                    |
 * |------|-------------------------------------------------------|----------------------|---------------------------------------------|
 * | TA1  | exact bar times (first / middle / last)               | Equivalence          | whole indices 0 / 2 / n−1                   |
 * | TA2  | time between two bars (session gap 1 min → 5 min)     | Equivalence          | fractional index by the gap                 |
 * | TA3  | time after the last / before the first bar, barMs 1m  | Boundary (outside)   | extrapolated (n−1+k / −k)                   |
 * | TA4  | outside with barMs 0 / NaN / −1 / ∞                   | Invalid              | clamped to n−1 / 0                          |
 * | TA5  | empty series / NaN / ∞ time                           | Boundary / Invalid   | NaN                                         |
 * | TA6  | duplicate timestamps (t1 == t0 inside)                | Boundary             | index of the bar, no division by 0          |
 * | TA7  | offset ring (offset 3)                                | Equivalence          | same results as offset 0                    |
 * | IT1  | indexToTime whole / fractional / beyond both ends     | Equivalence          | inverse of timeToIndex                      |
 * | IT2  | indexToTime empty / NaN / ∞ index                     | Invalid              | NaN                                         |
 * | IT3  | indexToTime outside with invalid barMs                | Invalid              | first / last time                           |
 * | BI1  | barIndexAtTime inside / on a bar / after the last     | Equivalence          | containing bar / that bar / n−1             |
 * | BI2  | barIndexAtTime before first / empty / NaN             | Boundary / Invalid   | −1                                          |
 * | SN1  | snapIndexToTime 1.4 / 1.6 / 5.5 (future slot)         | Equivalence          | bar 1 / bar 2 / slot 6 time                 |
 * | SN2  | snapIndexToTime NaN / empty series                    | Invalid              | NaN                                         |
 */
import { describe, expect, it } from '@jest/globals';
import {
  barIndexAtTime,
  indexToTime,
  snapIndexToTime,
  timeToIndex,
} from '../TimeAnchor';
import { columns, minuteBars, MIN, T0 } from './fixtures';

const five = minuteBars(5);
const empty = columns([]);

describe('timeToIndex', () => {
  it.each([
    [T0, 0],
    [T0 + 2 * MIN, 2],
    [T0 + 4 * MIN, 4],
  ])('TA1: exact bar time %p → %p', (time, expected) => {
    // Given: five 1-minute bars
    // When: an exact bar time is converted
    // Then: a whole index
    expect(timeToIndex(five, time, MIN)).toBe(expected);
  });

  it('TA2: a time inside a gap maps proportionally', () => {
    // Given: bars at 0, 1 and 5 minutes (4-minute gap)
    const gap = columns([T0, T0 + MIN, T0 + 5 * MIN]);
    // When: the middle of the gap is converted
    // Then: index 1.5
    expect(timeToIndex(gap, T0 + 3 * MIN, MIN)).toBe(1.5);
  });

  it('TA3: times outside the data are extrapolated with barMs', () => {
    // Given / When / Then: 3 slots after the last, 2 before the first
    expect(timeToIndex(five, T0 + 7 * MIN, MIN)).toBe(7);
    expect(timeToIndex(five, T0 - 2 * MIN, MIN)).toBe(-2);
  });

  it.each([[0], [NaN], [-1], [Infinity]])(
    'TA4: invalid barMs %p clamps outside times',
    (barMs) => {
      // Given / When / Then
      expect(timeToIndex(five, T0 + 9 * MIN, barMs)).toBe(4);
      expect(timeToIndex(five, T0 - 9 * MIN, barMs)).toBe(0);
    }
  );

  it.each([
    [empty, T0],
    [five, NaN],
    [five, Infinity],
    [five, -Infinity],
  ])('TA5: no data / non-finite time → NaN (%#)', (series, time) => {
    // Given / When / Then
    expect(timeToIndex(series, time, MIN)).toBeNaN();
  });

  it('TA6: duplicate timestamps do not divide by zero', () => {
    // Given: bars 1 and 2 share a time
    const dup = columns([T0, T0 + MIN, T0 + MIN, T0 + 2 * MIN]);
    // When: a time between the duplicate and the next bar is converted
    const index = timeToIndex(dup, T0 + MIN, MIN);
    // Then: a finite index at the last duplicate
    expect(index).toBe(2);
  });

  it('TA7: a ring offset gives the same indices', () => {
    // Given: the same bars stored at physical offset 3
    const shifted = minuteBars(5, 3);
    // When / Then
    expect(timeToIndex(shifted, T0 + 2.5 * MIN, MIN)).toBe(2.5);
  });
});

describe('indexToTime', () => {
  it.each([
    [0, T0],
    [2.5, T0 + 2.5 * MIN],
    [6, T0 + 6 * MIN],
    [-1, T0 - MIN],
  ])('IT1: index %p → time', (index, expected) => {
    // Given / When / Then: the inverse of timeToIndex
    expect(indexToTime(five, index, MIN)).toBe(expected);
    expect(timeToIndex(five, expected, MIN)).toBe(index);
  });

  it.each([
    [empty, 1],
    [five, NaN],
    [five, Infinity],
  ])('IT2: invalid input → NaN (%#)', (series, index) => {
    // Given / When / Then
    expect(indexToTime(series, index, MIN)).toBeNaN();
  });

  it('IT3: invalid barMs pins outside indices to the end bars', () => {
    // Given / When / Then
    expect(indexToTime(five, 9, NaN)).toBe(T0 + 4 * MIN);
    expect(indexToTime(five, -3, 0)).toBe(T0);
  });
});

describe('barIndexAtTime', () => {
  it.each([
    [T0 + 1.5 * MIN, 1],
    [T0 + 3 * MIN, 3],
    [T0 + 99 * MIN, 4],
  ])('BI1: %p → bar %p', (time, expected) => {
    // Given / When / Then
    expect(barIndexAtTime(five, time)).toBe(expected);
  });

  it.each([
    [five, T0 - 1],
    [empty, T0],
    [five, NaN],
  ])('BI2: → -1 (%#)', (series, time) => {
    // Given / When / Then
    expect(barIndexAtTime(series, time)).toBe(-1);
  });
});

describe('snapIndexToTime', () => {
  it.each([
    [1.4, T0 + MIN],
    [1.6, T0 + 2 * MIN],
    [5.5, T0 + 6 * MIN],
  ])('SN1: %p → nearest slot', (index, expected) => {
    // Given / When / Then
    expect(snapIndexToTime(five, index, MIN)).toBe(expected);
  });

  it.each([
    [five, NaN],
    [empty, 1],
  ])('SN2: invalid → NaN (%#)', (series, index) => {
    // Given / When / Then
    expect(snapIndexToTime(series, index, MIN)).toBeNaN();
  });
});
