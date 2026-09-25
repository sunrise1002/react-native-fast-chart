import {
  civilFromDays,
  createCivilDate,
  daysOf,
  MS_PER_DAY,
  MS_PER_MINUTE,
  MS_PER_SECOND,
} from './CivilTime';
import { thinTicksBySpacing, type WeightedTicks } from './LabelCollision';
import {
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from './TimeFormat';
import { offsetAt, type OffsetResolver } from './TimeZone';

/**
 * Time tick generator (spec §19.1, Phase 5.3).
 *
 * 1. `selectTimeInterval` picks the smallest interval from a ladder
 *    (seconds … hours, days, months, years) whose ticks land at least
 *    `minSpacing` dp apart for the bar duration and zoom. It depends only
 *    on the zoom, never on the pan position, so labels don't flicker.
 * 2. `generateTimeTicks` walks the bars and marks every bar whose (local)
 *    time crosses an interval boundary relative to the previous bar, so
 *    ticks are aligned to bar indices and follow session gaps. Each tick
 *    gets a weight from the largest calendar boundary it crosses (year >
 *    month > day > time) which selects its label format and wins
 *    collisions (`thinTicksBySpacing`).
 *
 * Pure, worklet-compatible, allocation-free.
 */

export const TIME_UNIT_MS = 0;
export const TIME_UNIT_DAY = 1;
export const TIME_UNIT_MONTH = 2;
export const TIME_UNIT_YEAR = 3;

const H = 60 * MS_PER_MINUTE;

/** Interval ladder: unit + count (ms for `TIME_UNIT_MS`). */
export const TIME_INTERVAL_UNITS: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2,
  2, 3, 3, 3, 3, 3, 3, 3,
];
export const TIME_INTERVAL_COUNTS: readonly number[] = [
  MS_PER_SECOND,
  5 * MS_PER_SECOND,
  10 * MS_PER_SECOND,
  15 * MS_PER_SECOND,
  30 * MS_PER_SECOND,
  MS_PER_MINUTE,
  2 * MS_PER_MINUTE,
  5 * MS_PER_MINUTE,
  10 * MS_PER_MINUTE,
  15 * MS_PER_MINUTE,
  30 * MS_PER_MINUTE,
  H,
  2 * H,
  3 * H,
  4 * H,
  6 * H,
  12 * H,
  1,
  2,
  3,
  5,
  10,
  15,
  1,
  2,
  3,
  6,
  1,
  2,
  5,
  10,
  20,
  50,
  100,
];

const AVG_MONTH_MS = 30.436875 * MS_PER_DAY;
const AVG_YEAR_MS = 365.2425 * MS_PER_DAY;

/** Approximate duration of ladder entry `k`, ms (`NaN` out of range). */
export function timeIntervalMs(k: number): number {
  'worklet';
  const unit = TIME_INTERVAL_UNITS[k];
  const count = TIME_INTERVAL_COUNTS[k];
  if (unit === undefined || count === undefined) {
    return NaN;
  }
  return unit === TIME_UNIT_MS
    ? count
    : unit === TIME_UNIT_DAY
      ? count * MS_PER_DAY
      : unit === TIME_UNIT_MONTH
        ? count * AVG_MONTH_MS
        : count * AVG_YEAR_MS;
}

/**
 * Index into the interval ladder for bars of `barMs` drawn `barSpacing`
 * dp apart, with ticks at least `minSpacing` dp apart. Sub-day intervals
 * must be whole multiples of the bar duration (4 h bars skip 6 h); day
 * intervals only apply to bars of up to one day. Falls back to the largest
 * interval; `-1` for invalid input.
 */
export function selectTimeInterval(
  barMs: number,
  barSpacing: number,
  minSpacing: number
): number {
  'worklet';
  if (
    !(barMs > 0 && barMs < Infinity) ||
    !(barSpacing > 0 && barSpacing < Infinity) ||
    !(minSpacing >= 0 && minSpacing < Infinity)
  ) {
    return -1;
  }
  const last = TIME_INTERVAL_UNITS.length - 1;
  for (let k = 0; k < last; k++) {
    const approx = timeIntervalMs(k);
    const unit = TIME_INTERVAL_UNITS[k] as number;
    if (approx < barMs || (unit === TIME_UNIT_DAY && barMs > MS_PER_DAY)) {
      continue;
    }
    if (unit === TIME_UNIT_MS) {
      const ratio = approx / barMs;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        continue;
      }
    }
    if ((approx / barMs) * barSpacing >= minSpacing) {
      return k;
    }
  }
  return last;
}

