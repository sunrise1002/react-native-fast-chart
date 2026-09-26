import type { ChartSymbolConfig } from '../axes/SymbolPrecision';
import type { ChartTimeZone } from '../axes/TimeZone';
import { deepMerge, type DeepPartial } from '../utils/deepMerge';
import { sanitizeChartConfig } from './ConfigSanitize';

/** Developer diagnostics. All flags default to `false` (zero cost). */
export interface ChartDebugConfig {
  /** Draws the FPS / render-time overlay on top of the chart. */
  overlay: boolean;
  /** Collects frame/render timings in `ChartMetrics`. */
  profiling: boolean;
}

export interface ChartLayoutConfig {
  /**
   * Minimum width of the right price axis, dp. The axis grows to fit its
   * widest label (never shrinks while panning; resets with the dataset).
   */
  priceAxisWidth: number;
  /** Height reserved for the bottom time axis, dp. */
  timeAxisHeight: number;
  /** Empty space right of the last bar, in bars. */
  rightOffsetBars: number;
  /**
   * Share of the price pane's height (bottom) used by indicators with
   * their own scale placed on the price pane — e.g. a volume overlay
   * (`paneId: 'price'`). `(0, 1]`.
   */
  overlayScaleHeightRatio: number;
  /** Touch slop around pane separators for resizing, dp. */
  paneSeparatorHitSlop: number;
}

export interface ChartViewportConfig {
  /** Initial distance between bar centers, dp. */
  initialBarSpacing: number;
  /** Zoom-in limit, dp per bar. */
  maxBarSpacing: number;
  /** Zoom-out limit, dp per bar (may be < 1 for conflated rendering). */
  minBarSpacing: number;
  /** Candle body width as a fraction of the bar spacing, `[0, 1]`. */
  bodyRatio: number;
  /** Bars rendered beyond each plot edge (spec §10.3). */
  overscanBars: number;
  /** Max empty bars right of the last bar when panning. */
  maxRightOffsetBars: number;
  /** Max empty bars left of the first bar when panning. */
  leftMarginBars: number;
  /** Bars that always remain visible at either pan bound. */
  minVisibleBars: number;
  /**
   * Pixel-bucket conflation (spec §23.3): when bars get narrower than this
   * many device px (or the wick width), groups of bars are drawn as one
   * bucket — rendering only, data is untouched. `0` disables it.
   */
  conflationPx: number;
}

export interface ChartInteractionConfig {
  panEnabled: boolean;
  pinchEnabled: boolean;
  crosshairEnabled: boolean;
  /** Drag pane separators to resize panes. */
  paneResizeEnabled: boolean;
}

/** Where daily and longer bars take their calendar date from. */
export type DailyBarsTimeZone = 'utc' | 'chart';

/** Axis labels and number / time formatting (spec §19, Phase 19.1–19.3). */
export interface ChartAxesConfig {
  /**
   * @deprecated Use `symbol.pricePrecision` (takes precedence). Kept as a
   * fallback until 1.0.
   */
  pricePrecision: number | null;
  /** Thousands separator of price labels (`''` disables grouping). */
  thousandsSeparator: string;
  /**
   * Zone of intraday time labels and the crosshair time: `'local'`
   * (device, DST-aware), `'utc'`, a fixed UTC offset in minutes (`540` =
   * UTC+9) or an IANA name (`'America/New_York'`, via `Intl`; falls back
   * to UTC when the runtime can't resolve it).
   */
  timeZone: ChartTimeZone;
  /**
   * Calendar date of daily / weekly / monthly bars. `'utc'` (default)
   * reads the bar's UTC date — right for exchanges stamping daily bars at
   * 00:00 UTC (crypto) and for zones west of UTC. `'chart'` reads it in
   * `timeZone` — use it when bars open at the exchange's local midnight
   * east of UTC (e.g. KRX / TSE daily bars at 00:00 UTC+9), together with
   * the same `timeZone` on `RealtimeBarAggregator`.
   */
  dailyBarsTimeZone: DailyBarsTimeZone;
}

/** Production telemetry (spec §32). */
export interface ChartTelemetryConfig {
  /**
   * Interval of `onPerformanceSample` reports, ms. Frame timing is only
   * collected while the prop is set. Clamped to `>= 1000`.
   */
  performanceSampleMs: number;
}

/** Crosshair release behavior. */
export type CrosshairMode = 'hold' | 'sticky';

