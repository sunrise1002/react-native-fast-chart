/**
 * Test perspective table — StoreSync realtime / history behaviors (P7)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                        |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------------|
 * | RS1  | follow off, at realtime, append                        | Equivalence        | view holds (offset -1), last bar pixels kept    |
 * | RS2  | follow on, at realtime, 2 appends                      | Equivalence        | offset unchanged (follows)                      |
 * | RS3  | prepend 200 bars, crosshair on bar 50                  | Equivalence        | crosshair → 250, same pixel, offset unchanged   |
 * | RS4  | prepend with no crosshair (-1)                         | Boundary           | stays -1                                        |
 * | RS5  | reset with policy keepZoom                             | Equivalence        | zoom kept, scrolled to realtime, crosshair off  |
 * | RS6  | reset with policy reset                                | Equivalence        | initial zoom restored                           |
 * | RS7  | pulse on: close changes                                | Equivalence        | progress 0 → 1 over the duration                |
 * | RS8  | pulse on: second tick while pulsing                    | Boundary           | not restarted                                   |
 * | RS9  | pulse on: tick with the same close                     | Boundary           | no pulse                                        |
 * | RS10 | pulse off (default)                                    | Equivalence        | progress stays 1                                |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ViewportResetPolicy } from '../../core/ChartController';
import type { Candle } from '../../data/Candle';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { indexToX } from '../../viewport/TimeScale';
import { readTimeScale } from '../ChartSharedState';
import { connectStoreToUi } from '../StoreSync';
import { makeEngine } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const flush = () => jest.advanceTimersByTime(20);
const BARS = generateCandles({ count: 300, seed: 4 });

function connected(
  options: {
    follow?: boolean;
    pulse?: boolean;
    bars?: readonly Candle[];
    policy?: ViewportResetPolicy;
  } = {}
) {
  const engine = makeEngine(0, {
    realtime: {
      followRealtime: options.follow ?? true,
      lastPricePulse: options.pulse ?? false,
      pulseDurationMs: 500,
    },
  });
  const store = new CandleStore();
  store.setData(options.bars ?? BARS);
  let policy: ViewportResetPolicy = options.policy ?? 'reset';
  connectStoreToUi(
    store,
    engine.state,
    () => engine.options,
    () => policy
  );
  flush();
  return {
    ...engine,
    store,
    setPolicy: (p: ViewportResetPolicy) => {
      policy = p;
    },
  };
}

const nextBar = (store: CandleStore, close = 11): Candle => ({
  time: store.lastTime + 60_000,
  open: 10,
  high: 12,
  low: 9,
  close,
  volume: 1,
});

/** Moves the last close by `delta` (kept inside the bar's range). */
const tick = (store: CandleStore, delta: number) => {
  const last = store.get(store.length - 1);
  if (!last) throw new Error('empty store');
  const close = last.close + delta;
  expect(
    store.updateLast({
      ...last,
      close,
      high: Math.max(last.high, close),
      low: Math.min(last.low, close),
    })
  ).toBe(true);
};

describe('follow mode', () => {
  it('RS1: follow off holds the view still at realtime', () => {
    // Given
    const { state, store } = connected({ follow: false });
    const offset = state.rightOffset.value;
    const x = indexToX(readTimeScale(state), store.length - 1);
    // When
    store.append(nextBar(store));
    flush();
    // Then
    expect(state.rightOffset.value).toBe(offset - 1);
    expect(indexToX(readTimeScale(state), store.length - 2)).toBeCloseTo(x, 9);
  });

  it('RS2: follow on keeps the offset at realtime', () => {
    // Given
    const { state, store } = connected();
    const offset = state.rightOffset.value;
    // When
    store.append(nextBar(store));
    flush();
    store.append(nextBar(store));
    flush();
    // Then
    expect(state.rightOffset.value).toBe(offset);
    expect(state.series.value.length).toBe(302);
  });
});

describe('prepend', () => {
  it('RS3: keeps pixels and shifts the crosshair index', () => {
    // Given
    const { state, store } = connected({ bars: BARS.slice(200) });
    state.crosshairIndex.value = 50;
    const offset = state.rightOffset.value;
    const x = indexToX(readTimeScale(state), 50);
    // When
    store.prepend(BARS.slice(0, 200));
    flush();
    // Then
    expect(state.series.value.length).toBe(300);
    expect(state.crosshairIndex.value).toBe(250);
    expect(state.rightOffset.value).toBe(offset);
    expect(indexToX(readTimeScale(state), 250)).toBeCloseTo(x, 9);
  });

  it('RS4: no crosshair stays hidden', () => {
    // Given
    const { state, store } = connected({ bars: BARS.slice(10) });
    // When
    store.prepend(BARS.slice(0, 10));
    flush();
    // Then
    expect(state.crosshairIndex.value).toBe(-1);
  });
});

describe('reset policy', () => {
  it('RS5: keepZoom keeps the bar width and scrolls to realtime', () => {
    // Given
    const { state, store, options, setPolicy } = connected();
    state.barSpacing.value = 14;
    state.rightOffset.value = -120;
    state.crosshairIndex.value = 20;
    setPolicy('keepZoom');
    // When
    store.setData(BARS.slice(0, 50));
    flush();
    // Then
    expect(state.barSpacing.value).toBe(14);
    expect(state.rightOffset.value).toBe(options.realtimeRightOffset);
    expect(state.crosshairIndex.value).toBe(-1);
  });

  it('RS6: reset restores the initial zoom', () => {
    // Given
    const { state, store, options } = connected();
    state.barSpacing.value = 14;
    // When
    store.setData(BARS.slice(0, 50));
    flush();
    // Then
    expect(state.barSpacing.value).toBe(options.initialBarSpacing);
  });
});

describe('last-price pulse', () => {
  it('RS7: a price change runs one pulse', () => {
    // Given
    const { state, store } = connected({ pulse: true });
    // When
    tick(store, 0.5);
    flush();
    // Then
    expect(state.lastPricePulse.value).toBeLessThan(1);
    jest.advanceTimersByTime(600);
    expect(state.lastPricePulse.value).toBe(1);
  });

  it('RS8: ticks during a pulse do not restart it', () => {
    // Given
    const { state, store } = connected({ pulse: true });
    tick(store, 0.5);
    flush();
    jest.advanceTimersByTime(250);
    const progress = state.lastPricePulse.value;
    // When
    tick(store, 0.25);
    flush();
    // Then
    expect(state.lastPricePulse.value).toBeGreaterThanOrEqual(progress);
  });

  it('RS9: an unchanged close does not pulse', () => {
    // Given
    const { state, store } = connected({ pulse: true });
    const last = store.get(store.length - 1);
    if (!last) throw new Error('empty store');
    // When
    store.updateLast({ ...last, volume: last.volume + 1 });
    flush();
    // Then
    expect(state.lastPricePulse.value).toBe(1);
  });

  it('RS10: disabled by default', () => {
    // Given
    const { state, store } = connected();
    // When
    tick(store, 1);
    flush();
    // Then
    expect(state.lastPricePulse.value).toBe(1);
  });
});
