/**
 * Device-pixel alignment helpers. Geometry is computed in dp, snapped to
 * whole device pixels (`dp * pixelRatio`) and converted back, so filled
 * rect edges land exactly on pixel boundaries (crisp, no anti-aliased
 * seams). All functions are worklet-compatible and allocation-free.
 */

/** `pixelRatio` when finite and `> 0`, else `1`. */
export function sanitizePixelRatio(pixelRatio: number): number {
  'worklet';
  return pixelRatio > 0 && pixelRatio < Infinity ? pixelRatio : 1;
}

/** Rounds a dp coordinate to the nearest device-pixel boundary. */
export function snapToPixel(value: number, pixelRatio: number): number {
  'worklet';
  const pr = sanitizePixelRatio(pixelRatio);
  return Math.round(value * pr) / pr;
}

/**
 * Width of a line of `widthDp` in whole device pixels, at least 1
 * (non-finite or non-positive widths → 1 device pixel).
 */
export function lineWidthPx(widthDp: number, pixelRatio: number): number {
  'worklet';
  const px = Math.round(widthDp * sanitizePixelRatio(pixelRatio));
  return px >= 1 && px < Infinity ? px : 1;
}
