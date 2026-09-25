/**
 * Test perspective table — RealtimeBarAggregator
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                     |
 * |------|----------------------------------------------------|--------------------|----------------------------------------------|
 * | C1   | invalid timeframe                                  | Abnormal           | RangeError with message                      |
 * | T1   | first trade, empty store                           | Boundary (empty)   | created, o=h=l=c=price, aligned time         |
 * | T2   | several trades in the same interval                | Equivalence        | updated h/l/c/v, one bar                     |
 * | T3   | trade at next boundary (exact)                     | Boundary           | rollover → created                           |
 * | T4   | trade at boundary - 1 ms                           | Boundary (-1)      | same bar updated                             |
 * | T5   | missing intervals, fillGaps off                    | Equivalence        | no fabricated bars                           |
 * | T6   | missing intervals, fillGaps on                     | Equivalence        | flat bars at previous close, volume 0        |
 * | T7   | gap longer than maxGapFillBars                     | Boundary (max+1)   | not filled                                   |
 * | T8   | older trade inside the live bar                    | Out-of-order       | h/l/v updated, close kept                    |
 * | T9   | late trade for a stored older bar ('apply')        | Out-of-order       | patched, close kept                          |
 * | T10  | late trade with lateTicks 'ignore'                 | Out-of-order       | ignored, unchanged                           |
 * | T11  | late trade for a bar missing from the store        | Out-of-order       | ignored (no fabricated bar)                  |
 * | T12  | NaN / Infinity price, negative / NaN qty, bad time | Invalid            | rejected, no event                           |
 * | T13  | zero quantity                                      | Boundary (0)       | accepted                                     |
 * | T14  | store reset between trades                         | State              | trade state forgotten                        |
 * | T15  | monthly timeframe gap fill                         | Equivalence        | calendar-month bars                          |
 * | K1   | kline newer / same / older-existing / older-missing| Equivalence        | created / updated / patched / inserted       |
 * | K2   | kline with string values                           | Invalid format ok  | parsed                                       |
 * | K3   | kline invalid (NaN string, high < low)             | Invalid            | rejected                                     |
 * | K4   | isClosed kline then trade for that bucket          | State              | trade ignored                                |
 * | K5   | kline replaces trade-built bar, older trade later  | State              | trade close applies again                    |
 * | K6   | kline gap with fillGaps                            | Equivalence        | gap filled                                   |
 * | S1   | snapshot merge                                     | Reconnect          | snapshot values win, others kept             |
 * | S2   | snapshot replace                                   | Reconnect          | unconfirmed bars dropped                     |
 * | S3   | snapshot into empty store / empty snapshot         | Boundary (empty)   | loaded / no-op                               |
 * | S4   | snapshot with invalid rows                         | Abnormal           | issues returned                              |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../CandleStore';
import { RealtimeBarAggregator } from '../RealtimeBarAggregator';
import { bar, bars, MIN, minutes, T0 } from './bars';

const at = (minute: number, secondMs = 0) => T0 + minute * MIN + secondMs;

function setup(
  options: Partial<ConstructorParameters<typeof RealtimeBarAggregator>[1]> = {}
) {
  const store = new CandleStore();
  const agg = new RealtimeBarAggregator(store, { timeframe: '1m', ...options });
  return { store, agg };
}

describe('RealtimeBarAggregator: trades', () => {
  it('C1: rejects an invalid timeframe', () => {
    // Given / When / Then
    expect(
      () => new RealtimeBarAggregator(new CandleStore(), { timeframe: '1q' })
    ).toThrow(new RangeError('Invalid timeframe: 1q'));
  });

  it('T1: first trade opens an aligned bar', () => {
    // Given
    const { store, agg } = setup();
    // When
    const result = agg.addTrade(100, 2, at(3, 12_345));
    // Then
    expect(result).toBe('created');
    expect(store.get(0)).toEqual({
      time: at(3),
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 2,
    });
    expect(agg.timeframe.ms).toBe(MIN);
  });

  it('T2: trades in one interval update the bar', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0, 1000));
    // When
    const results = [
      agg.addTrade(105, 1, at(0, 2000)),
      agg.addTrade(95, 1, at(0, 3000)),
      agg.addTrade(101, 0.5, at(0, 4000)),
    ];
    // Then
    expect(results).toEqual(['updated', 'updated', 'updated']);
    expect(store.length).toBe(1);
    expect(store.get(0)).toMatchObject({
      open: 100,
      high: 105,
      low: 95,
      close: 101,
      volume: 3.5,
    });
  });

  it('T3/T4: rollover exactly at the boundary', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0));
    // When
    const before = agg.addTrade(101, 1, at(1) - 1);
    const after = agg.addTrade(102, 1, at(1));
    // Then
    expect(before).toBe('updated');
    expect(after).toBe('created');
    expect(minutes(store)).toEqual([0, 1]);
    expect(store.get(1)?.open).toBe(102);
  });

  it('T5: gaps stay gaps by default', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0));
    // When
    agg.addTrade(110, 1, at(5));
    // Then
    expect(minutes(store)).toEqual([0, 5]);
  });

  it('T6: fillGaps inserts flat bars', () => {
    // Given
    const { store, agg } = setup({ fillGaps: true });
    agg.addTrade(100, 1, at(0));
    agg.addTrade(104, 1, at(0, 10));
    // When
    agg.addTrade(110, 1, at(3));
    // Then
    expect(minutes(store)).toEqual([0, 1, 2, 3]);
    expect(store.get(1)).toEqual({
      time: at(1),
      open: 104,
      high: 104,
      low: 104,
      close: 104,
      volume: 0,
    });
  });

  it('T7: gaps above maxGapFillBars are not filled', () => {
    // Given
    const { store, agg } = setup({ fillGaps: true, maxGapFillBars: 3 });
    agg.addTrade(100, 1, at(0));
    // When
    agg.addTrade(100, 1, at(5));
    agg.addTrade(100, 1, at(9));
    // Then: 4-bar gap skipped, 3-bar gap filled
    expect(minutes(store)).toEqual([0, 5, 6, 7, 8, 9]);
  });

  it('T8: an older trade inside the live bar keeps the close', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0, 30_000));
    // When
    const result = agg.addTrade(90, 1, at(0, 10_000));
    // Then
    expect(result).toBe('updated');
    expect(store.get(0)).toMatchObject({ low: 90, close: 100, volume: 2 });
  });

  it('T9: late trade patches a stored older bar', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0));
    agg.addTrade(101, 1, at(1));
    const kinds: string[] = [];
    store.subscribe((c) => kinds.push(c.kind));
    // When
    const result = agg.addTrade(120, 2, at(0, 59_000));
    // Then
    expect(result).toBe('patched');
    expect(store.get(0)).toMatchObject({ high: 120, close: 100, volume: 3 });
    expect(kinds).toEqual(['patch']);
  });

  it('T10: lateTicks ignore drops late trades', () => {
    // Given
    const { store, agg } = setup({ lateTicks: 'ignore' });
    agg.addTrade(100, 1, at(0));
    agg.addTrade(101, 1, at(1));
    // When
    const result = agg.addTrade(120, 2, at(0, 59_000));
    // Then
    expect(result).toBe('ignored');
    expect(store.get(0)?.high).toBe(100);
  });

  it('T11: late trade for a missing bar is ignored', () => {
    // Given: bars at minutes 0 and 5
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0));
    agg.addTrade(100, 1, at(5));
    // When
    const result = agg.addTrade(100, 1, at(3));
    // Then
    expect(result).toBe('ignored');
    expect(minutes(store)).toEqual([0, 5]);
  });

  it.each([
    [NaN, 1, at(0)],
    [Infinity, 1, at(0)],
    [100, -1, at(0)],
    [100, NaN, at(0)],
    [100, 1, -5],
    [100, 1, NaN],
    [100, 1, 1.5],
  ])('T12: rejects trade (%p, %p, %p)', (price, qty, time) => {
    // Given
    const { store, agg } = setup();
    // When
    const result = agg.addTrade(price, qty, time);
    // Then
    expect(result).toBe('rejected');
    expect(store.version).toBe(0);
  });

  it('T13: zero quantity is accepted', () => {
    // Given
    const { store, agg } = setup();
    // When / Then
    expect(agg.addTrade(100, 0, at(0))).toBe('created');
    expect(store.get(0)?.volume).toBe(0);
  });

  it('T14: store reset clears trade ordering state', () => {
    // Given: a trade at :50 set the close
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0, 50_000));
    // When: the dataset is replaced, then an earlier-in-bar trade arrives
    store.setData([bar(0, 100)]);
    agg.addTrade(77, 1, at(0, 10_000));
    // Then: nothing remembers the old :50 trade, so close is taken
    expect(store.get(0)?.close).toBe(77);
  });

  it('T15: monthly bars fill calendar months', () => {
    // Given
    const store = new CandleStore();
    const agg = new RealtimeBarAggregator(store, {
      timeframe: '1M',
      fillGaps: true,
    });
    agg.addTrade(10, 1, Date.UTC(2024, 0, 20));
    // When
    agg.addTrade(12, 1, Date.UTC(2024, 3, 2));
    // Then
    expect(store.getRange(0, 9).map((c) => c.time)).toEqual([
      Date.UTC(2024, 0, 1),
      Date.UTC(2024, 1, 1),
      Date.UTC(2024, 2, 1),
      Date.UTC(2024, 3, 1),
    ]);
  });
});

describe('RealtimeBarAggregator: klines & snapshots', () => {
  const kline = (minute: number, c: number, isClosed?: boolean) => ({
    t: at(minute),
    o: c,
    h: c + 1,
    l: c - 1,
    c,
    v: 5,
    isClosed,
  });

  it('K1: upsert creates, updates, patches and inserts', () => {
    // Given
    const { store, agg } = setup();
    // When / Then
    expect(agg.upsertBar(kline(0, 100))).toBe('created');
    expect(agg.upsertBar(kline(2, 100))).toBe('created');
    expect(agg.upsertBar(kline(2, 101))).toBe('updated');
    expect(agg.upsertBar(kline(0, 99))).toBe('patched');
    expect(agg.upsertBar(kline(1, 50))).toBe('patched');
    expect(minutes(store)).toEqual([0, 1, 2]);
    expect(store.getRange(0, 3).map((c) => c.close)).toEqual([99, 50, 101]);
  });

  it('K2: accepts numeric strings (Binance payload)', () => {
    // Given
    const { store, agg } = setup();
    // When
    const result = agg.upsertBar({
      t: at(0),
      o: '100.5',
      h: '101',
      l: '99',
      c: '100',
      v: '12.5',
    });
    // Then
    expect(result).toBe('created');
    expect(store.get(0)).toMatchObject({ open: 100.5, volume: 12.5 });
  });

  it.each([
    [{ ...kline(0, 100), c: 'abc' }],
    [{ ...kline(0, 100), h: 1 }],
    [{ ...kline(0, 100), t: -1 }],
  ])('K3: rejects an invalid kline', (k) => {
    // Given
    const { store, agg } = setup();
    // When / Then
    expect(agg.upsertBar(k)).toBe('rejected');
    expect(store.length).toBe(0);
  });

  it('K4: trades for a closed kline bucket are ignored', () => {
    // Given
    const { store, agg } = setup();
    agg.upsertBar(kline(0, 100, true));
    agg.upsertBar(kline(0, 100, true));
    // When
    const result = agg.addTrade(500, 1, at(0, 30_000));
    // Then
    expect(result).toBe('ignored');
    expect(store.get(0)?.high).toBe(101);
  });

  it('K5: a kline resets the trade ordering of its bucket', () => {
    // Given
    const { store, agg } = setup();
    agg.addTrade(100, 1, at(0, 50_000));
    agg.upsertBar(kline(0, 100));
    // When: a trade older than the previous one
    agg.addTrade(100.5, 1, at(0, 40_000));
    // Then
    expect(store.get(0)?.close).toBe(100.5);
  });

  it('K6: kline gaps can be filled', () => {
    // Given
    const { store, agg } = setup({ fillGaps: true });
    agg.upsertBar(kline(0, 100));
    // When
    agg.upsertBar(kline(3, 100));
    // Then
    expect(minutes(store)).toEqual([0, 1, 2, 3]);
  });

  it('S1: merge snapshot replaces matching bars', () => {
    // Given: realtime built 0..3
    const { store, agg } = setup();
    [0, 1, 2, 3].forEach((m) => agg.addTrade(1, 1, at(m)));
    // When: REST snapshot for 2..4
    const issues = agg.applySnapshot(bars(2, 4));
    // Then
    expect(issues).toEqual([]);
    expect(minutes(store)).toEqual([0, 1, 2, 3, 4]);
    expect(store.get(3)).toEqual(bar(3));
    expect(store.get(0)?.close).toBe(1);
  });

  it('S2: replace snapshot drops unconfirmed bars', () => {
    // Given: gap-filled bars 1..2 that the exchange never had
    const { store, agg } = setup({ fillGaps: true });
    agg.addTrade(1, 1, at(0));
    agg.addTrade(1, 1, at(3));
    // When
    agg.applySnapshot([bar(0), bar(3)], 'replace');
    // Then
    expect(minutes(store)).toEqual([0, 3]);
    expect(store.get(0)).toEqual(bar(0));
  });

  it('S3: snapshot into an empty store / empty snapshot', () => {
    // Given
    const { store, agg } = setup();
    // When
    agg.applySnapshot([], 'replace');
    agg.applySnapshot(bars(0, 2), 'replace');
    // Then
    expect(minutes(store)).toEqual([0, 1, 2]);
    expect(agg.addTrade(1, 1, at(2, 5))).toBe('updated');
  });

  it('S4: invalid snapshot rows are reported', () => {
    // Given
    const { agg } = setup();
    // When
    const issues = agg.applySnapshot([null, bar(0)], 'replace');
    // Then
    expect(issues).toEqual([{ index: 0, reason: 'NOT_AN_OBJECT' }]);
  });
});
