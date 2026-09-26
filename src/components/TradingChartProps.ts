import type { ReactNode, Ref } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type {
  ComposedGesture,
  GestureType,
} from 'react-native-gesture-handler';
import type { ChartConfig } from '../core/ChartConfig';
import type { Candle } from '../data/Candle';
import type { TradingChartHandle } from '../engine/ChartHandle';
import type { LoadMoreHandler } from '../history/HistoryLoader';
import type { IndicatorInput } from '../indicators/Indicator';
import type { CrosshairChangeHandler } from '../interaction/useCrosshairCallback';
import type { RealtimeStatus } from '../realtime/RealtimeStatus';
import type { ChartTheme } from '../theme/ChartTheme';
import type { ChartThemeOverride } from '../theme/mergeTheme';
import type { DeepPartial } from '../utils/deepMerge';

export interface TradingChartProps {
  /**
   * Dataset for simple usage (spec §20). A new array is diffed cheaply
   * against the previous one: appended bars, an updated last bar and
   * prepended history are applied incrementally (no viewport reset);
   * anything else (another symbol / timeframe) replaces the data. For
   * high-frequency feeds prefer the controller (`updateLastBar` …), which
   * skips React entirely. Update arrays immutably.
   */
  candles?: readonly Candle[];
  /**
   * Called (JS thread) when the view nears the oldest loaded bar
   * (`config.history.loadMoreThresholdBars`). Return the older bars (or a
   * promise of them / `{ candles, hasMore }`); they are prepended without
   * moving the view. One request at a time; an empty page stops paging
   * until the next `setData`.
   */
  onLoadMore?: LoadMoreHandler;
  /** Shown at the left edge while `onLoadMore` is in flight. */
  historyLoadingIndicator?: ReactNode;
  /** Feed status for the host UI (mirrors `controller.setRealtimeStatus`). */
  realtimeStatus?: RealtimeStatus;
  /** Handle from `useTradingChartController()`; created internally if omitted. */
  controller?: TradingChartHandle;
  /** Receives the chart handle (same object as `controller`). */
  ref?: Ref<TradingChartHandle>;
  /**
   * Base theme. Defaults to `defaultDarkTheme`. Keep the reference stable
   * (module constant or `useMemo`) to avoid re-resolving on every render.
   */
  theme?: ChartTheme;
  /** Partial overrides deep-merged over `theme`. Keep the reference stable. */
  themeOverride?: ChartThemeOverride;
  /**
   * Declarative indicator set (compared by value; matched by id, default
   * `${type}-${index}`). Omit it to manage indicators imperatively through
   * the controller (`addIndicator` …). Overlays (`sma`, `ema`, `wma`,
   * `bollinger`) draw on the price pane with legend values; pane
   * indicators (`volume`, `rsi`, `macd`, `atr`) get their own pane below
   * it (or set `paneId: 'price'` for a volume overlay).
   */
  indicators?: readonly IndicatorInput[];
  /** Partial config merged over `DEFAULT_CHART_CONFIG` (compared by value). */
  config?: DeepPartial<ChartConfig>;
  /**
   * Called on the JS thread when the crosshair moves to another bar (with
   * that bar) or hides (`null`) — never per frame. Suited for haptics.
   */
  onCrosshairChange?: CrosshairChangeHandler;
  /**
   * Replaces the built-in long-press crosshair gesture (raced against
   * pan / pinch). Keep the reference stable.
   */
  crosshairGesture?: GestureType | ComposedGesture;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}
