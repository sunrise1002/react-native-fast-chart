import { sanitizeDecimals, stepDecimals } from './PriceFormat';

/**
 * Price tick generator (spec §19.2, Phase 5.1). Steps are "nice" numbers
 * `1 / 2 / 2.5 / 5 × 10^n`; the target tick count follows the pane height
 * and the label font size, so ticks never crowd the axis. Label decimals
 * derive from the step or from a configured `pricePrecision` (which also
 * floors the step at one price unit, `10^-precision`).
 *
 * Pure, worklet-compatible, allocation-free (writes into `PriceTicks`).
 */

export interface PriceTicks {
  /** Tick prices, ascending; only `[0, count)` is valid. */
  values: Float64Array;
  count: number;
  /** Step between ticks (`NaN` when there are none). */
  step: number;
  /** Decimals for the tick labels. */
  decimals: number;
}

/** Default capacity: more ticks than any realistic pane can show. */
export const PRICE_TICK_CAPACITY = 64;

/** Minimum distance between price ticks, in multiples of the font size. */
export const PRICE_TICK_SPACING_EM = 3.5;

/** Hard floor for the tick distance, dp (tiny font sizes). */
export const MIN_PRICE_TICK_SPACING_DP = 24;

export function createPriceTicks(capacity = PRICE_TICK_CAPACITY): PriceTicks {
  const size = capacity > 0 && capacity < Infinity ? Math.ceil(capacity) : 0;
  return {
    values: new Float64Array(size),
    count: 0,
    step: NaN,
    decimals: 0,
  };
}

/**
 * Smallest nice step (`1, 2, 2.5, 5 × 10^n`) `>= span / targetCount` and
 * `>= minStep`. `NaN` when no positive finite step exists.
 */
export function nicePriceTickStep(
  span: number,
  targetCount: number,
  minStep = 0
): number {
  'worklet';
  let raw = span / targetCount;
  if (!(raw > 0 && raw < Infinity)) {
    return NaN;
  }
  if (minStep > raw && minStep < Infinity) {
    raw = minStep;
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  // The epsilon keeps exact nice values (e.g. 2.5) from rounding up a level.
  const nice =
    normalized <= 1 + 1e-9
      ? 1
      : normalized <= 2 + 1e-9
        ? 2
        : normalized <= 2.5 + 1e-9
          ? 2.5
          : normalized <= 5 + 1e-9
            ? 5
            : 10;
  const step = nice * magnitude;
  return step > 0 && step < Infinity ? step : NaN;
}

/** Minimum dp between two price ticks for a label font size. */
export function priceTickSpacing(fontSize: number): number {
  'worklet';
  const spacing = fontSize * PRICE_TICK_SPACING_EM;
  return spacing > MIN_PRICE_TICK_SPACING_DP && spacing < Infinity
    ? spacing
    : MIN_PRICE_TICK_SPACING_DP;
}

/** Number of ticks targeted for a pane height (0 when it can't fit one). */
export function priceTickTargetCount(
  heightPx: number,
  fontSize: number
): number {
  'worklet';
  if (!(heightPx > 0 && heightPx < Infinity)) {
    return 0;
  }
  return Math.floor(heightPx / priceTickSpacing(fontSize));
}

/**
 * Step for `[min, max]` over `heightPx` with labels of `fontSize`;
 * `pricePrecision` (`< 0` / `NaN` = automatic) floors it at `10^-p`.
 */
export function priceTickStep(
  min: number,
  max: number,
  heightPx: number,
  fontSize: number,
  pricePrecision = NaN
): number {
  'worklet';
  const target = priceTickTargetCount(heightPx, fontSize);
  if (target < 1) {
    return NaN;
  }
  const minStep =
    pricePrecision >= 0 ? Math.pow(10, -sanitizeDecimals(pricePrecision)) : 0;
  return nicePriceTickStep(max - min, target, minStep);
}

/**
 * Fills `out` with the multiples of the step inside `[min, max]`
 * (ascending, capped by the buffer capacity). Returns the tick count;
 * an invalid range / height yields 0 ticks and `step = NaN`.
 */
export function generatePriceTicks(
  min: number,
  max: number,
  heightPx: number,
  fontSize: number,
  out: PriceTicks,
  pricePrecision = NaN
): number {
  'worklet';
  out.count = 0;
  out.step = NaN;
  out.decimals = pricePrecision >= 0 ? sanitizeDecimals(pricePrecision) : 0;
  if (!(Number.isFinite(min) && Number.isFinite(max) && max > min)) {
    return 0;
  }
  const step = priceTickStep(min, max, heightPx, fontSize, pricePrecision);
  if (!(step > 0 && step < Infinity)) {
    return 0;
  }
  out.step = step;
  if (!(pricePrecision >= 0)) {
    out.decimals = stepDecimals(step);
  }
  const capacity = out.values.length;
  // `|| 0` turns -0 into 0 so a zero tick is never negative zero.
  const first = Math.ceil(min / step - 1e-9) || 0;
  let count = 0;
  for (let n = first; count < capacity; n++) {
    // Multiply (not accumulate) so values stay exact multiples of the step.
    const value = n * step;
    if (value > max + step * 1e-9) {
      break;
    }
    out.values[count++] = value;
  }
  out.count = count;
  return count;
}
