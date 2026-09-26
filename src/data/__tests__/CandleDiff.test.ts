/**
 * Test perspective table — CandleDiff (props diffing, spec §20)
 *
 * | Case | Input / Precondition                                   | Perspective         | Expected                                         |
 * |------|--------------------------------------------------------|---------------------|--------------------------------------------------|
 * | D1   | same array reference                                   | Equivalence         | none                                             |
 * | D2   | prev null / undefined / empty, next non-empty          | Boundary (NULL/0)   | reset                                            |
 * | D3   | next empty, store empty / non-empty                    | Boundary (empty)    | none / reset                                     |
 * | D4   | copy with identical rows                               | Equivalence         | none                                             |
 * | D5   | one bar appended                                       | Equivalence         | incremental, changedFrom = n                     |
 * | D6   | last bar replaced (new object)                         | Equivalence         | incremental, changedFrom = n - 1                 |
 * | D7   | last bar mutated in place (same reference)             | Boundary            | incremental, changedFrom = n - 1                 |
 * | D8   | last bar updated + new bar appended                    | Equivalence         | changedFrom = n - 1                              |
 * | D9   | k bars prepended                                       | Equivalence         | prepended k, changedFrom = k + n                 |
 * | D10  | prepended + appended                                   | Equivalence         | prepended k, changedFrom = k + n                 |
 * | D11  | interior bar replaced with new values                  | Equivalence         | changedFrom = that index                         |
 * | D12  | interior new object, equal values                      | Boundary            | none                                             |
 * | D13  | other dataset (first time absent)                      | Invalid → reset     | reset                                            |
 * | D14  | next shorter than prev (tail trimmed)                  | Boundary (n - 1)    | reset                                            |
 * | D15  | store diverged from prev (length / first / last time)  | Invalid             | reset                                            |
 * | D16  | next contains null / NaN-time rows                     | Invalid type        | NaN hit by search → reset; else apply → reset    |
 * | D17  | missing volume in next equals stored 0                 | Boundary            | none                                             |
 * | A1   | apply none                                             | Equivalence         | store untouched                                  |
 * | A2   | apply append / updateLast / updateLast + append        | Equivalence         | store events append / updateLast (no reset)      |
 * | A3   | apply prepend                                          | Equivalence         | one prepend event, no reset                      |
 * | A4   | apply interior change                                  | Equivalence         | one patch (splice) event                         |
 * | A5   | apply reset                                            | Equivalence         | setData                                          |
 * | A6   | apply incremental with invalid appended row            | Abnormal            | falls back to setData (normalized)               |
 * | A7   | apply incremental with a null last row                 | Invalid type        | fallback reset                                   |
 * | A8   | apply prepend of unsorted rows                         | Abnormal            | fallback reset                                   |
 * | A9   | apply updateLast with rejected (NaN) values            | Abnormal            | fallback reset (row dropped)                     |
 */
import { describe, expect, it } from '@jest/globals';
import type { Candle } from '../Candle';
import { applyCandleDiff, diffCandles } from '../CandleDiff';
import { CandleStore, type CandleStoreChangeKind } from '../CandleStore';

const bar = (i: number, close = 10 + i): Candle => ({
  time: 1_000 + i * 60_000,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
});

function series(from: number, to: number): Candle[] {
  const out: Candle[] = [];
  for (let i = from; i < to; i++) {
    out.push(bar(i));
  }
  return out;
}

function storeOf(rows: readonly Candle[]): CandleStore {
  const store = new CandleStore();
  store.setData(rows);
  return store;
}

function recordKinds(store: CandleStore): CandleStoreChangeKind[] {
  const kinds: CandleStoreChangeKind[] = [];
  store.subscribe((change) => {
    kinds.push(change.kind);
  });
  return kinds;
}

