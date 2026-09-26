import type { Candle } from './Candle';
import type { CandleColumns } from './CandleBuffer';
import type { CandleStore } from './CandleStore';

/**
 * Cheap diff of the `candles` prop (spec §20: the simple prop path must
 * not reset the chart for every realtime tick).
 *
 * - `none`: nothing to do (same array, or equal content).
 * - `reset`: unrelated dataset (symbol / timeframe switch, removed bars,
 *   diverged store) — `setData`.
 * - `incremental`: `prepended` older bars at the front, and bars from
 *   `changedFrom` (index in `next`) on changed or were appended.
 *
 * Cost: one binary search for the old first bar plus one pass over the
 * overlap that compares object **references** (a pointer compare per
 * bar). Only a bar whose reference changed is compared by value against
 * the store; the last bar is always value-compared, so a forming bar
 * mutated in place is still picked up. Interior bars mutated in place
 * (same reference) are not detected — update immutably.
 */
export type CandleDiff =
  | { readonly kind: 'none' }
  | { readonly kind: 'reset' }
  | {
      readonly kind: 'incremental';
      readonly prepended: number;
      readonly changedFrom: number;
    };

const NONE: CandleDiff = Object.freeze({ kind: 'none' });
const RESET: CandleDiff = Object.freeze({ kind: 'reset' });

/** `time` of `rows[i]`, `NaN` when the row is not a candle-like object. */
function timeAt(rows: readonly Candle[], i: number): number {
  const row = rows[i] as Candle | null | undefined;
  return row !== null && typeof row === 'object' ? row.time : NaN;
}

/** Index of the row with `time` in time-sorted `rows`, `-1` when absent. */
function findTime(rows: readonly Candle[], time: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = timeAt(rows, mid);
    if (t === time) {
      return mid;
    }
    if (t < time) {
      lo = mid + 1;
    } else if (t > time) {
      hi = mid - 1;
    } else {
      return -1; // NaN: unsorted / invalid input
    }
  }
  return -1;
}

function sameAsStored(
  row: Candle | null | undefined,
  columns: CandleColumns,
  index: number
): boolean {
  if (row === null || typeof row !== 'object') {
    return false;
  }
  const p = columns.offset + index;
  return (
    row.time === columns.time[p] &&
    row.open === columns.open[p] &&
    row.high === columns.high[p] &&
    row.low === columns.low[p] &&
    row.close === columns.close[p] &&
    (row.volume ?? 0) === columns.volume[p]
  );
}

/**
 * Diffs `next` against the previous prop `prev`, whose content the store
 * `columns` are expected to mirror (anything else → `reset`).
 */
export function diffCandles(
  prev: readonly Candle[] | null | undefined,
  next: readonly Candle[],
  columns: CandleColumns
): CandleDiff {
  if (next === prev) {
    return NONE;
  }
  const n = prev ? prev.length : 0;
  if (n === 0 || next.length === 0 || prev === null || prev === undefined) {
    return next.length === 0 && columns.length === 0 ? NONE : RESET;
  }
  const off = columns.offset;
  if (
    columns.length !== n ||
    columns.time[off] !== timeAt(prev, 0) ||
    columns.time[off + n - 1] !== timeAt(prev, n - 1)
  ) {
    return RESET;
  }
  const k = findTime(next, timeAt(prev, 0));
  if (k < 0 || k + n > next.length) {
    return RESET;
  }
  let d = n;
  for (let j = 0; j < n; j++) {
    const row = next[k + j];
    if (row === prev[j] && j < n - 1) {
      continue;
    }
    if (!sameAsStored(row, columns, j)) {
      d = j;
      break;
    }
  }
  const changedFrom = k + d;
  if (k === 0 && changedFrom === next.length) {
    return NONE;
  }
  return { kind: 'incremental', prepended: k, changedFrom };
}

/** What `applyCandleDiff` ended up doing. */
export type AppliedCandleDiff = 'none' | 'reset' | 'incremental';

/**
 * Applies `diff` (from `diffCandles(prev, next, store.columns)`) with the
 * cheapest store operations: `prepend`, `updateLast`, `appendMany`, or a
 * tail `splice`. Any rejected step (invalid / unsorted rows) falls back
 * to `setData(next)`, which normalizes.
 */
export function applyCandleDiff(
  store: CandleStore,
  next: readonly Candle[],
  diff: CandleDiff
): AppliedCandleDiff {
  if (diff.kind === 'none') {
    return 'none';
  }
  if (diff.kind === 'incremental' && applyIncremental(store, next, diff)) {
    return 'incremental';
  }
  store.setData(next);
  return 'reset';
}

function applyIncremental(
  store: CandleStore,
  next: readonly Candle[],
  diff: { prepended: number; changedFrom: number }
): boolean {
  const { prepended, changedFrom: c } = diff;
  if (prepended > 0 && !store.prepend(next.slice(0, prepended))) {
    return false;
  }
  const length = store.length;
  if (c >= next.length) {
    return true;
  }
  if (c === length) {
    return store.appendMany(next.slice(c));
  }
  if (c === length - 1) {
    const last = next[c] as Candle | null;
    if (last === null || typeof last !== 'object' || !store.updateLast(last)) {
      return false;
    }
    return c + 1 === next.length || store.appendMany(next.slice(c + 1));
  }
  return store.splice(c, length - c, next.slice(c));
}
