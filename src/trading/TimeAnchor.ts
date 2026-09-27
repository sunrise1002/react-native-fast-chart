import type { CandleColumns } from '../data/CandleBuffer';
import { upperBound } from '../data/TimeSearch';

/*
 * Time ↔ logical index conversion for time-anchored overlays (markers,
 * vertical lines, drawings). The X axis is index-based (session gaps
 * collapse), so a time maps to:
 *
 * - inside the data: the bar containing it plus the fraction of the gap
 *   to the next bar (exact bar times map to whole indices);
 * - before the first / after the last bar: extrapolated with the bar
 *   interval `barMs` (future whitespace slots right of the last bar).
 *
 * All functions are allocation-free worklets, O(log n).
 */

/** Fractional logical index of `time`; `NaN` without data / valid input. */
export function timeToIndex(
  series: CandleColumns,
  time: number,
  barMs: number
): number {
  'worklet';
  const n = series.length;
  if (n <= 0 || !Number.isFinite(time)) {
    return NaN;
  }
  const { time: column, offset } = series;
  const first = column[offset] as number;
  const last = column[offset + n - 1] as number;
  const step = barMs > 0 && barMs < Infinity ? barMs : 0;
  if (time <= first) {
    return step > 0 ? (time - first) / step : 0;
  }
  if (time >= last) {
    return step > 0 ? n - 1 + (time - last) / step : n - 1;
  }
  const i = upperBound(column, offset, n, time) - 1;
  const t0 = column[offset + i] as number;
  const t1 = column[offset + i + 1] as number;
  return t1 > t0 ? i + (time - t0) / (t1 - t0) : i;
}

/** Time at fractional logical `index` (inverse of `timeToIndex`). */
export function indexToTime(
  series: CandleColumns,
  index: number,
  barMs: number
): number {
  'worklet';
  const n = series.length;
  if (n <= 0 || !Number.isFinite(index)) {
    return NaN;
  }
  const { time: column, offset } = series;
  const step = barMs > 0 && barMs < Infinity ? barMs : 0;
  if (index <= 0) {
    return (column[offset] as number) + index * step;
  }
  if (index >= n - 1) {
    return (column[offset + n - 1] as number) + (index - (n - 1)) * step;
  }
  const i = Math.floor(index);
  const t0 = column[offset + i] as number;
  const t1 = column[offset + i + 1] as number;
  return t0 + (index - i) * (t1 - t0);
}

/**
 * Index of the bar containing `time` (last bar with `open time <= time`);
 * `-1` before the first bar, without data or for a non-finite time.
 */
export function barIndexAtTime(series: CandleColumns, time: number): number {
  'worklet';
  if (series.length <= 0 || !Number.isFinite(time)) {
    return -1;
  }
  return upperBound(series.time, series.offset, series.length, time) - 1;
}

/**
 * Time of the whole slot nearest to fractional `index` (drawing anchors
 * snap to bar centers, including future slots).
 */
export function snapIndexToTime(
  series: CandleColumns,
  index: number,
  barMs: number
): number {
  'worklet';
  return indexToTime(series, Math.round(index), barMs);
}
