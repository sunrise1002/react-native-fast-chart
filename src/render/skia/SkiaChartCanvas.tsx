import {
  Canvas,
  Fill,
  Group,
  Path,
  Picture,
  Rect,
} from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';
import { useDerivedValue } from 'react-native-reanimated';
import { estimateBarInterval } from '../../axes/TimeTicks';
import type {
  ChartAxesConfig,
  ChartLayoutConfig,
  ChartOverlaysConfig,
} from '../../core/ChartConfig';
import type {
  ChartSharedState,
  ViewportOptions,
} from '../../engine/ChartSharedState';
import type { ChartMetrics } from '../../performance/ChartMetrics';
import type { ChartTheme } from '../../theme/ChartTheme';
import type { OverlayRenderSpec } from '../indicators/OverlayRenderSpec';
import { useIndicatorDrawList } from './IndicatorPaints';
import { useChartFont, useChartPaints } from './SkiaResources';
import { useAxesLayer } from './useAxesLayer';
import { useCandlePaths } from './useCandlePaths';
import { useFrameProfiler } from './useFrameProfiler';
import { useIndicatorLayer } from './useIndicatorLayer';
import { useOverlayLayer } from './useOverlayLayer';
import { usePriceAxisWidth } from './usePriceAxisWidth';

export interface SkiaChartCanvasProps {
  state: ChartSharedState;
  options: ViewportOptions;
  theme: ChartTheme;
  layout: ChartLayoutConfig;
  axes: ChartAxesConfig;
  overlays: ChartOverlaysConfig;
  bodyRatio: number;
  pixelRatio: number;
  profiling: boolean;
  /** Price-pane overlay indicators (keep the reference stable). */
  overlaySpecs: readonly OverlayRenderSpec[];
  /** Current chart metrics (read when profiler samples are flushed). */
  getMetrics: () => ChartMetrics;
}

/**
 * Skia scene of the chart. Layer order: background → (clipped plot) grid,
 * wicks, bodies, overlay indicators → axis separators → axes picture (labels, last price) →
 * legend → crosshair.
 *
 * A constant number of nodes regardless of bars or labels: five paths and
 * four pictures, all shared values rebuilt on the UI thread, so this
 * component only re-renders on theme / config changes. Sizes come from
 * shared values too (the price axis auto-sizes on the UI thread).
 */
export function SkiaChartCanvas({
  state,
  options,
  theme,
  layout,
  axes,
  overlays,
  bodyRatio,
  pixelRatio,
  profiling,
  overlaySpecs,
  getMetrics,
}: SkiaChartCanvasProps) {
  const font = useChartFont(theme);
  const paints = useChartPaints(theme);
  const { series, plotWidth, plotHeight, crosshairOpacity } = state;
  const pricePrecision = axes.pricePrecision ?? NaN;
  const { timeAxisHeight } = layout;

  const barMs = useDerivedValue(() => estimateBarInterval(series.value));
  const candles = useCandlePaths(state, {
    bodyRatio,
    wickWidth: theme.candle.wickWidth,
    pixelRatio,
    profiling,
  });
  const drawList = useIndicatorDrawList(overlaySpecs);
  const indicatorLayer = useIndicatorLayer(state, drawList, profiling);
  const axesLayer = useAxesLayer(state, barMs, {
    font,
    paints,
    gridLineWidth: theme.grid.width,
    pixelRatio,
    timeAxisHeight,
    pricePrecision,
    thousandsSeparator: axes.thousandsSeparator,
    timeZone: axes.timeZone,
    showLastPrice: overlays.lastPrice,
  });
  const overlayLayer = useOverlayLayer(state, barMs, {
    font,
    paints,
    pixelRatio,
    timeAxisHeight,
    pricePrecision,
    thousandsSeparator: axes.thousandsSeparator,
    timeZone: axes.timeZone,
    showLegend: overlays.legend,
    showLegendVolume: overlays.legendVolume,
    indicators: drawList,
  });
  const requiredWidth = useDerivedValue(
    () => axesLayer.frame.value.requiredAxisWidth
  );
  usePriceAxisWidth(
    state,
    options,
    requiredWidth,
    layout.priceAxisWidth,
    timeAxisHeight
  );
  useFrameProfiler(profiling, candles.frame, getMetrics, indicatorLayer.frame);

  const clip = useDerivedValue(() => ({
    x: 0,
    y: 0,
    width: plotWidth.value,
    height: plotHeight.value,
  }));
  const hairline = 1 / pixelRatio;
  const axisWidth = useDerivedValue(() => plotWidth.value + hairline);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color={theme.background} />
      <Group clip={clip}>
        {theme.grid.visible ? (
          <Path path={axesLayer.grid} color={theme.grid.color} />
        ) : null}
        <Path path={candles.bullWicks} color={theme.candle.wickBullish} />
        <Path path={candles.bearWicks} color={theme.candle.wickBearish} />
        <Path path={candles.bullBodies} color={theme.candle.bullish} />
        <Path path={candles.bearBodies} color={theme.candle.bearish} />
        <Picture picture={indicatorLayer.picture} />
      </Group>
      <Rect
        x={plotWidth}
        y={0}
        width={hairline}
        height={plotHeight}
        color={theme.axis.lineColor}
      />
      <Rect
        x={0}
        y={plotHeight}
        width={axisWidth}
        height={hairline}
        color={theme.axis.lineColor}
      />
      <Picture picture={axesLayer.picture} />
      <Picture picture={overlayLayer.legend} />
      <Group opacity={crosshairOpacity}>
        <Picture picture={overlayLayer.crosshair} />
      </Group>
    </Canvas>
  );
}
