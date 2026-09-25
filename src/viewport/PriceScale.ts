import type { PriceRange } from '../core/ChartTypes';

/**
 * Vertical coordinate system for one pane (spec §11, Phase 2.5).
 *
 * A `PriceScaleSnapshot` is an immutable plain object describing how prices
 * map to pixels for the current frame; it is cheap to rebuild whenever the
 * visible range or the pane rect changes and can be stored in a Reanimated
 * shared value. `mode` selects the transform: only `'linear'` exists today;
 * `'log'` / `'percentage'` / `'indexed'` (spec §11.3) plug in by adding a
 * mode, storing `min`/`max` in that mode's scale space and branching on
 * `mode` in `priceToY` / `yToPrice` — the snapshot shape stays the same.
 */
export type PriceScaleMode = 'linear';

export interface PriceScaleSnapshot {
  readonly mode: PriceScaleMode;
  /** Pane top, px. */
  readonly top: number;
  /** Pane height, px (`>= 0`). */
  readonly height: number;
  /** Price at the bottom edge (padding included), finite. */
  readonly min: number;
  /** Price at the top edge (padding included), finite, `> min`. */
  readonly max: number;
}

export interface PriceScaleOptions {
  /** Extra space above the max price, as a ratio of the range. Default 0.1. */
  paddingTop?: number;
  /** Extra space below the min price, as a ratio of the range. Default 0.1. */
  paddingBottom?: number;
}

export const DEFAULT_PRICE_PADDING = 0.1;
/** Half-width of the synthesized range around a flat price, relative. */
export const DEGENERATE_RANGE_RATIO = 0.01;
/** Prices are clamped to ±this so `max - min` never overflows. */
export const MAX_ABS_PRICE = 1e300;
/** Used when no finite price is available at all. */
export const FALLBACK_PRICE_RANGE: Readonly<PriceRange> = Object.freeze({
  min: 0,
  max: 1,
});

function sanitizeRatio(value: number | undefined): number {
  'worklet';
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_PRICE_PADDING;
  }
  return value < 0 ? 0 : value > 10 ? 10 : value;
}

function clampPrice(value: number): number {
  'worklet';
  return value < -MAX_ABS_PRICE
    ? -MAX_ABS_PRICE
    : value > MAX_ABS_PRICE
      ? MAX_ABS_PRICE
      : value;
}

/**
 * Turns a raw data range into a non-degenerate, finite, ordered range:
 * non-finite ends are replaced by the other end (both → fallback `[0, 1]`),
 * reversed ends are swapped, a flat range `v..v` becomes
 * `v ± |v| * DEGENERATE_RANGE_RATIO` (`±1` around 0).
 */
export function normalizePriceRange(min: number, max: number): PriceRange {
  'worklet';
  let lo = Number.isFinite(min) ? clampPrice(min) : NaN;
  let hi = Number.isFinite(max) ? clampPrice(max) : NaN;
  if (Number.isNaN(lo) && Number.isNaN(hi)) {
    return { min: FALLBACK_PRICE_RANGE.min, max: FALLBACK_PRICE_RANGE.max };
  }
  if (Number.isNaN(lo)) {
    lo = hi;
  } else if (Number.isNaN(hi)) {
    hi = lo;
  }
  if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (hi - lo <= Math.abs(hi) * Number.EPSILON) {
    const center = (lo + hi) / 2;
    const half = Math.abs(center) * DEGENERATE_RANGE_RATIO || 1;
    lo = center - half;
    hi = center + half;
  }
  return { min: lo, max: hi };
}

/**
 * Builds the scale for a pane: `displayMin = min - range * paddingBottom`,
 * `displayMax = max + range * paddingTop` (spec §11.1), mapped onto
 * `[top, top + height]` with Y growing downwards. Invalid rect values
 * collapse to `0`.
 */
export function createPriceScale(
  range: PriceRange,
  top: number,
  height: number,
  options: PriceScaleOptions = {}
): PriceScaleSnapshot {
  'worklet';
  const { min, max } = normalizePriceRange(range.min, range.max);
  const span = max - min;
  const displayMin = clampPrice(
    min - span * sanitizeRatio(options.paddingBottom)
  );
  const displayMax = clampPrice(max + span * sanitizeRatio(options.paddingTop));
  return {
    mode: 'linear',
    top: Number.isFinite(top) ? top : 0,
    height: Number.isFinite(height) && height > 0 ? height : 0,
    min: displayMin,
    max: displayMax,
  };
}

/** Y of `price`; `NaN` for a non-finite price (callers must skip it). */
export function priceToY(scale: PriceScaleSnapshot, price: number): number {
  'worklet';
  if (!Number.isFinite(price)) {
    return NaN;
  }
  return (
    scale.top + ((scale.max - price) / (scale.max - scale.min)) * scale.height
  );
}

/** Price at `y`; mid price for a zero-height pane, `NaN` for non-finite y. */
export function yToPrice(scale: PriceScaleSnapshot, y: number): number {
  'worklet';
  if (!Number.isFinite(y)) {
    return NaN;
  }
  if (!(scale.height > 0)) {
    return (scale.min + scale.max) / 2;
  }
  return scale.max - ((y - scale.top) / scale.height) * (scale.max - scale.min);
}