/** Bar open times: logical bar `i` is at `time[offset + i]` (see `CandleColumns`). */
export interface TimeColumn {
  readonly time: ArrayLike<number>;
  readonly offset: number;
  readonly length: number;
}

/**
 * Bar duration estimate: the smallest positive gap between the last
 * `sample` bars (robust to session gaps). `NaN` with fewer than 2 bars.
 */
export function estimateBarInterval(bars: TimeColumn, sample = 64): number {
  'worklet';
  const { time, offset, length } = bars;
  let best = Infinity;
  const from = Math.max(1, length - Math.max(1, sample));
  for (let i = from; i < length; i++) {
    const gap = (time[offset + i] as number) - (time[offset + i - 1] as number);
    if (gap > 0 && gap < best) {
      best = gap;
    }
  }
  return best < Infinity ? best : NaN;
}

/** Time ticks: `positions` = bar indices, `payload` = local bar times. */
export type TimeTicks = WeightedTicks;

export const TIME_TICK_CAPACITY = 256;

export function createTimeTicks(capacity = TIME_TICK_CAPACITY): TimeTicks {
  const size = capacity > 0 && capacity < Infinity ? Math.ceil(capacity) : 0;
  return {
    positions: new Float64Array(size),
    weights: new Uint8Array(size),
    payload: new Float64Array(size),
    count: 0,
  };
}

/**
 * Collects ticks for bars `[start, end]` (clamped to the data) at ladder
 * interval `k`, then thins them so labels are at least `minBars` bars
 * apart. Bar 0 is never a tick (it has no previous bar to cross a
 * boundary from). Returns the tick count.
 */
export function generateTimeTicks(
  bars: TimeColumn,
  start: number,
  end: number,
  k: number,
  resolver: OffsetResolver,
  minBars: number,
  out: TimeTicks
): number {
  'worklet';
  out.count = 0;
  const unit = TIME_INTERVAL_UNITS[k];
  const n = TIME_INTERVAL_COUNTS[k];
  if (unit === undefined || n === undefined) {
    return 0;
  }
  const { time: times, offset } = bars;
  const first = Math.max(1, Math.floor(start));
  const last = Math.min(bars.length - 1, Math.floor(end));
  if (!(first <= last)) {
    return 0;
  }
  const capacity = out.positions.length;
  const date = createCivilDate();
  let t = times[offset + first - 1] as number;
  let local = t + offsetAt(resolver, t);
  let prevDays = daysOf(local);
  civilFromDays(prevDays, date);
  let prevYear = date.year;
  let prevMonth = date.month;
  let prevBucket = Math.floor(local / n);
  let count = 0;
  for (let i = first; i <= last && count < capacity; i++) {
    t = times[offset + i] as number;
    local = t + offsetAt(resolver, t);
    const days = daysOf(local);
    if (days !== prevDays) {
      civilFromDays(days, date);
    }
    const weight =
      date.year !== prevYear
        ? TICK_WEIGHT_YEAR
        : date.month !== prevMonth
          ? TICK_WEIGHT_MONTH
          : days !== prevDays
            ? TICK_WEIGHT_DAY
            : TICK_WEIGHT_TIME;
    let tick: boolean;
    if (unit === TIME_UNIT_MS) {
      const bucket = Math.floor(local / n);
      tick = bucket !== prevBucket;
      prevBucket = bucket;
    } else if (unit === TIME_UNIT_DAY) {
      tick =
        weight >= TICK_WEIGHT_MONTH ||
        (weight === TICK_WEIGHT_DAY && (date.day - 1) % n === 0);
    } else if (unit === TIME_UNIT_MONTH) {
      tick =
        weight === TICK_WEIGHT_YEAR ||
        (weight === TICK_WEIGHT_MONTH && (date.month - 1) % n === 0);
    } else {
      tick = weight === TICK_WEIGHT_YEAR && date.year % n === 0;
    }
    if (tick && Number.isFinite(local)) {
      out.positions[count] = i;
      out.weights[count] = weight;
      out.payload[count] = local;
      count++;
    }
    prevDays = days;
    prevYear = date.year;
    prevMonth = date.month;
  }
  out.count = count;
  return thinTicksBySpacing(out, minBars);
}
