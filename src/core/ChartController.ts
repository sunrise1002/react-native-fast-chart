import type { Candle } from '../data/Candle';
import type { ChartErrorHandler } from './ChartErrors';
import type { CandleIssue } from '../data/CandleValidation';
import type { MergeResult } from '../data/HistoryMerge';
import type { HistoryLoadState } from '../history/HistoryLoader';
import type { IndicatorInput } from '../indicators/Indicator';
import type { IndicatorEntry } from '../indicators/IndicatorDefinitions';
import type { IndicatorPatch } from '../indicators/IndicatorEngine';
import type { PaneDefinition, PaneInput } from '../panes/Pane';
import type { RealtimeStatus } from '../realtime/RealtimeStatus';
import type { ChartSettings } from '../settings/ChartSettings';
import type { LogicalRange } from './ChartTypes';

/**
 * Viewport after `setData` (symbol / timeframe switch, spec §32):
 * `'reset'` restores the initial zoom at realtime; `'keepZoom'` keeps the
 * current bar width and scrolls to realtime.
 */
export type ViewportResetPolicy = 'reset' | 'keepZoom';

/** Options of `setData`. */
export interface SetDataOptions {
  /** Default `'reset'`. */
  viewport?: ViewportResetPolicy;
}

/** What `upsertBar` did. */
export type UpsertBarResult = 'appended' | 'updated' | 'patched' | 'rejected';

/** Host-provided fields stored alongside the chart settings. */
export interface ChartSettingsExtras {
  theme?: string;
  timeframe?: string;
}

/**
 * Imperative chart API (spec §21). High-frequency data (realtime ticks,
 * history pages) flows through this controller instead of React props:
 * none of these calls re-render React.
 */
export interface TradingChartController {
  /* ---------------------------------- Data ---------------------------------- */

  /**
   * Replaces the dataset (symbol / timeframe switch): normalizes the rows,
   * recalculates indicators, resets history pagination and applies the
   * viewport policy. Returns the dropped rows.
   */
  setData(candles: readonly Candle[], options?: SetDataOptions): CandleIssue[];
  /** Appends a newer bar (interval rollover). `false` when rejected. */
  appendBar(candle: Candle): boolean;
  /** Replaces the forming (last) bar; same `time` required. */
  updateLastBar(candle: Candle): boolean;
  /**
   * Kline-style upsert: appends a newer bar, updates the last bar, or
   * patches an existing older bar with the same time.
   */
  upsertBar(candle: Candle): UpsertBarResult;
  /** Merges older history without moving the visible bars. */
  prependBars(candles: readonly Candle[]): MergeResult;

  /* -------------------------------- Getters -------------------------------- */

  getBarCount(): number;
  /** Bar `index` (0 = oldest loaded), `undefined` when out of range. */
  getBar(index: number): Candle | undefined;
  getLastBar(): Candle | undefined;
  /**
   * Fractional logical range currently on screen (`null` before layout /
   * without data). Reads UI-thread state; not for per-frame use.
   */
  getVisibleRange(): LogicalRange | null;

  /* ------------------------------- Indicators ------------------------------- */

  /** Returns the indicator id. Throws on an unknown type / duplicate id. */
  addIndicator(input: IndicatorInput): string;
  /**
   * Removes an indicator (cache and pane reference); its pane is removed
   * when left empty. `false` when unknown.
   */
  removeIndicator(id: string): boolean;
  /** Params / style / pane; only this indicator recalculates. */
  updateIndicator(id: string, patch: IndicatorPatch): boolean;
  setIndicators(inputs: readonly IndicatorInput[]): void;
  getIndicators(): readonly IndicatorEntry[];

  /* ---------------------------------- Panes ---------------------------------- */

  /** Returns the pane id. */
  addPane(input?: PaneInput): string;
  removePane(id: string): boolean;
  movePane(id: string, index: number): boolean;
  setPaneHeightRatio(id: string, ratio: number): boolean;
  resizePanes(ratios: readonly number[]): boolean;
  getPanes(): readonly PaneDefinition[];

  /* -------------------------------- Viewport -------------------------------- */

  scrollToRealtime(animated?: boolean): void;
  /** Shows bars with logical indices in `[start, end]`. */
  setVisibleRange(start: number, end: number, animated?: boolean): void;
  resetZoom(animated?: boolean): void;

  /* -------------------------------- Settings -------------------------------- */

  /** Serializable snapshot of indicators and panes (spec §25). */
  getSettings(extras?: ChartSettingsExtras): ChartSettings;
  /** Restores indicators, pane order and heights (unknown types skipped). */
  applySettings(settings: ChartSettings): void;

  /* ------------------------------ Realtime status ------------------------------ */

  setRealtimeStatus(status: RealtimeStatus): void;
  getRealtimeStatus(): RealtimeStatus;
  subscribeRealtimeStatus(
    listener: (status: RealtimeStatus) => void
  ): () => void;

  /* --------------------------------- History --------------------------------- */

  /** Requests older bars now (same guards as the left-edge trigger). */
  loadMoreHistory(): boolean;
  /** `false` = no older history; `true` = requestable again. */
  setHasMoreHistory(hasMore: boolean): void;
  getHistoryState(): HistoryLoadState;
  subscribeHistoryState(listener: () => void): () => void;

  /* -------------------------------- Telemetry -------------------------------- */

  /**
   * Non-fatal errors (dropped / rejected rows, failing indicators,
   * `onLoadMore` failures) on the JS thread. Listener errors are
   * swallowed. The `onError` prop subscribes here too.
   */
  subscribeErrors(listener: ChartErrorHandler): () => void;

  /** Releases listeners, schedulers and caches. The handle is unusable after. */
  dispose(): void;
}
