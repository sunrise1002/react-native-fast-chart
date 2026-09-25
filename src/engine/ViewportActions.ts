import {
  cancelAnimation,
  Easing,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import {
  barSpacingForRange,
  clampBarSpacing,
  clampRightOffset,
  maxRightOffset,
  minRightOffset,
  rightOffsetForRange,
  type TimeScaleState,
} from '../viewport/TimeScale';
import {
  readTimeScale,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';

/**
 * Viewport commands shared by gestures and the controller. All run on the
 * UI thread (worklets); the controller dispatches them with `scheduleOnUI`.
 */

export const VIEWPORT_ANIMATION_MS = 280;
/** Reanimated decay deceleration (per ms); TradingView-like glide. */
export const FLING_DECELERATION = 0.997;

const EASE_OUT = Easing.out(Easing.cubic);

function animateTo(
  value: { value: number },
  target: number,
  animated: boolean
): void {
  'worklet';
  if (animated) {
    value.value = withTiming(target, {
      duration: VIEWPORT_ANIMATION_MS,
      easing: EASE_OUT,
    });
  } else {
    value.value = target;
  }
}

/** Stops any running pan/zoom animation (e.g. a fling on touch down). */
export function stopViewportAnimations(state: ChartSharedState): void {
  'worklet';
  cancelAnimation(state.rightOffset);
  cancelAnimation(state.barSpacing);
}

/**
 * Releases the viewport after a gesture: glides with `velocity` (bars/s)
 * and rubber-bands back inside the pan bounds; with no velocity it only
 * springs back when out of bounds.
 */
export function releaseViewport(
  state: ChartSharedState,
  options: ViewportOptions,
  velocity: number
): void {
  'worklet';
  const time = readTimeScale(state);
  const lo = minRightOffset(time, options);
  const hi = maxRightOffset(time, options);
  const current = state.rightOffset.value;
  const v = Number.isFinite(velocity) ? velocity : 0;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo <= hi)) {
    return;
  }
  if (v === 0 && current >= lo && current <= hi) {
    return;
  }
  state.rightOffset.value = withDecay({
    velocity: v,
    deceleration: FLING_DECELERATION,
    clamp: [lo, hi],
    rubberBandEffect: true,
    rubberBandFactor: 0.9,
  });
}

/** `rightOffset` of the realtime position for `time`, clamped. */
export function realtimeRightOffset(
  time: TimeScaleState,
  options: ViewportOptions
): number {
  'worklet';
  return clampRightOffset(time, options.realtimeRightOffset, options);
}

/** Scrolls so the last bar sits `realtimeRightOffset` bars from the edge. */
export function scrollToRealtime(
  state: ChartSharedState,
  options: ViewportOptions,
  animated: boolean
): void {
  'worklet';
  stopViewportAnimations(state);
  const target = realtimeRightOffset(readTimeScale(state), options);
  if (Number.isFinite(target)) {
    animateTo(state.rightOffset, target, animated);
  }
}

/** Restores the initial bar spacing and scrolls to realtime. */
export function resetViewport(
  state: ChartSharedState,
  options: ViewportOptions,
  animated: boolean
): void {
  'worklet';
  stopViewportAnimations(state);
  const spacing = clampBarSpacing(options.initialBarSpacing, options);
  const time = readTimeScale(state);
  time.barSpacing = spacing;
  const target = realtimeRightOffset(time, options);
  animateTo(state.barSpacing, spacing, animated);
  if (Number.isFinite(target)) {
    animateTo(state.rightOffset, target, animated);
  }
}

/**
 * Fits logical bars `[from, to]` into the plot (spacing clamped to the
 * zoom limits, offset clamped to the pan bounds). Invalid ranges are
 * ignored.
 */
export function showLogicalRange(
  state: ChartSharedState,
  options: ViewportOptions,
  from: number,
  to: number,
  animated: boolean
): void {
  'worklet';
  const time = readTimeScale(state);
  const raw = barSpacingForRange(time.width, from, to);
  if (!(raw > 0) || !Number.isFinite(to)) {
    return;
  }
  stopViewportAnimations(state);
  time.barSpacing = clampBarSpacing(raw, options);
  const target = clampRightOffset(
    time,
    rightOffsetForRange(time.barCount, to),
    options
  );
  animateTo(state.barSpacing, time.barSpacing, animated);
  animateTo(state.rightOffset, target, animated);
}

/**
 * Applies a new plot size. The first non-empty size also resets the
 * viewport (data may have arrived before layout). Later resizes keep the
 * right edge anchored (TimeScale model), i.e. the latest bars stay put.
 */
export function resizePlot(
  state: ChartSharedState,
  options: ViewportOptions,
  width: number,
  height: number
): void {
  'worklet';
  const w = width > 0 && width < Infinity ? width : 0;
  const h = height > 0 && height < Infinity ? height : 0;
  const firstLayout = !(state.plotWidth.value > 0) && w > 0;
  state.plotWidth.value = w;
  state.plotHeight.value = h;
  if (firstLayout) {
    resetViewport(state, options, false);
  }
}
