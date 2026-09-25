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
