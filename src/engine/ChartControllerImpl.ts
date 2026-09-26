import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import type { ChartConfig } from '../core/ChartConfig';
import { chartIssue, type ChartErrorHandler } from '../core/ChartErrors';
import type {
  ChartSettingsExtras,
  SetDataOptions,
  UpsertBarResult,
  ViewportResetPolicy,
} from '../core/ChartController';
import type { LogicalRange } from '../core/ChartTypes';
import type { Candle } from '../data/Candle';
import type { AppliedCandleDiff } from '../data/CandleDiff';
import { CandleStore } from '../data/CandleStore';
import type { CandleIssue } from '../data/CandleValidation';
import type { MergeResult } from '../data/HistoryMerge';
import { HistoryLoader, type HistoryLoadState } from '../history/HistoryLoader';
import type { IndicatorInput } from '../indicators/Indicator';
import type { IndicatorEntry } from '../indicators/IndicatorDefinitions';
import {
  IndicatorEngine,
  type IndicatorPatch,
} from '../indicators/IndicatorEngine';
import {
  removeIndicatorAndEmptyPane,
  removePaneWithIndicators,
} from '../panes/PaneCleanup';
import type { PaneDefinition, PaneInput } from '../panes/Pane';
import { PaneManager } from '../panes/PaneManager';
import {
  createChartMetrics,
  type ChartMetrics,
} from '../performance/ChartMetrics';
import {
  RealtimeStatusStore,
  type RealtimeStatus,
} from '../realtime/RealtimeStatus';
import { applyChartSettings } from '../settings/ApplySettings';
import {
  createChartSettings,
  type ChartSettings,
} from '../settings/ChartSettings';
import { getVisibleLogicalRange } from '../viewport/VisibleRange';
import type { ChartControllerInternals } from './ChartHandle';
import {
  createChartSharedState,
  readTimeScale,
  toViewportOptions,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import { ChartErrorChannel, reportHistoryErrors } from './ChartErrorChannel';
import { ChartDataFeed } from './ChartDataFeed';
import {
  resetViewport,
  scrollToRealtime,
  showLogicalRange,
} from './ViewportActions';

/** Default `TradingChartHandle` implementation (see the factories). */
export class ChartController implements ChartControllerInternals {
  readonly store = new CandleStore();
  readonly state: ChartSharedState;
  options: ViewportOptions;
  metrics: ChartMetrics;
  readonly indicators: IndicatorEngine;
  readonly panes = new PaneManager();
  readonly history: HistoryLoader;
  readonly realtimeStatus = new RealtimeStatusStore();
  readonly errors = new ChartErrorChannel();
  private readonly feed: ChartDataFeed;
  private readonly unsubscribeEntries: () => void;
  private readonly unsubscribeHistory: () => void;

  constructor(config: ChartConfig) {
    this.state = createChartSharedState(config);
    this.feed = new ChartDataFeed(this.store, this.errors);
    this.options = toViewportOptions(config);
    this.metrics = createChartMetrics({ enabled: config.debug.profiling });
    this.indicators = new IndicatorEngine(this.store, {
      getProfiler: () => this.metrics.channel('indicator'),
      onError: (error) => this.errors.report(chartIssue('indicator', error)),
    });
    this.history = new HistoryLoader(this.store, {
      retryDelayMs: config.history.retryDelayMs,
    });
    const syncPanes = () => this.panes.sync(this.indicators.getEntries());
    syncPanes();
    this.unsubscribeEntries = this.indicators.subscribeEntries(syncPanes);
    this.unsubscribeHistory = reportHistoryErrors(this.history, this.errors);
  }

  get isAtRealtime(): SharedValue<boolean> {
    return this.state.isAtRealtime;
  }

  configure(config: ChartConfig): void {
    this.options = toViewportOptions(config);
    this.history.setRetryDelay(config.history.retryDelayMs);
    if (this.metrics.enabled !== config.debug.profiling) {
      this.metrics = createChartMetrics({ enabled: config.debug.profiling });
    }
  }

  /* ---------------------------------- Data ---------------------------------- */

  get resetPolicy(): ViewportResetPolicy {
    return this.feed.resetPolicy;
  }

  setData(candles: readonly Candle[], options?: SetDataOptions): CandleIssue[] {
    return this.feed.setData(candles, options);
  }

  syncCandles(candles: readonly Candle[]): AppliedCandleDiff {
    return this.feed.syncCandles(candles);
  }

  appendBar(candle: Candle): boolean {
    return this.feed.appendBar(candle);
  }

  updateLastBar(candle: Candle): boolean {
    return this.feed.updateLastBar(candle);
  }

  upsertBar(candle: Candle): UpsertBarResult {
    return this.feed.upsertBar(candle);
  }

  prependBars(candles: readonly Candle[]): MergeResult {
    return this.feed.prependBars(candles);
  }

  subscribeErrors(listener: ChartErrorHandler): () => void {
    return this.errors.subscribe(listener);
  }

  getBarCount(): number {
    return this.store.length;
  }

  getBar(index: number): Candle | undefined {
    return this.store.get(index);
  }

  getLastBar(): Candle | undefined {
    return this.store.get(this.store.length - 1);
  }

  getVisibleRange(): LogicalRange | null {
    const time = readTimeScale(this.state);
    if (!(time.width > 0) || !(time.barSpacing > 0) || time.barCount === 0) {
      return null;
    }
    return getVisibleLogicalRange(time);
  }

  /* ------------------------------- Indicators ------------------------------- */

  addIndicator(input: IndicatorInput): string {
    return this.indicators.add(input);
  }

  removeIndicator(id: string): boolean {
    return removeIndicatorAndEmptyPane(this.indicators, this.panes, id);
  }

  updateIndicator(id: string, patch: IndicatorPatch): boolean {
    return this.indicators.update(id, patch);
  }

  setIndicators(inputs: readonly IndicatorInput[]): void {
    this.indicators.setIndicators(inputs);
  }

  getIndicators(): readonly IndicatorEntry[] {
    return this.indicators.getEntries();
  }

  /* ---------------------------------- Panes ---------------------------------- */

  addPane(input?: PaneInput): string {
    return this.panes.add(input);
  }

  removePane(id: string): boolean {
    return removePaneWithIndicators(this.indicators, this.panes, id);
  }

  movePane(id: string, index: number): boolean {
    return this.panes.move(id, index);
  }

  setPaneHeightRatio(id: string, ratio: number): boolean {
    return this.panes.setHeightRatio(id, ratio);
  }

  resizePanes(ratios: readonly number[]): boolean {
    return this.panes.resize(ratios);
  }

  getPanes(): readonly PaneDefinition[] {
    return this.panes.getPanes();
  }

  /* -------------------------------- Viewport -------------------------------- */

  scrollToRealtime(animated = true): void {
    scheduleOnUI(scrollToRealtime, this.state, this.options, animated);
  }

  resetZoom(animated = true): void {
    scheduleOnUI(resetViewport, this.state, this.options, animated);
  }

  setVisibleRange(start: number, end: number, animated = true): void {
    scheduleOnUI(
      showLogicalRange,
      this.state,
      this.options,
      start,
      end,
      animated
    );
  }

  /* ------------------------- Settings / status / history ------------------------- */

  getSettings(extras: ChartSettingsExtras = {}): ChartSettings {
    return createChartSettings({
      indicators: this.indicators.getEntries(),
      panes: this.panes.getPanes(),
      isExplicitPane: (id) => this.panes.isExplicit(id),
      ...extras,
    });
  }

  applySettings(settings: ChartSettings): void {
    applyChartSettings(this.indicators, this.panes, settings);
  }

  setRealtimeStatus(status: RealtimeStatus): void {
    this.realtimeStatus.set(status);
  }

  getRealtimeStatus(): RealtimeStatus {
    return this.realtimeStatus.get();
  }

  subscribeRealtimeStatus(
    listener: (status: RealtimeStatus) => void
  ): () => void {
    return this.realtimeStatus.subscribe(listener);
  }

  loadMoreHistory(): boolean {
    return this.history.request();
  }

  setHasMoreHistory(hasMore: boolean): void {
    this.history.setHasMore(hasMore);
  }

  getHistoryState(): HistoryLoadState {
    return this.history.getState();
  }

  subscribeHistoryState(listener: () => void): () => void {
    return this.history.subscribe(listener);
  }

  dispose(): void {
    this.unsubscribeEntries();
    this.unsubscribeHistory();
    this.errors.clear();
    this.history.dispose();
    this.indicators.dispose();
    this.panes.dispose();
    this.realtimeStatus.dispose();
    this.feed.release();
  }
}
