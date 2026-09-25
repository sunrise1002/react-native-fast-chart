/**
 * Test perspective table — public entry points
 *
 * | Case | Input / Precondition     | Perspective | Expected                                 |
 * |------|--------------------------|-------------|------------------------------------------|
 * | E1   | main entry runtime values| API surface | all public runtime exports defined       |
 * | E2   | testing entry            | API surface | fixture generator exported               |
 */
import { describe, expect, it } from '@jest/globals';
import * as api from '../index';
import * as testing from '../testing';

describe('public API', () => {
  it('E1: exposes the runtime exports of the main entry', () => {
    // Given / When
    const names = Object.keys(api).sort();
    // Then
    expect(names).toEqual(
      [
        'BENCHMARK_SCENARIOS',
        'DEFAULT_CHART_CONFIG',
        'METRIC_CHANNELS',
        'NOOP_PROFILER',
        'PRICE_PANE_ID',
        'TradingChart',
        'createChartMetrics',
        'createRenderProfiler',
        'defaultClock',
        'defaultDarkTheme',
        'defaultLightTheme',
        'getCandleIssue',
        'isValidCandle',
        'mergeTheme',
        'normalizeCandles',
        'resolveChartConfig',
        'validateCandles',
        'CandleStore',
        'mergeCandles',
        'getBucketStart',
        'getNextBucketStart',
        'parseTimeframe',
        'timeframeToMs',
        'RealtimeBarAggregator',
        'barSpacingForRange',
        'candleBodyWidth',
        'clampBarSpacing',
        'clampRightOffset',
        'elasticRightOffset',
        'indexToX',
        'isLastBarVisible',
        'maxRightOffset',
        'minRightOffset',
        'panRightOffset',
        'rightEdgeIndex',
        'rightOffsetForRange',
        'visibleBarCount',
        'xToIndex',
        'xToNearestIndex',
        'zoomRightOffset',
        'DEFAULT_OVERSCAN_BARS',
        'getVisibleLogicalRange',
        'getVisibleRange',
        'createPriceScale',
        'DEFAULT_PRICE_PADDING',
        'DEGENERATE_RANGE_RATIO',
        'FALLBACK_PRICE_RANGE',
        'MAX_ABS_PRICE',
        'normalizePriceRange',
        'priceToY',
        'yToPrice',
        'candleRangeMinMax',
        'rangeMinMax',
        'getBarValuesIssue',
        // P3
        'createTradingChartController',
        'useTradingChartController',
        'composeChartGestures',
        'DOUBLE_TAP_MAX_DELAY_MS',
        'GESTURE_TEST_IDS',
        'PAN_ACTIVATION_DP',
        'createRectList',
        'pushRect',
        'buildCandleGeometry',
        'computeCandleMetrics',
        'createCandleMetrics',
        'MIN_BODY_OVER_WICK_PX',
        'batchSink',
        'createCandleGeometryBatch',
        'fillCandleGeometryBatch',
        'buildGridGeometry',
        'DEFAULT_GRID_OPTIONS',
        'lineWidthPx',
        'sanitizePixelRatio',
        'snapToPixel',
        'computeAutoScaleTarget',
        'priceRangeChanged',
        'PRICE_TARGET_EPSILON',
        'shouldSnapPriceRange',
        // P4
        'CROSSHAIR_TEST_IDS',
        'STICKY_DRAG_SLOP_DP',
        'LAST_PRICE_PINNED_BOTTOM',
        'LAST_PRICE_PINNED_NONE',
        'LAST_PRICE_PINNED_TOP',
        'MAX_PRICE_DECIMALS',
        'OHLC_STYLE_CAPTION',
        'OHLC_STYLE_DOWN',
        'OHLC_STYLE_UP',
        'PRICE_LABEL_STYLE',
        'TIME_LABEL_STYLE',
        'TICK_WEIGHT_DAY',
        'TICK_WEIGHT_MONTH',
        'TICK_WEIGHT_TIME',
        'TICK_WEIGHT_YEAR',
        'autoPriceDecimals',
        'centeredBaseline',
        'clampSpan',
        'computeCrosshair',
        'computeLastPriceMarker',
        'createCrosshairFrame',
        'createLastPriceMarker',
        'createOffsetResolver',
        'createPriceTicks',
        'createTimeTicks',
        'displayDecimals',
        'estimateBarInterval',
        'formatClock',
        'formatDateTime',
        'formatPercent',
        'formatPrice',
        'formatSignedPrice',
        'formatTimeTick',
        'formatVolume',
        'generatePriceTicks',
        'generateTimeTicks',
        'layoutOhlcHeader',
        'layoutPriceAxisLabels',
        'layoutTimeAxisLabels',
        'nearestBarIndex',
        'nextAxisWidth',
        'nicePriceTickStep',
        'offsetAt',
        'priceTickStep',
        'priceTickTargetCount',
        'rangesOverlap',
        'requiredAxisWidth',
        'selectTimeInterval',
        'stepDecimals',
        'thinTicksBySpacing',
        'timeIntervalMs',
      ].sort()
    );
  });

  it('E2: exposes fixtures from the testing entry', () => {
    // Given / When / Then
    expect(typeof testing.generateCandles).toBe('function');
    expect(typeof testing.createSeededRandom).toBe('function');
    expect(testing.MAX_GENERATED_CANDLES).toBeGreaterThan(100_000);
  });
});
