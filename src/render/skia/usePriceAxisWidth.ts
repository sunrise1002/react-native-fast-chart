import { useAnimatedReaction, type SharedValue } from 'react-native-reanimated';
import { nextAxisWidth } from '../../axes/AxisWidth';
import type {
  ChartSharedState,
  ViewportOptions,
} from '../../engine/ChartSharedState';
import { setPriceAxisWidth } from '../../engine/LayoutActions';

/** The axis never takes more than this share of the canvas width. */
export const MAX_PRICE_AXIS_SHARE = 0.4;

/**
 * Auto-sizes the price axis from the widest label of each axes frame:
 * grow-only while the dataset stays the same (no width jitter while
 * panning), may shrink back to fit when the dataset is replaced. Runs on
 * the UI thread; resizing the plot re-lays out every layer.
 */
export function usePriceAxisWidth(
  state: ChartSharedState,
  options: ViewportOptions,
  requiredWidth: SharedValue<number>,
  minWidth: number,
  timeAxisHeight: number
): void {
  const { series, priceAxisWidth, canvasWidth } = state;
  useAnimatedReaction(
    () => ({
      required: requiredWidth.value,
      resetVersion: series.value.resetVersion,
      canvas: canvasWidth.value,
    }),
    (next, previous) => {
      const allowShrink =
        previous === null || previous.resetVersion !== next.resetVersion;
      const width = nextAxisWidth(
        priceAxisWidth.value,
        next.required,
        minWidth,
        next.canvas * MAX_PRICE_AXIS_SHARE,
        allowShrink
      );
      setPriceAxisWidth(state, options, width, timeAxisHeight);
    },
    [minWidth, timeAxisHeight, options]
  );
}
