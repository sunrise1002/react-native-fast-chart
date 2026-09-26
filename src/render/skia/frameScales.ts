import type { SharedValue } from 'react-native-reanimated';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';
import type { MutablePriceScale } from '../conflation/RenderCache';

/*
 * Mapper helpers: mappers must capture the individual shared values they
 * read (every captured shared value becomes a mapper input), so these take
 * shared values rather than the whole `ChartSharedState`.
 */

/**
 * Time scale of the current frame (worklet helper for mappers). Pass
 * `out` (frame scratch, see `RenderCache.frame`) to fill it in place.
 */
export function frameTimeScale(
  plotWidth: SharedValue<number>,
  barSpacing: SharedValue<number>,
  rightOffset: SharedValue<number>,
  barCount: number,
  out: TimeScaleState = {
    width: 0,
    barSpacing: 0,
    rightOffset: 0,
    barCount: 0,
  }
): TimeScaleState {
  'worklet';
  out.width = plotWidth.value;
  out.barSpacing = barSpacing.value;
  out.rightOffset = rightOffset.value;
  out.barCount = barCount;
  return out;
}

/** Price scale of the price pane for the current frame (`out` as above). */
export function framePriceScale(
  plotHeight: SharedValue<number>,
  priceMin: SharedValue<number>,
  priceMax: SharedValue<number>,
  out: MutablePriceScale = {
    mode: 'linear',
    top: 0,
    height: 0,
    min: NaN,
    max: NaN,
  }
): PriceScaleSnapshot {
  'worklet';
  out.top = 0;
  out.height = plotHeight.value;
  out.min = priceMin.value;
  out.max = priceMax.value;
  return out;
}
