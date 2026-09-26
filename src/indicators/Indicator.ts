import type { ChartTimeZone } from '../axes/TimeZone';
import type { UnixMs } from '../data/Candle';
import type { CandleColumns } from '../data/CandleBuffer';

/*
 * Indicator contracts (spec §13). Pure TypeScript: no React, no Skia.
 *
 * Indicators read the candle store's struct-of-arrays columns directly
 * (bar `i` at `column[offset + i]`) and write their outputs into
 * `Float64Array` columns aligned with the candle indices — no per-point
 * objects on the hot path. `NaN` means "no value" (warm-up period,
 * missing input). The spec's point shapes (`LinePoint`, `BandPoint`, …)
 * are produced on demand by the adapters in `IndicatorAdapters.ts`.
 */

/** Price series an indicator reads from each bar (TradingView sources). */
export type PriceSource =
  'open' | 'high' | 'low' | 'close' | 'hl2' | 'hlc3' | 'ohlc4';

/** Any per-bar input column: a price source or the bar volume. */
export type SeriesSource = PriceSource | 'volume';

/** Every `PriceSource` value (indicator `source` param options). */
export const PRICE_SOURCES: readonly PriceSource[] = Object.freeze([
  'open',
  'high',
  'low',
  'close',
  'hl2',
  'hlc3',
  'ohlc4',
]);

/**
 * Numeric result of an indicator: one column per output, aligned with the
 * candles (`outputs[k][i]` = output `k` of bar `i`).
 *
 * Columns may have spare capacity; slots at `index >= length` hold `NaN`.
 * They are replaced (not resized) when they grow, so re-read `outputs`
 * after every update. `update` may mutate and return `previous`.
 */
export interface IndicatorResult<TState = unknown> {
  outputs: Float64Array[];
  /** Number of bars covered (equals the candle count after a compute). */
  length: number;
  /**
   * Bars whose values are final: their contribution is folded into
   * `state`. Everything from `committed` on is recomputed by the next
   * incremental update (normally only the forming last bar).
   */
  committed: number;
  /** First bar rewritten by the last `calculate` / `update` (0 = all). */
  changedFrom: number;
  /** Indicator-private incremental state. */
  state: TState;
}

/**
 * Chart-level inputs shared by every indicator of a chart (not part of
 * any indicator's config). A change recalculates the indicators whose
 * meta sets `usesContext`.
 */
export interface IndicatorContext {
  /** Chart time zone (`axes.timeZone`): session boundaries (VWAP). */
  readonly timeZone: ChartTimeZone;
}

/** Context used when none is supplied (UTC sessions). */
export const DEFAULT_INDICATOR_CONTEXT: IndicatorContext = Object.freeze({
  timeZone: 'utc',
});

/**
 * Indicator algorithm (spec §13.1, adapted to columnar input). One stateless
 * implementation per `type`; instances are described by
 * `IndicatorDefinition` and their results live in the indicator cache.
 */
export interface Indicator<TConfig, TResult = IndicatorResult> {
  readonly type: string;

  /** Full calculation over all bars of `input` (history load, spec §15.1). */
  calculate(
    input: CandleColumns,
    config: TConfig,
    context?: IndicatorContext
  ): TResult;

  /**
   * Incremental update after bars from `changedIndex` on changed or were
   * appended (spec §15.2). Must recompute only the affected tail; may fall
   * back to `calculate` when `changedIndex` precedes the committed bars.
   * Omitted = always recalculate.
   */
  update?(
    previous: TResult,
    input: CandleColumns,
    changedIndex: number,
    config: TConfig,
    context?: IndicatorContext
  ): TResult;

  /**
   * Older bars were inserted at the front (`count` bars, every previous
   * index shifted). Omitted = full recalculation (spec §15.3).
   */
  prepend?(
    previous: TResult,
    input: CandleColumns,
    count: number,
    config: TConfig
  ): TResult;
}

/** Per-indicator drawing overrides (colors, widths, histogram coloring). */
export interface IndicatorStyle {
  visible: boolean;
  /** Line width, dp. Defaults to 1.5. */
  lineWidth?: number;
  /** Line opacity `[0, 1]`. Defaults to 1. */
  opacity?: number;
  /**
   * Explicit colors, one per render series (in `IndicatorMeta.series`
   * order); falls back to the series default, then to
   * `ChartTheme.indicatorPalette`.
   */
  colors?: readonly string[];
  /** Band fill between upper and lower (bands only). Defaults to `true`. */
  fill?: boolean;
  /** Band fill opacity `[0, 1]`. Defaults to 0.08. */
  fillOpacity?: number;
  /**
   * Histogram coloring (MACD): `'trend'` = 4 colors (positive / negative ×
   * rising / falling, TradingView), `'sign'` = 2 colors. Defaults to the
   * series descriptor's mode.
   */
  histogramColorMode?: HistogramColorMode;
}

/**
 * How histogram bars pick their color bucket: `'sign'` (0 = ≥ 0,
 * 1 = < 0), `'trend'` (0 = ≥ 0 rising, 1 = ≥ 0 falling, 2 = < 0 falling,
 * 3 = < 0 rising) or `'candle'` (0 = bullish bar, 1 = bearish bar; volume).
 */
export type HistogramColorMode = 'sign' | 'trend' | 'candle';

/** Serializable description of an indicator instance (spec §13.2). */
export interface IndicatorDefinition {
  id: string;
  /** Registry key, e.g. `'ema'`, `'bollinger'`. */
  type: string;
  /** Pane that hosts the indicator (`'price'` for overlays). */
  paneId: string;
  config: Readonly<Record<string, unknown>>;
  style: IndicatorStyle;
}

/**
 * Loose input accepted by the chart API: everything except `type` is
 * optional (id generated, pane from the registry placement, default
 * config / style).
 */
export interface IndicatorInput {
  id?: string;
  type: string;
  paneId?: string;
  config?: Readonly<Record<string, unknown>>;
  style?: Partial<IndicatorStyle>;
}

/* ---------------------------- Result types (§13.3) ---------------------------- */

export interface LinePoint {
  time: UnixMs;
  /** `null` during warm-up or when the value is undefined. */
  value: number | null;
}

/** Named line series of a multi-output indicator (e.g. MACD). */
export interface MultiLineResult {
  lines: Readonly<Record<string, readonly LinePoint[]>>;
}

/** Sign class of a histogram bar (drives its color). */
export type HistogramPolarity = 'positive' | 'negative' | 'neutral';

/** Histogram sample with its polarity. */
export interface HistogramPoint {
  time: UnixMs;
  value: number;
  polarity?: HistogramPolarity;
}

/** Band sample (Bollinger-style upper / middle / lower). */
export interface BandPoint {
  time: UnixMs;
  upper: number;
  middle?: number;
  lower: number;
}
