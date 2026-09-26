/**
 * Test perspective table — HistoryLoader (history pagination, spec §23.2)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                          |
 * |------|----------------------------------------------------------|--------------------|---------------------------------------------------|
 * | H1   | sync handler returns older bars                          | Equivalence        | prepended, idle, request args before / barCount   |
 * | H2   | async handler resolves `{ candles, hasMore: true }`      | Equivalence        | loading → idle, bars prepended                    |
 * | H3   | handler returns void (host prepended itself)             | Equivalence        | idle                                              |
 * | H4   | `{ hasMore: false }` with bars                           | Equivalence        | bars merged, exhausted                            |
 * | H5   | second request while loading                             | Abnormal           | ignored, handler called once                      |
 * | H6   | no handler / empty store                                 | Boundary (NULL/0)  | false, idle                                       |
 * | H7   | empty page `[]`                                          | Boundary (empty)   | exhausted                                         |
 * | H8   | only overlapping bars, no hasMore / hasMore: true        | Boundary           | exhausted / idle                                  |
 * | H9   | exhausted → request                                      | Abnormal           | ignored                                           |
 * | H10  | handler throws                                           | Exception          | error state, getError = thrown error              |
 * | H11  | handler rejects                                          | Exception          | error state                                       |
 * | H12  | retry inside the delay / at delay boundary               | Boundary (±1)      | false at delay - 1, true at delay                 |
 * | H13  | store reset while loading → late response                | Abnormal (stale)   | ignored, idle, dataset untouched                  |
 * | H14  | store reset after error / exhausted                      | Equivalence        | idle, error cleared                               |
 * | H15  | late rejection after reset                               | Abnormal (stale)   | ignored                                           |
 * | H16  | setHasMore false / true / while loading                  | Equivalence        | exhausted / idle / ignored                        |
 * | H17  | malformed results (null, non-array candles, bad hasMore) | Invalid type       | treated as void / no candles                      |
 * | H18  | retry delay NaN / negative / Infinity / via setter       | Invalid            | treated as 0                                      |
 * | H19  | subscribe / unsubscribe / dispose                        | Equivalence        | notified per state change; nothing after dispose  |
 * | H20  | invalid rows in the page                                 | Invalid            | dropped by merge, valid bars prepended            |
 * | H21  | no options                                               | Boundary (NULL)    | delay 0, Date.now clock                           |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Candle } from '../../data/Candle';
import { CandleStore } from '../../data/CandleStore';
import { HistoryLoader, type LoadMoreHandler } from '../HistoryLoader';

const MINUTE = 60_000;
const bar = (i: number): Candle => ({
  time: i * MINUTE,
  open: 10,
  high: 11,
  low: 9,
  close: 10,
  volume: 1,
});
const range = (from: number, to: number): Candle[] => {
  const out: Candle[] = [];
  for (let i = from; i < to; i++) out.push(bar(i));
  return out;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flushPromises = () => new Promise<void>((r) => setImmediate(r));

let clock = 0;
let store: CandleStore;

function makeLoader(retryDelayMs = 1000) {
  return new HistoryLoader(store, { retryDelayMs, now: () => clock });
}

beforeEach(() => {
  clock = 0;
  store = new CandleStore();
  store.setData(range(100, 200));
});

describe('HistoryLoader: requests', () => {
  it('H1: sync handler bars are prepended', () => {
    // Given
    const loader = makeLoader();
    const handler = jest.fn<LoadMoreHandler>(() => range(50, 100));
    loader.setHandler(handler);
    // When
    const started = loader.request();
    // Then
    expect(started).toBe(true);
    expect(handler).toHaveBeenCalledWith({
      before: 100 * MINUTE,
      barCount: 100,
    });
    expect(store.length).toBe(150);
    expect(loader.getState()).toBe('idle');
  });

  it('H2: async handler goes loading → idle', async () => {
    // Given
    const loader = makeLoader();
    const page = deferred<{ candles: Candle[]; hasMore: boolean }>();
    loader.setHandler(() => page.promise);
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('loading');
    page.resolve({ candles: range(90, 100), hasMore: true });
    await flushPromises();
    expect(loader.getState()).toBe('idle');
    expect(store.firstTime).toBe(90 * MINUTE);
  });

  it('H3: void result keeps the loader idle', () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => undefined);
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('idle');
    expect(store.length).toBe(100);
  });

  it('H4: hasMore false merges and exhausts', () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => ({ candles: range(95, 100), hasMore: false }));
    // When
    loader.request();
    // Then
    expect(store.length).toBe(105);
    expect(loader.getState()).toBe('exhausted');
  });
});

describe('HistoryLoader: guards and failures', () => {
  it('H5: a second request while loading is ignored', () => {
    // Given
    const loader = makeLoader();
    const handler = jest.fn<LoadMoreHandler>(
      () => deferred<Candle[]>().promise
    );
    loader.setHandler(handler);
    loader.request();
    // When
    const again = loader.request();
    // Then
    expect(again).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('H6: no handler or no data → nothing happens', () => {
    // Given
    const loader = makeLoader();
    // When / Then
    expect(loader.request()).toBe(false);
    loader.setHandler(() => []);
    store.setData([]);
    expect(loader.request()).toBe(false);
    expect(loader.getState()).toBe('idle');
  });

  it('H7: an empty page exhausts', () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => []);
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('exhausted');
  });

  it('H8: overlap-only pages exhaust unless hasMore is true', () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => range(100, 110));
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('exhausted');
    // Given: explicit hasMore
    loader.setHasMore(true);
    loader.setHandler(() => ({ candles: range(100, 110), hasMore: true }));
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('idle');
    expect(store.length).toBe(100);
  });

  it('H9: exhausted ignores requests', () => {
    // Given
    const loader = makeLoader();
    const handler = jest.fn<LoadMoreHandler>(() => []);
    loader.setHandler(handler);
    loader.request();
    // When
    const again = loader.request();
    // Then
    expect(again).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('H10: a throwing handler sets the error state', () => {
    // Given
    const loader = makeLoader();
    const error = new Error('network down');
    loader.setHandler(() => {
      throw error;
    });
    // When
    const started = loader.request();
    // Then
    expect(started).toBe(true);
    expect(loader.getState()).toBe('error');
    expect(loader.getError()).toBe(error);
  });

  it('H11: a rejected promise sets the error state', async () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => Promise.reject(new TypeError('bad json')));
    // When
    loader.request();
    await flushPromises();
    // Then
    expect(loader.getState()).toBe('error');
    expect(loader.getError()).toBeInstanceOf(TypeError);
    expect((loader.getError() as Error).message).toBe('bad json');
  });

  it('H12: retries only after the delay', () => {
    // Given
    const loader = makeLoader(1000);
    let fail = true;
    loader.setHandler(() => {
      if (fail) throw new Error('x');
      return range(90, 100);
    });
    loader.request();
    fail = false;
    // When / Then
    clock = 999;
    expect(loader.request()).toBe(false);
    clock = 1000;
    expect(loader.request()).toBe(true);
    expect(loader.getState()).toBe('idle');
    expect(loader.getError()).toBeUndefined();
  });

  it('H13: a response after a dataset reset is dropped', async () => {
    // Given
    const loader = makeLoader();
    const page = deferred<Candle[]>();
    loader.setHandler(() => page.promise);
    loader.request();
    // When: symbol switch while loading
    store.setData(range(1000, 1010));
    page.resolve(range(50, 100));
    await flushPromises();
    // Then
    expect(loader.getState()).toBe('idle');
    expect(store.length).toBe(10);
    expect(store.firstTime).toBe(1000 * MINUTE);
  });

  it('H14: a reset clears error and exhausted', () => {
    // Given
    const loader = makeLoader(10_000);
    loader.setHandler(() => {
      throw new Error('x');
    });
    loader.request();
    // When
    store.setData(range(0, 5));
    // Then
    expect(loader.getState()).toBe('idle');
    expect(loader.getError()).toBeUndefined();
    // Given: exhausted
    loader.setHasMore(false);
    // When
    loader.reset();
    // Then
    expect(loader.getState()).toBe('idle');
  });

  it('H15: a late rejection after a reset is ignored', async () => {
    // Given
    const loader = makeLoader();
    const page = deferred<Candle[]>();
    loader.setHandler(() => page.promise);
    loader.request();
    // When
    loader.reset();
    page.reject(new Error('late'));
    await flushPromises();
    // Then
    expect(loader.getState()).toBe('idle');
    expect(loader.getError()).toBeUndefined();
  });

  it('H16: setHasMore toggles, but not while loading', () => {
    // Given
    const loader = makeLoader();
    // When / Then
    loader.setHasMore(false);
    expect(loader.getState()).toBe('exhausted');
    loader.setHasMore(true);
    expect(loader.getState()).toBe('idle');
    loader.setHandler(() => deferred<Candle[]>().promise);
    loader.request();
    loader.setHasMore(false);
    expect(loader.getState()).toBe('loading');
  });

  it.each([
    ['null', null],
    ['non-array candles', { candles: 'x', hasMore: 'yes' }],
    ['number', 42],
  ])('H17: malformed result (%s) behaves like void', (_name, value) => {
    // Given
    const loader = makeLoader();
    loader.setHandler((() => value) as unknown as LoadMoreHandler);
    // When
    loader.request();
    // Then
    expect(loader.getState()).toBe('idle');
    expect(store.length).toBe(100);
  });

  it.each([NaN, -5, Infinity])('H18: retry delay %p is treated as 0', (ms) => {
    // Given
    const loader = makeLoader(ms);
    loader.setHandler(() => {
      throw new Error('x');
    });
    loader.request();
    // When / Then
    expect(loader.request()).toBe(true);
    loader.setRetryDelay(500);
    expect(loader.request()).toBe(false);
    loader.setRetryDelay(ms);
    expect(loader.request()).toBe(true);
  });

  it('H19: listeners follow state changes until dispose', async () => {
    // Given
    const loader = makeLoader();
    const listener = jest.fn();
    const off = loader.subscribe(listener);
    const page = deferred<Candle[]>();
    loader.setHandler(() => page.promise);
    // When
    loader.request();
    page.resolve(range(90, 100));
    await flushPromises();
    // Then: loading, idle
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    loader.setHasMore(false);
    expect(listener).toHaveBeenCalledTimes(2);
    // When: dispose ignores late results and store resets
    const other = jest.fn();
    loader.subscribe(other);
    loader.setHasMore(true);
    const late = deferred<Candle[]>();
    loader.setHandler(() => late.promise);
    loader.request();
    loader.dispose();
    late.resolve(range(0, 90));
    await flushPromises();
    store.setData(range(0, 3));
    expect(other).toHaveBeenCalledTimes(2);
    expect(loader.request()).toBe(false);
  });

  it('H21: defaults to no retry delay and the wall clock', () => {
    // Given
    const loader = new HistoryLoader(store);
    loader.setHandler(() => {
      throw new Error('x');
    });
    loader.request();
    // When / Then
    expect(loader.request()).toBe(true);
    loader.dispose();
  });

  it('H20: invalid rows in a page are dropped by the merge', () => {
    // Given
    const loader = makeLoader();
    loader.setHandler(() => [bar(97), { ...bar(98), high: NaN }, bar(99)]);
    // When
    loader.request();
    // Then
    expect(store.length).toBe(102);
    expect(loader.getState()).toBe('idle');
  });
});
