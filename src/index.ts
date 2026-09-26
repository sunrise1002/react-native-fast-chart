/**
 * Public API of `react-native-fast-chart` (see docs/API.md).
 *
 * Everything exported here follows the semver policy in CHANGELOG.md.
 * Renderer, geometry, tick-generation and viewport-math modules are
 * internal and may change in any release; test fixtures, benchmark
 * scenes and test IDs live in `react-native-fast-chart/testing`.
 */

// ─── Components ──────────────────────────────────────────────────────────
export {
  TradingChart,
  type TradingChartProps,
} from './components/TradingChart';
export {
  ChartErrorBoundary,
  type ChartErrorBoundaryProps,
  type ChartErrorFallback,
} from './components/ChartErrorBoundary';

// ─── Controller / handle ─────────────────────────────────────────────────
export {
  createTradingChartController,
  useTradingChartController,
  type TradingChartHandle,
} from './engine/createTradingChartController';
export type {
  ChartSettingsExtras,
  SetDataOptions,
  TradingChartController,
  UpsertBarResult,
  ViewportResetPolicy,
} from './core/ChartController';
export type {
  ChartSharedState,
  ViewportOptions,
} from './engine/ChartSharedState';
export type { UiCandleSeries } from './data/UiCandleSeries';
export type {
  UiIndicatorSeries,
  UiIndicatorSet,
} from './indicators/UiIndicatorSet';
export type {
  CrosshairChange,
  CrosshairChangeHandler,
} from './interaction/useCrosshairCallback';

// ─── Core types + configuration ──────────────────────────────────────────
export type {
  Candle,
  LogicalRange,
  PriceRange,
  Rect,
  Size,
  TimeRange,
  Timeframe,
  TimeUnit,
  UnixMs,
} from './core/ChartTypes';
export {
  DEFAULT_CHART_CONFIG,
  resolveChartConfig,
  type ChartAxesConfig,
  type ChartConfig,
  type ChartCrosshairConfig,
  type ChartDebugConfig,
  type ChartHistoryConfig,
  type ChartInteractionConfig,
  type ChartLayoutConfig,
  type ChartOverlaysConfig,
  type ChartRealtimeConfig,
  type ChartTelemetryConfig,
  type ChartViewportConfig,
  type CrosshairMode,
  type DailyBarsTimeZone,
} from './core/ChartConfig';
export type { DeepPartial } from './utils/deepMerge';

