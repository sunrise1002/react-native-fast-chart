// Components
export {
  TradingChart,
  type TradingChartProps,
} from './components/TradingChart';

// Chart handle / controller (P3 subset of spec §21)
export {
  createTradingChartController,
  useTradingChartController,
  type TradingChartHandle,
} from './engine/ChartControllerImpl';
export type {
  ChartSharedState,
  ViewportOptions,
} from './engine/ChartSharedState';
export type { UiCandleSeries } from './data/UiCandleSeries';

// Gestures
export {
  composeChartGestures,
  DOUBLE_TAP_MAX_DELAY_MS,
  GESTURE_TEST_IDS,
  PAN_ACTIVATION_DP,
} from './interaction/useChartGestures';
export {
  CROSSHAIR_TEST_IDS,
  STICKY_DRAG_SLOP_DP,
} from './interaction/useCrosshairGesture';
export type {
  CrosshairChange,
  CrosshairChangeHandler,
} from './interaction/useCrosshairCallback';

// Render model + geometry (renderer-agnostic, worklet-compatible)
export type {
  AxisLabelGeometry,
  BandGeometry,
  TextBoxMetrics,
  TextSink,
  CandleDrawMode,
  CandleGeometryBatch,
  ChartRenderModel,
  CrosshairRenderModel,
  GridLineGeometry,
  GridLineOrientation,
  HistogramGeometry,
  LineGeometry,
  PaneRenderModel,
  RectList,
  TimeAxisRenderModel,
} from './render/RenderModel';
export { createRectList, pushRect } from './render/RenderModel';
export {
  buildCandleGeometry,
  computeCandleMetrics,
  createCandleMetrics,
  MIN_BODY_OVER_WICK_PX,
  type CandleGeometrySink,
  type CandleMetrics,
  type CandleSeriesView,
} from './render/candles/CandleGeometry';
export {
  batchSink,
  createCandleGeometryBatch,
  fillCandleGeometryBatch,
} from './render/candles/CandleGeometryBatch';
export {
  buildGridGeometry,
  DEFAULT_GRID_OPTIONS,
  type GridOptions,
  type GridPriceTicks,
  type GridSink,
  type GridTimeTicks,
} from './render/grid/GridGeometry';
export { centeredBaseline } from './render/RenderModel';
export {
  layoutPriceAxisLabels,
  PRICE_LABEL_STYLE,
  type PriceAxisLayout,
  type ReservedSpan,
} from './render/axes/PriceAxisRenderer';
export {
  layoutTimeAxisLabels,
  TIME_LABEL_STYLE,
  type TimeAxisLayout,
} from './render/axes/TimeAxisRenderer';
export {
  computeLastPriceMarker,
  createLastPriceMarker,
  LAST_PRICE_PINNED_BOTTOM,
  LAST_PRICE_PINNED_NONE,
  LAST_PRICE_PINNED_TOP,
  type LastPriceMarker,
} from './render/overlays/LastPriceRenderer';
export {
  computeCrosshair,
  createCrosshairFrame,
  nearestBarIndex,
  type CrosshairFrame,
} from './render/overlays/CrosshairRenderer';
export {
  layoutOhlcHeader,
  OHLC_STYLE_CAPTION,
  OHLC_STYLE_DOWN,
  OHLC_STYLE_UP,
  type OhlcHeaderLayout,
} from './render/overlays/OHLCHeaderRenderer';

// Axes: ticks + formatting (pure, worklet-compatible)
export {
  autoPriceDecimals,
  displayDecimals,
  formatPercent,
  formatPrice,
  formatSignedPrice,
  formatVolume,
  MAX_PRICE_DECIMALS,
  stepDecimals,
} from './axes/PriceFormat';
export {
  createPriceTicks,
  generatePriceTicks,
  nicePriceTickStep,
  priceTickStep,
  priceTickTargetCount,
  type PriceTicks,
} from './axes/PriceTicks';
export {
  createTimeTicks,
  estimateBarInterval,
  generateTimeTicks,
  selectTimeInterval,
  timeIntervalMs,
  type TimeColumn,
  type TimeTicks,
} from './axes/TimeTicks';
export {
  formatClock,
  formatDateTime,
  formatTimeTick,
  TICK_WEIGHT_DAY,
  TICK_WEIGHT_MONTH,
  TICK_WEIGHT_TIME,
  TICK_WEIGHT_YEAR,
} from './axes/TimeFormat';
export {
  createOffsetResolver,
  offsetAt,
  type ChartTimeZone,
  type OffsetResolver,
} from './axes/TimeZone';
export {
  clampSpan,
  rangesOverlap,
  thinTicksBySpacing,
  type WeightedTicks,
} from './axes/LabelCollision';
export { nextAxisWidth, requiredAxisWidth } from './axes/AxisWidth';
export {
  lineWidthPx,
  sanitizePixelRatio,
  snapToPixel,
} from './render/PixelSnap';

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
  type ChartAxesConfig,
  type ChartConfig,
  type ChartCrosshairConfig,
  type ChartDebugConfig,
  type ChartOverlaysConfig,
  type CrosshairMode,
  type ChartInteractionConfig,
  type ChartLayoutConfig,
  type ChartViewportConfig,
} from './core/ChartConfig';
export type { TradingChartController } from './core/ChartController';

// Indicators (P5): contracts, registry, built-ins, engine, adapters
export {
  PRICE_SOURCES,
  type BandPoint,
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
  IndicatorRegistry,
  type IndicatorMeta,
  type IndicatorModule,
  type IndicatorOutput,
  type IndicatorPlacement,
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
  createIndicatorRegistry,
  registerBuiltInIndicators,
} from './indicators/builtins';
export {
  DEFAULT_MA_PERIOD,
  emaModule,
  smaModule,
  wmaModule,
  type MovingAverageConfig,
} from './indicators/builtins/MovingAverages';
export {
  BOLLINGER_LOWER,
  BOLLINGER_MIDDLE,
  BOLLINGER_UPPER,
  bollingerModule,
  type BollingerConfig,
} from './indicators/builtins/Bollinger';
export {
  IndicatorEngine,
  type IndicatorEngineOptions,
  type IndicatorPatch,
  type IndicatorUpdate,
  type IndicatorUpdateListener,
} from './indicators/IndicatorEngine';
export type { IndicatorEntry } from './indicators/IndicatorDefinitions';
export {
  histogramPolarity,
  toBandPoints,
  toHistogramPoints,
  toLinePoints,
  toMultiLine,
} from './indicators/IndicatorAdapters';
export type {
  UiIndicatorSeries,
  UiIndicatorSet,
} from './indicators/UiIndicatorSet';
export {
  buildBandFill,
  buildLineGeometry,
  type FillPathSink,
  type LinePathSink,
} from './render/indicators/LineGeometry';
export {
  resolveOverlaySpecs,
  type OverlayRenderSpec,
} from './render/indicators/OverlayRenderSpec';
export {
  INDICATOR_LEGEND_STYLE_CAPTION,
  INDICATOR_LEGEND_STYLE_VALUE,
  layoutIndicatorLegend,
  type IndicatorLegendItem,
  type IndicatorLegendLayout,
} from './render/overlays/IndicatorLegendRenderer';
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
export {
  computeAutoScaleTarget,
  priceRangeChanged,
  PRICE_TARGET_EPSILON,
  shouldSnapPriceRange,
} from './viewport/AutoScaleTarget';

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
