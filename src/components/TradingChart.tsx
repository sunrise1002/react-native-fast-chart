import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useSyncExternalStore,
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
  Gesture,
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
import { connectIndicatorsToUi } from '../engine/IndicatorSync';
import { connectPanesToUi } from '../engine/PaneSync';
import { connectStoreToUi } from '../engine/StoreSync';
import type { IndicatorInput } from '../indicators/Indicator';
import {
  overlayAutoScaleRefs,
  resolveOverlaySpecs,
} from '../render/indicators/OverlayRenderSpec';
import { resolvePaneSpecs } from '../render/panes/PaneRenderSpec';
import { useChartReactions } from '../engine/useChartReactions';
import { resizeCanvas } from '../engine/LayoutActions';
import {
  useCrosshairCallback,
  type CrosshairChangeHandler,
} from '../interaction/useCrosshairCallback';
import { useChartGestures } from '../interaction/useChartGestures';
import { useCrosshairGesture } from '../interaction/useCrosshairGesture';
import { usePaneResizeGesture } from '../interaction/usePaneResizeGesture';
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

/**
 * Candlestick trading chart: Skia rendering of the visible bars (4 batched
 * paths), tick-derived grid, auto-sized price / time axes, last-price
 * marker, long-press crosshair with OHLC legend, overlay indicators, pan / pinch / fling /
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
  indicators,
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

  const indicatorsKey = indicators ? JSON.stringify(indicators) : null;
  useEffect(() => {
    if (indicators) {
      handle.setIndicators(indicators);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- compared by value
  }, [handle, indicatorsKey]);

  useEffect(
    () => connectIndicatorsToUi(handle.indicators, handle.state),
    [handle]
  );
  useEffect(
    () => connectPanesToUi(handle.panes, handle.state, () => handle.options),
    [handle]
  );
  const paneManager = handle.panes;
  const panes = useSyncExternalStore(
    useCallback((cb: () => void) => paneManager.subscribe(cb), [paneManager]),
    useCallback(() => paneManager.getPanes(), [paneManager])
  );
  // React state only when the indicator set / styles change (spec §22).
  const engine = handle.indicators;
  const entries = useSyncExternalStore(
    useCallback((cb: () => void) => engine.subscribeEntries(cb), [engine]),
    useCallback(() => engine.getEntries(), [engine])
  );
  const overlaySpecs = useMemo(
    () => resolveOverlaySpecs(entries, resolvedTheme.indicatorPalette),
    [entries, resolvedTheme]
  );
  const paneSpecs = useMemo(
    () => resolvePaneSpecs(entries, panes, resolvedTheme),
    [entries, panes, resolvedTheme]
  );
  const overlayRefs = useMemo(
    () => overlayAutoScaleRefs(overlaySpecs),
    [overlaySpecs]
  );

  useChartReactions(handle.state, overlayRefs);
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
  const commitPaneRatios = useCallback(
    (ratios: number[]) => {
      handle.resizePanes(ratios);
    },
    [handle]
  );
  const paneResize = usePaneResizeGesture(
    handle.state,
    options,
    resolved.interaction.paneResizeEnabled,
    resolved.layout.paneSeparatorHitSlop,
    commitPaneRatios
  );
  const composed = useMemo(
    () => Gesture.Race(paneResize, gestures.composed),
    [paneResize, gestures.composed]
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
    <GestureDetector gesture={composed}>
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
          overlaySpecs={overlaySpecs}
          paneSpecs={paneSpecs}
          getMetrics={getMetrics}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
});
