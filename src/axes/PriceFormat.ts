/**
 * Price / volume number formatting (spec §19.2, Phase 5.1). Pure and
 * worklet-compatible: no `Intl` / `toLocaleString` (not reliable on the UI
 * runtime), no allocation beyond the returned string.
 *
 * Non-finite input formats as `''` so renderers simply skip the label
 * (spec §33.8).
 */

/** Upper bound for label decimals (float64 carries ~15-17 digits). */
export const MAX_PRICE_DECIMALS = 12;

/** Relative tolerance when testing whether a step is "whole" at `d` decimals. */
const STEP_EPSILON = 1e-9;

/** `value` rounded to an integer in `[0, MAX_PRICE_DECIMALS]`; else `fallback`. */
export function sanitizeDecimals(value: number, fallback = 2): number {
  'worklet';
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const d = Math.round(value);
  return d < 0 ? 0 : d > MAX_PRICE_DECIMALS ? MAX_PRICE_DECIMALS : d;
}

/**
 * Fewest decimals that represent `step` exactly (`2.5` → 1, `0.25` → 2,
 * `5e-8` → 8, `100` → 0). Non-positive / non-finite steps → 0.
 */
export function stepDecimals(step: number): number {
  'worklet';
  if (!(step > 0 && step < Infinity)) {
    return 0;
  }
  let scaled = step;
  for (let d = 0; d < MAX_PRICE_DECIMALS; d++) {
    if (Math.abs(scaled - Math.round(scaled)) <= STEP_EPSILON * scaled) {
      return d;
    }
    scaled *= 10;
  }
  return MAX_PRICE_DECIMALS;
}

/**
 * Automatic display precision for a price (used when no `pricePrecision`
 * is configured): 2 decimals from 1 upwards, otherwise enough decimals for
 * 4 significant digits (`0.00001234` → 8). Invalid / zero input → 2.
 */
export function autoPriceDecimals(price: number): number {
  'worklet';
  const abs = Math.abs(price);
  if (!(abs > 0 && abs < Infinity) || abs >= 1) {
    return 2;
  }
  return sanitizeDecimals(Math.ceil(-Math.log10(abs)) + 3);
}

/** `true` when the string contains a digit 1-9. */
function hasNonZeroDigit(text: string): boolean {
  'worklet';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 49 && c <= 57) {
      return true;
    }
  }
  return false;
}

/**
 * Decimals for a displayed price (last price, crosshair, legend): the
 * configured precision when `>= 0`, else `autoPriceDecimals(reference)`.
 */
export function displayDecimals(
  pricePrecision: number,
  reference: number
): number {
  'worklet';
  return pricePrecision >= 0
    ? sanitizeDecimals(pricePrecision)
    : autoPriceDecimals(reference);
}

/** Inserts `separator` every 3 digits of an unsigned integer string. */
function groupThousands(digits: string, separator: string): string {
  'worklet';
  if (separator === '' || digits.length <= 3) {
    return digits;
  }
  let out = '';
  const head = digits.length % 3;
  if (head > 0) {
    out = digits.slice(0, head);
  }
  for (let i = head; i < digits.length; i += 3) {
    out += (out === '' ? '' : separator) + digits.slice(i, i + 3);
  }
  return out;
}

/**
 * Formats `value` with exactly `decimals` decimals and a thousands
 * separator: `65432.1` → `"65,432.10"`, `0.00001234` (8) → `"0.00001234"`.
 * Values that round to zero never keep a minus sign. Magnitudes ≥ 1e21
 * (where fixed notation is unavailable) use exponent notation.
 */
export function formatPrice(
  value: number,
  decimals: number,
  thousandsSeparator = ','
): string {
  'worklet';
  if (!Number.isFinite(value)) {
    return '';
  }
  const d = sanitizeDecimals(decimals);
  const abs = Math.abs(value);
  if (abs >= 1e21) {
    return (value < 0 ? '-' : '') + abs.toExponential(2);
  }
  const fixed = abs.toFixed(d);
  const dot = fixed.indexOf('.');
  const intPart = dot < 0 ? fixed : fixed.slice(0, dot);
  const fraction = dot < 0 ? '' : fixed.slice(dot);
  const negative = value < 0 && hasNonZeroDigit(fixed);
  return (
    (negative ? '-' : '') +
    groupThousands(intPart, thousandsSeparator) +
    fraction
  );
}

/** Like `formatPrice` but always signed: `"+12.30"`, `"-0.50"`, `"0.00"`. */
export function formatSignedPrice(
  value: number,
  decimals: number,
  thousandsSeparator = ','
): string {
  'worklet';
  const text = formatPrice(value, decimals, thousandsSeparator);
  if (text === '' || text.charCodeAt(0) === 45 /* - */) {
    return text;
  }
  return hasNonZeroDigit(text) ? '+' + text : text;
}

/** Signed percentage: `"+1.23%"`; `''` for non-finite input. */
export function formatPercent(value: number, decimals = 2): string {
  'worklet';
  const text = formatSignedPrice(value, decimals, '');
  return text === '' ? '' : text + '%';
}

const VOLUME_UNITS = ['', 'K', 'M', 'B', 'T'];

/**
 * Compact volume: `950` → `"950"`, `1234` → `"1.23K"`, `12_345_678` →
 * `"12.35M"`. Values below 1 keep up to 4 significant decimals. Negative /
 * non-finite volumes format as `''`.
 */
export function formatVolume(value: number): string {
  'worklet';
  if (!(value >= 0 && value < Infinity)) {
    return '';
  }
  if (value < 1) {
    return value === 0 ? '0' : formatPrice(value, autoPriceDecimals(value));
  }
  let scaled = value;
  let unit = 0;
  while (scaled >= 999.995 && unit < VOLUME_UNITS.length - 1) {
    scaled /= 1000;
    unit++;
  }
  const decimals = unit === 0 && scaled === Math.floor(scaled) ? 0 : 2;
  return formatPrice(scaled, decimals) + VOLUME_UNITS[unit];
}
