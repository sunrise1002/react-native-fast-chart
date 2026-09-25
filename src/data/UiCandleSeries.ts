import type { CandleColumns } from './CandleBuffer';

/**
 * UI-thread copy of the candle columns.
 *
 * Worklets cannot read the JS thread's `CandleStore` buffers by reference:
 * typed arrays are *cloned* when they cross into the UI runtime. The chart
 * therefore keeps one UI-side copy inside a Reanimated shared value:
 *
 * - full snapshot (`createUiCandleSeries`, JS thread) on reset / prepend /
 *   patch — O(n) copy, happens on data loads, not per frame;
 * - in-place writes (`writeUiBar`, worklet) for realtime `append` /
 *   `updateLast` — O(1) per bar, amortized growth.
 *
 * The object satisfies `CandleColumns` (offset 0), so every viewport /
 * autoscale / geometry worklet reads it exactly like the store columns.
 * Pure TypeScript, no Reanimated import (the glue lives in `engine/`).
 */
export interface UiCandleSeries extends CandleColumns {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  readonly offset: 0;
  length: number;
  /** Incremented by every write; lets consumers detect in-place changes. */
  revision: number;
  /**
   * `CandleStore.resetVersion` of the snapshot: changes only when the
   * dataset is replaced (symbol / timeframe switch), not on prepends.
   */
  resetVersion: number;
}

/** Spare slots allocated after the last bar of a snapshot. */
export const UI_SERIES_HEADROOM = 256;

function copyColumn(
  src: Float64Array,
  offset: number,
  length: number,
  capacity: number
): Float64Array {
  const out = new Float64Array(capacity);
  out.set(src.subarray(offset, offset + length));
  return out;
}

/**
 * Copies the bars of `columns` into a fresh series with `headroom` spare
 * slots for realtime appends. `revision` lets the caller continue a count.
 */
export function createUiCandleSeries(
  columns: CandleColumns,
  revision = 0,
  resetVersion = 0,
  headroom = UI_SERIES_HEADROOM
): UiCandleSeries {
  const length = columns.length > 0 ? columns.length : 0;
  const spare = headroom > 0 && Number.isFinite(headroom) ? headroom : 0;
  const capacity = length + Math.floor(spare);
  const { offset } = columns;
  return {
    time: copyColumn(columns.time, offset, length, capacity),
    open: copyColumn(columns.open, offset, length, capacity),
    high: copyColumn(columns.high, offset, length, capacity),
    low: copyColumn(columns.low, offset, length, capacity),
    close: copyColumn(columns.close, offset, length, capacity),
    volume: copyColumn(columns.volume, offset, length, capacity),
    offset: 0,
    length,
    revision,
    resetVersion,
  };
}

/** An empty series (no bars, small capacity). */
export function emptyUiCandleSeries(): UiCandleSeries {
  return createUiCandleSeries(
    {
      time: new Float64Array(0),
      open: new Float64Array(0),
      high: new Float64Array(0),
      low: new Float64Array(0),
      close: new Float64Array(0),
      volume: new Float64Array(0),
      offset: 0,
      length: 0,
    },
    0,
    0,
    16
  );
}

function grow(column: Float64Array, capacity: number): Float64Array {
  'worklet';
  const next = new Float64Array(capacity);
  next.set(column);
  return next;
}

/**
 * Writes bar `index` in place: `index < length` overwrites (updateLast /
 * patch), `index === length` appends (growing the columns ×2 when full).
 * Returns `false` (no change) for any other index. Values are trusted:
 * they come from the validated `CandleStore`. Worklet.
 */
export function writeUiBar(
  series: UiCandleSeries,
  index: number,
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number
): boolean {
  'worklet';
  if (!(index >= 0 && index <= series.length) || index % 1 !== 0) {
    return false;
  }
  if (index >= series.time.length) {
    const capacity = Math.max(16, series.time.length * 2);
    series.time = grow(series.time, capacity);
    series.open = grow(series.open, capacity);
    series.high = grow(series.high, capacity);
    series.low = grow(series.low, capacity);
    series.close = grow(series.close, capacity);
    series.volume = grow(series.volume, capacity);
  }
  series.time[index] = time;
  series.open[index] = open;
  series.high[index] = high;
  series.low[index] = low;
  series.close[index] = close;
  series.volume[index] = volume;
  if (index === series.length) {
    series.length++;
  }
  series.revision++;
  return true;
}

/** Number of values per bar in a packed update (`time, o, h, l, c, v`). */
export const PACKED_BAR_STRIDE = 6;

/**
 * Packs bars `[from, from + count)` of `columns` for a cheap JS → UI
 * transfer (one small typed array instead of objects). JS thread.
 */
export function packBars(
  columns: CandleColumns,
  from: number,
  count: number
): Float64Array {
  const available = columns.length - from;
  const wanted = count > 0 ? Math.floor(count) : 0;
  const n =
    Number.isInteger(from) && from >= 0 && available > 0
      ? Math.min(wanted, available)
      : 0;
  const out = new Float64Array(n * PACKED_BAR_STRIDE);
  for (let i = 0, p = columns.offset + from; i < out.length; p++) {
    out[i++] = columns.time[p] as number;
    out[i++] = columns.open[p] as number;
    out[i++] = columns.high[p] as number;
    out[i++] = columns.low[p] as number;
    out[i++] = columns.close[p] as number;
    out[i++] = columns.volume[p] as number;
  }
  return out;
}

/**
 * Applies a `packBars` payload starting at bar `from`. All-or-nothing
 * validation of the start index; returns the number of bars written. Worklet.
 */
export function applyPackedBars(
  series: UiCandleSeries,
  from: number,
  packed: ArrayLike<number>
): number {
  'worklet';
  const count = Math.floor(packed.length / PACKED_BAR_STRIDE);
  if (!(from >= 0 && from <= series.length) || from % 1 !== 0) {
    return 0;
  }
  // Consecutive indices from a valid start are always writable.
  for (let b = 0; b < count; b++) {
    const i = b * PACKED_BAR_STRIDE;
    writeUiBar(
      series,
      from + b,
      packed[i] as number,
      packed[i + 1] as number,
      packed[i + 2] as number,
      packed[i + 3] as number,
      packed[i + 4] as number,
      packed[i + 5] as number
    );
  }
  return count;
}
