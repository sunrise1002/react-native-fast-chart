import {
  Easing,
  useAnimatedReaction,
  withTiming,
} from 'react-native-reanimated';
import type { PriceRange } from '../core/ChartTypes';
import { frameTimeScale } from '../render/skia/frameScales';
import { cachedAutoScaleTarget } from '../render/conflation/ConflatedLayers';
import { pruneOutputPyramids } from '../render/conflation/RenderCache';
import {
  priceRangeChanged,
  shouldSnapPriceRange,
} from '../viewport/AutoScaleTarget';
import { isLastBarVisible } from '../viewport/TimeScale';
import type { UiOutputRef } from '../indicators/UiIndicatorSet';
import type { ChartSharedState } from './ChartSharedState';

const NO_REFS: readonly UiOutputRef[] = [];

/** Duration of the Y auto-scale follow animation, ms. */
export const AUTOSCALE_ANIMATION_MS = 160;
const AUTOSCALE_TIMING = {
  duration: AUTOSCALE_ANIMATION_MS,
  easing: Easing.out(Easing.quad),
};

interface AutoScaleInput extends PriceRange {
  valid: boolean;
  resetVersion: number;
}

/**
 * UI-thread reactions that keep derived engine state in sync without
 * React: the animated auto Y-scale and the `isAtRealtime` flag.
 */
export function useChartReactions(
  state: ChartSharedState,
  overlayRefs: readonly UiOutputRef[] = NO_REFS
): void {
  const { series, barSpacing, rightOffset, plotWidth, indicators } = state;
  const { priceMin, priceMax, isAtRealtime, renderCache } = state;

  // Auto Y-scale: follow the visible bars' range (widened by the overlay
  // indicator values, like TradingView). Retargeting a short
  // ease-out timing every frame acts as a low-pass filter, so bars entering
  // or leaving the view don't make the scale jitter. Long visible ranges
  // (extreme zoom-out) are answered by the render cache's min/max pyramids
  // in O(log n) instead of a scan of every visible bar.
  useAnimatedReaction(
    (): AutoScaleInput => {
      const data = series.value;
      const set = indicators.value;
      const cache = renderCache.value;
      pruneOutputPyramids(cache, set);
      const out = { min: NaN, max: NaN, valid: false, resetVersion: 0 };
      out.valid = cachedAutoScaleTarget(
        cache,
        data,
        set,
        overlayRefs,
        frameTimeScale(
          plotWidth,
          barSpacing,
          rightOffset,
          data.length,
          cache.frame.time
        ),
        out
      );
      out.resetVersion = data.resetVersion;
      return out;
    },
    (target, previous) => {
      if (!target.valid) {
        return;
      }
      const reset =
        previous === null || previous.resetVersion !== target.resetVersion;
      if (
        reset ||
        shouldSnapPriceRange(priceMin.value, priceMax.value, target)
      ) {
        priceMin.value = target.min;
        priceMax.value = target.max;
        return;
      }
      if (previous.valid && !priceRangeChanged(previous, target)) {
        return;
      }
      priceMin.value = withTiming(target.min, AUTOSCALE_TIMING);
      priceMax.value = withTiming(target.max, AUTOSCALE_TIMING);
    }
  );

  useAnimatedReaction(
    () => {
      const data = series.value;
      return (
        data.length === 0 ||
        isLastBarVisible(
          frameTimeScale(plotWidth, barSpacing, rightOffset, data.length)
        )
      );
    },
    (atRealtime) => {
      if (isAtRealtime.value !== atRealtime) {
        isAtRealtime.value = atRealtime;
      }
    }
  );
}
