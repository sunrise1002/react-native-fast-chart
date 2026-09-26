import { daysFromCivil, MS_PER_DAY, type CivilDate } from './CivilTime';
import {
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from './TimeFormat';

/*
 * Tick rules shared by the linear and the sparse time tick generators
 * (`TimeTicks`, `SparseTimeTicks`). Pure, worklet-compatible.
 */

export const TIME_UNIT_MS = 0;
export const TIME_UNIT_DAY = 1;
export const TIME_UNIT_MONTH = 2;
export const TIME_UNIT_YEAR = 3;

/** Weight of the largest calendar boundary crossed between two bars. */
export function tickWeight(
  date: CivilDate,
  days: number,
  prevYear: number,
  prevMonth: number,
  prevDays: number
): number {
  'worklet';
  return date.year !== prevYear
    ? TICK_WEIGHT_YEAR
    : date.month !== prevMonth
      ? TICK_WEIGHT_MONTH
      : days !== prevDays
        ? TICK_WEIGHT_DAY
        : TICK_WEIGHT_TIME;
}

/**
 * Whether a bar with calendar `date` and boundary `weight` is a tick of
 * interval `(unit, n)`. `bucketChanged` is the `TIME_UNIT_MS` rule (the
 * bar's `floor(local / n)` differs from the previous bar's).
 */
export function isIntervalTick(
  unit: number,
  n: number,
  weight: number,
  date: CivilDate,
  bucketChanged: boolean
): boolean {
  'worklet';
  if (unit === TIME_UNIT_MS) {
    return bucketChanged;
  }
  if (unit === TIME_UNIT_DAY) {
    return (
      weight >= TICK_WEIGHT_MONTH ||
      (weight === TICK_WEIGHT_DAY && (date.day - 1) % n === 0)
    );
  }
  if (unit === TIME_UNIT_MONTH) {
    return (
      weight === TICK_WEIGHT_YEAR ||
      (weight === TICK_WEIGHT_MONTH && (date.month - 1) % n === 0)
    );
  }
  return weight === TICK_WEIGHT_YEAR && date.year % n === 0;
}

/**
 * Smallest local instant after `local` at which a bar can become a tick
 * of interval `(unit, n)` (a candidate boundary): the next multiple of
 * `n` ms; the next day `1 + k·n` or month start; the next month
 * `1 + k·n` or year start; the next year multiple of `n`. `date` must be
 * the civil date of `local`.
 */
export function nextTickBoundary(
  local: number,
  unit: number,
  n: number,
  date: CivilDate
): number {
  'worklet';
  if (unit === TIME_UNIT_MS) {
    return (Math.floor(local / n) + 1) * n;
  }
  const { year, month, day } = date;
  let days: number;
  if (unit === TIME_UNIT_DAY) {
    const nextDay = day - ((day - 1) % n) + n;
    const monthStart =
      month === 12
        ? daysFromCivil(year + 1, 1, 1)
        : daysFromCivil(year, month + 1, 1);
    const candidate = daysFromCivil(year, month, nextDay);
    days = candidate < monthStart ? candidate : monthStart;
  } else if (unit === TIME_UNIT_MONTH) {
    const nextMonth = month - ((month - 1) % n) + n;
    days =
      nextMonth > 12
        ? daysFromCivil(year + 1, 1, 1)
        : daysFromCivil(year, nextMonth, 1);
  } else {
    days = daysFromCivil((Math.floor(year / n) + 1) * n, 1, 1);
  }
  return days * MS_PER_DAY;
}
