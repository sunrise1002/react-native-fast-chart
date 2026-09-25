import {
  cancelAnimation,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { nearestBarIndex } from '../render/overlays/CrosshairRenderer';
import { readTimeScale, type ChartSharedState } from './ChartSharedState';

/**
 * Crosshair commands (UI thread, spec §18.3 / Phase 6). All crosshair
 * state lives in shared values — no React state per move.
 */

/** Fade-out duration when the crosshair hides, ms. */
export const CROSSHAIR_FADE_MS = 120;

/**
 * Moves the crosshair: the bar snaps to the nearest bar under `x`, the
 * horizontal line follows `y` freely (clamped when drawn). Non-finite
 * coordinates are ignored.
 */
export function moveCrosshair(
  state: ChartSharedState,
  x: number,
  y: number
): void {
  'worklet';
  const index = nearestBarIndex(readTimeScale(state), x);
  if (index >= 0 && index !== state.crosshairIndex.value) {
    state.crosshairIndex.value = index;
  }
  if (Number.isFinite(y)) {
    state.crosshairY.value = y;
  }
}

/** Shows the crosshair at a touch point (plot space). */
export function showCrosshair(
  state: ChartSharedState,
  x: number,
  y: number
): void {
  'worklet';
  cancelAnimation(state.crosshairOpacity);
  state.crosshairOpacity.value = 1;
  moveCrosshair(state, x, y);
}

/** Hides the crosshair (animated fade after `delayMs`, or immediately). */
export function hideCrosshair(
  state: ChartSharedState,
  delayMs = 0,
  animated = true
): void {
  'worklet';
  cancelAnimation(state.crosshairOpacity);
  if (!animated) {
    state.crosshairOpacity.value = 0;
    return;
  }
  const fade = withTiming(0, { duration: CROSSHAIR_FADE_MS });
  state.crosshairOpacity.value =
    delayMs > 0 && delayMs < Infinity ? withDelay(delayMs, fade) : fade;
}

/** `true` while the crosshair is (at least partly) on screen. */
export function isCrosshairShown(state: ChartSharedState): boolean {
  'worklet';
  return state.crosshairOpacity.value > 0;
}
