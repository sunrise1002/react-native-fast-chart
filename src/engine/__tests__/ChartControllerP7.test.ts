/**
 * Test perspective table — TradingChartController P7 API (spec §21, §25, Phase 14–16)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                      |
 * |------|----------------------------------------------------------|--------------------|-----------------------------------------------|
 * | U1   | upsertBar newer / same time / older existing             | Equivalence        | appended / updated / patched                  |
 * | U2   | upsertBar into an empty store                            | Boundary (empty)   | appended                                      |
 * | U3   | upsertBar older missing time / invalid values / null     | Invalid            | rejected, store unchanged                     |
 * | U4   | upsertBar same time with NaN / newer with NaN            | Invalid            | rejected                                      |
 * | G1   | getBarCount / getBar / getLastBar                        | Equivalence        | store values                                  |
 * | G2   | getBar(-1 / length / NaN), getLastBar on empty           | Boundary / invalid | undefined                                     |
 * | G3   | getVisibleRange after layout                             | Equivalence        | { from, to } of the right-edge window         |
 * | G4   | getVisibleRange without width / data                     | Boundary (0)       | null                                          |
 * | I1   | removeIndicator of the last one in an auto pane          | Equivalence        | pane removed                                  |
 * | I2   | removeIndicator of the last one in an explicit pane      | Equivalence        | explicit pane removed too                     |
 * | I3   | removeIndicator with a sibling left / on price pane      | Boundary           | pane kept                                     |
 * | I4   | removeIndicator unknown id                               | Abnormal           | false                                         |
 * | I5   | removePane with indicators / price / unknown             | Equiv. / abnormal  | true + indicators gone / false / false        |
 * | I6   | updateIndicator config: only that id recalculates        | Equivalence        | stats: full only for that id                  |
 * | T1   | getSettings → applySettings on a new controller          | Equivalence        | same indicators, panes, order, ratios         |
 * | T2   | applySettings with unknown types / stale panes           | Abnormal           | unknown skipped, stale panes removed          |
 * | T3   | applySettings defaults (empty)                           | Boundary (empty)   | only the price pane remains                   |
 * | T4   | getSettings extras                                       | Equivalence        | theme / timeframe included                    |
 * | R1   | realtime status set / get / subscribe / invalid          | Equiv. / invalid   | notified once; invalid ignored                |
 * | H1   | loadMoreHistory without handler / with handler           | Equivalence        | false / true, bars prepended                  |
 * | H2   | setHasMoreHistory false → state exhausted, subscribe     | Equivalence        | listener notified                             |
 * | H3   | setData resets the history state                         | Equivalence        | idle                                          |
 * | P1   | syncCandles first / same array / appended / reset        | Equivalence        | reset / none / incremental / reset            |
 * | P2   | syncCandles after setData (prop baseline cleared)        | Boundary           | reset                                         |
 * | P3   | setData keepZoom policy then syncCandles reset           | Equivalence        | policy keepZoom → reset                       |
 * | D1   | dispose                                                  | Equivalence        | listeners released, history stops             |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Candle } from '../../data/Candle';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  asInternals,
  createTradingChartController,
} from '../ChartControllerImpl';

beforeEach(() => {
  jest.useFakeTimers();
});

const frame = () => jest.advanceTimersByTime(20);
const bar = (time: number, close = 10): Candle => ({
  time,
  open: 10,
  high: 12,
  low: 8,
  close,
  volume: 1,
});
const BARS = generateCandles({ count: 200, seed: 5 });

function chart(bars: readonly Candle[] = BARS) {
  const handle = asInternals(createTradingChartController());
  handle.setData(bars);
  return handle;
}

const paneIds = (h: ReturnType<typeof chart>) => h.getPanes().map((p) => p.id);

describe('upsertBar', () => {
  it('U1: appends, updates and patches', () => {
    // Given
    const h = chart([bar(1), bar(2), bar(3)]);
    // When / Then
    expect(h.upsertBar(bar(4))).toBe('appended');
    expect(h.upsertBar(bar(4, 11))).toBe('updated');
    expect(h.upsertBar(bar(2, 9))).toBe('patched');
    expect(h.getBar(1)?.close).toBe(9);
    expect(h.getLastBar()?.close).toBe(11);
  });

  it('U2: appends into an empty store', () => {
    // Given
    const h = chart([]);
    // When / Then
    expect(h.upsertBar(bar(1))).toBe('appended');
    expect(h.getBarCount()).toBe(1);
  });

  it.each([
    ['missing older time', bar(1.5)],
    ['older with NaN', bar(2, NaN)],
    ['null', null as unknown as Candle],
    ['string', 'bar' as unknown as Candle],
  ])('U3: rejects %s', (_name, candle) => {
    // Given
    const h = chart([bar(1), bar(2), bar(3)]);
    // When / Then
    expect(h.upsertBar(candle)).toBe('rejected');
    expect(h.getBarCount()).toBe(3);
    expect(h.getBar(1)?.close).toBe(10);
  });

  it.each([
    ['same time', bar(3, Infinity)],
    ['newer', { ...bar(4), high: 1 }],
  ])('U4: rejects invalid values at the %s', (_name, candle) => {
    // Given
    const h = chart([bar(1), bar(2), bar(3)]);
    // When / Then
    expect(h.upsertBar(candle)).toBe('rejected');
    expect(h.getLastBar()?.close).toBe(10);
  });
});

describe('getters', () => {
  it('G1: reads the store', () => {
    // Given
    const h = chart([bar(1), bar(2, 11)]);
    // When / Then
    expect(h.getBarCount()).toBe(2);
    expect(h.getBar(0)).toEqual(bar(1));
    expect(h.getLastBar()).toEqual(bar(2, 11));
  });

  it('G2: out-of-range reads are undefined', () => {
    // Given
    const h = chart([bar(1)]);
    // When / Then
    expect(h.getBar(-1)).toBeUndefined();
    expect(h.getBar(1)).toBeUndefined();
    expect(h.getBar(NaN)).toBeUndefined();
    expect(chart([]).getLastBar()).toBeUndefined();
  });

  it('G3: visible range of the laid-out chart', () => {
    // Given: 400 dp, spacing 8, right offset 5
    const h = chart();
    h.state.series.value = createUiCandleSeries(h.store.columns);
    h.state.plotWidth.value = 400;
    // When
    const range = h.getVisibleRange();
    // Then
    expect(range?.to).toBeCloseTo(200 - 0.5 + 5, 9);
    expect(range?.from).toBeCloseTo(204.5 - 50, 9);
  });

  it('G4: null before layout or without data', () => {
    // Given
    const h = chart();
    // When / Then
    expect(h.getVisibleRange()).toBeNull();
    h.state.plotWidth.value = 400;
    expect(h.getVisibleRange()).toBeNull();
  });
});

describe('indicators and panes', () => {
  it('I1: removing the last indicator removes its auto pane', () => {
    // Given
    const h = chart();
    const id = h.addIndicator({ type: 'rsi' });
    expect(paneIds(h)).toEqual(['price', `pane:${id}`]);
    // When
    const removed = h.removeIndicator(id);
    // Then
    expect(removed).toBe(true);
    expect(paneIds(h)).toEqual(['price']);
    expect(h.indicators.getResult(id)).toBeUndefined();
  });

  it('I2: removing the last indicator removes an explicit pane', () => {
    // Given
    const h = chart();
    const pane = h.addPane({ id: 'osc' });
    const id = h.addIndicator({ type: 'rsi', paneId: pane });
    // When
    h.removeIndicator(id);
    // Then
    expect(paneIds(h)).toEqual(['price']);
  });

  it('I3: panes with remaining indicators (and price) stay', () => {
    // Given
    const h = chart();
    const pane = h.addPane({ id: 'osc' });
    const a = h.addIndicator({ type: 'rsi', paneId: pane });
    h.addIndicator({ type: 'atr', paneId: pane });
    const ema = h.addIndicator({ type: 'ema' });
    // When
    h.removeIndicator(a);
    h.removeIndicator(ema);
    // Then
    expect(paneIds(h)).toEqual(['price', 'osc']);
  });

  it('I4: unknown id', () => {
    // Given / When / Then
    expect(chart().removeIndicator('nope')).toBe(false);
  });

  it('I5: removePane removes its indicators; price and unknown refused', () => {
    // Given
    const h = chart();
    const pane = h.addPane();
    const id = h.addIndicator({ type: 'macd', paneId: pane });
    // When / Then
    expect(h.removePane('price')).toBe(false);
    expect(h.removePane('missing')).toBe(false);
    expect(h.removePane(pane)).toBe(true);
    expect(h.getIndicators().find((e) => e.id === id)).toBeUndefined();
    expect(paneIds(h)).toEqual(['price']);
  });

  it('I6: a param edit recalculates only that indicator', () => {
    // Given
    const h = chart();
    const a = h.addIndicator({ type: 'ema', config: { period: 10 } });
    const b = h.addIndicator({ type: 'rsi' });
    frame();
    h.indicators.resetComputeStats();
    // When
    h.updateIndicator(b, { config: { period: 21 } });
    frame();
    // Then
    const stats = h.indicators.getComputeStats();
    expect(stats.byId[b]).toEqual({ full: 1, incremental: 0 });
    expect(stats.byId[a]).toBeUndefined();
  });
});

describe('settings', () => {
  it('T1: round-trips through a new controller', () => {
    // Given
    const source = chart();
    source.addIndicator({ type: 'ema', config: { period: 50 } });
    const rsi = source.addIndicator({ type: 'rsi' });
    const pane = source.addPane({ id: 'osc', heightRatio: 2 });
    source.addIndicator({ type: 'macd', paneId: pane });
    source.movePane('osc', 1);
    source.setPaneHeightRatio(`pane:${rsi}`, 0.5);
    const settings = source.getSettings();
    // When
    const target = chart();
    target.applySettings(settings);
    // Then
    expect(target.getSettings()).toEqual(settings);
    expect(paneIds(target)).toEqual(['price', 'osc', `pane:${rsi}`]);
  });

  it('T2: skips unknown types and removes stale panes', () => {
    // Given
    const h = chart();
    h.addIndicator({ type: 'atr' });
    h.addPane({ id: 'stale' });
    const settings = {
      ...h.getSettings(),
      indicators: [
        { id: 'x', type: 'unknown', paneId: 'price', config: {}, style: {} },
        { id: 'e', type: 'ema', paneId: 'price', config: {}, style: {} },
      ],
      panes: [{ id: 'price', heightRatio: 3, minHeight: 0, explicit: true }],
    };
    // When
    h.applySettings(settings);
    // Then
    expect(h.getIndicators().map((e) => e.id)).toEqual(['e']);
    expect(paneIds(h)).toEqual(['price']);
  });

  it('T3: empty settings leave only the price pane', () => {
    // Given
    const h = chart();
    h.addIndicator({ type: 'rsi' });
    h.addPane();
    // When
    h.applySettings({ version: 1, indicators: [], panes: [] });
    // Then
    expect(h.getIndicators()).toEqual([]);
    expect(paneIds(h)).toEqual(['price']);
  });

  it('T4: includes host extras', () => {
    // Given / When
    const settings = chart().getSettings({ theme: 'dark', timeframe: '5m' });
    // Then
    expect(settings).toMatchObject({ theme: 'dark', timeframe: '5m' });
  });
});

describe('realtime status and history', () => {
  it('R1: status set / get / subscribe', () => {
    // Given
    const h = chart();
    const listener = jest.fn();
    const off = h.subscribeRealtimeStatus(listener);
    // When
    h.setRealtimeStatus('live');
    h.setRealtimeStatus('live');
    h.setRealtimeStatus('bogus' as never);
    off();
    h.setRealtimeStatus('delayed');
    // Then
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('live');
    expect(h.getRealtimeStatus()).toBe('delayed');
  });

  it('H1: loadMoreHistory needs a handler', () => {
    // Given
    const h = chart(BARS.slice(100));
    // When / Then
    expect(h.loadMoreHistory()).toBe(false);
    h.history.setHandler(() => BARS.slice(0, 100));
    expect(h.loadMoreHistory()).toBe(true);
    expect(h.getBarCount()).toBe(200);
    expect(h.getHistoryState()).toBe('idle');
  });

  it('H2: setHasMoreHistory notifies subscribers', () => {
    // Given
    const h = chart();
    const listener = jest.fn();
    h.subscribeHistoryState(listener);
    // When
    h.setHasMoreHistory(false);
    // Then
    expect(h.getHistoryState()).toBe('exhausted');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('H3: setData resets pagination', () => {
    // Given
    const h = chart();
    h.setHasMoreHistory(false);
    // When
    h.setData(BARS.slice(0, 10));
    // Then
    expect(h.getHistoryState()).toBe('idle');
  });
});

describe('candles prop sync', () => {
  it('P1: diffs successive prop arrays', () => {
    // Given
    const h = asInternals(createTradingChartController());
    const first = BARS.slice(0, 100);
    // When / Then
    expect(h.syncCandles(first)).toBe('reset');
    expect(h.syncCandles(first)).toBe('none');
    expect(h.syncCandles(BARS.slice(0, 101))).toBe('incremental');
    expect(h.syncCandles(BARS.slice(150, 160))).toBe('reset');
    expect(h.getBarCount()).toBe(10);
  });

  it('P2: setData clears the prop baseline', () => {
    // Given
    const h = asInternals(createTradingChartController());
    const rows = BARS.slice(0, 50);
    h.syncCandles(rows);
    h.setData(BARS.slice(0, 20));
    // When / Then
    expect(h.syncCandles(rows)).toBe('reset');
    expect(h.getBarCount()).toBe(50);
  });

  it('P3: the viewport policy follows the last dataset replacement', () => {
    // Given
    const h = asInternals(createTradingChartController());
    // When / Then
    h.setData(BARS, { viewport: 'keepZoom' });
    expect(h.resetPolicy).toBe('keepZoom');
    h.setData(BARS);
    expect(h.resetPolicy).toBe('reset');
    h.setData(BARS, { viewport: 'keepZoom' });
    h.syncCandles(BARS.slice(0, 5));
    expect(h.resetPolicy).toBe('reset');
  });
});

describe('dispose', () => {
  it('D1: releases listeners and stops history', () => {
    // Given
    const h = chart();
    const status = jest.fn();
    const history = jest.fn();
    h.subscribeRealtimeStatus(status);
    h.subscribeHistoryState(history);
    const handler = jest.fn(() => []);
    h.history.setHandler(handler);
    // When
    h.dispose();
    h.setRealtimeStatus('live');
    h.setHasMoreHistory(false);
    // Then
    expect(status).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(h.loadMoreHistory()).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
