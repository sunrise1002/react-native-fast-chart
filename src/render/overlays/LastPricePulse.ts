/*
 * Last-price pulse (spec Phase 15, optional): a soft circle that grows and
 * fades at the last close whenever the forming bar ticks. Pure worklets;
 * `progress` runs 0 (tick) → 1 (idle).
 */

export const PULSE_MIN_RADIUS = 2.5;
export const PULSE_MAX_RADIUS = 9;
export const PULSE_MAX_OPACITY = 0.45;

function unit(progress: number): number {
  'worklet';
  if (!(progress > 0)) {
    return 0;
  }
  return progress < 1 ? progress : 1;
}

/** Radius, dp: grows from the min to the max radius. */
export function pulseRadius(progress: number): number {
  'worklet';
  return (
    PULSE_MIN_RADIUS + (PULSE_MAX_RADIUS - PULSE_MIN_RADIUS) * unit(progress)
  );
}

/** Opacity: fades out (ease-out) to 0 at `progress` 1; 0 when invalid. */
export function pulseOpacity(progress: number): number {
  'worklet';
  if (!(progress >= 0)) {
    return 0;
  }
  const rest = 1 - unit(progress);
  return PULSE_MAX_OPACITY * rest * rest;
}
