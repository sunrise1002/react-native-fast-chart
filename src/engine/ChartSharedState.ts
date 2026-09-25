import { makeMutable, type SharedValue } from 'react-native-reanimated';
import type { ChartConfig } from '../core/ChartConfig';
import {
  emptyUiCandleSeries,
  type UiCandleSeries,
} from '../data/UiCandleSeries';
import {
  emptyUiIndicatorSet,
  type UiIndicatorSet,
} from '../indicators/UiIndicatorSet';
import type { TimeScaleOptions, TimeScaleState } from '../viewport/TimeScale';

/**
 * Per-chart engine state living in Reanimated shared values (spec §22:
 * pan position, bar width, visible price range, realtime flag). Written
 * from gesture/animation worklets on the UI thread; React never re-renders
 * because of them.
 */
export interface ChartSharedState {
  /** UI-thread copy of the candle columns (see `UiCandleSeries`). */
  series: SharedValue<UiCandleSeries>;
  /** Distance between bar centers, dp. */
  barSpacing: SharedValue<number>;
  /** Empty bar slots right of the last bar (TimeScale convention). */
  rightOffset: SharedValue<number>;
  /**
   * Unclamped offset tracked during gestures; `rightOffset` is its rubber-
   * banded projection. Only meaningful while `activeGestures > 0`.
   */
  rawOffset: SharedValue<number>;
  /** Active pan/pinch gestures. */
  activeGestures: SharedValue<number>;
  /** Plot (price pane) size, dp, excluding the axis gutters. */
  plotWidth: SharedValue<number>;
  plotHeight: SharedValue<number>;
  /** Displayed (padded, animated) price range of the price pane. */
  priceMin: SharedValue<number>;
  priceMax: SharedValue<number>;
  /** `true` while the last bar is on screen (or there is no data). */
  isAtRealtime: SharedValue<boolean>;
  /** Canvas size, dp (plot + axis gutters). */
  canvasWidth: SharedValue<number>;
  canvasHeight: SharedValue<number>;
  /** Current (auto-sized) price axis width, dp. */
  priceAxisWidth: SharedValue<number>;
  /** Bar under the crosshair (`-1` = none). */
  crosshairIndex: SharedValue<number>;
  /** Finger Y of the crosshair, plot space, dp. */
  crosshairY: SharedValue<number>;
  /** Crosshair visibility, `0` (hidden) … `1`; animates on hide. */
  crosshairOpacity: SharedValue<number>;
  /** UI-thread copy of the indicator outputs (see `UiIndicatorSet`). */
  indicators: SharedValue<UiIndicatorSet>;
}

/** Static viewport options captured by worklets (plain numbers only). */
export interface ViewportOptions extends TimeScaleOptions {
  initialBarSpacing: number;
  /** `rightOffset` of the realtime position ("jump to latest"). */
  realtimeRightOffset: number;
  bodyRatio: number;
  overscanBars: number;
}

/** Rubber-band overshoot allowed while dragging, as a share of the plot. */
export const ELASTIC_PLOT_FRACTION = 0.15;

export function createChartSharedState(config: ChartConfig): ChartSharedState {
  return {
    series: makeMutable(emptyUiCandleSeries()),
    barSpacing: makeMutable(config.viewport.initialBarSpacing),
    rightOffset: makeMutable(config.layout.rightOffsetBars),
    rawOffset: makeMutable(config.layout.rightOffsetBars),
    activeGestures: makeMutable(0),
    plotWidth: makeMutable(0),
    plotHeight: makeMutable(0),
    priceMin: makeMutable(Number.NaN),
    priceMax: makeMutable(Number.NaN),
    isAtRealtime: makeMutable(true),
    canvasWidth: makeMutable(0),
    canvasHeight: makeMutable(0),
    priceAxisWidth: makeMutable(config.layout.priceAxisWidth),
    crosshairIndex: makeMutable(-1),
    crosshairY: makeMutable(Number.NaN),
    crosshairOpacity: makeMutable(0),
    indicators: makeMutable(emptyUiIndicatorSet()),
  };
}

export function toViewportOptions(config: ChartConfig): ViewportOptions {
  const { viewport, layout } = config;
  return {
    minBarSpacing: viewport.minBarSpacing,
    maxBarSpacing: viewport.maxBarSpacing,
    maxRightOffsetBars: viewport.maxRightOffsetBars,
    leftMarginBars: viewport.leftMarginBars,
    minVisibleBars: viewport.minVisibleBars,
    initialBarSpacing: viewport.initialBarSpacing,
    realtimeRightOffset: layout.rightOffsetBars,
    bodyRatio: viewport.bodyRatio,
    overscanBars: viewport.overscanBars,
  };
}

/** Current time-scale state (one small object; call once per frame). */
export function readTimeScale(state: ChartSharedState): TimeScaleState {
  'worklet';
  return {
    width: state.plotWidth.value,
    barSpacing: state.barSpacing.value,
    rightOffset: state.rightOffset.value,
    barCount: state.series.value.length,
  };
}

/** Rubber-band limit in bars for the current plot width / zoom. */
export function elasticLimit(time: TimeScaleState): number {
  'worklet';
  const bars = (time.width * ELASTIC_PLOT_FRACTION) / time.barSpacing;
  return bars > 0 && bars < Infinity ? bars : 0;
}
