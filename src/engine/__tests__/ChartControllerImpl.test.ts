/**
 * Test perspective table — ChartControllerImpl
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                   |
 * |------|----------------------------------------------------|--------------------|--------------------------------------------|
 * | CC1  | createTradingChartController() / (null)            | Boundary (empty)   | empty store, defaults, metrics disabled    |
 * | CC2  | config seeds viewport + profiling                  | Equivalence        | spacing 12, metrics enabled                |
 * | CC3  | setData with an invalid row                        | Invalid            | issue { index, reason }, row dropped       |
 * | CC4  | appendBar valid / older / NaN                      | Equiv. / invalid   | true / false / false                       |
 * | CC5  | updateLastBar same time / other time               | Equiv. / invalid   | true / false                               |
 * | CC6  | prependBars overlapping history                    | Equivalence        | merged, sorted, deduped                    |
 * | CC7  | scrollToRealtime default (animated) / false        | Equivalence        | reaches realtime offset                    |
 * | CC8  | resetZoom                                          | Equivalence        | spacing + offset restored                  |
 * | CC9  | setVisibleRange(900, 999, false) / invalid range   | Equiv. / invalid   | spacing 4 / unchanged                      |
 * | CC9b | setVisibleRange default (animated)                 | Equivalence        | reaches spacing 4 after the animation      |
 * | CC10 | configure: options updated; profiling toggled/same | Equivalence        | new metrics only when profiling changes    |
 * | CC11 | isAtRealtime                                       | Equivalence        | the state's shared value                   |
 * | CC12 | useTradingChartController across re-renders        | Equivalence        | stable handle                              |
 * | CC13 | add / update / remove / set / get indicators       | Equivalence        | delegated to the indicator engine          |
 * | CC14 | addIndicator unknown type                          | Invalid            | throws, nothing added                      |
 * | CC15 | indicator flush with profiling on                  | Equivalence        | `indicator` metrics channel records        |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { resolveChartConfig } from '../../core/ChartConfig';
import type { Candle } from '../../data/Candle';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  asInternals,
  createTradingChartController,
  useTradingChartController,
} from '../ChartControllerImpl';

beforeEach(() => {
  jest.useFakeTimers();
});

const bar = (time: number, close = 10): Candle => ({
  time,
  open: 10,
  high: 12,
  low: 9,
  close,
  volume: 1,
});

/** Controller with 1000 bars mirrored to the UI state, plot 400 dp. */
function loaded() {
  const handle = asInternals(createTradingChartController());
  handle.setData(generateCandles({ count: 1000, seed: 2 }));
  handle.state.series.value = createUiCandleSeries(handle.store.columns);
  handle.state.plotWidth.value = 400;
  return handle;
}

describe('createTradingChartController', () => {
  it.each([undefined, null])('CC1: creates defaults for %p', (config) => {
    // Given / When
    const handle = asInternals(createTradingChartController(config));
    // Then
    expect(handle.store.length).toBe(0);
    expect(handle.state.barSpacing.value).toBe(8);
    expect(handle.state.rightOffset.value).toBe(5);
    expect(handle.metrics.enabled).toBe(false);
    expect(handle.options.realtimeRightOffset).toBe(5);
  });

  it('CC2: seeds the viewport and profiling from config', () => {
    // Given / When
    const handle = createTradingChartController({
      viewport: { initialBarSpacing: 12 },
      debug: { profiling: true },
    });
    // Then
    expect(handle.state.barSpacing.value).toBe(12);
    expect(handle.metrics.enabled).toBe(true);
  });
});

describe('data methods', () => {
  it('CC3: reports invalid rows from setData', () => {
    // Given
    const handle = createTradingChartController();
    // When
    const issues = handle.setData([bar(1), { ...bar(2), high: 1 }, bar(3)]);
    // Then
    expect(issues).toEqual([{ index: 1, reason: 'HIGH_BELOW_BODY' }]);
    expect(handle.store.length).toBe(2);
  });

  it.each([
    ['newer bar', bar(10), true],
    ['older bar', bar(1), false],
    ['NaN close', bar(10, NaN), false],
  ])('CC4: appendBar(%s) → %p', (_label, candle, ok) => {
    // Given
    const handle = createTradingChartController();
    handle.setData([bar(5)]);
    // When / Then
    expect(handle.appendBar(candle)).toBe(ok);
    expect(handle.store.length).toBe(ok ? 2 : 1);
  });

  it.each([
    ['same time', 5, true],
    ['other time', 6, false],
  ])('CC5: updateLastBar(%s) → %p', (_label, time, ok) => {
    // Given
    const handle = createTradingChartController();
    handle.setData([bar(5)]);
    // When / Then
    expect(handle.updateLastBar(bar(time, 11))).toBe(ok);
    expect(handle.store.get(0)!.close).toBe(ok ? 11 : 10);
  });

  it('CC6: merges prepended history', () => {
    // Given
    const handle = createTradingChartController();
    handle.setData([bar(5), bar(6)]);
    // When
    handle.prependBars([bar(3), bar(4), bar(5)]);
    // Then
    expect(
      handle.store.getRange(0, handle.store.length).map((c) => c.time)
    ).toEqual([3, 4, 5, 6]);
  });
});

