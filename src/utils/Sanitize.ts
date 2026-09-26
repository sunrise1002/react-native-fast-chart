/**
 * Central numeric guards (spec §26, §33.8, Phase 20.2): nothing non-finite
 * or absurdly large reaches Skia. Pure, allocation-free worklets, shared
 * by the geometry builders, layout actions and config resolution.
 */

/**
 * |coordinate| limit, dp / px. Far beyond any plot, but inside float32
 * range for the rasterizer (values like 1e300 on a normal scale would
 * overflow to ∞ in Skia's float geometry).
 */
export const MAX_ABS_COORDINATE = 1e6;

/** `true` for a finite number (type guard; rejects `NaN`, ±∞, non-numbers). */
export function isFiniteNumber(value: unknown): value is number {
  'worklet';
  return typeof value === 'number' && value - value === 0;
}

/** `value` when finite, else `fallback`. */
export function finiteOr(value: number, fallback: number): number {
  'worklet';
  return value - value === 0 ? value : fallback;
}

/**
 * Drawable coordinate: finite values clamped to `±MAX_ABS_COORDINATE`,
 * `NaN` for non-finite input (callers skip the primitive).
 */
export function clampCoordinate(value: number): number {
  'worklet';
  if (!(value - value === 0)) {
    return NaN;
  }
  return value > MAX_ABS_COORDINATE
    ? MAX_ABS_COORDINATE
    : value < -MAX_ABS_COORDINATE
      ? -MAX_ABS_COORDINATE
      : value;
}

/** `value` clamped to `[min, max]`; `fallback` when it is not finite. */
export function clampFinite(
  value: number,
  min: number,
  max: number,
  fallback: number
): number {
  'worklet';
  if (!(value - value === 0)) {
    return fallback;
  }
  return value < min ? min : value > max ? max : value;
}

/** Non-negative finite size (width, height, spacing); else `fallback`. */
export function sanitizeLength(value: number, fallback = 0): number {
  'worklet';
  return value >= 0 && value < Infinity ? value : fallback;
}

/** Mutable rectangle (Skia `SkRect` shape). */
export interface MutableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Makes `rect` drawable in place: clamps the origin, turns negative sizes
 * into 0 and clamps the far edge. Returns `false` (rect untouched) when
 * any field is not finite — the caller must skip it.
 */
export function sanitizeRect(rect: MutableRect): boolean {
  'worklet';
  const { x, y, width, height } = rect;
  if (
    !(x - x === 0) ||
    !(y - y === 0) ||
    !(width - width === 0) ||
    !(height - height === 0)
  ) {
    return false;
  }
  const left = clampCoordinate(x);
  const top = clampCoordinate(y);
  rect.x = left;
  rect.y = top;
  rect.width = width > 0 ? clampCoordinate(left + width) - left : 0;
  rect.height = height > 0 ? clampCoordinate(top + height) - top : 0;
  return true;
}
