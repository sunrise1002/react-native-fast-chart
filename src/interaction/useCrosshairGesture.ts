import { useMemo } from 'react';
import {
  Gesture,
  type ComposedGesture,
  type GestureStateManager,
  type GestureTouchEvent,
  type GestureType,
} from 'react-native-gesture-handler';
import { makeMutable, type SharedValue } from 'react-native-reanimated';
import type { ChartCrosshairConfig } from '../core/ChartConfig';
import type { ChartSharedState } from '../engine/ChartSharedState';
import {
  hideCrosshair,
  isCrosshairShown,
  moveCrosshair,
  showCrosshair,
} from '../engine/CrosshairActions';

/**
 * Crosshair gestures (spec §18.3, Phase 6.1), raced against the viewport
 * gestures by `composeChartGestures`:
 *
 * - long press (`longPressMs`) activates a pan that moves the crosshair;
 *   the `Race` cancels the viewport pan while it is active. A horizontal
 *   drag before the delay pans the chart instead (TradingView feel).
 * - `'hold'`: on release the crosshair stays `holdMs`, then fades out.
 * - `'sticky'` (Binance): it stays after release; while shown, a
 *   one-finger drag moves it immediately and a tap hides it. The drag
 *   gesture fails at touch-down when the crosshair is hidden (or for a
 *   second finger), so panning / pinching work as usual then; a pinch
 *   keeps the crosshair on its bar.
 */

export const CROSSHAIR_TEST_IDS = Object.freeze({
  longPress: 'rnfc-crosshair',
  stickyDrag: 'rnfc-crosshair-drag',
});

/** Movement (dp) that turns a sticky-mode touch into a drag, not a tap. */
export const STICKY_DRAG_SLOP_DP = 4;

/** `true` when a touch moved farther than the tap slop. */
export function exceedsSlop(dx: number, dy: number, slop: number): boolean {
  'worklet';
  return dx * dx + dy * dy > slop * slop;
}

/** Touch bookkeeping of the sticky drag (UI thread). */
export interface StickyTouch {
  x: number;
  y: number;
  /** The touch moved past the slop and drives the crosshair. */
  drag: boolean;
  /** The touch ended without dragging (a tap: hides the crosshair). */
  tap: boolean;
}

type StickyTouchValue = SharedValue<StickyTouch>;
type TouchManager = Pick<GestureStateManager, 'activate' | 'fail' | 'end'>;
type TouchEvent = Pick<GestureTouchEvent, 'allTouches' | 'numberOfTouches'>;

/** Sticky drag touch-down: tracks one finger while the crosshair is shown. */
export function stickyTouchDown(
  state: ChartSharedState,
  touch0: StickyTouchValue,
  e: TouchEvent,
  manager: TouchManager
): void {
  'worklet';
  const touch = e.allTouches[0];
  if (!isCrosshairShown(state) || e.numberOfTouches !== 1 || !touch) {
    manager.fail();
    return;
  }
  touch0.value = { x: touch.x, y: touch.y, drag: false, tap: false };
}

/** Sticky drag touch-move: activates once the finger leaves the slop. */
export function stickyTouchMove(
  touch0: StickyTouchValue,
  e: TouchEvent,
  manager: TouchManager
): void {
  'worklet';
  const touch = e.allTouches[0];
  const t0 = touch0.value;
  if (
    touch &&
    !t0.drag &&
    exceedsSlop(touch.x - t0.x, touch.y - t0.y, STICKY_DRAG_SLOP_DP)
  ) {
    touch0.value = { x: t0.x, y: t0.y, drag: true, tap: false };
    manager.activate();
  }
}

/** Sticky drag touch-up: ends a drag, or marks a tap and fails. */
export function stickyTouchUp(
  touch0: StickyTouchValue,
  manager: TouchManager
): void {
  'worklet';
  const t0 = touch0.value;
  if (t0.drag) {
    manager.end();
  } else {
    touch0.value = { x: t0.x, y: t0.y, drag: false, tap: true };
    manager.fail();
  }
}

/**
 * Sticky drag finalize: a finger lifted without dragging is a tap → hide.
 * (Cancellation by the long press or a second finger keeps the crosshair.)
 */
export function stickyFinalize(
  state: ChartSharedState,
  touch0: StickyTouchValue
): void {
  'worklet';
  if (touch0.value.tap) {
    hideCrosshair(state, 0);
  }
  touch0.value = { x: 0, y: 0, drag: false, tap: false };
}

export function useCrosshairGesture(
  state: ChartSharedState,
  config: ChartCrosshairConfig,
  enabled: boolean
): GestureType | ComposedGesture | undefined {
  const { mode, longPressMs, holdMs } = config;
  return useMemo(() => {
    if (!enabled) {
      return undefined;
    }
    const sticky = mode === 'sticky';
    const longPress = Gesture.Pan()
      .withTestId(CROSSHAIR_TEST_IDS.longPress)
      .activateAfterLongPress(longPressMs > 0 ? longPressMs : 1)
      .onStart((e) => {
        showCrosshair(state, e.x, e.y);
      })
      .onUpdate((e) => {
        moveCrosshair(state, e.x, e.y);
      })
      .onEnd(() => {
        if (!sticky) {
          hideCrosshair(state, holdMs);
        }
      });
    if (!sticky) {
      return longPress;
    }

    const touch0 = makeMutable<StickyTouch>({
      x: 0,
      y: 0,
      drag: false,
      tap: false,
    });
    const stickyDrag = Gesture.Pan()
      .withTestId(CROSSHAIR_TEST_IDS.stickyDrag)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        stickyTouchDown(state, touch0, e, manager);
      })
      .onTouchesMove((e, manager) => {
        stickyTouchMove(touch0, e, manager);
      })
      .onTouchesUp((_e, manager) => {
        stickyTouchUp(touch0, manager);
      })
      .onUpdate((e) => {
        moveCrosshair(state, e.x, e.y);
      })
      .onFinalize(() => {
        stickyFinalize(state, touch0);
      });
    return Gesture.Race(stickyDrag, longPress);
  }, [state, enabled, mode, longPressMs, holdMs]);
}
