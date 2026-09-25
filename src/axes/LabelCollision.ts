/**
 * Label collision helpers (spec §19.1–19.2: "avoid overlapping labels").
 * Pure, worklet-compatible, allocation-free.
 */

/** `true` when `[a0, a1]` and `[b0, b1]` are closer than `gap`. */
export function rangesOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  gap = 0
): boolean {
  'worklet';
  return a0 < b1 + gap && b0 < a1 + gap;
}

/**
 * Start of a span of `size` placed centered on `center`, clamped into
 * `[min, max]` (pins axis badges / crosshair labels to the edges). When the
 * span is larger than the room, it is aligned to `min`. `NaN` center →
 * `NaN` (caller skips the label).
 */
export function clampSpan(
  center: number,
  size: number,
  min: number,
  max: number
): number {
  'worklet';
  const start = center - size / 2;
  if (Number.isNaN(start)) {
    return NaN;
  }
  if (start + size > max) {
    return max - size < min ? min : max - size;
  }
  return start < min ? min : start;
}

/** Ticks with a priority; `payload` travels with each kept tick. */
export interface WeightedTicks {
  /** Tick positions, ascending (any linear unit, e.g. bar index). */
  positions: Float64Array;
  weights: Uint8Array;
  payload: Float64Array;
  count: number;
}

/**
 * Removes ticks closer than `minDistance` to their kept neighbour, in
 * place. Scanning left to right, a tick that collides with the previous
 * kept tick replaces it only when its weight is strictly higher (e.g. a
 * month boundary beats a day label); ties keep the earlier tick, so the
 * result is stable while panning. Returns the new count.
 */
export function thinTicksBySpacing(
  ticks: WeightedTicks,
  minDistance: number
): number {
  'worklet';
  if (!(minDistance > 0)) {
    return ticks.count;
  }
  const { positions, weights, payload } = ticks;
  let kept = 0;
  for (let i = 0; i < ticks.count; i++) {
    const position = positions[i] as number;
    const weight = weights[i] as number;
    // Drop kept ticks that are too close and less important.
    while (
      kept > 0 &&
      position - (positions[kept - 1] as number) < minDistance &&
      weight > (weights[kept - 1] as number)
    ) {
      kept--;
    }
    if (kept > 0 && position - (positions[kept - 1] as number) < minDistance) {
      continue;
    }
    positions[kept] = position;
    weights[kept] = weight;
    payload[kept] = payload[i] as number;
    kept++;
  }
  ticks.count = kept;
  return kept;
}
