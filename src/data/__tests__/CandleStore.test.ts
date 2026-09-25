/**
 * Test perspective table — CandleStore mutations & change tracking
 *
 * | Case | Input / Precondition                          | Perspective        | Expected                                        |
 * |------|-----------------------------------------------|--------------------|-------------------------------------------------|
 * | D1   | new store / constructor with data             | Boundary (empty)   | length 0, NaN times / data loaded               |
 * | D2   | setData clean sorted data                     | Equivalence        | copied, reset event, no issues                  |
 * | D3   | setData unsorted + duplicates + invalid rows  | Abnormal           | normalized, issues returned                     |
 * | D4   | setData([]) / clear()                         | Boundary (empty)   | length 0, reset event                           |
 * | D5   | setData with null / primitive rows            | Invalid type       | rows dropped                                    |
 * | A1   | append newer bar                              | Equivalence        | true, append event {count 1, fromIndex n}       |
 * | A2   | append equal / older time                     | Boundary (0/-1)    | false, no event                                 |
 * | A3   | append NaN / Infinity / high<body / bad time  | Abnormal           | false, no event                                 |
 * | A4   | append to empty store                         | Boundary (empty)   | true                                            |
 * | A5   | appendMany ok / empty / unsorted / overlap    | Equiv./Abnormal    | all-or-nothing                                  |
 * | U1   | updateLast same time                          | Equivalence        | true, updateLast event, values replaced         |
 * | U2   | updateLast other time / empty store           | Abnormal / empty   | false                                           |
 * | U3   | updateLastValues invalid (low>body)           | Abnormal           | false, unchanged                                |
 * | U4   | updateValuesAt middle / bad index             | Equiv./Boundary    | patch event / false for -1, n, 1.5, NaN         |
 * | P1   | prepend older sorted bars                     | Equivalence        | true, prepend event, counters                   |
 * | P2   | prepend overlapping / unsorted / empty        | Abnormal           | false                                           |
 * | P3   | prepend into empty store                      | Boundary (empty)   | true                                            |
 * | P4   | 1000 prepend pages of 100 bars                | Performance        | amortized, sorted, fast                         |
 * | S1   | splice replace / insert / delete              | Equivalence        | patch event with length delta                   |
 * | S2   | splice breaking order / bad args / no-op      | Abnormal           | false                                           |
 * | L1   | subscribe / unsubscribe                       | Equivalence        | listener called until unsubscribed              |
 * | L2   | listener throws                               | External failure   | others still called, first error rethrown       |
 * | L3   | unsubscribe during notification               | Boundary           | current round unaffected                        |
 * | V1   | version / resetVersion / prependedSinceReset  | Invariant          | monotonic; reset clears prepend counter         |
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Candle } from '../Candle';
import { CandleStore, type CandleStoreChange } from '../CandleStore';
import { bar, bars, minutes, T0 } from './bars';

function recorder(store: CandleStore) {
  const events: Array<Omit<CandleStoreChange, 'version'>> = [];
  store.subscribe(({ kind, count, fromIndex }) =>
    events.push({ kind, count, fromIndex })
  );
  return events;
}

describe('CandleStore: setData', () => {
  it('D1: empty store and constructor loading', () => {
    // Given / When
    const empty = new CandleStore();
    const loaded = new CandleStore(bars(0, 2));
    // Then
    expect(empty.length).toBe(0);
    expect(empty.firstTime).toBeNaN();
    expect(empty.lastTime).toBeNaN();
    expect(empty.version).toBe(0);
    expect(loaded.length).toBe(3);
    expect(loaded.version).toBe(1);
  });

  it('D2: copies clean data and emits reset', () => {
    // Given
    const store = new CandleStore();
    const events = recorder(store);
    const input = bars(0, 9);
    // When
    const issues = store.setData(input);
    // Then
    expect(issues).toEqual([]);
    expect(store.length).toBe(10);
    expect(store.get(3)).toEqual(bar(3));
    expect(events).toEqual([{ kind: 'reset', count: 10, fromIndex: 0 }]);
  });

  it('D3: normalizes dirty data', () => {
    // Given: unsorted, a duplicate (last wins) and an invalid row
    const store = new CandleStore();
    const dup = bar(1, 500);
    const input = [bar(2), bar(1), { ...bar(3), high: NaN }, bar(0), dup];
    // When
    const issues = store.setData(input);
    // Then
    expect(minutes(store)).toEqual([0, 1, 2]);
    expect(store.get(1)?.close).toBe(500);
    expect(issues.map((i) => i.reason).sort()).toEqual([
      'DUPLICATE_TIME',
      'NON_FINITE_PRICE',
    ]);
  });

  it('D4: empty data and clear()', () => {
    // Given
    const store = new CandleStore(bars(0, 5));
    const events = recorder(store);
    // When
    store.setData([]);
    store.setData(bars(0, 1));
    store.clear();
    // Then
    expect(store.length).toBe(0);
    expect(events.map((e) => e.kind)).toEqual(['reset', 'reset', 'reset']);
  });

  it('D5: drops null and primitive rows', () => {
    // Given
    const store = new CandleStore();
    // When
    const issues = store.setData([null, 42, 'x', bar(0)]);
    // Then
    expect(store.length).toBe(1);
    expect(issues).toHaveLength(3);
  });
});

describe('CandleStore: append / update', () => {
  it('A1: appends a newer bar', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = recorder(store);
    // When
    const ok = store.append(bar(3));
    // Then
    expect(ok).toBe(true);
    expect(store.lastTime).toBe(bar(3).time);
    expect(events).toEqual([{ kind: 'append', count: 1, fromIndex: 3 }]);
  });

  it.each([
    ['equal time', bar(2)],
    ['older time', bar(1)],
  ])('A2: rejects %s', (_label, candle) => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = recorder(store);
    // When
    const ok = store.append(candle);
    // Then
    expect(ok).toBe(false);
    expect(store.length).toBe(3);
    expect(events).toEqual([]);
  });

  it.each([
    ['NaN close', { ...bar(5), close: NaN }],
    ['Infinity high', { ...bar(5), high: Infinity }],
    ['high below body', { ...bar(5), high: 50 }],
    ['negative volume', { ...bar(5), volume: -1 }],
    ['fractional time', { ...bar(5), time: T0 + 0.5 }],
    ['negative time', { ...bar(5), time: -1 }],
  ])('A3: rejects invalid bar (%s)', (_label, candle) => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const version = store.version;
    // When / Then
    expect(store.append(candle)).toBe(false);
    expect(store.version).toBe(version);
  });

  it('A4: appends into an empty store', () => {
    // Given
    const store = new CandleStore();
    // When / Then
    expect(store.append(bar(0))).toBe(true);
    expect(store.appendValues(T0 + 60_000, 1, 2, 0, 1, 0)).toBe(true);
    expect(store.length).toBe(2);
  });

  it('A5: appendMany is all-or-nothing', () => {
    // Given
    const store = new CandleStore(bars(0, 1));
    const events = recorder(store);
    // When / Then
    expect(store.appendMany([])).toBe(false);
    expect(store.appendMany([bar(3), bar(2)])).toBe(false);
    expect(store.appendMany([bar(1), bar(2)])).toBe(false);
    expect(store.appendMany([bar(2), { ...bar(3), low: NaN }])).toBe(false);
    expect(store.length).toBe(2);
    expect(store.appendMany(bars(2, 300))).toBe(true);
    expect(store.length).toBe(301);
    expect(events).toEqual([{ kind: 'append', count: 299, fromIndex: 2 }]);
    expect(new CandleStore().appendMany(bars(0, 1))).toBe(true);
  });

  it('U1: updates the last bar in place', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = recorder(store);
    const next = { ...bar(2, 150), volume: 9 };
    // When
    const ok = store.updateLast(next);
    // Then
    expect(ok).toBe(true);
    expect(store.get(2)).toEqual(next);
    expect(store.length).toBe(3);
    expect(events).toEqual([{ kind: 'updateLast', count: 0, fromIndex: 2 }]);
  });

  it('U2: rejects updateLast for another time or empty store', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    // When / Then
    expect(store.updateLast(bar(1))).toBe(false);
    expect(store.updateLast(bar(3))).toBe(false);
    expect(new CandleStore().updateLast(bar(0))).toBe(false);
    expect(new CandleStore().updateLastValues(1, 1, 1, 1, 1)).toBe(false);
  });

  it('U3: rejects invalid last-bar values', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    // When
    const ok = store.updateLastValues(10, 12, 11, 10, 1);
    // Then
    expect(ok).toBe(false);
    expect(store.get(2)).toEqual(bar(2));
  });

  it.each([-1, 3, 1.5, NaN])('U4: updateValuesAt rejects index %p', (i) => {
    // Given
    const store = new CandleStore(bars(0, 2));
    // When / Then
    expect(store.updateValuesAt(i, 1, 1, 1, 1, 1)).toBe(false);
  });

  it('U4: updateValuesAt patches a middle bar', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = recorder(store);
    // When
    const ok = store.updateValuesAt(1, 5, 6, 4, 5, 3);
    // Then
    expect(ok).toBe(true);
    expect(store.get(1)).toEqual({
      time: bar(1).time,
      open: 5,
      high: 6,
      low: 4,
      close: 5,
      volume: 3,
    });
    expect(events).toEqual([{ kind: 'patch', count: 0, fromIndex: 1 }]);
  });
});

describe('CandleStore: prepend / splice', () => {
  it('P1: prepends older bars', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    const events = recorder(store);
    // When
    const ok = store.prepend(bars(5, 9));
    // Then
    expect(ok).toBe(true);
    expect(minutes(store)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(events).toEqual([{ kind: 'prepend', count: 5, fromIndex: 0 }]);
    expect(store.prependedSinceReset).toBe(5);
  });

  it.each([
    ['overlapping', bars(8, 10)],
    ['unsorted', [bar(3), bar(2)]],
    ['empty', [] as Candle[]],
    ['invalid', [{ ...bar(1), open: NaN }]],
  ])('P2: rejects %s pages', (_label, page) => {
    // Given
    const store = new CandleStore(bars(10, 12));
    // When / Then
    expect(store.prepend(page)).toBe(false);
    expect(store.length).toBe(3);
  });

  it('P3: prepends into an empty store', () => {
    // Given
    const store = new CandleStore();
    // When / Then
    expect(store.prepend(bars(0, 3))).toBe(true);
    expect(store.length).toBe(4);
  });

  it('P4: 1000 history pages of 100 bars', () => {
    // Given
    const store = new CandleStore(bars(100_000, 100_099));
    const t0 = Date.now();
    // When
    for (let p = 999; p >= 0; p--) {
      store.prepend(bars(p * 100, p * 100 + 99));
    }
    // Then
    expect(store.length).toBe(100_100);
    expect(store.firstTime).toBe(T0);
    expect(store.findIndexByTime(bar(54_321).time)).toBe(54_321);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('S1: splice replaces, inserts and deletes', () => {
    // Given: minutes 0,1,2,4,5
    const store = new CandleStore([...bars(0, 2), ...bars(4, 5)]);
    const events = recorder(store);
    // When: fill the gap at 3 and replace 2
    expect(store.splice(2, 1, [bar(2, 7), bar(3)])).toBe(true);
    // Then
    expect(minutes(store)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(store.get(2)?.close).toBe(7);
    // When: truncate the tail
    expect(store.splice(4, 2, [])).toBe(true);
    // Then
    expect(minutes(store)).toEqual([0, 1, 2, 3]);
    expect(events).toEqual([
      { kind: 'patch', count: 1, fromIndex: 2 },
      { kind: 'patch', count: -2, fromIndex: 4 },
    ]);
  });

  it.each([
    ['breaks order before', 1, 0, [bar(0)]],
    ['breaks order after', 1, 0, [bar(1)]],
    ['unsorted', 1, 1, [bar(2), bar(1)]],
    ['negative from', -1, 0, [bar(0)]],
    ['fractional count', 0, 0.5, []],
    ['past the end', 2, 5, []],
    ['no-op', 1, 0, []],
    ['negative delete', 1, -1, []],
    ['NaN from', NaN, 0, [bar(9)]],
  ])('S2: rejects splice that %s', (_label, from, del, items) => {
    // Given: minutes 0,1,2
    const store = new CandleStore(bars(0, 2));
    // When / Then
    expect(store.splice(from, del, items)).toBe(false);
    expect(minutes(store)).toEqual([0, 1, 2]);
  });
});

describe('CandleStore: listeners & versions', () => {
  it('L1: subscribe and unsubscribe', () => {
    // Given
    const store = new CandleStore(bars(0, 1));
    const listener = jest.fn();
    const off = store.subscribe(listener);
    // When
    store.append(bar(2));
    off();
    store.append(bar(3));
    // Then
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1]).toBe(store);
  });

  it('L2: a throwing listener does not starve the others', () => {
    // Given
    const store = new CandleStore(bars(0, 1));
    const second = jest.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      throw new Error('second boom');
    });
    store.subscribe(second);
    // When / Then: first error surfaces, mutation already applied
    expect(() => store.append(bar(2))).toThrow('boom');
    expect(second).toHaveBeenCalledTimes(1);
    expect(store.length).toBe(3);
  });

  it('L3: unsubscribing inside a listener is safe', () => {
    // Given
    const store = new CandleStore(bars(0, 1));
    const calls: string[] = [];
    const offA = store.subscribe(() => {
      calls.push('a');
      offA();
    });
    store.subscribe(() => calls.push('b'));
    // When
    store.append(bar(2));
    store.append(bar(3));
    // Then
    expect(calls).toEqual(['a', 'b', 'b']);
  });

  it('V1: counters track resets and prepends', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    const reset1 = store.resetVersion;
    // When
    store.prepend(bars(8, 9));
    store.append(bar(13));
    store.prepend(bars(5, 7));
    // Then
    expect(store.version).toBe(reset1 + 3);
    expect(store.prependedSinceReset).toBe(5);
    expect(store.lastChange.kind).toBe('prepend');
    // When
    store.setData(bars(0, 1));
    // Then
    expect(store.resetVersion).toBe(store.version);
    expect(store.prependedSinceReset).toBe(0);
  });
});
