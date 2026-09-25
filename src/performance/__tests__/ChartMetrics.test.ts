/**
 * Test perspective table — ChartMetrics & BenchmarkScenarios
 *
 * | Case | Input / Precondition                  | Perspective      | Expected                                 |
 * |------|---------------------------------------|------------------|------------------------------------------|
 * | M1   | disabled (default)                    | Zero-cost        | noop channels, fps 0, empty stats        |
 * | M2   | enabled, frames every 16 ms           | Equivalence      | frame avg 16, fps 62.5                   |
 * | M3   | first frame only                      | Boundary (1)     | no interval recorded, fps 0              |
 * | M4   | markFrame without timestamp           | Equivalence      | uses injected clock                      |
 * | M5   | markFrame(NaN / Infinity)             | Invalid          | ignored, does not break interval chain   |
 * | M6   | channel timing via begin/end          | Equivalence      | recorded only in that channel            |
 * | M7   | reset                                 | State            | all channels empty, frame chain restarts |
 * | M8   | invalid capacity                      | Abnormal         | RangeError                               |
 * | M9   | countRender ×3, disabled; then reset  | Equivalence / 0  | renderCount 3, then 0                    |
 * | B1   | scenes A–D                            | Spec conformance | counts/indicators match spec §28         |
 */
import { describe, expect, it } from '@jest/globals';
import { BENCHMARK_SCENARIOS } from '../BenchmarkScenarios';
import { createChartMetrics, METRIC_CHANNELS } from '../ChartMetrics';
import { EMPTY_TIMING_STATS, NOOP_PROFILER } from '../RenderProfiler';

describe('createChartMetrics', () => {
  it('M1: disabled metrics are no-ops', () => {
    // Given
    const metrics = createChartMetrics();
    // When
    metrics.markFrame(0);
    metrics.markFrame(16);
    const snapshot = metrics.snapshot();
    // Then
    expect(metrics.enabled).toBe(false);
    expect(metrics.channel('render')).toBe(NOOP_PROFILER);
    expect(snapshot.fps).toBe(0);
    for (const name of METRIC_CHANNELS) {
      expect(snapshot.channels[name]).toEqual(EMPTY_TIMING_STATS);
    }
  });

  it('M2: derives fps from frame intervals', () => {
    // Given
    const metrics = createChartMetrics({ enabled: true });
    // When
    [0, 16, 32, 48].forEach((t) => metrics.markFrame(t));
    const snapshot = metrics.snapshot();
    // Then
    expect(snapshot.channels.frame).toMatchObject({ count: 3, avg: 16 });
    expect(snapshot.fps).toBe(62.5);
  });

  it('M3: a single frame records no interval', () => {
    // Given
    const metrics = createChartMetrics({ enabled: true });
    // When
    metrics.markFrame(100);
    // Then
    expect(metrics.snapshot()).toMatchObject({ fps: 0 });
    expect(metrics.snapshot().channels.frame.count).toBe(0);
  });

  it('M4: uses the clock when no timestamp is given', () => {
    // Given
    const times = [1000, 1020];
    const metrics = createChartMetrics({
      enabled: true,
      clock: () => times.shift() ?? 0,
    });
    // When
    metrics.markFrame();
    metrics.markFrame();
    // Then
    expect(metrics.snapshot().channels.frame.last).toBe(20);
  });

  it.each([Number.NaN, Infinity])('M5: ignores frame timestamp %p', (bad) => {
    // Given
    const metrics = createChartMetrics({ enabled: true });
    // When
    metrics.markFrame(0);
    metrics.markFrame(bad);
    metrics.markFrame(10);
    // Then
    expect(metrics.snapshot().channels.frame).toMatchObject({
      count: 1,
      last: 10,
    });
  });

  it('M6: channels record independently', () => {
    // Given
    const times = [5, 12];
    const metrics = createChartMetrics({
      enabled: true,
      clock: () => times.shift() ?? 0,
    });
    // When
    const render = metrics.channel('render');
    render.end(render.begin());
    const snapshot = metrics.snapshot();
    // Then
    expect(snapshot.channels.render.last).toBe(7);
    expect(snapshot.channels.indicator.count).toBe(0);
  });

  it('M7: reset clears channels and restarts the frame chain', () => {
    // Given
    const metrics = createChartMetrics({ enabled: true });
    [0, 16].forEach((t) => metrics.markFrame(t));
    metrics.channel('data').record(3);
    // When
    metrics.reset();
    metrics.markFrame(1000);
    // Then
    const snapshot = metrics.snapshot();
    expect(snapshot.channels.frame.count).toBe(0);
    expect(snapshot.channels.data.count).toBe(0);
  });

  it('M9: counts renders even when disabled; reset clears them', () => {
    // Given
    const metrics = createChartMetrics();
    expect(metrics.snapshot().renderCount).toBe(0);
    // When
    [1, 2, 3].forEach(() => metrics.countRender());
    const counted = metrics.snapshot().renderCount;
    metrics.reset();
    // Then
    expect(counted).toBe(3);
    expect(metrics.snapshot().renderCount).toBe(0);
  });

  it('M8: rejects an invalid capacity', () => {
    // Given / When / Then
    expect(() => createChartMetrics({ enabled: true, capacity: 0 })).toThrow(
      RangeError
    );
  });
});

describe('BENCHMARK_SCENARIOS', () => {
  it('B1: matches spec §28 scenes', () => {
    // Given
    const { A, B, C, D } = BENCHMARK_SCENARIOS;
    // When / Then
    expect(Object.isFrozen(BENCHMARK_SCENARIOS)).toBe(true);
    expect([A.storedCandles, A.indicators.length]).toEqual([500, 0]);
    expect([B.storedCandles, B.visibleCandles]).toEqual([5_000, 150]);
    expect(B.indicators.map((i) => i.config.period)).toEqual([20, 50]);
    expect(C.storedCandles).toBe(20_000);
    expect(C.indicators.map((i) => i.type)).toEqual([
      'bollinger',
      'volume',
      'macd',
      'rsi',
    ]);
    expect([D.realtimeUpdatesPerSecond, D.panning]).toEqual([20, true]);
  });
});
