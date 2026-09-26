import type { SharedValue } from 'react-native-reanimated';
import type { ChartConfig } from '../core/ChartConfig';
import type {
  TradingChartController,
  ViewportResetPolicy,
} from '../core/ChartController';
import type { Candle } from '../data/Candle';
import type { AppliedCandleDiff } from '../data/CandleDiff';
import type { CandleStore } from '../data/CandleStore';
import type { HistoryLoader } from '../history/HistoryLoader';
import type { IndicatorEngine } from '../indicators/IndicatorEngine';
import type { PaneManager } from '../panes/PaneManager';
import type { ChartMetrics } from '../performance/ChartMetrics';
import type { RealtimeStatusStore } from '../realtime/RealtimeStatus';
import type { ChartSharedState, ViewportOptions } from './ChartSharedState';

/**
 * Chart handle: the spec §21 controller (`TradingChartController`) plus
 * direct access to the engine parts for advanced hosts (custom
 * aggregators, overlays reading UI-thread state).
 */
export interface TradingChartHandle extends TradingChartController {
  /** JS-thread data store (source of truth). */
  readonly store: CandleStore;
  /** UI-thread engine state (read in worklets; do not write). */
  readonly state: ChartSharedState;
  /** `true` while the last bar is on screen — drive a "jump to latest" button. */
  readonly isAtRealtime: SharedValue<boolean>;
  /** Timings (enabled by `config.debug.profiling`) + render counter. */
  readonly metrics: ChartMetrics;
  /** Indicator engine (registry, results, entries, compute stats). */
  readonly indicators: IndicatorEngine;
  /**
   * Pane list (price pane first). Indicators are assigned by their
   * `paneId`; an unknown id creates an automatic pane.
   */
  readonly panes: PaneManager;
  /** History pagination state machine (`onLoadMore`). */
  readonly history: HistoryLoader;
  /** Host-reported realtime feed status. */
  readonly realtimeStatus: RealtimeStatusStore;
}

/** Internal: the component feeds the resolved config and props in. */
export interface ChartControllerInternals extends TradingChartHandle {
  readonly options: ViewportOptions;
  /** Viewport policy of the pending / last dataset reset. */
  readonly resetPolicy: ViewportResetPolicy;
  configure(config: ChartConfig): void;
  /** `candles` prop path: diffs against the previous prop and applies. */
  syncCandles(candles: readonly Candle[]): AppliedCandleDiff;
}
