import { useMemo } from 'react';
import {
  Gesture,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import { makeMutable } from 'react-native-reanimated';
import type { ChartInteractionConfig } from '../core/ChartConfig';
import type {
  ChartSharedState,
  ViewportOptions,
} from '../engine/ChartSharedState';
import {
  beginViewportGesture,
  endViewportGesture,
  panVelocityToBars,
  panViewport,
  zoomViewport,
} from '../engine/GestureActions';
import {
  releaseViewport,
  resetViewport,
  stopViewportAnimations,
} from '../engine/ViewportActions';

/**
 * Gesture layer (spec §18, Phase 4). Structure:
 *
 *   Race(crosshair?, Simultaneous(pan, pinch, doubleTap))
 *
 * - pan: horizontal-only activation (`activeOffsetX` / `failOffsetY`) so a
 *   vertical parent ScrollView keeps scrolling; 1:1 drag, fling with
 *   rubber-banded edges; touch-down stops a running fling.
 * - pinch: focal-point zoom, simultaneous with pan (two-finger drag pans).
 * - doubleTap: animated reset to the default zoom at realtime.
 * - crosshair: the long-press gesture from `useCrosshairGesture` (or a
 *   custom one); `Race` hands the touch to whichever activates first.
 */

/** Horizontal travel (dp) before a pan activates / vertical before it fails. */
export const PAN_ACTIVATION_DP = 8;
export const DOUBLE_TAP_MAX_DELAY_MS = 250;

export const GESTURE_TEST_IDS = Object.freeze({
  pan: 'rnfc-pan',
  pinch: 'rnfc-pinch',
  doubleTap: 'rnfc-double-tap',
});

export interface ChartGestures {
  pan: GestureType;
  pinch: GestureType;
  doubleTap: GestureType;
  composed: ComposedGesture;
}

/** Composes the viewport gestures with an optional crosshair gesture. */
export function composeChartGestures(
  pan: GestureType,
  pinch: GestureType,
  doubleTap: GestureType,
  crosshair?: GestureType | ComposedGesture
): ComposedGesture {
  const viewport = Gesture.Simultaneous(pan, pinch, doubleTap);
  return crosshair ? Gesture.Race(crosshair, viewport) : viewport;
}

export function useChartGestures(
  state: ChartSharedState,
  options: ViewportOptions,
  interaction: ChartInteractionConfig,
  crosshair?: GestureType | ComposedGesture
): ChartGestures {
  return useMemo(() => {
    const panActive = makeMutable(false);
    const pinchStartSpacing = makeMutable(0);

    const pan = Gesture.Pan()
      .withTestId(GESTURE_TEST_IDS.pan)
      .enabled(interaction.panEnabled)
      .activeOffsetX([-PAN_ACTIVATION_DP, PAN_ACTIVATION_DP])
      .failOffsetY([-PAN_ACTIVATION_DP, PAN_ACTIVATION_DP])
      .onBegin(() => {
        // A new touch catches a running fling (TradingView / iOS feel).
        if (state.activeGestures.value === 0) {
          stopViewportAnimations(state);
        }
      })
      .onStart(() => {
        panActive.value = true;
        beginViewportGesture(state);
      })
      .onChange((e) => {
        panViewport(state, options, e.changeX);
      })
      .onFinalize((e) => {
        if (panActive.value) {
          panActive.value = false;
          endViewportGesture(
            state,
            options,
            panVelocityToBars(e.velocityX, state.barSpacing.value)
          );
        } else if (state.activeGestures.value === 0) {
          // Touch without a pan (e.g. a tap that stopped a fling):
          // spring back if the fling was stopped out of bounds.
          releaseViewport(state, options, 0);
        }
      });

    const pinch = Gesture.Pinch()
      .withTestId(GESTURE_TEST_IDS.pinch)
      .enabled(interaction.pinchEnabled)
      .onStart(() => {
        beginViewportGesture(state);
        pinchStartSpacing.value = state.barSpacing.value;
      })
      .onUpdate((e) => {
        zoomViewport(
          state,
          options,
          pinchStartSpacing.value * e.scale,
          e.focalX
        );
      })
      .onEnd(() => {
        endViewportGesture(state, options, 0);
      });

    const doubleTap = Gesture.Tap()
      .withTestId(GESTURE_TEST_IDS.doubleTap)
      .enabled(interaction.pinchEnabled || interaction.panEnabled)
      .numberOfTaps(2)
      .maxDelay(DOUBLE_TAP_MAX_DELAY_MS)
      .onEnd((_e, success) => {
        if (success) {
          resetViewport(state, options, true);
        }
      });

    return {
      pan,
      pinch,
      doubleTap,
      composed: composeChartGestures(pan, pinch, doubleTap, crosshair),
    };
  }, [state, options, interaction, crosshair]);
}