describe('diffCandles', () => {
  it('D1: same reference is a no-op', () => {
    // Given
    const prev = series(0, 5);
    // When / Then
    expect(diffCandles(prev, prev, storeOf(prev).columns)).toEqual({
      kind: 'none',
    });
  });

  it.each([null, undefined, []])('D2: prev %p yields reset', (prev) => {
    // Given
    const next = series(0, 3);
    // When / Then
    expect(diffCandles(prev, next, new CandleStore().columns).kind).toBe(
      'reset'
    );
  });

  it('D3: empty next is none on an empty store, reset otherwise', () => {
    // Given
    const prev = series(0, 3);
    // When / Then
    expect(diffCandles([], [], new CandleStore().columns).kind).toBe('none');
    expect(diffCandles(null, [], new CandleStore().columns).kind).toBe('none');
    expect(diffCandles(prev, [], storeOf(prev).columns).kind).toBe('reset');
  });

  it('D4: an identical copy is none', () => {
    // Given
    const prev = series(0, 5);
    // When
    const diff = diffCandles(prev, [...prev], storeOf(prev).columns);
    // Then
    expect(diff.kind).toBe('none');
  });

  it('D5: detects an appended bar', () => {
    // Given
    const prev = series(0, 5);
    // When
    const diff = diffCandles(prev, [...prev, bar(5)], storeOf(prev).columns);
    // Then
    expect(diff).toEqual({ kind: 'incremental', prepended: 0, changedFrom: 5 });
  });

  it('D6: detects a replaced last bar', () => {
    // Given
    const prev = series(0, 5);
    const next = [...prev.slice(0, 4), bar(4, 99)];
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns)).toEqual({
      kind: 'incremental',
      prepended: 0,
      changedFrom: 4,
    });
  });

  it('D7: detects a last bar mutated in place', () => {
    // Given
    const prev = series(0, 5);
    const store = storeOf(prev);
    const next = [...prev];
    (next[4] as Candle).close = 12.5;
    // When / Then
    expect(diffCandles(prev, next, store.columns)).toMatchObject({
      changedFrom: 4,
    });
  });

  it('D8: updated last bar plus a new bar starts at the last bar', () => {
    // Given
    const prev = series(0, 5);
    const next = [...prev.slice(0, 4), bar(4, 50), bar(5)];
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns)).toEqual({
      kind: 'incremental',
      prepended: 0,
      changedFrom: 4,
    });
  });

  it('D9: detects prepended history', () => {
    // Given
    const prev = series(10, 20);
    const next = [...series(0, 10), ...prev];
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns)).toEqual({
      kind: 'incremental',
      prepended: 10,
      changedFrom: 20,
    });
  });

  it('D10: detects prepend and append in one update', () => {
    // Given
    const prev = series(10, 20);
    const next = [...series(5, 10), ...prev, bar(20)];
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns)).toEqual({
      kind: 'incremental',
      prepended: 5,
      changedFrom: 15,
    });
  });

  it('D11: detects an interior change', () => {
    // Given
    const prev = series(0, 10);
    const next = [...prev];
    next[3] = bar(3, 77);
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns)).toMatchObject({
      changedFrom: 3,
    });
  });

  it('D12: interior new objects with equal values are not changes', () => {
    // Given
    const prev = series(0, 10);
    const next = prev.map((c) => ({ ...c }));
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns).kind).toBe('none');
  });

  it('D13: another dataset resets', () => {
    // Given
    const prev = series(0, 10);
    const next = series(100, 110);
    // When / Then
    expect(diffCandles(prev, next, storeOf(prev).columns).kind).toBe('reset');
  });

  it('D14: a trimmed tail resets', () => {
    // Given
    const prev = series(0, 10);
    // When / Then
    expect(
      diffCandles(prev, prev.slice(0, 9), storeOf(prev).columns).kind
    ).toBe('reset');
  });

  it('D15: resets when the store no longer mirrors prev', () => {
    // Given
    const prev = series(0, 10);
    const longer = storeOf(series(0, 11));
    const shifted = storeOf([bar(-1), ...prev.slice(0, 9)]);
    const otherLast = storeOf([...prev.slice(0, 9), bar(30)]);
    const next = [...prev, bar(10)];
    // When / Then
    expect(diffCandles(prev, next, longer.columns).kind).toBe('reset');
    expect(diffCandles(prev, next, shifted.columns).kind).toBe('reset');
    expect(diffCandles(prev, next, otherLast.columns).kind).toBe('reset');
  });

  it('D16: invalid rows never produce a false match', () => {
    // Given
    const prev = series(0, 4);
    const store = storeOf(prev);
    const nullFirst = [null, ...prev] as unknown as Candle[];
    const nanRows = [
      { ...bar(-2), time: NaN },
      { ...bar(-1), time: NaN },
      ...prev,
    ];
    const nullLast = [...prev.slice(0, 3), null] as unknown as Candle[];
    // When / Then
    expect(diffCandles(prev, nullFirst, store.columns).kind).not.toBe('none');
    const nanDiff = diffCandles(prev, nanRows, store.columns);
    expect(nanDiff).toMatchObject({ prepended: 2 });
    expect(applyCandleDiff(store, nanRows, nanDiff)).toBe('reset');
    expect(store.length).toBe(4);
    const nanMid = [bar(-1), { ...bar(0), time: NaN }, bar(1)];
    expect(diffCandles([bar(5)], nanMid, storeOf([bar(5)]).columns).kind).toBe(
      'reset'
    );
    expect(diffCandles(prev, nullLast, store.columns)).toMatchObject({
      changedFrom: 3,
    });
  });

  it('D17: a missing volume equals a stored 0', () => {
    // Given
    const prev = [{ ...bar(0), volume: 0 }];
    const store = storeOf(prev);
    const next = [{ ...bar(0), volume: undefined as unknown as number }];
    // When / Then
    expect(diffCandles(prev, next, store.columns).kind).toBe('none');
  });
});

