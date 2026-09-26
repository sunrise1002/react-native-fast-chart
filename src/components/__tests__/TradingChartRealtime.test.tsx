/**
 * Test perspective table — TradingChart P7 props (candles diffing,
 * pagination, realtime status, pulse). Skia mocked, real Reanimated.
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                       |
 * |------|--------------------------------------------------------|--------------------|------------------------------------------------|
 * | TR1  | candles prop + 1 bar while scrolled back               | Equivalence        | incremental append, view holds, no reset       |
 * | TR2  | candles prop, same array re-rendered                   | Boundary           | store untouched                                |
 * | TR3  | candles prop with another dataset                      | Equivalence        | reset, viewport back to realtime               |
 * | TR4  | 100 controller ticks                                   | Equivalence        | zero React commits                             |
 * | TR5  | scrolled to the left edge with onLoadMore (pending)    | Equivalence        | one call, loading slot shown                   |
 * | TR6  | page resolves                                          | Equivalence        | bars prepended, slot hidden                    |
 * | TR7  | handler returns [] (no more history)                   | Boundary (empty)   | exhausted, no further calls                    |
 * | TR8  | handler throws                                         | Exception          | error state, slot hidden                       |
 * | TR9  | no onLoadMore, at the left edge                        | Boundary (NULL)    | no request                                     |
 * | TR10 | far from the left edge                                 | Boundary           | no request                                     |
 * | TR11 | loading without historyLoadingIndicator                | Boundary (NULL)    | no slot rendered                               |
 * | TR12 | realtimeStatus prop / undefined                        | Equivalence        | forwarded / untouched                          |
 * | TR13 | realtime.lastPricePulse on / off                       | Equivalence        | circle node mounted / absent                   |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Profiler } from 'react';
import { Text } from 'react-native';
import type { Candle } from '../../data/Candle';
import {
  asInternals,
  createTradingChartController,
} from '../../engine/ChartControllerImpl';
import type { LoadMoreHandler } from '../../history/HistoryLoader';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { TradingChart } from '../TradingChart';
import type { TradingChartProps } from '../TradingChartProps';

beforeEach(() => {
  jest.useFakeTimers();
});

const CANDLES = generateCandles({ count: 1000, seed: 6 });

function tick(ms = 50) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mounted(props: TradingChartProps = {}) {
  const controller = createTradingChartController();
  const onRender = jest.fn();
  const element = (p: TradingChartProps) => (
    <Profiler id="chart" onRender={onRender}>
      <TradingChart testID="chart" controller={controller} {...p} />
    </Profiler>
  );
  const view = await render(element(props));
  fireEvent(view.getByTestId('chart'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 324 } },
  });
  tick();
  const handle = asInternals(controller);
  const rerender = async (p: TradingChartProps) => {
    await view.rerender(element(p));
    tick();
  };
  const scrollTo = (rightOffset: number) => {
    act(() => {
      handle.state.rightOffset.value = rightOffset;
    });
    tick();
  };
  return { view, handle, onRender, rerender, scrollTo };
}

/** Right offset that puts bar 0 at the plot's left edge. */
const leftEdgeOffset = (h: ReturnType<typeof asInternals>) =>
  h.state.plotWidth.value / h.state.barSpacing.value - h.store.length;

const next = (c: Candle): Candle => ({ ...c, time: c.time + 60_000 });

describe('candles prop diffing', () => {
  it('TR1: appends incrementally and holds a scrolled-back view', async () => {
    // Given
    const { handle, rerender, scrollTo } = await mounted({ candles: CANDLES });
    scrollTo(-300);
    const kinds: string[] = [];
    handle.store.subscribe((c) => {
      kinds.push(c.kind);
    });
    // When
    await rerender({ candles: [...CANDLES, next(CANDLES[999]!)] });
    // Then
    expect(kinds).toEqual(['append']);
    expect(handle.state.series.value.length).toBe(1001);
    expect(handle.state.rightOffset.value).toBe(-301);
  });

  it('TR2: the same array is a no-op', async () => {
    // Given
    const { handle, rerender } = await mounted({ candles: CANDLES });
    const version = handle.store.version;
    // When
    await rerender({ candles: CANDLES, realtimeStatus: 'live' });
    // Then
    expect(handle.store.version).toBe(version);
  });

  it('TR3: another dataset resets the viewport', async () => {
    // Given
    const { handle, rerender, scrollTo } = await mounted({ candles: CANDLES });
    scrollTo(-300);
    // When
    await rerender({ candles: CANDLES.slice(0, 300) });
    // Then
    expect(handle.store.length).toBe(300);
    expect(handle.state.rightOffset.value).toBe(
      handle.options.realtimeRightOffset
    );
  });

  it('TR4: controller ticks never re-render React', async () => {
    // Given
    const { handle, onRender } = await mounted({ candles: CANDLES });
    const commits = onRender.mock.calls.length;
    // When
    for (let i = 0; i < 100; i++) {
      const last = handle.getLastBar()!;
      handle.upsertBar(
        i % 10 === 9 ? next(last) : { ...last, volume: last.volume + 1 }
      );
      tick(16);
    }
    // Then
    expect(onRender.mock.calls.length).toBe(commits);
    expect(handle.state.series.value.length).toBe(1010);
  });
});

