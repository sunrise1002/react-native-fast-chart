/**
 * Test perspective table — StoreSync (real Reanimated, fake timers)
 *
 * | Case | Input / Precondition                           | Perspective        | Expected                                   |
 * |------|------------------------------------------------|--------------------|--------------------------------------------|
 * | SS1  | connect with 100 bars, scrolled away           | Equivalence        | snapshot installed, viewport reset         |
 * | SS2  | connect with an empty store                    | Boundary (empty)   | empty series                               |
 * | SS3  | setData (reset)                                | Equivalence        | new snapshot + resetVersion, reset view    |
 * | SS4  | append at realtime                             | Equivalence        | patched in place, offset unchanged         |
 * | SS5  | append while scrolled into history             | Equivalence        | offset += 1 (view holds still)             |
 * | SS6  | first bar appended to an empty store           | Boundary (0 → 1)   | no offset shift                            |
 * | SS7  | updateLast                                     | Equivalence        | last bar replaced in place                 |
 * | SS8  | appendMany 512 / 513 bars                      | Boundary (max ±1)  | in place / full snapshot                   |
 * | SS9  | prepend                                        | Equivalence        | snapshot, offset kept                      |
 * | SS10 | shrinking splice patch                         | Boundary           | full snapshot with shorter length          |
 * | SS11 | small splice patch                             | Equivalence        | patched in place                           |
 * | SS12 | rejected update (invalid bar)                  | Invalid            | nothing pushed                             |
 * | SS13 | after unsubscribe                              | Equivalence        | changes ignored                            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Candle } from '../../data/Candle';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { connectStoreToUi, MAX_PATCH_BARS } from '../StoreSync';
import { makeEngine } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const flush = () => jest.advanceTimersByTime(20);

function connected(bars = 100) {
  const engine = makeEngine(0);
  const store = new CandleStore();
  if (bars > 0) {
    store.setData(generateCandles({ count: bars, seed: 3 }));
  }
  const unsubscribe = connectStoreToUi(
    store,
    engine.state,
    () => engine.options
  );
  flush();
  return { ...engine, store, unsubscribe };
}

function nextBar(store: CandleStore, dt = 60_000): Candle {
  const t = store.lastTime + dt;
  return { time: t, open: 10, high: 12, low: 9, close: 11, volume: 1 };
}

describe('connectStoreToUi', () => {
  it('SS1: installs the snapshot and resets the viewport', () => {
    // Given
    const engine = makeEngine(0);
    const store = new CandleStore();
    store.setData(generateCandles({ count: 100, seed: 3 }));
    engine.state.rightOffset.value = -40;
    // When
    connectStoreToUi(store, engine.state, () => engine.options);
    flush();
    // Then
    const series = engine.state.series.value;
    expect(series.length).toBe(100);
    expect(series.close[99]).toBe(store.get(99)!.close);
    expect(engine.state.rightOffset.value).toBe(5);
  });

  it('SS2: handles an empty store', () => {
    // Given / When
    const { state } = connected(0);
    // Then
    expect(state.series.value.length).toBe(0);
  });

  it('SS3: replaces the series on setData', () => {
    // Given
    const { state, store } = connected();
    const before = state.series.value.resetVersion;
    state.rightOffset.value = -30;
    // When
    store.setData(generateCandles({ count: 200, seed: 9 }));
    flush();
    // Then
    expect(state.series.value.length).toBe(200);
    expect(state.series.value.resetVersion).not.toBe(before);
    expect(state.rightOffset.value).toBe(5);
  });

  it('SS4: patches appends in place at realtime', () => {
    // Given
    const { state, store } = connected();
    const offset = state.rightOffset.value;
    // When
    store.append(nextBar(store));
    flush();
    // Then
    expect(state.series.value.length).toBe(101);
    expect(state.series.value.close[100]).toBe(11);
    expect(state.rightOffset.value).toBe(offset);
  });

  it('SS5: holds the view still when scrolled into history', () => {
    // Given
    const { state, store } = connected();
    state.rightOffset.value = -60;
    state.rawOffset.value = -60;
    // When
    store.append(nextBar(store));
    flush();
    // Then
    expect(state.rightOffset.value).toBe(-61);
    expect(state.rawOffset.value).toBe(-61);
  });

  it('SS6: does not shift the view for the first bar', () => {
    // Given
    const { state, store } = connected(0);
    state.rightOffset.value = -60;
    // When
    store.append({
      time: 60_000,
      open: 1,
      high: 2,
      low: 0,
      close: 1,
      volume: 0,
    });
    flush();
    // Then
    expect(state.series.value.length).toBe(1);
    expect(state.rightOffset.value).toBe(-60);
  });

  it('SS7: replaces the forming bar in place', () => {
    // Given
    const { state, store } = connected();
    const revision = state.series.value.revision;
    // When
    const last = store.get(99)!;
    const ok = store.updateLast({ ...last, close: last.high });
    flush();
    // Then
    const series = state.series.value;
    expect(ok).toBe(true);
    expect(series.length).toBe(100);
    expect(series.close[99]).toBe(last.high);
    expect(series.revision).toBe(revision + 1);
  });

  it.each([
    [MAX_PATCH_BARS, 0],
    [MAX_PATCH_BARS + 1, 1],
  ])('SS8: appendMany %p bars → %p snapshot(s)', (n, snapshots) => {
    // Given
    const { state, store } = connected();
    const before = state.series.value;
    const bars = Array.from({ length: n }, (_, i) =>
      nextBar(store, (i + 1) * 60_000)
    );
    // When
    store.appendMany(bars);
    flush();
    // Then
    expect(state.series.value.length).toBe(100 + n);
    expect(state.series.value.time[100 + n - 1]).toBe(bars[n - 1]!.time);
    expect(state.series.value === before).toBe(snapshots === 0);
  });

  it('SS9: re-snapshots on prepend without moving the view', () => {
    // Given
    const { state, store } = connected();
    state.rightOffset.value = -20;
    const first = store.firstTime;
    // When
    store.prepend([
      { time: first - 60_000, open: 1, high: 2, low: 0, close: 1, volume: 0 },
    ]);
    flush();
    // Then
    expect(state.series.value.length).toBe(101);
    expect(state.series.value.time[0]).toBe(first - 60_000);
    expect(state.rightOffset.value).toBe(-20);
  });

  it('SS10: re-snapshots when a patch shrinks the store', () => {
    // Given
    const { state, store } = connected();
    // When
    store.splice(98, 2, []);
    flush();
    // Then
    expect(state.series.value.length).toBe(98);
  });

  it('SS11: patches a small same-size splice in place', () => {
    // Given
    const { state, store } = connected();
    const bar = { ...store.get(99)!, open: store.get(99)!.low };
    const series = state.series.value;
    // When
    const ok = store.splice(99, 1, [bar]);
    flush();
    // Then
    expect(ok).toBe(true);
    expect(state.series.value).toBe(series);
    expect(state.series.value.open[99]).toBe(bar.low);
  });

  it('SS12: pushes nothing for rejected updates', () => {
    // Given
    const { state, store } = connected();
    const revision = state.series.value.revision;
    // When
    const ok = store.append({ ...nextBar(store), high: NaN });
    flush();
    // Then
    expect(ok).toBe(false);
    expect(state.series.value.revision).toBe(revision);
  });

  it('SS13: stops syncing after unsubscribe', () => {
    // Given
    const { state, store, unsubscribe } = connected();
    // When
    unsubscribe();
    store.append(nextBar(store));
    flush();
    // Then
    expect(state.series.value.length).toBe(100);
  });
});
