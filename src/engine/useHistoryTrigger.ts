import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { frameTimeScale } from '../render/skia/frameScales';
import { isNearHistoryStart } from '../viewport/ViewportShift';
import type { ChartSharedState } from './ChartSharedState';

/** 2^32: packs `resetVersion` above any realistic bar count. */
const RESET_STRIDE = 4294967296;

/**
 * Left-edge detection for history pagination (spec Phase 16.1), evaluated
 * on the UI thread from the viewport shared values. `onNearStart` runs on
 * the JS thread (`scheduleOnRN`) when the view enters the threshold zone,
 * and again whenever the series grows or is replaced while the view stays
 * in it (a short page may not be enough). Panning inside the zone does
 * not re-fire; the JS side (`HistoryLoader`) guards against duplicates.
 */
export function useHistoryTrigger(
  state: ChartSharedState,
  thresholdBars: number,
  enabled: boolean,
  onNearStart: () => void
): void {
  const { series, barSpacing, rightOffset, plotWidth } = state;
  useAnimatedReaction(
    () => {
      if (!enabled) {
        return -1;
      }
      const data = series.value;
      const near = isNearHistoryStart(
        frameTimeScale(plotWidth, barSpacing, rightOffset, data.length),
        thresholdBars
      );
      return near ? data.resetVersion * RESET_STRIDE + data.length : -1;
    },
    (key, previous) => {
      if (key >= 0 && key !== previous) {
        scheduleOnRN(onNearStart);
      }
    },
    [enabled, thresholdBars, onNearStart]
  );
}
