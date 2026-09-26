/**
 * Test perspective table — memory release (spec Phase 20.3)
 *
 * Subscriptions are counted by wrapping every `subscribe*` method of the
 * controller's internals (store, indicator engine, panes, history, error
 * channel): "active" = subscribed and not yet unsubscribed.
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                    |
 * |------|----------------------------------------------------------|--------------------|---------------------------------------------|
 * | ML1  | mount → unmount, 5 cycles (indicators, onError, candles) | Equivalence        | active subscriptions back to baseline       |
 * | ML2  | symbol switch ×10 via the candles prop                   | Equivalence        | subscriptions constant, only new data kept  |
 * | ML3  | timeframe switch ×10 via setData                         | Equivalence        | indicator results sized to the new dataset  |
 * | ML4  | add / remove 3 indicators ×20                            | Equivalence        | engine, UI series, pyramids, panes released |
 * | ML5  | controller.dispose()                                     | Equivalence        | error / history listeners cleared           |
 * | ML6  | unmount after a render error (fallback shown)            | Abnormal           | no subscriptions leaked                     |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  asInternals,
  createTradingChartController,
  type ChartControllerInternals,
} from '../../engine/createTradingChartController';
import type { IndicatorInput } from '../../indicators/Indicator';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { TradingChart } from '../TradingChart';

const MIN = 60_000;
const DAY = 86_400_000;
const BTC = generateCandles({ count: 400, seed: 1, intervalMs: MIN });
const INDICATORS: IndicatorInput[] = [
  { type: 'ema', id: 'ema' },
  { type: 'rsi', id: 'rsi' },
  { type: 'macd', id: 'macd' },
];

beforeEach(() => {
  jest.useFakeTimers();
});

function tick(ms = 50) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

type Unsubscribe = () => void;
type Subscribable = Record<string, unknown>;

/** Wraps `subscribe*` methods; returns the live subscription count. */
function trackSubscriptions(handle: ChartControllerInternals): () => number {
  let active = 0;
  const wrap = (target: object, method: string) => {
    const host = target as Subscribable;
    const original = host[method] as (...args: unknown[]) => Unsubscribe;
    host[method] = (...args: unknown[]) => {
      const off = original.apply(target, args);
      active++;
      let done = false;
      return () => {
        if (!done) {
          done = true;
          active--;
        }
        off();
      };
    };
  };
  wrap(handle.store, 'subscribe');
  wrap(handle.indicators, 'subscribeEntries');
  wrap(handle.indicators, 'subscribeResults');
  wrap(handle.panes, 'subscribe');
  wrap(handle.history, 'subscribe');
  wrap(handle.errors, 'subscribe');
  return () => active;
}

async function mount(
  controller: ReturnType<typeof createTradingChartController>,
  props: Partial<Parameters<typeof TradingChart>[0]> = {}
) {
  const view = await render(
    <TradingChart testID="chart" controller={controller} {...props} />
  );
  const chart = view.queryByTestId('chart');
  if (chart !== null) {
    fireEvent(chart, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 324 } },
    });
  }
  tick();
  return view;
}

describe('memory release', () => {
  it('ML1: mount / unmount cycles return to the baseline', async () => {
    // Given
    const controller = createTradingChartController();
    const handle = asInternals(controller);
    const active = trackSubscriptions(handle);
    const baseline = active();
    // When
    for (let i = 0; i < 5; i++) {
      const view = await mount(controller, {
        candles: BTC,
        indicators: INDICATORS,
        onError: () => {},
        onLoadMore: () => [],
      });
      expect(active()).toBeGreaterThan(baseline);
      view.unmount();
      tick();
    }
    // Then
    expect(active()).toBe(baseline);
    expect(handle.errors.size).toBe(0);
  });

  it('ML2: symbol switches keep subscriptions flat and drop old data', async () => {
    // Given
    const controller = createTradingChartController();
    const handle = asInternals(controller);
    const active = trackSubscriptions(handle);
    const view = await mount(controller, {
      candles: BTC,
      indicators: INDICATORS,
    });
    const mounted = active();
    // When
    let last = BTC;
    for (let i = 0; i < 10; i++) {
      last = generateCandles({
        count: 100 + i,
        seed: 10 + i,
        startTime: i * DAY,
      });
      await view.rerender(
        <TradingChart
          testID="chart"
          controller={controller}
          candles={last}
          indicators={INDICATORS}
        />
      );
      tick();
    }
    // Then
    expect(active()).toBe(mounted);
    expect(handle.getBarCount()).toBe(last.length);
    expect(handle.state.series.value.length).toBe(last.length);
    expect(handle.indicators.getResult('ema')?.length).toBe(last.length);
    view.unmount();
  });

  it('ML3: timeframe switches resize indicator caches', async () => {
    // Given
    const controller = createTradingChartController();
    const handle = asInternals(controller);
    const view = await mount(controller, { indicators: INDICATORS });
    // When
    for (let i = 0; i < 10; i++) {
      const interval = i % 2 === 0 ? DAY : 5 * MIN;
      act(() => {
        controller.setData(
          generateCandles({ count: 50 + i * 10, seed: i, intervalMs: interval })
        );
      });
      tick();
    }
    // Then
    const bars = 50 + 9 * 10;
    expect(handle.getBarCount()).toBe(bars);
    for (const id of ['ema', 'rsi', 'macd']) {
      expect(handle.indicators.getResult(id)?.length).toBe(bars);
    }
    view.unmount();
  });

  it('ML4: indicator add / remove cycles release everything', async () => {
    // Given
    const controller = createTradingChartController();
    const handle = asInternals(controller);
    const active = trackSubscriptions(handle);
    const view = await mount(controller, { candles: BTC });
    const mounted = active();
    const panes = controller.getPanes().length;
    // When
    for (let i = 0; i < 20; i++) {
      let ids: string[] = [];
      act(() => {
        ids = INDICATORS.map((input) => controller.addIndicator(input));
      });
      tick();
      act(() => {
        for (const id of ids) {
          controller.removeIndicator(id);
        }
      });
      tick();
    }
    // Then
    expect(controller.getIndicators()).toEqual([]);
    for (const { id } of INDICATORS) {
      expect(handle.indicators.getResult(id as string)).toBeUndefined();
    }
    expect(Object.keys(handle.state.indicators.value.series)).toEqual([]);
    expect(Object.keys(handle.state.renderCache.value.outputs)).toEqual([]);
    expect(controller.getPanes().length).toBe(panes);
    expect(active()).toBe(mounted);
    view.unmount();
  });

  it('ML5: dispose clears the controller listeners', () => {
    // Given
    const controller = createTradingChartController();
    const handle = asInternals(controller);
    controller.subscribeErrors(() => {});
    const history = jest.fn();
    controller.subscribeHistoryState(history);
    controller.setData(BTC);
    // When
    controller.dispose();
    controller.setHasMoreHistory(false);
    // Then
    expect(handle.errors.size).toBe(0);
    expect(history).not.toHaveBeenCalled();
  });

  it('ML6: unmounting the error fallback leaks nothing', async () => {
    // Given
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const controller = createTradingChartController();
    const active = trackSubscriptions(asInternals(controller));
    const baseline = active();
    // When
    const view = await mount(controller, {
      candles: BTC,
      indicators: [{ type: 'nope' }],
    });
    view.unmount();
    tick();
    // Then
    expect(active()).toBe(baseline);
    error.mockRestore();
  });
});