describe('applyCandleDiff', () => {
  it('A1: none leaves the store untouched', () => {
    // Given
    const prev = series(0, 5);
    const store = storeOf(prev);
    const kinds = recordKinds(store);
    // When
    const applied = applyCandleDiff(store, prev, { kind: 'none' });
    // Then
    expect(applied).toBe('none');
    expect(kinds).toEqual([]);
  });

  it.each([
    ['append', (p: Candle[]) => [...p, bar(5)], ['append']],
    [
      'updateLast',
      (p: Candle[]) => [...p.slice(0, 4), bar(4, 3)],
      ['updateLast'],
    ],
    [
      'updateLast + append',
      (p: Candle[]) => [...p.slice(0, 4), bar(4, 3), bar(5), bar(6)],
      ['updateLast', 'append'],
    ],
  ])('A2: applies %s incrementally', (_name, make, expected) => {
    // Given
    const prev = series(0, 5);
    const store = storeOf(prev);
    const kinds = recordKinds(store);
    const next = make(prev);
    // When
    const applied = applyCandleDiff(
      store,
      next,
      diffCandles(prev, next, store.columns)
    );
    // Then
    expect(applied).toBe('incremental');
    expect(kinds).toEqual(expected);
    expect(store.length).toBe(next.length);
    expect(store.get(store.length - 1)).toEqual(next[next.length - 1]);
  });

  it('A3: applies a prepend without a reset', () => {
    // Given
    const prev = series(10, 20);
    const store = storeOf(prev);
    const kinds = recordKinds(store);
    const next = [...series(0, 10), ...prev];
    // When
    applyCandleDiff(store, next, diffCandles(prev, next, store.columns));
    // Then
    expect(kinds).toEqual(['prepend']);
    expect(store.length).toBe(20);
    expect(store.firstTime).toBe(bar(0).time);
  });

  it('A4: applies an interior change as one splice patch', () => {
    // Given
    const prev = series(0, 10);
    const store = storeOf(prev);
    const kinds = recordKinds(store);
    const next = [...prev];
    next[2] = bar(2, 42);
    // When
    applyCandleDiff(store, next, diffCandles(prev, next, store.columns));
    // Then
    expect(kinds).toEqual(['patch']);
    expect(store.get(2)?.close).toBe(42);
    expect(store.length).toBe(10);
  });

  it('A5: reset calls setData', () => {
    // Given
    const store = storeOf(series(0, 3));
    const kinds = recordKinds(store);
    const next = series(50, 60);
    // When
    const applied = applyCandleDiff(store, next, { kind: 'reset' });
    // Then
    expect(applied).toBe('reset');
    expect(kinds).toEqual(['reset']);
    expect(store.length).toBe(10);
  });

  it('A6: an invalid appended row falls back to a normalized setData', () => {
    // Given
    const prev = series(0, 5);
    const store = storeOf(prev);
    const next = [...prev, { ...bar(5), high: NaN }];
    // When
    const applied = applyCandleDiff(
      store,
      next,
      diffCandles(prev, next, store.columns)
    );
    // Then
    expect(applied).toBe('reset');
    expect(store.length).toBe(5);
  });

  it('A7: a null last row falls back to setData', () => {
    // Given
    const prev = series(0, 4);
    const store = storeOf(prev);
    const next = [...prev.slice(0, 3), null] as unknown as Candle[];
    // When
    const applied = applyCandleDiff(store, next, {
      kind: 'incremental',
      prepended: 0,
      changedFrom: 3,
    });
    // Then
    expect(applied).toBe('reset');
    expect(store.length).toBe(3);
  });

  it('A8: an unsorted prepend falls back to setData', () => {
    // Given
    const prev = series(10, 12);
    const store = storeOf(prev);
    const next = [bar(3), bar(1), ...prev];
    // When
    const applied = applyCandleDiff(store, next, {
      kind: 'incremental',
      prepended: 2,
      changedFrom: 4,
    });
    // Then
    expect(applied).toBe('reset');
    expect(store.length).toBe(4);
    expect(store.firstTime).toBe(bar(1).time);
  });

  it('A9: a rejected last-bar update falls back to setData', () => {
    // Given
    const prev = series(0, 4);
    const store = storeOf(prev);
    const next = [...prev.slice(0, 3), { ...bar(3), close: Infinity }];
    // When
    const applied = applyCandleDiff(
      store,
      next,
      diffCandles(prev, next, store.columns)
    );
    // Then
    expect(applied).toBe('reset');
    expect(store.length).toBe(3);
  });
});
