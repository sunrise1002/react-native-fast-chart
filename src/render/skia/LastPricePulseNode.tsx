import { Circle } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import type { ChartTheme } from '../../theme/ChartTheme';
import { priceToY } from '../../viewport/PriceScale';
import { indexToX } from '../../viewport/TimeScale';
import { pulseOpacity, pulseRadius } from '../overlays/LastPricePulse';
import { framePriceScale, frameTimeScale } from './frameScales';

export interface LastPricePulseLayer {
  cx: SharedValue<number>;
  cy: SharedValue<number>;
  r: SharedValue<number>;
  opacity: SharedValue<number>;
  color: SharedValue<string>;
}

/**
 * One circle at the last bar's close, animated by `state.lastPricePulse`
 * (written by realtime ticks in `StoreSync`). Hidden (opacity 0) while
 * idle, without data or off-scale.
 */
export function useLastPricePulse(
  state: ChartSharedState,
  theme: ChartTheme
): LastPricePulseLayer {
  const { series, plotWidth, barSpacing, rightOffset } = state;
  const { plotHeight, priceMin, priceMax, lastPricePulse } = state;
  const { bullish, bearish } = theme.candle;
  const point = useDerivedValue(() => {
    const data = series.value;
    const last = data.length - 1;
    if (last < 0) {
      return { x: NaN, y: NaN, bull: true };
    }
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    const close = data.close[last] as number;
    return {
      x: indexToX(time, last),
      y: priceToY(price, close),
      bull: close >= (data.open[last] as number),
    };
  });
  const cx = useDerivedValue(() => point.value.x);
  const cy = useDerivedValue(() => point.value.y);
  const r = useDerivedValue(() => pulseRadius(lastPricePulse.value));
  const opacity = useDerivedValue(() =>
    Number.isFinite(point.value.x) && Number.isFinite(point.value.y)
      ? pulseOpacity(lastPricePulse.value)
      : 0
  );
  const color = useDerivedValue(() => (point.value.bull ? bullish : bearish));
  return { cx, cy, r, opacity, color };
}

/**
 * Skia node of the pulse. Mounted only when `realtime.lastPricePulse` is
 * on, so a disabled pulse costs no mapper at all.
 */
export function LastPricePulseNode({
  state,
  theme,
}: {
  state: ChartSharedState;
  theme: ChartTheme;
}) {
  const { cx, cy, r, opacity, color } = useLastPricePulse(state, theme);
  return <Circle cx={cx} cy={cy} r={r} opacity={opacity} color={color} />;
}
