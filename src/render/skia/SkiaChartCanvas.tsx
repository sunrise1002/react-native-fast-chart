import {
  Canvas,
  Fill,
  Group,
  Path,
  Picture,
  Rect,
  Skia,
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
import type { PaneRenderSpec } from '../panes/PaneRenderSpec';
import { useIndicatorDrawList } from './IndicatorPaints';
import { useChartFont, useChartPaints } from './SkiaResources';
import { useAxesLayer } from './useAxesLayer';
import { useCandlePaths } from './useCandlePaths';
import { useFrameProfiler } from './useFrameProfiler';
import { useIndicatorLayer } from './useIndicatorLayer';
import { useOverlayLayer } from './useOverlayLayer';
import { usePaneDrawList } from './PanePaints';
import { usePaneLayer } from './usePaneLayer';
import { usePaneScales } from './usePaneScales';
import { usePriceAxisWidth } from './usePriceAxisWidth';

const NO_PANE_SPECS: readonly PaneRenderSpec[] = [];

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
  /** Indicator panes + price-pane scale overlays (keep the reference stable). */
  paneSpecs?: readonly PaneRenderSpec[];
  /** Current chart metrics (read when profiler samples are flushed). */
  getMetrics: () => ChartMetrics;
}

/**
 * Skia scene of the chart. Layer order: background → grid (clipped to the
 * pane stack) → (clipped price pane) volume underlay, wicks, bodies,
 * overlay indicators → indicator panes → pane / axis separators → axes
 * picture (labels, last price) → legend → crosshair.
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
  paneSpecs = NO_PANE_SPECS,
  getMetrics,
}: SkiaChartCanvasProps) {
  const font = useChartFont(theme);
  const paints = useChartPaints(theme);
  const { series, plotWidth, plotHeight, crosshairOpacity } = state;
  const { stackHeight, paneLayout, canvasWidth } = state;
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
  const paneItems = usePaneDrawList(paneSpecs);
  const paneScales = usePaneScales(
    state,
    paneItems,
    layout.overlayScaleHeightRatio
  );
  const paneLayer = usePaneLayer(state, paneItems, paneScales, {
    paints,
    bodyRatio,
    wickWidth: theme.candle.wickWidth,
    pixelRatio,
  });
  const underlay = useDerivedValue(() => paneLayer.value.underlay);
  const panePicture = useDerivedValue(() => paneLayer.value.panes);
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
    panes: paneItems,
    paneScales,
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
    panes: paneItems,
    paneScales,
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
  const stackClip = useDerivedValue(() => ({
    x: 0,
    y: 0,
    width: plotWidth.value,
    height: stackHeight.value,
  }));
  const hairline = 1 / pixelRatio;
  const axisWidth = useDerivedValue(() => plotWidth.value + hairline);
  // One path for every pane separator (full canvas width).
  const separators = useDerivedValue(() => {
    const builder = Skia.PathBuilder.Make();
    const frame = paneLayout.value;
    for (let i = 1; i < frame.tops.length; i++) {
      builder.addRect({
        x: 0,
        y: frame.tops[i] as number,
        width: canvasWidth.value,
        height: theme.pane.separatorWidth,
      });
    }
    return builder.detach();
  });

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color={theme.background} />
      {theme.grid.visible ? (
        <Group clip={stackClip}>
          <Path path={axesLayer.grid} color={theme.grid.color} />
        </Group>
      ) : null}
      <Group clip={clip}>
        <Picture picture={underlay} />
        <Path path={candles.bullWicks} color={theme.candle.wickBullish} />
        <Path path={candles.bearWicks} color={theme.candle.wickBearish} />
        <Path path={candles.bullBodies} color={theme.candle.bullish} />
        <Path path={candles.bearBodies} color={theme.candle.bearish} />
        <Picture picture={indicatorLayer.picture} />
      </Group>
      <Picture picture={panePicture} />
      <Path path={separators} color={theme.pane.separatorColor} />
      <Rect
        x={plotWidth}
        y={0}
        width={hairline}
        height={stackHeight}
        color={theme.axis.lineColor}
      />
      <Rect
        x={0}
        y={stackHeight}
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