describe('history pagination', () => {
  const spinner = <Text testID="history-loading">loading</Text>;

  it('TR5/TR6: loads once at the left edge and prepends in place', async () => {
    // Given
    let resolve!: (rows: Candle[]) => void;
    const onLoadMore = jest.fn<LoadMoreHandler>(
      () => new Promise<Candle[]>((r) => (resolve = r))
    );
    const { view, handle, scrollTo } = await mounted({
      candles: CANDLES.slice(500),
      onLoadMore,
      historyLoadingIndicator: spinner,
    });
    expect(onLoadMore).not.toHaveBeenCalled();
    // When
    scrollTo(leftEdgeOffset(handle));
    scrollTo(leftEdgeOffset(handle) + 1);
    // Then
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onLoadMore).toHaveBeenCalledWith({
      before: CANDLES[500]!.time,
      barCount: 500,
    });
    expect(view.queryByTestId('history-loading')).not.toBeNull();
    // When: the page arrives
    const offset = handle.state.rightOffset.value;
    resolve(CANDLES.slice(0, 500));
    await flushPromises();
    tick();
    // Then
    expect(handle.store.length).toBe(1000);
    expect(handle.state.series.value.length).toBe(1000);
    expect(handle.state.rightOffset.value).toBe(offset);
    expect(view.queryByTestId('history-loading')).toBeNull();
  });

  it('TR7: an empty page stops pagination', async () => {
    // Given
    const onLoadMore = jest.fn<LoadMoreHandler>(() => []);
    const { handle, scrollTo } = await mounted({
      candles: CANDLES.slice(900),
      onLoadMore,
    });
    // When
    scrollTo(leftEdgeOffset(handle));
    handle.appendBar(next(handle.getLastBar()!));
    tick();
    // Then
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(handle.getHistoryState()).toBe('exhausted');
  });

  it('TR8: a failing handler ends in the error state', async () => {
    // Given
    const onLoadMore = jest.fn<LoadMoreHandler>(() => {
      throw new Error('503');
    });
    const { view, handle, scrollTo } = await mounted({
      candles: CANDLES.slice(900),
      onLoadMore,
      historyLoadingIndicator: spinner,
    });
    // When
    scrollTo(leftEdgeOffset(handle));
    // Then
    expect(handle.getHistoryState()).toBe('error');
    expect((handle.history.getError() as Error).message).toBe('503');
    expect(view.queryByTestId('history-loading')).toBeNull();
  });

  it('TR9: nothing happens without onLoadMore', async () => {
    // Given
    const { handle, scrollTo } = await mounted({ candles: CANDLES.slice(900) });
    // When
    scrollTo(leftEdgeOffset(handle));
    // Then
    expect(handle.getHistoryState()).toBe('idle');
  });

  it('TR10: no request far from the left edge', async () => {
    // Given
    const onLoadMore = jest.fn<LoadMoreHandler>(() => []);
    const { scrollTo } = await mounted({ candles: CANDLES, onLoadMore });
    // When
    scrollTo(-100);
    // Then
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('TR11: no slot without an indicator', async () => {
    // Given
    const onLoadMore = jest.fn<LoadMoreHandler>(
      () => new Promise<Candle[]>(() => {})
    );
    const { view, handle, scrollTo } = await mounted({
      candles: CANDLES.slice(900),
      onLoadMore,
    });
    // When
    scrollTo(leftEdgeOffset(handle));
    // Then
    expect(handle.getHistoryState()).toBe('loading');
    expect(view.queryByTestId('history-loading')).toBeNull();
  });
});

describe('realtime props', () => {
  it('TR12: forwards realtimeStatus', async () => {
    // Given
    const { handle, rerender } = await mounted({ realtimeStatus: 'live' });
    expect(handle.getRealtimeStatus()).toBe('live');
    // When
    handle.setRealtimeStatus('delayed');
    await rerender({});
    // Then
    expect(handle.getRealtimeStatus()).toBe('delayed');
    await rerender({ realtimeStatus: 'reconnecting' });
    expect(handle.getRealtimeStatus()).toBe('reconnecting');
  });

  it.each([
    [true, 1],
    [false, 0],
  ])('TR13: lastPricePulse %p → %p circle', async (pulse, count) => {
    // Given / When
    const { view } = await mounted({
      candles: CANDLES,
      config: { realtime: { lastPricePulse: pulse } },
    });
    // Then
    expect(view.UNSAFE_root.findAllByType('SkiaCircle' as never)).toHaveLength(
      count
    );
  });
});
