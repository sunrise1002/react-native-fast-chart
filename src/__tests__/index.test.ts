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
