/**
 * Test perspective table — TimeTickRules
 *
 * | Case  | Input / Precondition                                  | Perspective        | Expected                                  |
 * |-------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | TR01  | year / month / day / same-day bars                     | Equivalence        | weight year / month / day / time          |
 * | TR02  | ms unit, bucket changed / unchanged                    | Equivalence        | true / false                              |
 * | TR03  | day unit: month weight, day 6 (n 5), day 7, time       | Equivalence / neg. | true, true, false, false                  |
 * | TR04  | month unit: year, Apr (n 3), May, day weight           | Equivalence / neg. | true, true, false, false                  |
 * | TR05  | year unit: 2025 (n 5), 2026, month weight              | Equivalence / neg. | true, false, false                        |
 * | TR06  | ms boundary: mid-bucket, exactly on, negative time     | Boundary           | next multiple strictly after              |
 * | TR07  | day boundary: mid-month, end of month, end of year     | Boundary           | next 1 + k·n day or next month / year     |
 * | TR08  | month boundary: Feb (n 3), Nov (n 3), Dec (n 1)        | Boundary           | Apr 1 / next Jan 1 / next Jan 1           |
 * | TR09  | year boundary: 2023 (n 5), 2025 (n 5), n 1             | Boundary           | 2025 / 2030 / next year                   |
 */
