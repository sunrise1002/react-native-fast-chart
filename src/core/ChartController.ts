import type { Candle } from '../data/Candle';
import type { IndicatorDefinition } from '../indicators/Indicator';
import type { PaneDefinition } from '../panes/Pane';

/**
 * Imperative chart API (spec §21). High-frequency data (realtime ticks,
 * history pages) flows through this controller instead of React props.
 * Implemented in phase P7; the signature is fixed here so that earlier
 * phases can code against it.
 */
export interface TradingChartController {
  /** Replaces the whole dataset (symbol or timeframe switch). */
  setData(candles: readonly Candle[]): void;

  /** Appends a new bar whose time is greater than the last bar's time. */
  appendBar(candle: Candle): void;
  /** Replaces the last (still forming) bar. */
  updateLastBar(candle: Candle): void;
  /** Prepends older history without moving the visible viewport. */
  prependBars(candles: readonly Candle[]): void;

  /** Returns the id of the added indicator. */
  addIndicator(definition: IndicatorDefinition): string;
  removeIndicator(id: string): void;
  updateIndicator(id: string, patch: Partial<IndicatorDefinition>): void;

  /** Returns the id of the added pane. */
  addPane(definition: PaneDefinition): string;
  removePane(id: string): void;

  scrollToRealtime(): void;
  /** Shows bars with logical indices in `[start, end]`. */
  setVisibleRange(start: number, end: number): void;
  resetZoom(): void;
}
