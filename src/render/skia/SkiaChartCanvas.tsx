import { Canvas, Fill, Group, Path, Rect } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { ChartLayoutConfig } from '../../core/ChartConfig';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import type { ChartMetrics } from '../../performance/ChartMetrics';
import type { ChartTheme } from '../../theme/ChartTheme';
import type { BarStepFn, PriceStepFn } from '../grid/GridGeometry';
import { useCandlePaths } from './useCandlePaths';
import { useFrameProfiler } from './useFrameProfiler';
import { useGridPath } from './useGridPath';

export interface SkiaChartCanvasProps {
  state: ChartSharedState;
  theme: ChartTheme;
  /** Canvas size, dp. */
  width: number;
  height: number;
  layout: ChartLayoutConfig;
  bodyRatio: number;
  pixelRatio: number;
  profiling: boolean;
  /** Current chart metrics (read when profiler samples are flushed). */
  getMetrics: () => ChartMetrics;
  /** Grid tick sources (worklets); P4 plugs its axis ticks in. */
  priceStep?: PriceStepFn;
  barStep?: BarStepFn;
}

/** Plot (price pane) size for a canvas size and the reserved axis gutters. */
export function computePlotSize(
  width: number,
  height: number,
  layout: ChartLayoutConfig
): { width: number; height: number } {
  const w = width - layout.priceAxisWidth;
  const h = height - layout.timeAxisHeight;
  return {
    width: w > 0 && w < Infinity ? w : 0,
    height: h > 0 && h < Infinity ? h : 0,
  };
}

/**
 * Skia scene of the chart. Layer order: background → (clipped plot) grid,
 * wicks, bodies → axis gutters and separators. The price-axis gutter
 * (right) and time-axis gutter (bottom) are reserved for P4's axes.
 *
 * Exactly six paths are drawn regardless of the number of bars; all of
 * them are shared values rebuilt on the UI thread, so this component only
 * re-renders on theme / layout / config changes.
 */
export function SkiaChartCanvas({
  state,
  theme,
  width,
  height,
  layout,
  bodyRatio,
  pixelRatio,
  profiling,
  getMetrics,
  priceStep,
  barStep,
}: SkiaChartCanvasProps) {
  const plot = computePlotSize(width, height, layout);
  const candles = useCandlePaths(state, {
    bodyRatio,
    wickWidth: theme.candle.wickWidth,
    pixelRatio,
    profiling,
  });
  const grid = useGridPath(state, {
    lineWidth: theme.grid.width,
    pixelRatio,
    priceStep,
    barStep,
  });
  useFrameProfiler(profiling, candles.frame, getMetrics);

  const clip = useMemo(
    () => ({ x: 0, y: 0, width: plot.width, height: plot.height }),
    [plot.width, plot.height]
  );
  const hairline = 1 / pixelRatio;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color={theme.background} />
      <Group clip={clip}>
        {theme.grid.visible ? (
          <Path path={grid} color={theme.grid.color} />
        ) : null}
        <Path path={candles.bullWicks} color={theme.candle.wickBullish} />
        <Path path={candles.bearWicks} color={theme.candle.wickBearish} />
        <Path path={candles.bullBodies} color={theme.candle.bullish} />
        <Path path={candles.bearBodies} color={theme.candle.bearish} />
      </Group>
      <Rect
        x={plot.width}
        y={0}
        width={hairline}
        height={plot.height}
        color={theme.axis.lineColor}
      />
      <Rect
        x={0}
        y={plot.height}
        width={plot.width + hairline}
        height={hairline}
        color={theme.axis.lineColor}
      />
    </Canvas>
  );
}