import { describe, expect, it } from '@jest/globals';
import {
  civilFromDays,
  createCivilDate,
  daysOf,
  type CivilDate,
} from '../CivilTime';
import {
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from '../TimeFormat';
import {
  isIntervalTick,
  nextTickBoundary,
  tickWeight,
  TIME_UNIT_DAY,
  TIME_UNIT_MONTH,
  TIME_UNIT_MS,
  TIME_UNIT_YEAR,
} from '../TimeTickRules';

function civil(ms: number): CivilDate {
  return civilFromDays(daysOf(ms), createCivilDate());
}

function weightBetween(prev: number, next: number): number {
  const p = civil(prev);
  return tickWeight(civil(next), daysOf(next), p.year, p.month, daysOf(prev));
}

function date(year: number, month: number, day: number): CivilDate {
  return { year, month, day } as CivilDate;
}

describe('tickWeight', () => {
  it('TR01: returns the largest boundary crossed', () => {
    // Given / When / Then
    expect(
      weightBetween(Date.UTC(2023, 11, 31, 23), Date.UTC(2024, 0, 1))
    ).toBe(TICK_WEIGHT_YEAR);
    expect(weightBetween(Date.UTC(2024, 0, 31), Date.UTC(2024, 1, 1))).toBe(
      TICK_WEIGHT_MONTH
    );
    expect(weightBetween(Date.UTC(2024, 0, 3), Date.UTC(2024, 0, 4))).toBe(
      TICK_WEIGHT_DAY
    );
    expect(
      weightBetween(Date.UTC(2024, 0, 3, 1), Date.UTC(2024, 0, 3, 2))
    ).toBe(TICK_WEIGHT_TIME);
  });
});

describe('isIntervalTick', () => {
  const d = date(2024, 1, 1);

  it('TR02: ms unit follows the bucket change flag', () => {
    // Given / When / Then
    expect(isIntervalTick(TIME_UNIT_MS, 1000, TICK_WEIGHT_TIME, d, true)).toBe(
      true
    );
    expect(isIntervalTick(TIME_UNIT_MS, 1000, TICK_WEIGHT_DAY, d, false)).toBe(
      false
    );
  });

  it('TR03: day unit ticks month starts and days 1 + k·n', () => {
    // Given: n = 5
    // When / Then
    expect(isIntervalTick(TIME_UNIT_DAY, 5, TICK_WEIGHT_MONTH, d, false)).toBe(
      true
    );
    expect(
      isIntervalTick(TIME_UNIT_DAY, 5, TICK_WEIGHT_DAY, date(2024, 1, 6), false)
    ).toBe(true);
    expect(
      isIntervalTick(TIME_UNIT_DAY, 5, TICK_WEIGHT_DAY, date(2024, 1, 7), false)
    ).toBe(false);
    expect(
      isIntervalTick(
        TIME_UNIT_DAY,
        5,
        TICK_WEIGHT_TIME,
        date(2024, 1, 6),
        false
      )
    ).toBe(false);
  });

  it('TR04: month unit ticks years and months 1 + k·n', () => {
    // Given: n = 3
    // When / Then
    expect(isIntervalTick(TIME_UNIT_MONTH, 3, TICK_WEIGHT_YEAR, d, false)).toBe(
      true
    );
    expect(
      isIntervalTick(
        TIME_UNIT_MONTH,
        3,
        TICK_WEIGHT_MONTH,
        date(2024, 4, 1),
        false
      )
    ).toBe(true);
    expect(
      isIntervalTick(
        TIME_UNIT_MONTH,
        3,
        TICK_WEIGHT_MONTH,
        date(2024, 5, 1),
        false
      )
    ).toBe(false);
    expect(
      isIntervalTick(
        TIME_UNIT_MONTH,
        3,
        TICK_WEIGHT_DAY,
        date(2024, 4, 1),
        false
      )
    ).toBe(false);
  });

  it('TR05: year unit ticks multiples of n only', () => {
    // Given: n = 5
    // When / Then
    expect(
      isIntervalTick(
        TIME_UNIT_YEAR,
        5,
        TICK_WEIGHT_YEAR,
        date(2025, 1, 1),
        false
      )
    ).toBe(true);
    expect(
      isIntervalTick(
        TIME_UNIT_YEAR,
        5,
        TICK_WEIGHT_YEAR,
        date(2026, 1, 1),
        false
      )
    ).toBe(false);
    expect(
      isIntervalTick(
        TIME_UNIT_YEAR,
        5,
        TICK_WEIGHT_MONTH,
        date(2025, 1, 1),
        false
      )
    ).toBe(false);
  });
});

describe('nextTickBoundary', () => {
  it('TR06: ms unit returns the next multiple strictly after', () => {
    // Given / When / Then
    expect(nextTickBoundary(1500, TIME_UNIT_MS, 1000, date(1970, 1, 1))).toBe(
      2000
    );
    expect(nextTickBoundary(2000, TIME_UNIT_MS, 1000, date(1970, 1, 1))).toBe(
      3000
    );
    expect(
      nextTickBoundary(-1500, TIME_UNIT_MS, 1000, date(1969, 12, 31))
    ).toBe(-1000);
  });

  it('TR07: day unit returns the next 1 + k·n day or month start', () => {
    // Given: n = 5
    const at = (y: number, m: number, dd: number) => Date.UTC(y, m - 1, dd);
    const next = (y: number, m: number, dd: number) =>
      nextTickBoundary(at(y, m, dd), TIME_UNIT_DAY, 5, date(y, m, dd));
    // When / Then
    expect(next(2024, 1, 3)).toBe(at(2024, 1, 6));
    expect(next(2024, 1, 6)).toBe(at(2024, 1, 11));
    expect(next(2024, 1, 30)).toBe(at(2024, 1, 31));
    expect(next(2024, 1, 31)).toBe(at(2024, 2, 1));
    expect(next(2024, 2, 27)).toBe(at(2024, 3, 1));
    expect(next(2023, 12, 31)).toBe(at(2024, 1, 1));
    expect(
      nextTickBoundary(at(2024, 1, 3) + 5, TIME_UNIT_DAY, 1, date(2024, 1, 3))
    ).toBe(at(2024, 1, 4));
  });

  it('TR08: month unit returns the next 1 + k·n month or year start', () => {
    // Given
    const at = (y: number, m: number) => Date.UTC(y, m - 1, 1);
    // When / Then
    expect(
      nextTickBoundary(at(2024, 2), TIME_UNIT_MONTH, 3, date(2024, 2, 1))
    ).toBe(at(2024, 4));
    expect(
      nextTickBoundary(at(2024, 11), TIME_UNIT_MONTH, 3, date(2024, 11, 1))
    ).toBe(at(2025, 1));
    expect(
      nextTickBoundary(at(2024, 12), TIME_UNIT_MONTH, 1, date(2024, 12, 1))
    ).toBe(at(2025, 1));
  });

  it('TR09: year unit returns the next multiple-of-n year', () => {
    // Given
    const at = (y: number) => Date.UTC(y, 0, 1);
    // When / Then
    expect(
      nextTickBoundary(at(2023), TIME_UNIT_YEAR, 5, date(2023, 1, 1))
    ).toBe(at(2025));
    expect(
      nextTickBoundary(at(2025), TIME_UNIT_YEAR, 5, date(2025, 1, 1))
    ).toBe(at(2030));
    expect(
      nextTickBoundary(at(2025), TIME_UNIT_YEAR, 1, date(2025, 6, 1))
    ).toBe(at(2026));
  });
});
