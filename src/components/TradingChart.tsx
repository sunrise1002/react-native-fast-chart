import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  type Ref,
} from 'react';
import {
  PixelRatio,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  GestureDetector,
  type ComposedGesture,
  type GestureType,
} from 'react-native-gesture-handler';
import { scheduleOnUI } from 'react-native-worklets';
import { resolveChartConfig, type ChartConfig } from '../core/ChartConfig';
import type { Candle } from '../data/Candle';
import {
  asInternals,
  createTradingChartController,
  type TradingChartHandle,
} from '../engine/ChartControllerImpl';
import { toViewportOptions } from '../engine/ChartSharedState';
import { connectStoreToUi } from '../engine/StoreSync';
import { useChartReactions } from '../engine/useChartReactions';
import { resizeCanvas } from '../engine/LayoutActions';
import {
  useCrosshairCallback,
  type CrosshairChangeHandler,
} from '../interaction/useCrosshairCallback';
import { useChartGestures } from '../interaction/useChartGestures';
import { useCrosshairGesture } from '../interaction/useCrosshairGesture';
import { SkiaChartCanvas } from '../render/skia/SkiaChartCanvas';
import type { ChartTheme } from '../theme/ChartTheme';
import { defaultDarkTheme } from '../theme/defaultDarkTheme';
import { mergeTheme, type ChartThemeOverride } from '../theme/mergeTheme';
import type { DeepPartial } from '../utils/deepMerge';

export interface TradingChartProps {
  /**
   * Initial / replacement dataset (spec §20). Changing the array reference
   * calls `setData` (full reset). Stream realtime updates through the
   * controller (`appendBar` / `updateLastBar`) instead of new arrays.
   */
  candles?: readonly Candle[];
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

/**
 * Candlestick trading chart: Skia rendering of the visible bars (4 batched
 * paths), tick-derived grid, auto-sized price / time axes, last-price
 * marker, long-press crosshair with OHLC legend, pan / pinch / fling /
 * double-tap gestures and auto Y-scale, all driven by UI-thread shared
 * values. React renders only on prop, theme, config or layout changes —
 * never per gesture frame.
 */
export function TradingChart({
  candles,
  controller,
  ref,
  theme = defaultDarkTheme,
  themeOverride,
  config,
  onCrosshairChange,
  crosshairGesture,
  style,
  testID,
}: TradingChartProps) {
  const handle = useMemo(
    () => asInternals(controller ?? createTradingChartController(config)),
    // Only the controller identity matters; `config` merely seeds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller]
  );
  if (__DEV__) {
    handle.metrics.countRender();
  }
  useImperativeHandle(ref, () => handle, [handle]);
  const getMetrics = useCallback(() => handle.metrics, [handle]);

  const configKey = JSON.stringify(config ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- compared by value
  const resolved = useMemo(() => resolveChartConfig(config), [configKey]);
  const options = useMemo(() => toViewportOptions(resolved), [resolved]);
  const resolvedTheme = useMemo(
    () => (themeOverride ? mergeTheme(theme, themeOverride) : theme),
    [theme, themeOverride]
  );
  const pixelRatio = useMemo(() => PixelRatio.get(), []);

  useEffect(() => {
    handle.configure(resolved);
  }, [handle, resolved]);

  useEffect(
    () => connectStoreToUi(handle.store, handle.state, () => handle.options),
    [handle]
  );

  useEffect(() => {
    if (candles) {
      handle.setData(candles);
    }
  }, [handle, candles]);

  useChartReactions(handle.state);
  const builtInCrosshair = useCrosshairGesture(
    handle.state,
    resolved.crosshair,
    resolved.interaction.crosshairEnabled
  );
  const gestures = useChartGestures(
    handle.state,
    options,
    resolved.interaction,
    crosshairGesture ?? builtInCrosshair
  );
  useCrosshairCallback(handle.state, onCrosshairChange);

  const { timeAxisHeight } = resolved.layout;
  const onLayout = (e: LayoutChangeEvent) => {
    // Sizes live in shared values: a layout change re-renders nothing.
    const { width, height } = e.nativeEvent.layout;
    scheduleOnUI(
      resizeCanvas,
      handle.state,
      options,
      width,
      height,
      timeAxisHeight
    );
  };

  return (
    <GestureDetector gesture={gestures.composed}>
      <View
        style={[styles.container, style]}
        testID={testID}
        onLayout={onLayout}
        collapsable={false}
      >
        <SkiaChartCanvas
          state={handle.state}
          options={options}
          theme={resolvedTheme}
          layout={resolved.layout}
          axes={resolved.axes}
          overlays={resolved.overlays}
          bodyRatio={resolved.viewport.bodyRatio}
          pixelRatio={pixelRatio}
          profiling={resolved.debug.profiling}
          getMetrics={getMetrics}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
});
