/**
 * `react-native-fast-chart/testing`: deterministic fixtures, benchmark
 * scenes and the `testID`s the chart renders (for RNTL / Detox / Maestro).
 * Not needed in production bundles.
 */
export {
  generateCandles,
  MAX_GENERATED_CANDLES,
  type GenerateCandlesOptions,
} from './fixtures/generateCandles';
export { createSeededRandom } from './fixtures/random';
export {
  BENCHMARK_SCENARIOS,
  type BenchmarkIndicatorSpec,
  type BenchmarkScenario,
  type BenchmarkSceneId,
} from '../performance/BenchmarkScenarios';
export { GESTURE_TEST_IDS } from '../interaction/useChartGestures';
export { CROSSHAIR_TEST_IDS } from '../interaction/useCrosshairGesture';
export { PANE_RESIZE_TEST_ID } from '../interaction/usePaneResizeGesture';
export { CHART_ERROR_FALLBACK_TEST_ID } from '../components/ChartErrorBoundary';
export { TRADING_GESTURE_TEST_IDS } from '../interaction/useTradingGestures';
