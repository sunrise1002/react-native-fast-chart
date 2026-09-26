import { useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type {
  ChartSharedState,
  ViewportOptions,
} from '../engine/ChartSharedState';
import { setPaneSpec } from '../engine/LayoutActions';
import {
  dragSeparator,
  hitTestSeparator,
  type PaneLayoutFrame,
  type PaneLayoutSpec,
} from '../panes/PaneLayout';

export const PANE_RESIZE_TEST_ID = 'rnfc-pane-resize';

interface DragStart {
  /** Separator index (`>= 1`), `-1` when the touch missed. */
  index: number;
  spec: PaneLayoutSpec;
  frame: PaneLayoutFrame;
}

/**
 * Pane separator drag (spec §12.2, Phase 9.6). A touch within `hitSlop`
 * of a separator activates immediately (manual activation), any other
 * touch fails the gesture so pan / pinch / crosshair keep working. The
 * layout follows the finger on the UI thread (`setPaneSpec` with the
 * dragged ratios, derived from the layout at touch-down); on release the
 * ratios are committed once to the pane config through `onCommit` (JS).
 */
export function usePaneResizeGesture(
  state: ChartSharedState,
  options: ViewportOptions,
  enabled: boolean,
  hitSlop: number,
  onCommit: (ratios: number[]) => void
): GestureType {
  return useMemo(() => {
    // Filled on touch-down (reading shared values here would happen
    // during render).
    const start = makeMutable<DragStart>({
      index: -1,
      spec: { ids: [], ratios: [], minHeights: [] },
      frame: { ids: [], tops: [], heights: [], total: 0 },
    });
    return Gesture.Pan()
      .withTestId(PANE_RESIZE_TEST_ID)
      .enabled(enabled)
      .manualActivation(true)
      .onTouchesDown((e, manager) => {
        const touch = e.changedTouches[0];
        const frame = state.paneLayout.value;
        const index =
          touch === undefined ? -1 : hitTestSeparator(frame, touch.y, hitSlop);
        if (index < 1 || e.numberOfTouches > 1) {
          manager.fail();
          return;
        }
        start.value = { index, spec: state.paneSpec.value, frame };
        manager.activate();
      })
      .onUpdate((e) => {
        const { index, spec, frame } = start.value;
        if (index < 1) {
          return;
        }
        setPaneSpec(state, options, {
          ids: spec.ids,
          ratios: dragSeparator(spec, frame, index, e.translationY),
          minHeights: spec.minHeights,
        });
      })
      .onFinalize(() => {
        if (start.value.index < 1) {
          return;
        }
        start.value = { ...start.value, index: -1 };
        scheduleOnRN(onCommit, [...state.paneSpec.value.ratios]);
      });
  }, [state, options, enabled, hitSlop, onCommit]);
}