// ─── Precision, formatting, time zones ───────────────────────────────────
export {
  resolveSymbolPrecision,
  snapToTickSize,
  type ChartSymbolConfig,
  type ResolvedPrecision,
} from './axes/SymbolPrecision';
export {
  TIME_LABEL_CROSSHAIR,
  type PriceFormatter,
  type TimeFormatter,
} from './axes/Formatters';
export {
  autoPriceDecimals,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  formatVolume,
  MAX_PRICE_DECIMALS,
} from './axes/PriceFormat';
export {
  formatClock,
  formatDateTime,
  formatTimeTick,
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from './axes/TimeFormat';
export { type ChartTimeZone } from './axes/TimeZone';
export { isSupportedTimeZone } from './axes/ZoneTable';

// ─── Errors + telemetry ──────────────────────────────────────────────────
export type {
  ChartErrorEvent,
  ChartErrorHandler,
  ChartErrorSource,
} from './core/ChartErrors';
export {
  MIN_PERFORMANCE_SAMPLE_MS,
  type ChartPerformanceSample,
  type ChartPerformanceSampleHandler,
} from './performance/PerformanceSampler';
export {
  createFrameStats,
  DEFAULT_FRAME_TARGET_MS,
  recordFrameInterval,
  resetFrameStats,
  summarizeFrameStats,
  type FrameStatsAccumulator,
  type FrameStatsSummary,
} from './performance/FrameStats';
export type {
  ChartMetrics,
  ChartMetricsSnapshot,
  MetricChannel,
} from './performance/ChartMetrics';
export type { TimingStats } from './performance/RenderProfiler';

// ─── Data: validation, timeframes, realtime aggregation ──────────────────
export {
  getCandleIssue,
  isValidCandle,
  normalizeCandles,
  validateCandles,
  type CandleIssue,
  type CandleIssueReason,
  type CandleValidationResult,
  type NormalizeCandlesOptions,
  type NormalizeCandlesResult,
} from './data/CandleValidation';
export type {
  CandleStore,
  CandleStoreChange,
  CandleStoreChangeKind,
  CandleStoreListener,
} from './data/CandleStore';
export type { CandleColumns } from './data/CandleBuffer';
export type { MergeConflictPolicy, MergeResult } from './data/HistoryMerge';
export {
  getBucketStart,
  getNextBucketStart,
  parseTimeframe,
  timeframeToMs,
  type TimeframeSpec,
  type TimeframeUnit,
} from './data/Timeframe';
export { createBucketAligner, type BucketAligner } from './data/BucketAligner';
export {
  RealtimeBarAggregator,
  type AggregateResult,
  type KlineUpdate,
  type RealtimeBarAggregatorOptions,
  type SnapshotMode,
} from './data/RealtimeBarAggregator';

// ─── History pagination + realtime status ────────────────────────────────
export type {
  HistoryLoader,
  HistoryLoadState,
  LoadMoreHandler,
  LoadMoreRequest,
  LoadMoreResult,
} from './history/HistoryLoader';
export {
  isRealtimeStatus,
  REALTIME_STATUSES,
  type RealtimeStatus,
  type RealtimeStatusStore,
} from './realtime/RealtimeStatus';

// ─── Indicators: inputs, catalog, custom indicators ──────────────────────
export {
  PRICE_SOURCES,
  type BandPoint,
  type HistogramColorMode,
  type HistogramPoint,
  type HistogramPolarity,
  type Indicator,
  type IndicatorDefinition,
  type IndicatorInput,
  type IndicatorResult,
  type IndicatorStyle,
  type LinePoint,
  type MultiLineResult,
  type PriceSource,
} from './indicators/Indicator';
export {
  indicatorScale,
  IndicatorRegistry,
  type IndicatorGuides,
  type IndicatorMeta,
  type IndicatorModule,
  type IndicatorOutput,
  type IndicatorPlacement,
  type IndicatorScaleKind,
  type IndicatorScaleSpec,
  type IndicatorSeriesDescriptor,
} from './indicators/IndicatorRegistry';
export {
  formatIndicatorLabel,
  MAX_INDICATOR_PERIOD,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type IndicatorConfigValue,
  type IndicatorParam,
  type NumberParam,
  type RawIndicatorConfig,
  type SourceParam,
} from './indicators/IndicatorConfig';
export {
  createStepIndicator,
  type StepKernel,
} from './indicators/StepIndicator';
export {
  createIndicatorResult,
  ensureResultCapacity,
  isFiniteValue,
  readSource,
} from './indicators/IndicatorSeries';
export {
  histogramPolarity,
  toBandPoints,
  toHistogramPoints,
  toLinePoints,
  toMultiLine,
} from './indicators/IndicatorAdapters';
export { createIndicatorRegistry } from './indicators/builtins';
export type {
  IndicatorEngine,
  IndicatorPatch,
  IndicatorUpdate,
  IndicatorUpdateListener,
} from './indicators/IndicatorEngine';
export type { IndicatorEntry } from './indicators/IndicatorDefinitions';
export type {
  IndicatorComputeCounts,
  IndicatorComputeStats,
} from './indicators/IndicatorStats';

// ─── Panes ───────────────────────────────────────────────────────────────
export {
  MAX_PANE_RATIO,
  MIN_PANE_RATIO,
  PRICE_PANE_ID,
  type PaneDefinition,
  type PaneInput,
  type PaneType,
} from './panes/Pane';
export type { PaneIndicatorRef, PaneManager } from './panes/PaneManager';

// ─── Settings persistence + indicator catalog helpers ────────────────────
export {
  CHART_SETTINGS_VERSION,
  createChartSettings,
  defaultChartSettings,
  deserializeChartSettings,
  serializeChartSettings,
  settingsToIndicatorInputs,
  type ChartSettings,
  type ChartSettingsIssue,
  type ChartSettingsSource,
  type DeserializedChartSettings,
  type IndicatorSettings,
  type IndicatorSettingValue,
  type PaneSettings,
} from './settings/ChartSettings';
export {
  allowedPlacements,
  createIndicatorInput,
  parseParamValue,
  placementOf,
  type CreateIndicatorOptions,
  type ParsedParamValue,
} from './settings/IndicatorCatalog';

// ─── Theme ───────────────────────────────────────────────────────────────
export type { ChartTheme, ColorValue } from './theme/ChartTheme';
export { defaultDarkTheme } from './theme/defaultDarkTheme';
export { defaultLightTheme } from './theme/defaultLightTheme';
export { mergeTheme, type ChartThemeOverride } from './theme/mergeTheme';
