/**
 * Test perspective table — mergeCandles (history merge & conflict policy)
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                         |
 * |------|--------------------------------------------------------|-------------------|--------------------------------------------------|
 * | M1   | empty batch                                            | Boundary (empty)  | nothing changes, no event                        |
 * | M2   | only invalid rows                                      | Abnormal          | issues reported, store untouched                 |
 * | M3   | empty store                                            | Boundary (empty)  | reset with the batch                             |
 * | M4   | strictly older page                                    | Equivalence       | prepend event only                               |
 * | M5   | older page overlapping one closed bar ('history')      | Equivalence       | closed bar replaced, rest prepended              |
 * | M6   | overlap with identical values                          | Boundary          | no patch event, replaced 0                       |
 * | M7   | overlap on the live bar ('history')                    | Race              | open from history, close from live, h/l/v merged |
 * | M8   | overlap on the live bar ('replace')                    | Equivalence       | incoming wins                                    |
 * | M9   | overlap + gaps ('keep')                                | Equivalence       | existing kept, only gaps inserted                |
 * | M10  | batch fills a gap in the middle                        | Equivalence       | inserted count, patch from first change          |
 * | M11  | batch newer than the store                             | Equivalence       | append event                                     |
 * | M12  | unsorted batch with duplicates                         | Abnormal          | normalized, last duplicate wins                  |
 * | M13  | realtime bars exist, initial history arrives late      | Race (§9.1)       | history prepended, live bar kept                 |
 * | M14  | batch spanning older + overlap + newer                 | Ordering          | events patch → append → prepend                  |
 */
import { describe, expect, it } from '@jest/globals';
import type { Candle } from '../Candle';
import { CandleStore } from '../CandleStore';
import { mergeCandles } from '../HistoryMerge';
import { bar, bars, minutes } from './bars';

function kinds(store: CandleStore): string[] {
  const out: string[] = [];
  store.subscribe((c) => out.push(`${c.kind}:${c.count}@${c.fromIndex}`));
  return out;
}

