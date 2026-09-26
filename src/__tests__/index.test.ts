/**
 * Test perspective table — public entry points (P9 API stabilization)
 *
 * | Case | Input / Precondition        | Perspective | Expected                                        |
 * |------|-----------------------------|-------------|-------------------------------------------------|
 * | E1   | main entry runtime values   | API surface | exactly the curated list (docs/API.md)          |
 * | E2   | testing entry               | API surface | fixtures, benchmark scenes and test IDs          |
 * | E3   | renderer / geometry names   | Abnormal    | not reachable from the main entry               |
 * | E4   | viewport / tick math names  | Abnormal    | not reachable from the main entry               |
 * | E5   | test IDs / benchmark scenes | Abnormal    | moved: absent from the main entry               |
 * | E6   | P9 additions                | Equivalence | callable functions / components                 |
 */
import { describe, expect, it } from '@jest/globals';
import * as api from '../index';
import * as testing from '../testing';

const exported = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(api, name);

describe('public API', () => {
  it('E1: exposes exactly the curated runtime exports', () => {
    // Given / When
    const names = Object.keys(api).sort();
    // Then
    expect(names).toEqual(
      [
        'CHART_SETTINGS_VERSION',
        'ChartErrorBoundary',
        'DEFAULT_CHART_CONFIG',
        'DEFAULT_FRAME_TARGET_MS',
        'IndicatorRegistry',
        'MAX_INDICATOR_PERIOD',
        'MAX_PANE_RATIO',
        'MAX_PRICE_DECIMALS',
        'MIN_PANE_RATIO',
        'MIN_PERFORMANCE_SAMPLE_MS',
        'PRICE_PANE_ID',
        'PRICE_SOURCES',
        'REALTIME_STATUSES',
        'RealtimeBarAggregator',
        'TICK_WEIGHT_DAY',
        'TICK_WEIGHT_MONTH',
        'TICK_WEIGHT_TIME',
        'TICK_WEIGHT_YEAR',
        'TIME_LABEL_CROSSHAIR',
        'TradingChart',
        'allowedPlacements',
        'autoPriceDecimals',
        'createBucketAligner',
        'createChartSettings',
        'createFrameStats',
        'createIndicatorInput',
        'createIndicatorRegistry',
        'createIndicatorResult',
        'createStepIndicator',
        'createTradingChartController',
        'defaultChartSettings',
        'defaultDarkTheme',
        'defaultLightTheme',
        'deserializeChartSettings',
        'ensureResultCapacity',
        'formatClock',
        'formatDateTime',
        'formatIndicatorLabel',
        'formatPercent',
        'formatPrice',
        'formatSignedPrice',
        'formatTimeTick',
        'formatVolume',
        'getBucketStart',
        'getCandleIssue',
        'getNextBucketStart',
        'histogramPolarity',
        'indicatorScale',
        'isFiniteValue',
        'isRealtimeStatus',
        'isSupportedTimeZone',
        'isValidCandle',
        'mergeTheme',
        'normalizeCandles',
        'paramDefaults',
        'parseParamValue',
        'parseTimeframe',
        'periodParam',
        'placementOf',
        'readSource',
        'recordFrameInterval',
        'resetFrameStats',
        'resolveChartConfig',
        'resolveNumberParam',
        'resolveSourceParam',
        'resolveSymbolPrecision',
        'serializeChartSettings',
        'settingsToIndicatorInputs',
        'snapToTickSize',
        'sourceParam',
        'summarizeFrameStats',
        'timeframeToMs',
        'toBandPoints',
        'toHistogramPoints',
        'toLinePoints',
        'toMultiLine',
        'useTradingChartController',
        'validateCandles',
      ].sort()
    );
  });

  it('E2: exposes fixtures, scenes and test IDs from the testing entry', () => {
    // Given / When
    const names = Object.keys(testing).sort();
    // Then
    expect(names).toEqual(
      [
        'BENCHMARK_SCENARIOS',
        'CHART_ERROR_FALLBACK_TEST_ID',
        'CROSSHAIR_TEST_IDS',
        'GESTURE_TEST_IDS',
        'MAX_GENERATED_CANDLES',
        'PANE_RESIZE_TEST_ID',
        'createSeededRandom',
        'generateCandles',
      ].sort()
    );
    expect(testing.MAX_GENERATED_CANDLES).toBeGreaterThan(100_000);
    expect(testing.CHART_ERROR_FALLBACK_TEST_ID).toBe(
      'fast-chart-error-fallback'
    );
  });

  it('E3: hides renderer and geometry internals', () => {
    // Given
    const internals = [
      'buildCandleGeometry',
      'createCandleGeometryBatch',
      'buildGridGeometry',
      'buildHistogramGeometry',
      'computeCrosshair',
      'computeLastPriceMarker',
      'pulseOpacity',
      'snapToPixel',
      'createRectList',
    ];
    // When
    const leaked = internals.filter(exported);
    // Then
    expect(leaked).toEqual([]);
  });

  it('E4: hides viewport, tick and pane-layout math', () => {
    // Given
    const internals = [
      'indexToX',
      'xToIndex',
      'priceToY',
      'createPriceScale',
      'getVisibleRange',
      'computeAutoScaleTarget',
      'createPriceTicks',
      'createTimeTicks',
      'createOffsetResolver',
      'composeChartGestures',
      'applyChartSettings',
      'mergeCandles',
    ];
    // When
    const leaked = internals.filter(exported);
    // Then
    expect(leaked).toEqual([]);
  });

  it('E5: test IDs and benchmark scenes live only in the testing entry', () => {
    // Given
    const moved = [
      'BENCHMARK_SCENARIOS',
      'GESTURE_TEST_IDS',
      'CROSSHAIR_TEST_IDS',
      'PANE_RESIZE_TEST_ID',
      'CHART_ERROR_FALLBACK_TEST_ID',
    ];
    // When
    const leaked = moved.filter(exported);
    // Then
    expect(leaked).toEqual([]);
  });

  it('E6: P9 additions are callable', () => {
    // Given / When / Then
    expect(typeof api.ChartErrorBoundary).toBe('function');
    expect(typeof api.createBucketAligner).toBe('function');
    expect(typeof api.isSupportedTimeZone).toBe('function');
    expect(api.snapToTickSize(1.234, 0.5)).toBe(1);
    expect(api.MIN_PERFORMANCE_SAMPLE_MS).toBe(1000);
  });
});
