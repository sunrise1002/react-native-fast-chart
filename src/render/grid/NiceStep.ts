/**
 * "Nice" tick steps (1, 2, 5 × 10^k) for the basic grid (Phase 3.4).
 * Deliberately simple: P4's price/time tick generators replace these via
 * the `GridTickSource` hooks of `buildGridGeometry`. Worklet-compatible.
 */

/**
 * Smallest nice step `>= span / targetCount`. Returns `NaN` when no
 * positive finite step exists (empty/invalid span or count).
 */
export function niceStep(span: number, targetCount: number): number {
  'worklet';
  const raw = span / targetCount;
  if (!(raw > 0 && raw < Infinity)) {
    return NaN;
  }
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  // Tiny epsilon keeps exact powers (1, 2, 5) from rounding up a level.
  const nice =
    normalized <= 1 + 1e-9
      ? 1
      : normalized <= 2 + 1e-9
        ? 2
        : normalized <= 5 + 1e-9
          ? 5
          : 10;
  const step = nice * magnitude;
  return step > 0 && step < Infinity ? step : NaN;
}

/** Price step giving lines roughly every `spacingPx` px over `heightPx`. */
export function nicePriceStep(
  min: number,
  max: number,
  heightPx: number,
  spacingPx: number
): number {
  'worklet';
  if (!(heightPx > 0) || !(spacingPx > 0)) {
    return NaN;
  }
  return niceStep(max - min, heightPx / spacingPx);
}

/**
 * Whole-bar step (1, 2, 5 × 10^k bars, `>= 1`) so vertical lines are at
 * least `spacingPx` apart. Lines sit on multiples of the step, so they stay
 * glued to the same bars while panning. `NaN` for an invalid spacing.
 */
export function niceBarStep(barSpacing: number, spacingPx: number): number {
  'worklet';
  if (!(barSpacing > 0 && barSpacing < Infinity) || !(spacingPx > 0)) {
    return NaN;
  }
  const bars = spacingPx / barSpacing;
  if (bars <= 1) {
    return 1;
  }
  return niceStep(bars, 1);
}
