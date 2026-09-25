import type { SharedValue } from 'react-native-reanimated';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import type { TimeScaleState } from '../../viewport/TimeScale';

/*
 * Mapper helpers: mappers must capture the individual shared values they
 * read (every captured shared value becomes a mapper input), so these take
 * shared values rather than the whole `ChartSharedState`.
 */

/** Time scale of the current frame (worklet helper for mappers). */
export function frameTimeScale(
  plotWidth: SharedValue<number>,
  barSpacing: SharedValue<number>,
  rightOffset: SharedValue<number>,
  barCount: number
): TimeScaleState {
  'worklet';
  return {
    width: plotWidth.value,
    barSpacing: barSpacing.value,
    rightOffset: rightOffset.value,
    barCount,
  };
}

/** Price scale of the price pane for the current frame. */
export function framePriceScale(
  plotHeight: SharedValue<number>,
  priceMin: SharedValue<number>,
  priceMax: SharedValue<number>
): PriceScaleSnapshot {
  'worklet';
  return {
    mode: 'linear',
    top: 0,
    height: plotHeight.value,
    min: priceMin.value,
    max: priceMax.value,
  };
}
