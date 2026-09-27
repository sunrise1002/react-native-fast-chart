import { useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { ChartSharedState } from '../engine/ChartSharedState';
import {
  beginOverlayDrag,
  endOverlayDrag,
  noDragStart,
  updateOverlayDrag,
  type OverlayDragStart,
} from '../engine/TradingActions';
import { tapOverlays } from '../engine/TradingTapActions';
import { DRAG_LINE, DRAG_NONE } from '../engine/TradingState';
import type { DrawingType } from '../trading/DrawingModel';

export const TRADING_GESTURE_TEST_IDS = Object.freeze({
  drag: 'rnfc-overlay-drag',
  tap: 'rnfc-overlay-tap',
});

/** JS-thread receivers of the overlay gestures (called via `scheduleOnRN`). */
export interface TradingGestureCallbacks {
  /** Line drag: `'change'` per snapped price step, `'commit'` on release. */
  onLineDrag: (
    target: string,
    id: string,
    price: number,
    phase: 'change' | 'commit'
  ) => void;
  /** Drawing moved / an anchor edited (flattened `[time, price, ...]`). */
  onDrawingMove: (id: string, anchors: number[]) => void;
  /** The active tool's draft got all its anchors. */
  onDraftComplete: (tool: DrawingType, anchors: number[]) => void;
  /** Tap selection changed (`''` = none). */
  onSelect: (id: string) => void;
}

export interface TradingGestureOptions {
  enabled: boolean;
  hitSlop: number;
  /** Price snap step (`NaN` = no snapping). */
  tickSize: number;
}

export interface TradingGestures {
  /** Line / drawing drag; fails at touch-down unless it grabbed something. */
  drag: GestureType;
  /** Selection and tap-tap drawing creation. */
  tap: GestureType;
}

/**
 * Overlay gestures (spec 22.3 / 22.5), both UI-thread worklets:
 *
 * - drag: manual activation. Touch-down hit-tests draggable levels (label
 *   box / axis-side grab zone) and the selected drawing; a miss fails the
 *   gesture at once, so pan / pinch / crosshair keep the touch. Levels
 *   snap to `tickSize`; JS hears a `'change'` only when the snapped price
 *   changes and one commit on release.
 * - tap: places draft anchors while a drawing tool is active, otherwise
 *   selects the drawing under the finger.
 */
export function useTradingGestures(
  state: ChartSharedState,
  options: TradingGestureOptions,
  callbacks: TradingGestureCallbacks
): TradingGestures {
  const { enabled, hitSlop, tickSize } = options;
  const { onLineDrag, onDrawingMove, onDraftComplete, onSelect } = callbacks;
  return useMemo(() => {
    const start = makeMutable<OverlayDragStart>(noDragStart());
    const drag = Gesture.Pan()
      .withTestId(TRADING_GESTURE_TEST_IDS.drag)
      .enabled(enabled)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        const touch = e.changedTouches[0];
        const grabbed =
          touch === undefined || e.numberOfTouches > 1
            ? noDragStart()
            : beginOverlayDrag(state, touch.x, touch.y, hitSlop);
        if (grabbed.kind === DRAG_NONE) {
          manager.fail();
          return;
        }
        start.value = grabbed;
        manager.activate();
      })
      .onUpdate((e) => {
        const s = start.value;
        if (s.kind === DRAG_NONE) {
          return;
        }
        const price = updateOverlayDrag(state, s, e.x, e.y, tickSize);
        if (s.kind === DRAG_LINE && Number.isFinite(price)) {
          if (price !== s.lastPrice) {
            start.value = { ...s, lastPrice: price };
            scheduleOnRN(onLineDrag, s.target, s.id, price, 'change');
          }
        }
      })
      .onFinalize(() => {
        const s = start.value;
        if (s.kind === DRAG_NONE) {
          return;
        }
        start.value = noDragStart();
        if (!endOverlayDrag(state, s)) {
          return;
        }
        const ui = state.tradingUi.value;
        if (s.kind === DRAG_LINE) {
          scheduleOnRN(onLineDrag, s.target, s.id, ui.dragPrice, 'commit');
        } else {
          scheduleOnRN(onDrawingMove, s.id, ui.dragAnchors.slice());
        }
      });

    const tap = Gesture.Tap()
      .withTestId(TRADING_GESTURE_TEST_IDS.tap)
      .enabled(enabled)
      .onEnd((e, success) => {
        if (!success || !(e.y <= state.plotHeight.value)) {
          return;
        }
        const tool = state.tradingScene.value.tool;
        const result = tapOverlays(state, e.x, e.y, hitSlop, tickSize);
        if (tool !== '' && result.complete) {
          scheduleOnRN(onDraftComplete, tool, result.anchors);
        } else if (!result.draft && result.selectionChanged) {
          scheduleOnRN(onSelect, result.selectedId);
        }
      });
    return { drag, tap };
  }, [
    state,
    enabled,
    hitSlop,
    tickSize,
    onLineDrag,
    onDrawingMove,
    onDraftComplete,
    onSelect,
  ]);
}
