import type { PriceRange } from '../core/ChartTypes';
import type { CandleColumns } from '../data/CandleBuffer';

/**
 * Visible-range min/max queries (spec §11.1, Phase 2.6). Index ranges are
 * **inclusive** (`VisibleRange` convention) and clamped to the data.
 *
 * Strategy (decided by `benchmarks/viewport.bench.ts`): a plain loop over
 * the typed columns. A 500-bar scan costs ~1 µs and even the zoom-out
 * worst case (a few thousand bars) stays far below a frame budget, so a
 * sparse table / block cache (extra memory + invalidation on every
 * realtime tick) is not worth it.
 *
 * All functions write into `out`, never allocate, skip non-finite values
 * and are worklet-compatible. They return `false` (and set `out` to NaN)
 * when the range holds no finite value.
 */

function setEmpty(out: PriceRange): boolean {
  'worklet';
  out.min = NaN;
  out.max = NaN;
  return false;
}

/** Min of `low`, max of `high` over bars `[start, end]`. */
export function candleRangeMinMax(
  columns: CandleColumns,
  start: number,
  end: number,
  out: PriceRange
): boolean {
  'worklet';
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < columns.length - 1 ? Math.floor(end) : columns.length - 1;
  if (!(from <= to) || Number.isNaN(start) || Number.isNaN(end)) {
    return setEmpty(out);
  }
  const { low, high, offset } = columns;
  let min = Infinity;
  let max = -Infinity;
  for (let p = offset + from, stop = offset + to; p <= stop; p++) {
    const l = low[p] as number;
    const h = high[p] as number;
    if (l < min) {
      min = l;
    }
    if (h > max) {
      max = h;
    }
  }
  if (min === Infinity || max === -Infinity) {
    return setEmpty(out);
  }
  out.min = min;
  out.max = max;
  return true;
}

/**
 * Min/max of `values[offset + i]` for `i` in `[start, end]`, skipping
 * `null`, `undefined`, `NaN` and ±Infinity (indicator warm-up gaps).
 * `length` defaults to `values.length - offset`.
 */
export function rangeMinMax(
  values: ArrayLike<number | null | undefined>,
  start: number,
  end: number,
  out: PriceRange,
  offset = 0,
  length = values.length - offset
): boolean {
  'worklet';
  const from = start > 0 ? Math.ceil(start) : 0;
  const to = end < length - 1 ? Math.floor(end) : length - 1;
  if (!(from <= to) || Number.isNaN(start) || Number.isNaN(end)) {
    return setEmpty(out);
  }
  let min = Infinity;
  let max = -Infinity;
  for (let p = offset + from, stop = offset + to; p <= stop; p++) {
    const v = values[p];
    if (typeof v !== 'number' || v === Infinity || v === -Infinity) {
      continue;
    }
    // NaN fails both comparisons and is skipped implicitly.
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  if (min === Infinity) {
    return setEmpty(out);
  }
  out.min = min;
  out.max = max;
  return true;
}
