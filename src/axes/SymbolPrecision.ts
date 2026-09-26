import { sanitizeDecimals, stepDecimals } from './PriceFormat';

/**
 * Symbol metadata → display precision (spec Phase 19.1–19.2). Pure; the
 * snapping helpers are worklets.
 *
 * Typical values:
 * - crypto majors: `{ tickSize: 0.01, quantityStep: 0.00001 }`;
 * - crypto micro prices: `{ tickSize: 0.00000001 }` (8 decimals);
 * - forex: `{ pricePrecision: 5 }` (JPY pairs: 3);
 * - equities: `{ tickSize: 0.01, quantityStep: 1 }`;
 * - futures: `{ tickSize: 0.25 }` (ES) — axis steps stay multiples of 0.25.
 */
export interface ChartSymbolConfig {
  /**
   * Fixed price decimals (labels, crosshair, legend, last price). `null`
   * derives them from `tickSize`, or from the price magnitude when that
   * is unset too (4 significant digits below 1, else 2 decimals).
   */
  pricePrecision: number | null;
  /**
   * Minimum price increment. Price-axis steps are multiples of it and it
   * sets the decimals when `pricePrecision` is `null`.
   */
  tickSize: number | null;
  /** Minimum quantity increment; sets `volumePrecision` when that is `null`. */
  quantityStep: number | null;
  /**
   * Decimals of unscaled volumes in the legend (`12.345` with 3). Compact
   * volumes (`1.23K`) keep 2 decimals. `null` = automatic.
   */
  volumePrecision: number | null;
}

/** Resolved precision; `NaN` means "automatic" / "none". */
export interface ResolvedPrecision {
  priceDecimals: number;
  tickSize: number;
  volumeDecimals: number;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && value > 0 && value < Infinity;
}

function isDecimals(value: unknown): value is number {
  return typeof value === 'number' && value >= 0 && value < Infinity;
}

/**
 * Resolves symbol metadata. Invalid entries (negative, NaN, ∞, zero tick
 * sizes, non-numbers) are ignored, never thrown on: the chart falls back
 * to automatic precision. `legacyPricePrecision` is the deprecated
 * `axes.pricePrecision` (used when `symbol.pricePrecision` is unset).
 */
export function resolveSymbolPrecision(
  symbol: Partial<ChartSymbolConfig> | null | undefined,
  legacyPricePrecision: number | null = null
): ResolvedPrecision {
  const tickSize = isPositiveFinite(symbol?.tickSize) ? symbol.tickSize : NaN;
  const quantityStep = symbol?.quantityStep;
  let priceDecimals = NaN;
  if (isDecimals(symbol?.pricePrecision)) {
    priceDecimals = sanitizeDecimals(symbol.pricePrecision);
  } else if (isDecimals(legacyPricePrecision)) {
    priceDecimals = sanitizeDecimals(legacyPricePrecision);
  } else if (!Number.isNaN(tickSize)) {
    priceDecimals = stepDecimals(tickSize);
  }
  let volumeDecimals = NaN;
  if (isDecimals(symbol?.volumePrecision)) {
    volumeDecimals = sanitizeDecimals(symbol.volumePrecision);
  } else if (isPositiveFinite(quantityStep)) {
    volumeDecimals = stepDecimals(quantityStep);
  }
  return { priceDecimals, tickSize, volumeDecimals };
}

/**
 * Nearest multiple of `tickSize` (`101.13`, tick `0.25` → `101.25`).
 * Returns `price` unchanged when the tick size is invalid; `NaN` for a
 * non-finite price.
 */
export function snapToTickSize(price: number, tickSize: number): number {
  'worklet';
  if (!Number.isFinite(price)) {
    return NaN;
  }
  if (!(tickSize > 0 && tickSize < Infinity)) {
    return price;
  }
  const snapped = Math.round(price / tickSize) * tickSize;
  // Strip float noise (`3 × 0.1 = 0.30000000000000004`).
  return Number(snapped.toFixed(stepDecimals(tickSize))) || 0;
}

/**
 * Smallest multiple of `tickSize` that is `>= step` (axis steps never
 * fall between two tradable prices). `step` unchanged for an invalid tick
 * size; `NaN` for a non-positive / non-finite step.
 */
export function snapStepToTickSize(step: number, tickSize: number): number {
  'worklet';
  if (!(step > 0 && step < Infinity)) {
    return NaN;
  }
  if (!(tickSize > 0 && tickSize < Infinity)) {
    return step;
  }
  const multiple = Math.max(1, Math.ceil(step / tickSize - 1e-9));
  const snapped = multiple * tickSize;
  return snapped < Infinity ? snapped : NaN;
}
