import { useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { resolveChartConfig, type ChartConfig } from '../core/ChartConfig';
import type {
  ChartSettingsExtras,
  SetDataOptions,
  UpsertBarResult,
  ViewportResetPolicy,
} from '../core/ChartController';
import type { LogicalRange } from '../core/ChartTypes';
import type { Candle } from '../data/Candle';
import {
  applyCandleDiff,
  diffCandles,
  type AppliedCandleDiff,
} from '../data/CandleDiff';
import { CandleStore } from '../data/CandleStore';
import type { CandleIssue } from '../data/CandleValidation';
import { mergeCandles, type MergeResult } from '../data/HistoryMerge';
import { HistoryLoader, type HistoryLoadState } from '../history/HistoryLoader';
import type { IndicatorInput } from '../indicators/Indicator';
import type { IndicatorEntry } from '../indicators/IndicatorDefinitions';
import {
  IndicatorEngine,
  type IndicatorPatch,
} from '../indicators/IndicatorEngine';
import { upsertCandle } from '../data/CandleUpsert';
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
import type { DeepPartial } from '../utils/deepMerge';
import { getVisibleLogicalRange } from '../viewport/VisibleRange';
import type {
  ChartControllerInternals,
  TradingChartHandle,
} from './ChartHandle';
import {
  createChartSharedState,
  readTimeScale,
  toViewportOptions,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import {
  resetViewport,
  scrollToRealtime,
  showLogicalRange,
} from './ViewportActions';

export type {
  ChartControllerInternals,
  TradingChartHandle,
} from './ChartHandle';

class ChartController implements ChartControllerInternals {
  readonly store = new CandleStore();
  readonly state: ChartSharedState;
  options: ViewportOptions;
  metrics: ChartMetrics;
  readonly indicators: IndicatorEngine;
  readonly panes = new PaneManager();
  readonly history: HistoryLoader;
  readonly realtimeStatus = new RealtimeStatusStore();
  resetPolicy: ViewportResetPolicy = 'reset';
  private lastCandlesProp: readonly Candle[] | null = null;
  private readonly unsubscribeEntries: () => void;

  constructor(config: ChartConfig) {
    this.state = createChartSharedState(config);
    this.options = toViewportOptions(config);
    this.metrics = createChartMetrics({ enabled: config.debug.profiling });
    this.indicators = new IndicatorEngine(this.store, {
      getProfiler: () => this.metrics.channel('indicator'),
    });
    this.history = new HistoryLoader(this.store, {
      retryDelayMs: config.history.retryDelayMs,
    });
    const syncPanes = () => this.panes.sync(this.indicators.getEntries());
    syncPanes();
    this.unsubscribeEntries = this.indicators.subscribeEntries(syncPanes);
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

  setData(candles: readonly Candle[], options?: SetDataOptions): CandleIssue[] {
    this.resetPolicy = options?.viewport ?? 'reset';
    this.lastCandlesProp = null;
    return this.store.setData(candles);
  }

  syncCandles(candles: readonly Candle[]): AppliedCandleDiff {
    const diff = diffCandles(this.lastCandlesProp, candles, this.store.columns);
    this.lastCandlesProp = candles;
    if (diff.kind === 'reset') {
      this.resetPolicy = 'reset';
    }
    return applyCandleDiff(this.store, candles, diff);
  }

  appendBar(candle: Candle): boolean {
    return this.store.append(candle);
  }

  updateLastBar(candle: Candle): boolean {
    return this.store.updateLast(candle);
  }

  upsertBar(candle: Candle): UpsertBarResult {
    return upsertCandle(this.store, candle);
  }

  prependBars(candles: readonly Candle[]): MergeResult {
    return mergeCandles(this.store, candles);
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
    this.history.dispose();
    this.indicators.dispose();
    this.panes.dispose();
    this.realtimeStatus.dispose();
    this.lastCandlesProp = null;
  }
}

/** Creates a chart handle outside React (e.g. in a store / service). */
export function createTradingChartController(
  config?: DeepPartial<ChartConfig> | null
): TradingChartHandle {
  return new ChartController(resolveChartConfig(config));
}

/**
 * Creates a stable chart handle for a host component; pass it to
 * `<TradingChart controller={...} />`. The config only seeds the initial
 * viewport; the chart's `config` prop stays authoritative.
 *
 * Not disposed automatically: every subscription the chart component
 * makes is released on unmount, and the handle only references its own
 * parts, so it is garbage-collected with the host (auto-disposal would
 * also break StrictMode's mount → unmount → mount check).
 */
export function useTradingChartController(
  config?: DeepPartial<ChartConfig> | null
): TradingChartHandle {
  return useState(() => createTradingChartController(config))[0];
}

/** Narrows a public handle to the internals the component needs. */
export function asInternals(
  handle: TradingChartHandle
): ChartControllerInternals {
  return handle as ChartControllerInternals;
}
