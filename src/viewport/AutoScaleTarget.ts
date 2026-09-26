import type { PriceRange } from '../core/ChartTypes';
import type { CandleColumns } from '../data/CandleBuffer';
import { candleRangeMinMax } from './AutoScale';
import { createPriceScale, type PriceScaleOptions } from './PriceScale';
import type { TimeScaleState } from './TimeScale';
import { getVisibleRange, type VisibleRange } from './VisibleRange';

/**
 * Widens a visible min/max with other series (overlay indicators) before
 * padding. `out` holds the candle range of bars `[start, end]`.
 */
export interface PriceRangeExtender {
  extend(start: number, end: number, out: PriceRange): void;
}

/** Applies the price-scale padding of `options` to a valid range in place. */
export function padPriceRange(
  out: PriceRange,
  options: PriceScaleOptions = {}
): void {
  'worklet';
  const scale = createPriceScale(out, 0, 1, options);
  out.min = scale.min;
  out.max = scale.max;
}

/**
 * Per-frame auto-scale target (spec §11.1): the padded low/high of the bars
 * actually on screen (no overscan, so bars scrolling in don't rescale
 * early), optionally widened by `extender` (overlay indicators, like
 * TradingView). Worklet-compatible; the caller animates towards the result.
 */
export function computeAutoScaleTarget(
  columns: CandleColumns,
  time: TimeScaleState,
  out: PriceRange,
  options: PriceScaleOptions = {},
  scratch: VisibleRange = { startIndex: 0, endIndex: -1 },
  extender?: PriceRangeExtender
): boolean {
  'worklet';
  const range = getVisibleRange(time, 0, scratch);
  if (!candleRangeMinMax(columns, range.startIndex, range.endIndex, out)) {
    return false;
  }
  if (extender) {
    extender.extend(range.startIndex, range.endIndex, out);
  }
  padPriceRange(out, options);
  return true;
}

/**
 * `true` when the displayed range should jump instead of animating: no
 * valid range is displayed yet, or it does not overlap the target at all
 * (dataset switch, first load).
 */
export function shouldSnapPriceRange(
  currentMin: number,
  currentMax: number,
  target: PriceRange
): boolean {
  'worklet';
  if (
    !Number.isFinite(currentMin) ||
    !Number.isFinite(currentMax) ||
    !(currentMax > currentMin)
  ) {
    return true;
  }
  return currentMax < target.min || currentMin > target.max;
}

/** Relative change below which a new target is ignored (anti-jitter). */
export const PRICE_TARGET_EPSILON = 1e-6;

/** `true` when `a` and `b` differ by more than `epsilon` of their span. */
export function priceRangeChanged(
  a: PriceRange,
  b: PriceRange,
  epsilon: number = PRICE_TARGET_EPSILON
): boolean {
  'worklet';
  const span = Math.abs(b.max - b.min);
  const tolerance = span > 0 && span < Infinity ? span * epsilon : 0;
  return (
    !(Math.abs(a.min - b.min) <= tolerance) ||
    !(Math.abs(a.max - b.max) <= tolerance)
  );
}