export interface ChartCrosshairConfig {
  /**
   * `'hold'` (TradingView): hides `holdMs` after the finger lifts.
   * `'sticky'` (Binance): stays after release; drag moves it, tap hides it.
   */
  mode: CrosshairMode;
  /** Long-press duration that activates the crosshair, ms. */
  longPressMs: number;
  /** `'hold'` mode: time the crosshair stays visible after release, ms. */
  holdMs: number;
}

export interface ChartOverlaysConfig {
  /** Last-price dashed line + axis badge. */
  lastPrice: boolean;
  /** OHLC legend (top-left). */
  legend: boolean;
  /** Include volume in the legend. */
  legendVolume: boolean;
}

/** Realtime behavior (spec Phase 15). */
export interface ChartRealtimeConfig {
  /**
   * Follow new bars while the last bar is on screen (TradingView). When the
   * user has scrolled into history the view always holds still. `false`
   * never auto-scrolls: appended bars appear right of the visible area.
   */
  followRealtime: boolean;
  /** Subtle pulse at the last price whenever the forming bar ticks. */
  lastPricePulse: boolean;
  /** Duration of one pulse, ms. */
  pulseDurationMs: number;
}

/** History pagination (spec §23.2, Phase 16). */
export interface ChartHistoryConfig {
  /**
   * `onLoadMore` fires when the left edge of the view gets within this
   * many bars of the oldest loaded bar. `0` = only when it is reached.
   */
  loadMoreThresholdBars: number;
  /** Minimum delay before retrying a failed `onLoadMore`, ms. */
  retryDelayMs: number;
}

/** Static chart options. Changing them is not a per-frame operation. */
export interface ChartConfig {
  /** Symbol metadata: precision and tick size (spec Phase 19.1–19.2). */
  symbol: ChartSymbolConfig;
  layout: ChartLayoutConfig;
  viewport: ChartViewportConfig;
  interaction: ChartInteractionConfig;
  axes: ChartAxesConfig;
  crosshair: ChartCrosshairConfig;
  overlays: ChartOverlaysConfig;
  realtime: ChartRealtimeConfig;
  history: ChartHistoryConfig;
  telemetry: ChartTelemetryConfig;
  debug: ChartDebugConfig;
}

export const DEFAULT_CHART_CONFIG: Readonly<ChartConfig> = Object.freeze({
  symbol: Object.freeze({
    pricePrecision: null,
    tickSize: null,
    quantityStep: null,
    volumePrecision: null,
  }),
  layout: Object.freeze({
    priceAxisWidth: 64,
    timeAxisHeight: 24,
    rightOffsetBars: 5,
    overlayScaleHeightRatio: 0.2,
    paneSeparatorHitSlop: 12,
  }),
  viewport: Object.freeze({
    initialBarSpacing: 8,
    maxBarSpacing: 64,
    minBarSpacing: 0.5,
    bodyRatio: 0.8,
    overscanBars: 20,
    maxRightOffsetBars: 50,
    leftMarginBars: 10,
    minVisibleBars: 2,
    conflationPx: 2,
  }),
  interaction: Object.freeze({
    panEnabled: true,
    pinchEnabled: true,
    crosshairEnabled: true,
    paneResizeEnabled: true,
  }),
  axes: Object.freeze({
    pricePrecision: null,
    thousandsSeparator: ',',
    timeZone: 'local' as ChartTimeZone,
    dailyBarsTimeZone: 'utc' as DailyBarsTimeZone,
  }),
  crosshair: Object.freeze({
    mode: 'hold' as CrosshairMode,
    longPressMs: 250,
    holdMs: 1200,
  }),
  overlays: Object.freeze({
    lastPrice: true,
    legend: true,
    legendVolume: true,
  }),
  realtime: Object.freeze({
    followRealtime: true,
    lastPricePulse: false,
    pulseDurationMs: 700,
  }),
  history: Object.freeze({
    loadMoreThresholdBars: 50,
    retryDelayMs: 2000,
  }),
  telemetry: Object.freeze({
    performanceSampleMs: 5000,
  }),
  debug: Object.freeze({
    overlay: false,
    profiling: false,
  }),
});

/**
 * Resolves a user-supplied partial config against the defaults. Invalid
 * values (wrong type, `NaN` / ±∞, negative sizes, unknown enum values)
 * fall back to their defaults instead of reaching the engine.
 */
export function resolveChartConfig(
  override?: DeepPartial<ChartConfig> | null
): ChartConfig {
  return sanitizeChartConfig(
    deepMerge<ChartConfig>(DEFAULT_CHART_CONFIG, override),
    DEFAULT_CHART_CONFIG
  );
}
