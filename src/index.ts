// Components
export {
  TradingChart,
  type TradingChartProps,
} from './components/TradingChart';

// Core types
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
  type ChartConfig,
  type ChartDebugConfig,
  type ChartInteractionConfig,
  type ChartLayoutConfig,
  type ChartViewportConfig,
} from './core/ChartConfig';
export type { TradingChartController } from './core/ChartController';
export type {
  BandPoint,
  HistogramPoint,
  HistogramPolarity,
  Indicator,
  IndicatorDefinition,
  IndicatorStyle,
  LinePoint,
  MultiLineResult,
} from './indicators/Indicator';
export {
  PRICE_PANE_ID,
  type PaneDefinition,
  type PaneType,
} from './panes/Pane';

// Data validation
export {
  getBarValuesIssue,
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

// Data engine
export {
  CandleStore,
  type CandleStoreChange,
  type CandleStoreChangeKind,
  type CandleStoreListener,
} from './data/CandleStore';
export type { CandleColumns } from './data/CandleBuffer';
export {
  mergeCandles,
  type MergeConflictPolicy,
  type MergeOptions,
  type MergeResult,
} from './data/HistoryMerge';
export {
  getBucketStart,
  getNextBucketStart,
  parseTimeframe,
  timeframeToMs,
  type TimeframeSpec,
  type TimeframeUnit,
} from './data/Timeframe';
export {
  RealtimeBarAggregator,
  type AggregateResult,
  type KlineUpdate,
  type RealtimeBarAggregatorOptions,
  type SnapshotMode,
} from './data/RealtimeBarAggregator';

// Viewport engine (worklet-compatible math)
export {
  barSpacingForRange,
  candleBodyWidth,
  clampBarSpacing,
  clampRightOffset,
  elasticRightOffset,
  indexToX,
  isLastBarVisible,
  maxRightOffset,
  minRightOffset,
  panRightOffset,
  rightEdgeIndex,
  rightOffsetForRange,
  visibleBarCount,
  xToIndex,
  xToNearestIndex,
  zoomRightOffset,
  type TimeScaleOptions,
  type TimeScaleState,
} from './viewport/TimeScale';
export {
  DEFAULT_OVERSCAN_BARS,
  getVisibleLogicalRange,
  getVisibleRange,
  type VisibleRange,
} from './viewport/VisibleRange';
export {
  createPriceScale,
  DEFAULT_PRICE_PADDING,
  DEGENERATE_RANGE_RATIO,
  FALLBACK_PRICE_RANGE,
  MAX_ABS_PRICE,
  normalizePriceRange,
  priceToY,
  yToPrice,
  type PriceScaleMode,
  type PriceScaleOptions,
  type PriceScaleSnapshot,
} from './viewport/PriceScale';
export { candleRangeMinMax, rangeMinMax } from './viewport/AutoScale';

// Theme
export type { ChartTheme, ColorValue } from './theme/ChartTheme';
export { defaultDarkTheme } from './theme/defaultDarkTheme';
export { defaultLightTheme } from './theme/defaultLightTheme';
export { mergeTheme, type ChartThemeOverride } from './theme/mergeTheme';

// Performance instrumentation
export {
  createRenderProfiler,
  defaultClock,
  NOOP_PROFILER,
  type Clock,
  type RenderProfiler,
  type RenderProfilerOptions,
  type TimingStats,
} from './performance/RenderProfiler';
export {
  createChartMetrics,
  METRIC_CHANNELS,
  type ChartMetrics,
  type ChartMetricsOptions,
  type ChartMetricsSnapshot,
  type MetricChannel,
} from './performance/ChartMetrics';
export {
  BENCHMARK_SCENARIOS,
  type BenchmarkIndicatorSpec,
  type BenchmarkScenario,
  type BenchmarkSceneId,
} from './performance/BenchmarkScenarios';

// Utilities
export type { DeepPartial } from './utils/deepMerge';
