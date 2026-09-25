import type { CandleColumns } from '../../data/CandleBuffer';
import type { PriceSource } from '../Indicator';
import { isFiniteValue, readSource } from '../IndicatorSeries';

/**
 * Rolling sums over the last `period` source values (window of bar `i` =
 * bars `[i - period + 1, i]`), shared by SMA, WMA and Bollinger Bands.
 *
 * - O(1) per bar: add the entering value, remove the leaving one.
 * - Values are accumulated relative to `shift` (a recent value) so the
 *   variance `sumSq / p − (sum / p)²` does not suffer catastrophic
 *   cancellation at large price levels.
 * - Every `RESYNC_INTERVAL` bars (by bar index, hence deterministic for
 *   full and incremental computation alike) the sums are recomputed from
 *   the window, which bounds floating-point drift and refreshes `shift`.
 * - Non-finite values count in `nan` instead of the sums; any bar whose
 *   window holds one has no value (TradingView `na` semantics).
 */
export interface WindowSums {
  /** Σ (x − shift) over the finite window values. */
  sum: number;
  /** Σ (x − shift)². */
  sumSq: number;
  /** Σ w·(x − shift) with weight `period` for the newest bar down to 1. */
  weighted: number;
  /** Non-finite values inside the window. */
  nan: number;
  shift: number;
}

/** Bars between exact window recomputations. */
export const RESYNC_INTERVAL = 256;

export function createWindowSums(): WindowSums {
  return { sum: 0, sumSq: 0, weighted: 0, nan: 0, shift: 0 };
}

export function copyWindowSums(from: WindowSums, to: WindowSums): void {
  to.sum = from.sum;
  to.sumSq = from.sumSq;
  to.weighted = from.weighted;
  to.nan = from.nan;
  to.shift = from.shift;
}

function recompute(
  input: CandleColumns,
  i: number,
  period: number,
  source: PriceSource,
  out: WindowSums
): void {
  const current = readSource(input, i, source);
  const shift = isFiniteValue(current) ? current : 0;
  let sum = 0;
  let sumSq = 0;
  let weighted = 0;
  let nan = 0;
  const start = i - period + 1 > 0 ? i - period + 1 : 0;
  for (let j = start; j <= i; j++) {
    const x = readSource(input, j, source);
    if (isFiniteValue(x)) {
      const d = x - shift;
      sum += d;
      sumSq += d * d;
      weighted += (period - (i - j)) * d;
    } else {
      nan++;
    }
  }
  out.sum = sum;
  out.sumSq = sumSq;
  out.weighted = weighted;
  out.nan = nan;
  out.shift = shift;
}

/**
 * Sums of the window ending at bar `i`, given `prev` = sums of the window
 * ending at `i − 1`. Writes `out` (may not alias `prev`).
 */
export function stepWindowSums(
  prev: WindowSums,
  input: CandleColumns,
  i: number,
  period: number,
  source: PriceSource,
  out: WindowSums
): void {
  if (i % RESYNC_INTERVAL === 0) {
    recompute(input, i, period, source, out);
    return;
  }
  const { shift } = prev;
  let { sum, sumSq, nan } = prev;
  // Weighted update uses the previous window's plain sum.
  let weighted = prev.weighted - sum;
  const x = readSource(input, i, source);
  if (isFiniteValue(x)) {
    const d = x - shift;
    sum += d;
    sumSq += d * d;
    weighted += period * d;
  } else {
    nan++;
  }
  if (i >= period) {
    const y = readSource(input, i - period, source);
    if (isFiniteValue(y)) {
      const d = y - shift;
      sum -= d;
      sumSq -= d * d;
    } else {
      nan--;
    }
  }
  out.sum = sum;
  out.sumSq = sumSq;
  out.weighted = weighted;
  out.nan = nan;
  out.shift = shift;
}
