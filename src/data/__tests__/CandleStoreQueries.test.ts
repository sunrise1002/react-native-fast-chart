/**
 * Test perspective table — CandleStore read API
 *
 * | Case | Input / Precondition                        | Perspective        | Expected                                   |
 * |------|---------------------------------------------|--------------------|--------------------------------------------|
 * | G1   | get(0) / get(n-1)                           | Boundary (min/max) | fresh Candle objects                       |
 * | G2   | get(-1) / get(n) / get(1.5) / get(NaN)      | Boundary / invalid | undefined                                  |
 * | G3   | timeAt out of range                         | Boundary           | NaN                                        |
 * | R1   | getRange(1, 3)                              | Equivalence        | bars 1..2 (end exclusive)                  |
 * | R2   | getRange clamps (-5, 99) / reversed / NaN   | Boundary / invalid | clamped / empty                            |
 * | Q1   | findIndexByTime hit / miss / NaN            | Equiv. / Abnormal  | index / -1 / -1                            |
 * | Q2   | findNearestIndex between bars / empty       | Equiv. / empty     | nearest / -1                               |
 * | Q3   | lowerBound / upperBound                     | Equivalence        | bound indices                              |
 * | C1   | columns layout after prepend                | Invariant          | column[offset + i] matches get(i)          |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../CandleStore';
import { bar, bars, MIN, T0 } from './bars';

describe('CandleStore: queries', () => {
  const store = new CandleStore(bars(0, 4));

  it('G1: get returns fresh candles at the ends', () => {
    // Given / When
    const first = store.get(0);
    const again = store.get(0);
    // Then
    expect(first).toEqual(bar(0));
    expect(first).not.toBe(again);
    expect(store.get(4)).toEqual(bar(4));
  });

  it.each([-1, 5, 1.5, NaN])('G2: get(%p) is undefined', (i) => {
    // Given / When / Then
    expect(store.get(i)).toBeUndefined();
  });

  it.each([-1, 5])('G3: timeAt(%p) is NaN', (i) => {
    // Given / When / Then
    expect(store.timeAt(i)).toBeNaN();
  });

  it('R1: getRange is end-exclusive', () => {
    // Given / When
    const range = store.getRange(1, 3);
    // Then
    expect(range).toEqual([bar(1), bar(2)]);
  });

  it.each([
    [-5, 99, 5],
    [3, 1, 0],
    [NaN, 2, 2],
    [0, NaN, 0],
  ])('R2: getRange(%p, %p) has %p bars', (a, b, n) => {
    // Given / When / Then
    expect(store.getRange(a, b)).toHaveLength(n);
  });

  it('Q1: exact lookup', () => {
    // Given / When / Then
    expect(store.findIndexByTime(T0 + 2 * MIN)).toBe(2);
    expect(store.findIndexByTime(T0 + 2 * MIN + 1)).toBe(-1);
    expect(store.findIndexByTime(NaN)).toBe(-1);
  });

  it('Q2: nearest lookup', () => {
    // Given / When / Then
    expect(store.findNearestIndex(T0 + 2.6 * MIN)).toBe(3);
    expect(store.findNearestIndex(T0 - 1e9)).toBe(0);
    expect(new CandleStore().findNearestIndex(T0)).toBe(-1);
  });

  it('Q3: bounds', () => {
    // Given / When / Then
    expect(store.lowerBound(T0 + MIN)).toBe(1);
    expect(store.upperBound(T0 + MIN)).toBe(2);
    expect(store.lowerBound(T0 + 99 * MIN)).toBe(5);
  });

  it('C1: raw columns match the object accessor', () => {
    // Given: a store that grew at the front
    const s = new CandleStore(bars(100, 110));
    s.prepend(bars(0, 99));
    const c = s.columns;
    // When / Then
    for (let i = 0; i < s.length; i += 7) {
      const candle = s.get(i);
      expect(c.time[c.offset + i]).toBe(candle?.time);
      expect(c.low[c.offset + i]).toBe(candle?.low);
    }
    expect(c.length).toBe(111);
  });
});
