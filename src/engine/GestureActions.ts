import {
  clampBarSpacing,
  elasticRightOffset,
  panRightOffset,
  zoomRightOffset,
} from '../viewport/TimeScale';
import {
  elasticLimit,
  readTimeScale,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import { releaseViewport, stopViewportAnimations } from './ViewportActions';

/**
 * Gesture → viewport updates (Phase 4.1–4.2). Worklets, called from the
 * RNGH callbacks on the UI thread; they only write shared values.
 *
 * Pan and pinch may run simultaneously. Both work on the *unclamped*
 * `rawOffset`; the displayed `rightOffset` is its rubber-banded projection
 * (TradingView-mobile edge feel). The last gesture to end releases the
 * viewport (fling and/or spring back into bounds).
 */

/** Registers an activated pan/pinch. The first one stops running animations. */
export function beginViewportGesture(state: ChartSharedState): void {
  'worklet';
  if (state.activeGestures.value <= 0) {
    stopViewportAnimations(state);
    state.rawOffset.value = state.rightOffset.value;
    state.activeGestures.value = 0;
  }
  state.activeGestures.value += 1;
}

/**
 * Unregisters a gesture. When it was the last one, releases the viewport
 * with `velocity` (bars/s, positive = towards realtime). Returns the number
 * of gestures still active.
 */
export function endViewportGesture(
  state: ChartSharedState,
  options: ViewportOptions,
  velocity: number
): number {
  'worklet';
  const remaining =
    state.activeGestures.value > 1 ? state.activeGestures.value - 1 : 0;
  state.activeGestures.value = remaining;
  if (remaining === 0) {
    releaseViewport(state, options, velocity);
  }
  return remaining;
}

/** Applies a horizontal drag of `dx` dp (positive = finger moves right). */
export function panViewport(
  state: ChartSharedState,
  options: ViewportOptions,
  dx: number
): void {
  'worklet';
  const time = readTimeScale(state);
  time.rightOffset = state.rawOffset.value;
  const raw = panRightOffset(time, dx);
  if (!Number.isFinite(raw)) {
    return;
  }
  state.rawOffset.value = raw;
  state.rightOffset.value = elasticRightOffset(
    time,
    raw,
    options,
    elasticLimit(time)
  );
}

/**
 * Zooms to `nextBarSpacing` (clamped to the zoom limits) keeping the bar
 * under `focalX` fixed (spec §18.2).
 */
export function zoomViewport(
  state: ChartSharedState,
  options: ViewportOptions,
  nextBarSpacing: number,
  focalX: number
): void {
  'worklet';
  const spacing = clampBarSpacing(nextBarSpacing, options);
  if (!(spacing > 0) || !Number.isFinite(focalX)) {
    return;
  }
  const time = readTimeScale(state);
  time.rightOffset = state.rawOffset.value;
  const raw = zoomRightOffset(time, spacing, focalX);
  time.barSpacing = spacing;
  state.barSpacing.value = spacing;
  state.rawOffset.value = raw;
  state.rightOffset.value = elasticRightOffset(
    time,
    raw,
    options,
    elasticLimit(time)
  );
}

/** Pan velocity (dp/s, finger direction) → `rightOffset` velocity (bars/s). */
export function panVelocityToBars(
  velocityX: number,
  barSpacing: number
): number {
  'worklet';
  const v = -velocityX / barSpacing;
  return Number.isFinite(v) ? v : 0;
}
