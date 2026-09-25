/**
 * Test perspective table — TradingChart (Skia mocked, see jest/mocks;
 * real Reanimated + RNGH jest utils, fake timers)
 *
 * Layout 464 × 324 dp → plot 400 × 300 (gutters 64 / 24).
 *
 * | Case | Input / Precondition                        | Perspective      | Expected                                  |
 * |------|---------------------------------------------|------------------|-------------------------------------------|
 * | TC1  | no props                                    | Boundary (empty) | dark background, no bars                  |
 * | TC2  | light theme                                 | Equivalence      | light background                          |
 * | TC3  | themeOverride.background                    | Equivalence      | override wins over theme                  |
 * | TC4  | style + testID                              | Equivalence      | forwarded, flex kept                      |
 * | TC5  | 1000 candles + layout                       | Equivalence      | plot size, 5 paths, bars drawn            |
 * | TC6  | grid.visible false                          | Equivalence      | 4 paths (no grid)                         |
 * | TC7  | new candles array                           | Equivalence      | store replaced                            |
 * | TC8  | controller prop + ref                       | Equivalence      | ref receives that controller              |
 * | TC9  | controller.appendBar after mount            | Equivalence      | series patched on UI state                |
 * | TC10 | unmount then append                         | Equivalence      | UI state no longer synced                 |
 * | TC12 | same layout reported twice                  | Boundary         | no extra React render                     |
 * | TC13 | debug.profiling turned on after mount       | Equivalence      | frames land in the new metrics instance   |
 * | TC11 | config change (by value / same value)       | Equivalence      | options updated / no re-resolve           |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { createRef } from 'react';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  asInternals,
  createTradingChartController,
  type TradingChartHandle,
} from '../../engine/ChartControllerImpl';
import { defaultDarkTheme } from '../../theme/defaultDarkTheme';
import { defaultLightTheme } from '../../theme/defaultLightTheme';
import { TradingChart } from '../TradingChart';

beforeEach(() => {
  jest.useFakeTimers();
});

const CANDLES = generateCandles({ count: 1000, seed: 4 });

const fillColor = (root: ReturnType<typeof render>) =>
  root.UNSAFE_root.findByType('SkiaFill' as never).props.color;

function tick(ms = 50) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

async function mounted(
  props: Parameters<typeof TradingChart>[0] = {},
  controller = createTradingChartController()
) {
  const view = await render(
    <TradingChart testID="chart" controller={controller} {...props} />
  );
  fireEvent(view.getByTestId('chart'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 324 } },
  });
  tick();
  return { view, handle: asInternals(controller) };
}

describe('TradingChart', () => {
  it('TC1: renders the dark background by default', async () => {
    // Given / When
    const view = await render(<TradingChart />);
    // Then
    expect(fillColor(view)).toBe(defaultDarkTheme.background);
  });

  it('TC2: renders the given theme background', async () => {
    // Given / When
    const view = await render(<TradingChart theme={defaultLightTheme} />);
    // Then
    expect(fillColor(view)).toBe(defaultLightTheme.background);
  });

  it('TC3: applies themeOverride on top of theme', async () => {
    // Given / When
    const view = await render(
      <TradingChart
        theme={defaultLightTheme}
        themeOverride={{ background: '#123456' }}
      />
    );
    // Then
    expect(fillColor(view)).toBe('#123456');
  });

  it('TC4: forwards style and testID to the canvas', async () => {
    // Given / When
    const view = await render(
      <TradingChart testID="chart" style={{ height: 300 }} />
    );
    // Then
    expect(view.getByTestId('chart')).toHaveStyle({ flex: 1, height: 300 });
  });

  it('TC5: lays out the plot and draws the visible candles', async () => {
    // Given / When
    const { view, handle } = await mounted({ candles: CANDLES });
    // Then
    const { state } = handle;
    expect([state.plotWidth.value, state.plotHeight.value]).toEqual([400, 300]);
    expect(state.series.value.length).toBe(1000);
    expect(Number.isFinite(state.priceMin.value)).toBe(true);
    const paths = view.UNSAFE_root.findAllByType('SkiaPath' as never);
    expect(paths).toHaveLength(5);
    const wickRects = paths
      .slice(1, 3)
      .reduce(
        (n, p) => n + (p.props.path.value as { rects: unknown[] }).rects.length,
        0
      );
    expect(wickRects).toBeGreaterThan(40);
  });

  it('TC6: omits the grid path when the grid is hidden', async () => {
    // Given
    const theme = {
      ...defaultDarkTheme,
      grid: { ...defaultDarkTheme.grid, visible: false },
    };
    // When
    const view = await render(<TradingChart theme={theme} />);
    // Then
    expect(view.UNSAFE_root.findAllByType('SkiaPath' as never)).toHaveLength(4);
  });

  it('TC7: replaces the data when the candles prop changes', async () => {
    // Given
    const controller = createTradingChartController();
    const { view, handle } = await mounted({ candles: CANDLES }, controller);
    // When
    view.rerender(
      <TradingChart
        testID="chart"
        controller={controller}
        candles={CANDLES.slice(0, 10)}
      />
    );
    tick();
    // Then
    expect(handle.store.length).toBe(10);
    expect(handle.state.series.value.length).toBe(10);
  });

  it('TC8: exposes the controller through the ref', async () => {
    // Given
    const ref = createRef<TradingChartHandle>();
    const controller = createTradingChartController();
    // When
    await render(<TradingChart ref={ref} controller={controller} />);
    // Then
    expect(ref.current).toBe(controller);
  });

  it('TC9: streams appended bars to the UI state', async () => {
    // Given
    const { handle } = await mounted({ candles: CANDLES });
    const last = CANDLES[CANDLES.length - 1]!;
    // When
    const ok = handle.appendBar({ ...last, time: last.time + 60_000 });
    tick();
    // Then
    expect(ok).toBe(true);
    expect(handle.state.series.value.length).toBe(1001);
  });

  it('TC10: stops syncing after unmount', async () => {
    // Given
    const { view, handle } = await mounted({ candles: CANDLES });
    const last = CANDLES[CANDLES.length - 1]!;
    // When
    view.unmount();
    handle.appendBar({ ...last, time: last.time + 60_000 });
    tick();
    // Then
    expect(handle.state.series.value.length).toBe(1000);
  });

  it('TC12: ignores a repeated identical layout', async () => {
    // Given
    const { view, handle } = await mounted({ candles: CANDLES });
    const renders = handle.metrics.snapshot().renderCount;
    // When
    fireEvent(view.getByTestId('chart'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 464, height: 324 } },
    });
    tick();
    // Then
    expect(handle.metrics.snapshot().renderCount).toBe(renders);
  });

  it('TC13: profiles into the metrics created by a profiling toggle', async () => {
    // Given
    const controller = createTradingChartController();
    const { view, handle } = await mounted({ candles: CANDLES }, controller);
    // When
    view.rerender(
      <TradingChart
        testID="chart"
        controller={controller}
        candles={CANDLES}
        config={{ debug: { profiling: true } }}
      />
    );
    tick(2000);
    // Then
    const snap = handle.metrics.snapshot();
    expect(handle.metrics.enabled).toBe(true);
    expect(snap.channels.frame.count).toBeGreaterThan(0);
    expect(snap.fps).toBeGreaterThan(0);
  });

  it('TC11: reconfigures on a config change by value', async () => {
    // Given
    const controller = createTradingChartController();
    const { view, handle } = await mounted(
      { config: { layout: { rightOffsetBars: 3 } } },
      controller
    );
    const options = handle.options;
    // When: same value, new object
    view.rerender(
      <TradingChart
        testID="chart"
        controller={controller}
        config={{ layout: { rightOffsetBars: 3 } }}
      />
    );
    const same = handle.options;
    view.rerender(
      <TradingChart
        testID="chart"
        controller={controller}
        config={{ layout: { rightOffsetBars: 7 } }}
      />
    );
    // Then
    expect(options.realtimeRightOffset).toBe(3);
    expect(same).toBe(options);
    expect(handle.options.realtimeRightOffset).toBe(7);
  });
});