describe('viewport methods', () => {
  it.each([undefined, false])(
    'CC7: scrollToRealtime(animated = %p)',
    (animated) => {
      // Given
      const handle = loaded();
      handle.state.rightOffset.value = -300;
      // When
      handle.scrollToRealtime(animated);
      jest.advanceTimersByTime(1000);
      // Then
      expect(handle.state.rightOffset.value).toBeCloseTo(5, 6);
    }
  );

  it('CC8: resetZoom restores the initial viewport', () => {
    // Given
    const handle = loaded();
    handle.state.barSpacing.value = 30;
    handle.state.rightOffset.value = -300;
    // When
    handle.resetZoom();
    jest.advanceTimersByTime(1000);
    // Then
    expect(handle.state.barSpacing.value).toBeCloseTo(8, 6);
    expect(handle.state.rightOffset.value).toBeCloseTo(5, 6);
  });

  it.each([
    [900, 999, 4],
    [10, 5, 8],
    [NaN, 5, 8],
  ])('CC9: setVisibleRange(%p, %p) → spacing %p', (from, to, spacing) => {
    // Given
    const handle = loaded();
    // When
    handle.setVisibleRange(from, to, false);
    jest.advanceTimersByTime(20);
    // Then
    expect(handle.state.barSpacing.value).toBe(spacing);
  });

  it('CC9b: animates setVisibleRange by default', () => {
    // Given
    const handle = loaded();
    // When
    handle.setVisibleRange(900, 999);
    jest.advanceTimersByTime(20);
    const mid = handle.state.barSpacing.value;
    jest.advanceTimersByTime(1000);
    // Then
    expect(mid).toBeGreaterThan(4);
    expect(handle.state.barSpacing.value).toBeCloseTo(4, 6);
  });

  it('CC11: exposes the realtime flag shared value', () => {
    // Given / When
    const handle = createTradingChartController();
    // Then
    expect(handle.isAtRealtime).toBe(handle.state.isAtRealtime);
    expect(handle.isAtRealtime.value).toBe(true);
  });
});

describe('configure', () => {
  it('CC10: updates options; replaces metrics only on a profiling change', () => {
    // Given
    const handle = asInternals(createTradingChartController());
    const metrics = handle.metrics;
    // When
    handle.configure(resolveChartConfig({ layout: { rightOffsetBars: 9 } }));
    const kept = handle.metrics;
    const offset = handle.options.realtimeRightOffset;
    handle.configure(resolveChartConfig({ debug: { profiling: true } }));
    // Then
    expect(offset).toBe(9);
    expect(handle.options.realtimeRightOffset).toBe(5);
    expect(kept).toBe(metrics);
    expect(handle.metrics).not.toBe(metrics);
    expect(handle.metrics.enabled).toBe(true);
  });
});

describe('useTradingChartController', () => {
  it('CC12: returns a stable handle', () => {
    // Given
    const { result, rerender } = renderHook(() => useTradingChartController());
    const first = result.current;
    // When
    rerender({});
    // Then
    expect(result.current).toBe(first);
  });
});

describe('indicator API', () => {
  it('CC13: delegates to the engine', () => {
    // Given
    const handle = loaded();
    // When
    const id = handle.addIndicator({ type: 'ema', config: { period: 20 } });
    handle.updateIndicator(id, { config: { period: 30 } });
    handle.setIndicators([
      { type: 'ema', id, config: { period: 30 } },
      { type: 'sma', id: 's' },
    ]);
    // Then
    expect(handle.getIndicators().map((e) => e.label)).toEqual([
      'EMA 30',
      'SMA 9',
    ]);
    expect(handle.removeIndicator('s')).toBe(true);
    expect(handle.removeIndicator('s')).toBe(false);
    handle.indicators.flush();
    expect(handle.indicators.getResult(id)?.length).toBe(1000);
  });

  it('CC14: unknown type throws', () => {
    // Given
    const handle = loaded();
    // When / Then
    expect(() => handle.addIndicator({ type: 'macd?' })).toThrow(
      'Unknown indicator type "macd?"'
    );
    expect(handle.getIndicators()).toEqual([]);
  });

  it('CC15: records the indicator metrics channel', () => {
    // Given
    const handle = asInternals(
      createTradingChartController({ debug: { profiling: true } })
    );
    handle.setData(generateCandles({ count: 100, seed: 2 }));
    handle.addIndicator({ type: 'ema' });
    // When
    handle.indicators.flush();
    // Then
    expect(handle.metrics.snapshot().channels.indicator.count).toBe(1);
  });
});