describe('mergeCandles', () => {
  it('M1: empty batch is a no-op', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = kinds(store);
    // When
    const result = mergeCandles(store, []);
    // Then
    expect(result).toEqual({
      prepended: 0,
      appended: 0,
      inserted: 0,
      replaced: 0,
      issues: [],
    });
    expect(events).toEqual([]);
  });

  it('M2: invalid rows are reported and ignored', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    // When
    const result = mergeCandles(store, [null, { ...bar(5), close: NaN }]);
    // Then
    expect(result.issues).toHaveLength(2);
    expect(minutes(store)).toEqual([0, 1, 2]);
  });

  it('M3: empty store takes the batch as a reset', () => {
    // Given
    const store = new CandleStore();
    const events = kinds(store);
    // When
    const result = mergeCandles(store, bars(0, 4));
    // Then
    expect(result.appended).toBe(5);
    expect(events).toEqual(['reset:5@0']);
  });

  it('M4: strictly older page is prepended', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    const events = kinds(store);
    // When
    const result = mergeCandles(store, bars(5, 9));
    // Then
    expect(result.prepended).toBe(5);
    expect(minutes(store)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(events).toEqual(['prepend:5@0']);
  });

  it('M5: history wins for an overlapping closed bar', () => {
    // Given: store 10..12, page 5..10 with a corrected bar 10
    const store = new CandleStore(bars(10, 12));
    const events = kinds(store);
    const page = [...bars(5, 9), bar(10, 999)];
    // When
    const result = mergeCandles(store, page);
    // Then
    expect(result).toMatchObject({ prepended: 5, replaced: 1, inserted: 0 });
    expect(store.get(5)?.close).toBe(999);
    expect(events).toEqual(['patch:0@0', 'prepend:5@0']);
  });

  it('M6: identical overlap produces no patch', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    const events = kinds(store);
    // When
    const result = mergeCandles(store, bars(8, 11));
    // Then
    expect(result.replaced).toBe(0);
    expect(events).toEqual(['prepend:2@0']);
  });

  it('M7: live bar is combined under the history policy', () => {
    // Given: live bar 12 built by realtime (joined mid-bar)
    const store = new CandleStore(bars(10, 11));
    const live: Candle = {
      time: bar(12).time,
      open: 105,
      high: 106,
      low: 104,
      close: 105.5,
      volume: 3,
    };
    store.append(live);
    const history: Candle = {
      time: bar(12).time,
      open: 101,
      high: 105,
      low: 100,
      close: 104,
      volume: 7,
    };
    // When
    const result = mergeCandles(store, [history]);
    // Then
    expect(result.replaced).toBe(1);
    expect(store.get(2)).toEqual({
      time: live.time,
      open: 101,
      high: 106,
      low: 100,
      close: 105.5,
      volume: 7,
    });
  });

  it('M8: replace policy overwrites the live bar', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    // When
    mergeCandles(store, [bar(12, 50)], { policy: 'replace' });
    // Then
    expect(store.get(2)).toEqual(bar(12, 50));
  });

  it('M9: keep policy only fills gaps', () => {
    // Given: minutes 0, 2
    const store = new CandleStore([bar(0), bar(2)]);
    // When
    const result = mergeCandles(store, [bar(0, 7), bar(1, 7), bar(2, 7)], {
      policy: 'keep',
    });
    // Then
    expect(result).toMatchObject({ inserted: 1, replaced: 0 });
    expect(store.getRange(0, 3).map((c) => c.close)).toEqual([100, 7, 102]);
  });

  it('M10: gap in the middle is inserted', () => {
    // Given: 0,1,2,5,6
    const store = new CandleStore([...bars(0, 2), ...bars(5, 6)]);
    const events = kinds(store);
    // When
    const result = mergeCandles(store, bars(2, 4));
    // Then
    expect(result).toMatchObject({ inserted: 2, replaced: 0 });
    expect(minutes(store)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events).toEqual(['patch:2@3']);
  });

  it('M11: newer bars are appended', () => {
    // Given
    const store = new CandleStore(bars(0, 2));
    const events = kinds(store);
    // When
    const result = mergeCandles(store, bars(3, 5));
    // Then
    expect(result.appended).toBe(3);
    expect(events).toEqual(['append:3@3']);
  });

  it('M12: unsorted duplicated batch is normalized', () => {
    // Given
    const store = new CandleStore(bars(10, 11));
    // When
    const result = mergeCandles(store, [bar(3), bar(1), bar(3, 42), bar(2)]);
    // Then
    expect(minutes(store)).toEqual([1, 2, 3, 10, 11]);
    expect(store.get(2)?.close).toBe(42);
    expect(result.issues).toEqual([{ index: 0, reason: 'DUPLICATE_TIME' }]);
  });

  it('M13: late initial history does not wipe realtime bars', () => {
    // Given: realtime already produced bars 100 (closed) and 101 (live)
    const store = new CandleStore();
    store.append(bar(100, 1));
    store.append(bar(101, 2));
    // When: history 0..100 arrives (stale values for 100)
    const result = mergeCandles(store, bars(0, 100));
    // Then
    expect(store.length).toBe(102);
    expect(result.prepended).toBe(100);
    expect(store.get(100)).toEqual(bar(100)); // closed: history wins
    expect(store.get(101)).toEqual(bar(101, 2)); // live: untouched
  });

  it('M14: event order is patch, append, prepend', () => {
    // Given
    const store = new CandleStore(bars(10, 12));
    const events = kinds(store);
    // When
    mergeCandles(store, [bar(8), bar(11, 1), bar(14)]);
    // Then
    expect(events).toEqual(['patch:0@1', 'append:1@3', 'prepend:1@0']);
    expect(minutes(store)).toEqual([8, 10, 11, 12, 14]);
  });
});
