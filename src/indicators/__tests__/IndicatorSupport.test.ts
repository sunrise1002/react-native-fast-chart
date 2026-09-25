/**
 * Test perspective table — series helpers, adapters, cache, listeners
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                   |
 * |------|---------------------------------------------------|--------------------|--------------------------------------------|
 * | S1   | readSource for every source + offset              | Equivalence        | correct derived price                       |
 * | S2   | growCapacity(0) / (n, current)                    | Boundary (0)       | 64 headroom / ×1.5 growth                   |
 * | S3   | nanColumn(0 / −1 / 3)                             | Boundary (0, −1)   | empty / empty / NaN-filled                  |
 * | S4   | ensureResultCapacity within / beyond / no outputs | Boundary           | untouched / grown, values kept              |
 * | S5   | isFiniteValue(1, NaN, ±Infinity, 0)               | Equivalence        | only finite → true                          |
 * | A1   | toLinePoints with warm-up NaN                     | Normal / Abnormal  | null values, candle times                   |
 * | A2   | result longer than candles                        | Boundary           | clipped to candle length                    |
 * | A3   | toMultiLine names                                 | Normal             | one line per name                           |
 * | A4   | toBandPoints with/without middle, NaN rows        | Normal / Abnormal  | skips non-finite rows, middle optional      |
 * | A5   | histogramPolarity(+, −, 0) / toHistogramPoints    | Equivalence        | positive / negative / neutral; skips NaN    |
 * | A6   | unknown output index                              | Invalid input      | RangeError with message                     |
 * | C1   | cache get with matching / stale versions          | Equivalence        | hit / miss                                  |
 * | C2   | cache peek / delete / clear / size                | Normal / Boundary  | expected sizes, missing id → undefined      |
 * | L1   | ListenerSet add / emit / unsubscribe during emit  | Normal / Abnormal  | snapshot iteration, unsubscribed not called |
 * | L2   | ListenerSet clear / double unsubscribe            | Boundary           | size 0, no throw                            |
 */
import { describe, expect, it, jest } from '@jest/globals';
import { ListenerSet } from '../../utils/ListenerSet';
import type { IndicatorResult } from '../Indicator';
import {
  histogramPolarity,
  toBandPoints,
  toHistogramPoints,
  toLinePoints,
  toMultiLine,
} from '../IndicatorAdapters';
import { IndicatorCache } from '../IndicatorCache';
import {
  createIndicatorResult,
  ensureResultCapacity,
  growCapacity,
  isFiniteValue,
  nanColumn,
  readSource,
} from '../IndicatorSeries';
import { columnsOf } from './indicatorTestUtils';

function resultOf(...columns: number[][]): IndicatorResult {
  return {
    outputs: columns.map((c) => Float64Array.from(c)),
    length: columns[0]?.length ?? 0,
    committed: 0,
    changedFrom: 0,
    state: undefined,
  };
}

describe('IndicatorSeries', () => {
  it('S1: readSource with offset', () => {
    // Given
    const c = columnsOf([{ open: 1, high: 6, low: 2, close: 3 }], 4);
    // When / Then
    expect(readSource(c, 0, 'open')).toBe(1);
    expect(readSource(c, 0, 'high')).toBe(6);
    expect(readSource(c, 0, 'low')).toBe(2);
    expect(readSource(c, 0, 'close')).toBe(3);
    expect(readSource(c, 0, 'hl2')).toBe(4);
    expect(readSource(c, 0, 'hlc3')).toBeCloseTo(11 / 3, 12);
    expect(readSource(c, 0, 'ohlc4')).toBe(3);
  });

  it('S2: growCapacity', () => {
    // Given / When / Then
    expect(growCapacity(0)).toBe(64);
    expect(growCapacity(10, 100)).toBe(214);
    expect(growCapacity(1000, 100)).toBe(1064);
  });

  it('S3: nanColumn', () => {
    // Given / When / Then
    expect(nanColumn(0)).toHaveLength(0);
    expect(nanColumn(-1)).toHaveLength(0);
    expect(Array.from(nanColumn(3)).every(Number.isNaN)).toBe(true);
  });

  it('S4: ensureResultCapacity', () => {
    // Given
    const r = createIndicatorResult(2, 4, null);
    (r.outputs[0] as Float64Array)[0] = 5;
    r.length = 1;
    const before = r.outputs[0];
    // When
    ensureResultCapacity(r, 4);
    // Then: untouched
    expect(r.outputs[0]).toBe(before);
    // When
    ensureResultCapacity(r, 5);
    // Then: grown, value kept, tail NaN
    expect((r.outputs[0] as Float64Array).length).toBe(70);
    expect(r.outputs[0]?.[0]).toBe(5);
    expect(Number.isNaN(r.outputs[1]?.[4] as number)).toBe(true);
    // Given / When: no outputs at all
    const none = createIndicatorResult(0, 0, null);
    ensureResultCapacity(none, 10);
    // Then
    expect(none.outputs).toHaveLength(0);
  });

  it('S5: isFiniteValue', () => {
    // Given / When / Then
    expect(isFiniteValue(1)).toBe(true);
    expect(isFiniteValue(0)).toBe(true);
    expect(isFiniteValue(NaN)).toBe(false);
    expect(isFiniteValue(Infinity)).toBe(false);
    expect(isFiniteValue(-Infinity)).toBe(false);
  });
});

