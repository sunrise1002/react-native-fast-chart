/*
 * Position math (spec 22.2). Pure worklets, allocation-free; every
 * function returns `NaN` for invalid input so callers can skip labels.
 */

/** `+1` for long, `-1` for short. */
export type PositionSign = 1 | -1;

/**
 * Unrealized PnL: `(price − entry) × size × multiplier × sign`.
 * `size` is the absolute position size (`> 0`).
 */
export function unrealizedPnl(
  sign: number,
  size: number,
  entry: number,
  price: number,
  multiplier = 1
): number {
  'worklet';
  if (
    (sign !== 1 && sign !== -1) ||
    !(size > 0 && size < Infinity) ||
    !(multiplier > 0 && multiplier < Infinity) ||
    !Number.isFinite(entry) ||
    !Number.isFinite(price)
  ) {
    return NaN;
  }
  const pnl = (price - entry) * size * multiplier * sign;
  return Number.isFinite(pnl) ? pnl : NaN;
}

/** PnL relative to the entry price, percent (unleveraged). */
export function pnlPercent(sign: number, entry: number, price: number): number {
  'worklet';
  if (
    (sign !== 1 && sign !== -1) ||
    !Number.isFinite(entry) ||
    entry === 0 ||
    !Number.isFinite(price)
  ) {
    return NaN;
  }
  const pct = ((price - entry) / Math.abs(entry)) * 100 * sign;
  return Number.isFinite(pct) ? pct : NaN;
}

/** `true` when a price in `sign`'s direction is a profit vs `entry`. */
export function isProfit(sign: number, entry: number, price: number): boolean {
  'worklet';
  return (price - entry) * sign > 0;
}
