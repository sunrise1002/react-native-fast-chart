/**
 * Test perspective table — time interval ladder, interval selection and
 * bar-duration estimate (TimeTicks).
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                    |
 * |------|----------------------------------------------------------|--------------------|---------------------------------------------|
 * | TT1  | ladder consistency                                       | Equivalence        | units / counts aligned, ascending durations |
 * | TT2  | timeIntervalMs -1 / 999 / 1.5                            | Invalid            | NaN                                         |
 * | TT3  | 1 m bars, 8 dp, min 60 dp → 10 m                         | Equivalence        | 10 min                                      |
 * | TT4  | 4 h bars skip 6 h (not a multiple) → 12 h                | Equivalence        | 12 h                                        |
 * | TT5  | daily bars zoomed out → months / years                   | Equivalence        | month / year units                          |
 * | TT6  | weekly bars never use day units                          | Boundary           | month unit                                  |
 * | TT7  | min spacing 0 → the bar interval itself                  | Boundary (0)       | 1 m                                         |
 * | TT8  | extreme zoom-out → last ladder entry                     | Boundary (max)     | 100 y                                       |
 * | TT9  | invalid barMs / spacing / min spacing                    | Invalid            | -1                                          |
 * | TT10 | estimateBarInterval regular / gaps / duplicates          | Equivalence        | min positive gap                            |
 * | TT11 | estimateBarInterval 0 / 1 bar / all equal                | Boundary           | NaN                                         |
 * | TT12 | estimateBarInterval sample 0 / window / offset           | Boundary           | ≥ 1 gap; last `sample` gaps; offset honored |
 */
import { describe, expect, it } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  estimateBarInterval,
  selectTimeInterval,
  TIME_INTERVAL_COUNTS,
  TIME_INTERVAL_UNITS,
  TIME_UNIT_DAY,
  TIME_UNIT_MONTH,
  TIME_UNIT_YEAR,
  timeIntervalMs,
} from '../TimeTicks';

const MIN = MS_PER_MINUTE;

function col(time: ArrayLike<number>, offset = 0) {
  return { time, offset, length: time.length - offset };
}

describe('interval ladder', () => {
  it('TT1: units and counts are aligned and ascending', () => {
    // Given / When / Then
    expect(TIME_INTERVAL_UNITS).toHaveLength(TIME_INTERVAL_COUNTS.length);
    for (let k = 1; k < TIME_INTERVAL_UNITS.length; k++) {
      expect(timeIntervalMs(k)).toBeGreaterThan(timeIntervalMs(k - 1));
    }
  });

  it.each([[-1], [999], [1.5]])('TT2: index %p → NaN', (k) => {
    // Given / When / Then
    expect(timeIntervalMs(k)).toBeNaN();
  });
});

describe('selectTimeInterval', () => {
  it('TT3: 1 m bars at 8 dp with 60 dp labels → 10 m', () => {
    // Given / When
    const k = selectTimeInterval(MIN, 8, 60);
    // Then
    expect(timeIntervalMs(k)).toBe(10 * MIN);
  });

  it('TT4: 4 h bars skip the 6 h interval', () => {
    // Given / When: 6 h would give 12 dp ≥ 10 but is not a multiple
    const k = selectTimeInterval(4 * MS_PER_HOUR, 8, 10);
    // Then
    expect(timeIntervalMs(k)).toBe(8 * MS_PER_HOUR * 1.5);
  });

  it.each([
    [8, 60, TIME_UNIT_DAY],
    [2, 60, TIME_UNIT_MONTH],
    [0.05, 60, TIME_UNIT_YEAR],
  ])('TT5: daily bars at %p dp → unit %p', (spacing, min, unit) => {
    // Given / When
    const k = selectTimeInterval(MS_PER_DAY, spacing, min);
    // Then
    expect(TIME_INTERVAL_UNITS[k]).toBe(unit);
  });

  it('TT6: weekly bars skip day units', () => {
    // Given / When
    const k = selectTimeInterval(7 * MS_PER_DAY, 30, 10);
    // Then
    expect(TIME_INTERVAL_UNITS[k]).toBe(TIME_UNIT_MONTH);
  });

  it('TT7: zero min spacing → bar interval', () => {
    // Given / When / Then
    expect(timeIntervalMs(selectTimeInterval(MIN, 8, 0))).toBe(MIN);
  });

  it('TT8: falls back to the largest interval', () => {
    // Given / When
    const k = selectTimeInterval(MS_PER_DAY, 1e-6, 1000);
    // Then
    expect(k).toBe(TIME_INTERVAL_UNITS.length - 1);
  });

  it.each([
    [0, 8, 60],
    [NaN, 8, 60],
    [Infinity, 8, 60],
    [MIN, 0, 60],
    [MIN, NaN, 60],
    [MIN, 8, -1],
    [MIN, 8, Infinity],
  ])('TT9: barMs %p, spacing %p, min %p → -1', (bar, spacing, min) => {
    // Given / When / Then
    expect(selectTimeInterval(bar, spacing, min)).toBe(-1);
  });
});

describe('estimateBarInterval', () => {
  it.each<[number[], number]>([
    [[0, 60, 120, 180], 60],
    [[0, 60, 1000, 1060], 60],
    [[0, 60, 60, 120], 60],
  ])('TT10: %p → %p', (times, expected) => {
    // Given / When / Then
    expect(estimateBarInterval(col(times))).toBe(expected);
  });

  it.each<[number[]]>([[[]], [[5]], [[5, 5, 5]]])('TT11: %p → NaN', (times) => {
    // Given / When / Then
    expect(estimateBarInterval(col(times))).toBeNaN();
  });

  it('TT12: samples only the last gaps (at least one)', () => {
    // Given
    const times = [0, 10, 100, 200];
    // When / Then
    expect(estimateBarInterval(col(times), 2)).toBe(90);
    expect(estimateBarInterval(col(times), 0)).toBe(100);
    // Physical offset: logical bars start at index 2
    expect(estimateBarInterval(col(times, 2))).toBe(100);
  });
});