describe('IndicatorAdapters', () => {
  const candles = columnsOf([1, 2, 3], 2);

  it('A1: toLinePoints maps warm-up to null', () => {
    // Given
    const r = resultOf([NaN, 2, Infinity]);
    // When
    const points = toLinePoints(r, candles);
    // Then
    expect(points).toEqual([
      { time: 1000, value: null },
      { time: 2000, value: 2 },
      { time: 3000, value: null },
    ]);
  });

  it('A2: clipped to the candle length', () => {
    // Given
    const r = resultOf([1, 2, 3, 4, 5]);
    // When / Then
    expect(toLinePoints(r, candles)).toHaveLength(3);
    expect(toLinePoints(resultOf([]), candles)).toEqual([]);
  });

  it('A3: toMultiLine', () => {
    // Given
    const r = resultOf([1, 2, 3], [4, 5, 6]);
    // When
    const { lines } = toMultiLine(r, candles, ['a', 'b']);
    // Then
    expect(Object.keys(lines)).toEqual(['a', 'b']);
    expect(lines.b?.[2]).toEqual({ time: 3000, value: 6 });
  });

  it('A4: toBandPoints', () => {
    // Given
    const r = resultOf([3, NaN, 5], [2, 3, NaN], [1, 1, 1]);
    // When
    const withMiddle = toBandPoints(r, candles, 0, 2, 1);
    const plain = toBandPoints(r, candles, 0, 2);
    // Then
    expect(withMiddle).toEqual([
      { time: 1000, upper: 3, lower: 1, middle: 2 },
      { time: 3000, upper: 5, lower: 1 },
    ]);
    expect(plain).toEqual([
      { time: 1000, upper: 3, lower: 1 },
      { time: 3000, upper: 5, lower: 1 },
    ]);
  });

  it('A5: histogram polarity and points', () => {
    // Given / When / Then
    expect(histogramPolarity(2)).toBe('positive');
    expect(histogramPolarity(-2)).toBe('negative');
    expect(histogramPolarity(0)).toBe('neutral');
    expect(toHistogramPoints(resultOf([1, NaN, -1]), candles)).toEqual([
      { time: 1000, value: 1, polarity: 'positive' },
      { time: 3000, value: -1, polarity: 'negative' },
    ]);
  });

  it('A6: unknown output throws RangeError', () => {
    // Given
    const r = resultOf([1, 2, 3]);
    // When / Then
    expect(() => toLinePoints(r, candles, 1)).toThrow(
      new RangeError('Indicator output 1 does not exist')
    );
    expect(() => toBandPoints(r, candles, 0, 5)).toThrow(RangeError);
    expect(() => toBandPoints(r, candles, 0, 0, 9)).toThrow(RangeError);
    expect(() => toHistogramPoints(r, candles, -1)).toThrow(
      'Indicator output -1 does not exist'
    );
  });
});

describe('IndicatorCache', () => {
  const entry = (id: string, datasetVersion = 1, configVersion = 0) => ({
    id,
    datasetVersion,
    configVersion,
    resetVersion: 1,
    firstTime: 0,
    result: resultOf([1]),
  });

  it('C1: get validates both versions', () => {
    // Given
    const cache = new IndicatorCache();
    const e = entry('a', 3, 1);
    cache.set(e);
    // When / Then
    expect(cache.get('a', 3, 1)).toBe(e.result);
    expect(cache.get('a', 4, 1)).toBeUndefined();
    expect(cache.get('a', 3, 2)).toBeUndefined();
    expect(cache.get('b', 3, 1)).toBeUndefined();
  });

  it('C2: peek / delete / clear / size', () => {
    // Given
    const cache = new IndicatorCache();
    cache.set(entry('a'));
    cache.set(entry('b'));
    // When / Then
    expect(cache.size).toBe(2);
    expect(cache.peek('a')?.id).toBe('a');
    expect(cache.peek('zz')).toBeUndefined();
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('ListenerSet', () => {
  it('L1: emits to a snapshot', () => {
    // Given
    const set = new ListenerSet<[number]>();
    const second = jest.fn();
    let unsubscribeSecond = () => {};
    const first = jest.fn(() => unsubscribeSecond());
    set.add(first);
    unsubscribeSecond = set.add(second);
    // When
    set.emit(1);
    set.emit(2);
    // Then
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  it('L2: clear and double unsubscribe', () => {
    // Given
    const set = new ListenerSet<[]>();
    const off = set.add(() => {});
    set.add(() => {});
    // When
    off();
    off();
    // Then
    expect(set.size).toBe(1);
    set.clear();
    expect(set.size).toBe(0);
    expect(() => set.emit()).not.toThrow();
  });
});
