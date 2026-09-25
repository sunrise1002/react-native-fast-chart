/**
 * Scalar helpers shared by the viewport engine.
 *
 * Worklet contract (applies to every function under `src/viewport/` marked
 * with `'worklet'`): plain functions of numbers / plain objects, no closures
 * over class instances, no allocation unless documented, no Skia/React.
 * They run unchanged on the JS thread (tests) and inside Reanimated
 * UI-thread worklets (the consumer's Babel worklets plugin transforms them).
 */

/** Clamps `value` into `[min, max]`; `NaN` maps to `min`. */
export function clamp(value: number, min: number, max: number): number {
  'worklet';
  if (Number.isNaN(value)) {
    return min;
  }
  return value < min ? min : value > max ? max : value;
}

/** Rubber-band stiffness (iOS UIScrollView uses 0.55). */
export const RUBBER_BAND_COEFFICIENT = 0.55;

/**
 * Elastic overscroll: inside `[min, max]` returns `value`; outside, the
 * overshoot is compressed so it approaches but never exceeds `limit`
 * (same unit as `value`). `limit <= 0` degrades to a hard clamp.
 */
export function rubberBand(
  value: number,
  min: number,
  max: number,
  limit: number
): number {
  'worklet';
  if (Number.isNaN(value)) {
    return min;
  }
  if (value >= min && value <= max) {
    return value;
  }
  if (!(limit > 0)) {
    return clamp(value, min, max);
  }
  const over = value < min ? min - value : value - max;
  const eased =
    (1 - 1 / ((over * RUBBER_BAND_COEFFICIENT) / limit + 1)) * limit;
  return value < min ? min - eased : max + eased;
}

/** `true` when every argument is a finite number. */
export function areFinite(a: number, b: number, c = 0, d = 0): boolean {
  'worklet';
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Number.isFinite(c) &&
    Number.isFinite(d)
  );
}
