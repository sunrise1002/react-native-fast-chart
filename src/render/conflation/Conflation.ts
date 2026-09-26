import {
  MAX_PYRAMID_LEVEL,
  type MinMaxPyramid,
  type PyramidSource,
} from '../../data/MinMaxPyramid';
import { rightEdgeIndex, type TimeScaleState } from '../../viewport/TimeScale';
import { lineWidthPx, sanitizePixelRatio } from '../PixelSnap';

/*
 * Pixel-bucket conflation (spec §23.3, Phase 18.1–18.3). Rendering-only
 * aggregation: when bars get narrower than a device-pixel slot, groups of
 * `g` consecutive bars (`g` a power of two, anchored at bar 0) are drawn
 * as one bucket — candles as `open = first open, high = max high,
 * low = min low, close = last close`; indicator lines as the min/max
 * envelope of the group (the visual envelope is preserved). Source data
 * and indicator values are never modified.
 *
 * Groups are anchored at bar 0 and sized by zoom only, so panning never
 * re-buckets (no shimmer): buckets just translate. Group min/max come from
 * a `MinMaxPyramid` (O(1) per bucket), so a frame costs O(buckets on
 * screen) whatever the number of bars in view (100k bars → ~plot px / 3).
 *
 * The conflated buckets are laid out as a series of their own with a
 * derived time scale (`barSpacing · g`, bucket centers at the group
 * centers), so the regular candle / band / histogram geometry builders
 * render them unchanged. Pure TypeScript, worklet-compatible.
 */

/** Default minimum bucket width, device px (see `conflationMinSlotPx`). */
export const DEFAULT_CONFLATION_PX = 2;

/**
 * Narrowest bar slot drawn without conflation, device px: the larger of
 * `bucketPx` and the wick width (narrower slots make wicks overlap, i.e.
 * overdraw). `bucketPx <= 0` (or NaN) disables conflation (returns 0).
 */
export function conflationMinSlotPx(
  bucketPx: number,
  wickWidthDp: number,
  pixelRatio: number
): number {
  'worklet';
  if (!(bucketPx > 0)) {
    return 0;
  }
  const wick = lineWidthPx(wickWidthDp, pixelRatio);
  const px = bucketPx < Infinity ? bucketPx : 0;
  return px > wick ? px : wick;
}

/**
 * Bars per bucket for a zoom level: `1` (no conflation) when a bar slot is
 * at least `minSlotPx` device px, else the smallest power of two whose
 * group is at least that wide. Invalid input → 1.
 */
export function conflationGroupSize(
  barSpacing: number,
  pixelRatio: number,
  minSlotPx: number
): number {
  'worklet';
  const slot = barSpacing * sanitizePixelRatio(pixelRatio);
  if (!(slot > 0 && slot < Infinity) || !(minSlotPx > 0) || slot >= minSlotPx) {
    return 1;
  }
  let group = 2;
  let level = 1;
  while (group * slot < minSlotPx && level < MAX_PYRAMID_LEVEL) {
    group *= 2;
    level++;
  }
  return group;
}

/** `log2(group)` for a power-of-two group (0 for 1 or invalid). */
export function groupLevel(group: number): number {
  'worklet';
  let level = 0;
  while (2 ** (level + 1) <= group && level < MAX_PYRAMID_LEVEL) {
    level++;
  }
  return level;
}

/** Fields shared by every conflated series. */
export interface ConflatedBase {
  /** Buckets written. */
  length: number;
  readonly offset: 0;
  /** Bars per bucket. */
  group: number;
  /** Group index of bucket 0 (bucket `b` = bars from `(firstGroup + b)·group`). */
  firstGroup: number;
  /** Time scale of the buckets (`barCount` = `length`). */
  scale: TimeScaleState;
}

/** Conflated candles (satisfies the candle geometry's series view). */
export interface ConflatedCandles extends ConflatedBase {
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
}

/** Conflated value column (indicator line / band edge / histogram). */
export interface ConflatedValues extends ConflatedBase {
  /** Min / max of the group (`+∞` / `−∞` when nothing is finite). */
  min: Float64Array;
  max: Float64Array;
  /** Value of the group's first / last bar (may be `NaN`). */
  first: Float64Array;
  last: Float64Array;
  /** Largest-magnitude value (sign kept), `NaN` when empty (histograms). */
  peak: Float64Array;
}

function emptyScale(): TimeScaleState {
  'worklet';
  return { width: 0, barSpacing: 0, rightOffset: 0, barCount: 0 };
}

export function createConflatedCandles(capacity = 0): ConflatedCandles {
  'worklet';
  const n = capacity > 0 ? Math.ceil(capacity) : 0;
  return {
    length: 0,
    offset: 0,
    group: 1,
    firstGroup: 0,
    scale: emptyScale(),
    open: new Float64Array(n),
    high: new Float64Array(n),
    low: new Float64Array(n),
    close: new Float64Array(n),
  };
}

