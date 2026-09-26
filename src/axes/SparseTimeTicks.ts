import { civilFromDays, createCivilDate, daysOf } from './CivilTime';
import type { WeightedTicks } from './LabelCollision';
import { lowerBound } from '../data/TimeSearch';
import {
  isIntervalTick,
  nextTickBoundary,
  tickWeight,
  TIME_UNIT_MS,
} from './TimeTickRules';
import type { TimeColumn } from './TimeTicks';
import { offsetAt, type OffsetResolver } from './TimeZone';

function localAt(
  times: ArrayLike<number>,
  p: number,
  resolver: OffsetResolver
): number {
  'worklet';
  const t = times[p] as number;
  return t + offsetAt(resolver, t);
}

/**
 * Sparse variant of the time tick scan (P8, extreme zoom-out): instead of
 * visiting every bar, jumps from the current bar to the first bar at or
 * after the next candidate boundary (`nextTickBoundary`) with a binary
 * search over the sorted bar times, then applies the regular tick rule to
 * that bar and its predecessor. No bar in between can be a tick (no
 * boundary is crossed there), so the result equals the linear scan for
 * monotonic local time (all fixed zones; DST fall-back hours may differ by
 * a bar). Cost: O(ticks · log n). Writes unthinned ticks of bars
 * `[first, last]` (`first >= 1`) into `out`; returns the count.
 */
export function generateSparseTimeTicks(
  bars: TimeColumn,
  first: number,
  last: number,
  unit: number,
  n: number,
  resolver: OffsetResolver,
  out: WeightedTicks
): number {
  'worklet';
  const { time: times, offset } = bars;
  const capacity = out.positions.length;
  const date = createCivilDate();
  let count = 0;
  let cursor = first - 1;
  while (cursor < last && count < capacity) {
    const reference = localAt(times, offset + cursor, resolver);
    if (!Number.isFinite(reference)) {
      cursor++;
      continue;
    }
    civilFromDays(daysOf(reference), date);
    const boundary = nextTickBoundary(reference, unit, n, date);
    // UTC target from the offset around the boundary. It never overshoots
    // the first qualifying bar (an offset increase in between can only
    // make it early), so a forward fix-up suffices.
    const guess = boundary - offsetAt(resolver, boundary - resolver.offsetMs);
    const lo = cursor + 1;
    let j = lo + lowerBound(times, offset + lo, last - cursor, guess);
    while (j <= last && localAt(times, offset + j, resolver) < boundary) {
      j++;
    }
    if (j > last) {
      break;
    }
    const prevLocal = localAt(times, offset + j - 1, resolver);
    const local = localAt(times, offset + j, resolver);
    const prevDays = daysOf(prevLocal);
    civilFromDays(prevDays, date);
    const prevYear = date.year;
    const prevMonth = date.month;
    const days = daysOf(local);
    civilFromDays(days, date);
    const weight = tickWeight(date, days, prevYear, prevMonth, prevDays);
    const bucketChanged =
      unit === TIME_UNIT_MS &&
      Math.floor(local / n) !== Math.floor(prevLocal / n);
    if (
      isIntervalTick(unit, n, weight, date, bucketChanged) &&
      Number.isFinite(local)
    ) {
      out.positions[count] = j;
      out.weights[count] = weight;
      out.payload[count] = local;
      count++;
    }
    cursor = j;
  }
  return count;
}
