import { useState } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { resolveChartConfig, type ChartConfig } from '../core/ChartConfig';
import type { Candle } from '../data/Candle';
import { CandleStore } from '../data/CandleStore';
import type { CandleIssue } from '../data/CandleValidation';
import { mergeCandles } from '../data/HistoryMerge';
import type { IndicatorInput } from '../indicators/Indicator';
import type { IndicatorEntry } from '../indicators/IndicatorDefinitions';
import {
  IndicatorEngine,
  type IndicatorPatch,
} from '../indicators/IndicatorEngine';
import {
  createChartMetrics,
  type ChartMetrics,
} from '../performance/ChartMetrics';
import type { DeepPartial } from '../utils/deepMerge';
import {
  createChartSharedState,
  toViewportOptions,
  type ChartSharedState,
  type ViewportOptions,
} from './ChartSharedState';
import {
  resetViewport,
  scrollToRealtime,
  showLogicalRange,
} from './ViewportActions';

/**
 * Chart handle implemented in P3: data entry points, viewport commands
 * (the viewport subset of `TradingChartController`, spec §21) and
 * UI-thread state for host overlays, plus the P5 indicator methods (spec
 * §21 `addIndicator` / `removeIndicator` / `updateIndicator`). Pane
 * methods arrive with P6–P7.
 */
export interface TradingChartHandle {
  /** JS-thread data store (source of truth). */
  readonly store: CandleStore;
  /** UI-thread engine state (read in worklets; do not write). */
  readonly state: ChartSharedState;
  /** `true` while the last bar is on screen — drive a "jump to latest" button. */
  readonly isAtRealtime: SharedValue<boolean>;
  /** Timings (enabled by `config.debug.profiling`) + render counter. */
  readonly metrics: ChartMetrics;
  /** Indicator engine (registry, results, entries) bound to `store`. */
  readonly indicators: IndicatorEngine;

  /** Replaces the dataset (normalized); resets the viewport. */
  setData(candles: readonly Candle[]): CandleIssue[];
  /** Appends a newer bar. `false` when rejected (invalid / not newer). */
  appendBar(candle: Candle): boolean;
  /** Replaces the forming (last) bar. `false` when rejected. */
  updateLastBar(candle: Candle): boolean;
  /** Merges older history without moving the viewport. */
  prependBars(candles: readonly Candle[]): void;

  /**
   * Adds an indicator (e.g. `{ type: 'ema', config: { period: 20 } }`);
   * returns its id. Throws on an unknown type or a duplicate id.
   */
  addIndicator(input: IndicatorInput): string;
  /** Removes an indicator; `false` when unknown. */
  removeIndicator(id: string): boolean;
  /** Patches config / style / pane; `false` when unknown. */
  updateIndicator(id: string, patch: IndicatorPatch): boolean;
  /** Replaces the whole indicator set (matched by id). */
  setIndicators(inputs: readonly IndicatorInput[]): void;
  /** Active indicators in display order. */
  getIndicators(): readonly IndicatorEntry[];

  /** Scrolls to the latest bar (animated by default). */
  scrollToRealtime(animated?: boolean): void;
  /** Restores the default zoom at realtime (animated by default). */
  resetZoom(animated?: boolean): void;
  /** Shows logical bars `[start, end]` (animated by default). */
  setVisibleRange(start: number, end: number, animated?: boolean): void;
}

/** Internal: the component feeds the resolved config in. */
export interface ChartControllerInternals extends TradingChartHandle {
  readonly options: ViewportOptions;
  configure(config: ChartConfig): void;
}

class ChartController implements ChartControllerInternals {
  readonly store = new CandleStore();
  readonly state: ChartSharedState;
  options: ViewportOptions;
  metrics: ChartMetrics;
  readonly indicators: IndicatorEngine;

  constructor(config: ChartConfig) {
    this.state = createChartSharedState(config);
    this.options = toViewportOptions(config);
    this.metrics = createChartMetrics({ enabled: config.debug.profiling });
    this.indicators = new IndicatorEngine(this.store, {
      getProfiler: () => this.metrics.channel('indicator'),
    });
  }

  get isAtRealtime(): SharedValue<boolean> {
    return this.state.isAtRealtime;
  }

  configure(config: ChartConfig): void {
    this.options = toViewportOptions(config);
    if (this.metrics.enabled !== config.debug.profiling) {
      this.metrics = createChartMetrics({ enabled: config.debug.profiling });
    }
  }

  setData(candles: readonly Candle[]): CandleIssue[] {
    return this.store.setData(candles);
  }

  appendBar(candle: Candle): boolean {
    return this.store.append(candle);
  }

  updateLastBar(candle: Candle): boolean {
    return this.store.updateLast(candle);
  }

  prependBars(candles: readonly Candle[]): void {
    mergeCandles(this.store, candles);
  }

  addIndicator(input: IndicatorInput): string {
    return this.indicators.add(input);
  }

  removeIndicator(id: string): boolean {
    return this.indicators.remove(id);
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