export function createConflatedValues(capacity = 0): ConflatedValues {
  'worklet';
  const n = capacity > 0 ? Math.ceil(capacity) : 0;
  return {
    length: 0,
    offset: 0,
    group: 1,
    firstGroup: 0,
    scale: emptyScale(),
    min: new Float64Array(n),
    max: new Float64Array(n),
    first: new Float64Array(n),
    last: new Float64Array(n),
    peak: new Float64Array(n),
  };
}

/**
 * Writes the time scale of `count` buckets of `group` bars starting at
 * group `firstGroup` into `out`: bucket `b` is centered on the center of
 * its group's bars, `barSpacing` is `time.barSpacing · group`.
 */
export function conflatedTimeScale(
  time: TimeScaleState,
  group: number,
  firstGroup: number,
  count: number,
  out: TimeScaleState
): TimeScaleState {
  'worklet';
  const center = firstGroup * group + (group - 1) / 2;
  const right = (rightEdgeIndex(time) - center) / group;
  out.width = time.width;
  out.barSpacing = time.barSpacing * group;
  out.barCount = count;
  out.rightOffset = right - count + 0.5;
  return out;
}

/**
 * Groups overlapping bars `[start, end]` (clamped to `[0, length)`):
 * writes `firstGroup` / returns the count (0 when empty or invalid).
 * Shared with `ValueConflation`.
 */
export function groupSpan(
  start: number,
  end: number,
  length: number,
  group: number,
  out: ConflatedBase
): number {
  'worklet';
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < length - 1 ? Math.floor(end) : length - 1;
  if (!(from <= to) || !(group >= 1) || Number.isNaN(start)) {
    out.firstGroup = 0;
    out.length = 0;
    return 0;
  }
  const first = Math.floor(from / group);
  out.firstGroup = first;
  out.group = group;
  return Math.floor(to / group) - first + 1;
}

/** A larger (≥ ×2) column for `capacity` values; contents are not kept. */
export function growColumn(
  column: Float64Array,
  capacity: number
): Float64Array {
  'worklet';
  return new Float64Array(Math.max(capacity, column.length * 2));
}

/**
 * Min / max of group `k` (level `level`): a pyramid bucket, or the source
 * bar itself at level 0. A group wider than the data (`level` above the
 * pyramid's top) is group 0 = the whole series.
 */
export function groupExtremes(
  pyramid: MinMaxPyramid,
  minSource: PyramidSource,
  maxSource: PyramidSource,
  offset: number,
  level: number,
  k: number,
  out: { min: number; max: number }
): void {
  'worklet';
  const top = pyramid.levels;
  if (level === 0 || top === 0) {
    const i = level === 0 ? k : 0;
    const lo = minSource[offset + i] as number;
    const hi = maxSource[offset + i] as number;
    out.min = lo - lo === 0 ? lo : Infinity;
    out.max = hi - hi === 0 ? hi : -Infinity;
    return;
  }
  const l = level < top ? level : top;
  const b = level <= top ? k : 0;
  const index = (pyramid.starts[l] as number) + b;
  out.min = pyramid.min[index] as number;
  out.max = pyramid.max[index] as number;
}

/**
 * Conflates candles `[start, end]` into buckets of `group` bars. The
 * pyramid must be synced with `low` (min) / `high` (max) of `series`.
 * Groups without a finite high/low get `NaN` prices (skipped by the
 * geometry). Returns the bucket count.
 */
export function conflateCandles(
  series: {
    readonly open: ArrayLike<number>;
    readonly high: ArrayLike<number>;
    readonly low: ArrayLike<number>;
    readonly close: ArrayLike<number>;
    readonly offset: number;
    readonly length: number;
  },
  pyramid: MinMaxPyramid,
  start: number,
  end: number,
  time: TimeScaleState,
  group: number,
  out: ConflatedCandles,
  scratch: { min: number; max: number }
): number {
  'worklet';
  const n = series.length;
  const count = groupSpan(start, end, n, group, out);
  if (count > out.open.length) {
    out.open = growColumn(out.open, count);
    out.high = growColumn(out.high, count);
    out.low = growColumn(out.low, count);
    out.close = growColumn(out.close, count);
  }
  const level = groupLevel(group);
  const { offset } = series;
  for (let b = 0; b < count; b++) {
    const k = out.firstGroup + b;
    const firstBar = k * group;
    const lastBar = Math.min(firstBar + group, n) - 1;
    groupExtremes(pyramid, series.low, series.high, offset, level, k, scratch);
    const finite = scratch.min < Infinity && scratch.max > -Infinity;
    out.open[b] = finite ? (series.open[offset + firstBar] as number) : NaN;
    out.close[b] = finite ? (series.close[offset + lastBar] as number) : NaN;
    out.high[b] = finite ? scratch.max : NaN;
    out.low[b] = finite ? scratch.min : NaN;
  }
  out.length = count;
  conflatedTimeScale(time, group, out.firstGroup, count, out.scale);
  return count;
}
