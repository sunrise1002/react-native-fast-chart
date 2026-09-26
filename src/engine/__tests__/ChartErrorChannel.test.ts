/**
 * Test perspective table — ChartErrorChannel / ChartDataFeed error reports
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                    |
 * |------|-------------------------------------------------------|--------------------|---------------------------------------------|
 * | EC1  | two listeners, report                                 | Equivalence        | both called in order                        |
 * | EC2  | throwing first listener                               | Abnormal           | second still called, report does not throw  |
 * | EC3  | unsubscribe (twice) / clear                           | Equivalence        | size 1 → 0, idempotent                      |
 * | EC4  | report with no listeners                              | Boundary (empty)   | no-op                                       |
 * | EI1  | droppedRowsIssue with / without issues                | Equivalence        | message + details (firstIndex/Reason)       |
 * | EI2  | droppedRowsIssue 0 of 0                               | Boundary (0)       | "0 of 0 candles dropped"                    |
 * | EI3  | rejectedBarIssue with bar / null / primitive          | Invalid input      | time from bar / undefined                   |
 * | EH1  | history handler throws                                | External dep. fail | one 'history' issue with that error         |
 * | EH2  | same error state notified twice                       | Equivalence        | reported once                               |
 * | EH3  | retry fails again with a new error                    | Equivalence        | reported again                              |
 * | EH4  | recovered, then fails with the same error object      | State              | reported again                              |
 * | EH5  | unsubscribe                                           | Equivalence        | no more reports                             |
 * | DF1  | setData with malformed rows                           | Invalid            | issues returned, one 'data' issue           |
 * | DF2  | setData all valid / empty                             | Boundary (empty)   | no issue                                    |
 * | DF3  | candles prop reset with invalid rows / valid prop     | Invalid            | one issue / none                            |
 * | DF4  | appendBar / updateLastBar / upsertBar invalid bar     | Invalid            | false / 'rejected' + operation issue        |
 * | DF5  | valid realtime bars                                   | Equivalence        | no issue                                    |
 * | DF6  | release() then the same prop                          | State              | treated as a reset                          |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Candle } from '../../data/Candle';
import { CandleStore } from '../../data/CandleStore';
import type {
  ChartErrorEvent,
  ChartErrorHandler,
} from '../../core/ChartErrors';
import { HistoryLoader } from '../../history/HistoryLoader';
import { ChartDataFeed } from '../ChartDataFeed';
import {
  ChartErrorChannel,
  droppedRowsIssue,
  rejectedBarIssue,
  reportHistoryErrors,
} from '../ChartErrorChannel';

const MIN = 60_000;
const bar = (i: number, close = 10): Candle => ({
  time: i * MIN,
  open: 10,
  high: Math.max(11, close),
  low: Math.min(9, close),
  close,
  volume: 1,
});
const BAD = { ...bar(5), high: NaN } as Candle;

let channel: ChartErrorChannel;
let events: ChartErrorEvent[];

beforeEach(() => {
  channel = new ChartErrorChannel();
  events = [];
  channel.subscribe((e) => events.push(e));
});

describe('ChartErrorChannel', () => {
  it('EC1: fans out in order', () => {
    // Given
    const order: string[] = [];
    const c = new ChartErrorChannel();
    c.subscribe(() => order.push('a'));
    c.subscribe(() => order.push('b'));
    // When
    c.report(droppedRowsIssue(1, 0));
    // Then
    expect(order).toEqual(['a', 'b']);
  });

  it('EC2: a throwing listener does not stop the others', () => {
    // Given
    const c = new ChartErrorChannel();
    const second = jest.fn<ChartErrorHandler>();
    c.subscribe(() => {
      throw new Error('listener');
    });
    c.subscribe(second);
    // When / Then
    expect(() => c.report(droppedRowsIssue(1, 0))).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('EC3: unsubscribe and clear', () => {
    // Given
    const c = new ChartErrorChannel();
    const off = c.subscribe(() => {});
    c.subscribe(() => {});
    // When
    off();
    off();
    // Then
    expect(c.size).toBe(1);
    c.clear();
    expect(c.size).toBe(0);
  });

  it('EC4: reporting without listeners is a no-op', () => {
    // Given / When / Then
    expect(() =>
      new ChartErrorChannel().report(droppedRowsIssue(1, 0))
    ).not.toThrow();
  });
});

describe('issue builders', () => {
  it('EI1: dropped rows', () => {
    // Given / When
    const plain = droppedRowsIssue(10, 7);
    const detailed = droppedRowsIssue(10, 9, [
      { index: 3, reason: 'NON_FINITE_PRICE' },
    ]);
    // Then
    expect(plain.source).toBe('data');
    expect(plain.fatal).toBe(false);
    expect(plain.error.message).toBe(
      '3 of 10 candles dropped (malformed or duplicate)'
    );
    expect(plain.details).toEqual({ received: 10, kept: 7 });
    expect(detailed.details).toEqual({
      received: 10,
      kept: 9,
      firstIndex: 3,
      firstReason: 'NON_FINITE_PRICE',
    });
  });

  it('EI2: zero rows', () => {
    // Given / When / Then
    expect(droppedRowsIssue(0, 0, []).error.message).toBe(
      '0 of 0 candles dropped (malformed or duplicate)'
    );
  });

  it.each<[unknown, unknown]>([
    [bar(3), 3 * MIN],
    [null, undefined],
    [42, undefined],
  ])('EI3: rejected bar %p → time %p', (value, time) => {
    // Given / When
    const event = rejectedBarIssue('appendBar', value);
    // Then
    expect(event.error.message).toBe('appendBar rejected an invalid bar');
    expect(event.details).toEqual({ operation: 'appendBar', time });
  });
});

describe('reportHistoryErrors', () => {
  let clock = 0;
  const setup = () => {
    const store = new CandleStore();
    store.setData([bar(10), bar(11)]);
    const history = new HistoryLoader(store, {
      retryDelayMs: 0,
      now: () => clock,
    });
    const off = reportHistoryErrors(history, channel);
    return { history, off };
  };

  it('EH1: a throwing handler is reported', () => {
    // Given
    const { history } = setup();
    const error = new Error('network');
    history.setHandler(() => {
      throw error;
    });
    // When
    history.request();
    // Then
    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe('history');
    expect(events[0]?.error).toBe(error);
  });

  it('EH2: the same error state is reported once', () => {
    // Given
    const { history } = setup();
    history.setHandler(() => {
      throw new Error('x');
    });
    history.request();
    // When: another notification while still in 'error'
    history.setRetryDelay(1);
    history.setHasMore(false);
    // Then
    expect(events).toHaveLength(1);
  });

  it('EH3/EH4: new failures are reported again', () => {
    // Given
    const { history } = setup();
    const same = new Error('same');
    let error: Error = new Error('first');
    history.setHandler(() => {
      throw error;
    });
    history.request();
    // When
    error = new Error('second');
    clock += 10;
    history.request();
    history.setHasMore(true);
    error = same;
    history.request();
    history.setHasMore(true);
    history.request();
    // Then
    expect(events.map((e) => e.error.message)).toEqual([
      'first',
      'second',
      'same',
      'same',
    ]);
  });

  it('EH5: unsubscribe stops reports', () => {
    // Given
    const { history, off } = setup();
    history.setHandler(() => {
      throw new Error('x');
    });
    // When
    off();
    history.request();
    // Then
    expect(events).toHaveLength(0);
  });
});

describe('ChartDataFeed', () => {
  let store: CandleStore;
  let feed: ChartDataFeed;

  beforeEach(() => {
    store = new CandleStore();
    feed = new ChartDataFeed(store, channel);
  });

  it('DF1: malformed rows are dropped and reported', () => {
    // Given
    const rows = [bar(1), BAD, bar(6)];
    // When
    const issues = feed.setData(rows, { viewport: 'keepZoom' });
    // Then
    expect(issues).toHaveLength(1);
    expect(store.length).toBe(2);
    expect(feed.resetPolicy).toBe('keepZoom');
    expect(events).toHaveLength(1);
    expect(events[0]?.error.message).toBe(
      '1 of 3 candles dropped (malformed or duplicate)'
    );
    expect(events[0]?.details).toMatchObject({ firstIndex: 1 });
  });

  it.each([[[bar(1), bar(2)]], [[]]])('DF2: %p → no issue', (rows) => {
    // Given / When
    feed.setData(rows);
    // Then
    expect(events).toHaveLength(0);
    expect(feed.resetPolicy).toBe('reset');
  });

  it('DF3: candles prop reset with invalid rows', () => {
    // Given / When
    feed.syncCandles([bar(1), BAD]);
    feed.syncCandles([bar(1), bar(2)]);
    // Then
    expect(events).toHaveLength(1);
    expect(events[0]?.error.message).toBe(
      '1 of 2 candles dropped (malformed or duplicate)'
    );
    expect(feed.resetPolicy).toBe('reset');
  });

  it('DF4: rejected realtime bars are reported', () => {
    // Given
    feed.setData([bar(1), bar(2)]);
    // When
    const results = [
      feed.appendBar(BAD),
      feed.updateLastBar(BAD),
      feed.upsertBar(BAD),
    ];
    // Then
    expect(results).toEqual([false, false, 'rejected']);
    expect(events.map((e) => e.details?.operation)).toEqual([
      'appendBar',
      'updateLastBar',
      'upsertBar',
    ]);
  });

  it('DF5: valid bars report nothing', () => {
    // Given
    feed.setData([bar(1)]);
    // When
    feed.appendBar(bar(2));
    feed.updateLastBar(bar(2, 10.5));
    feed.upsertBar(bar(3));
    feed.prependBars([bar(0)]);
    // Then
    expect(store.length).toBe(4);
    expect(events).toHaveLength(0);
  });

  it('DF6: release forgets the last prop', () => {
    // Given
    const rows = [bar(1), bar(2)];
    feed.syncCandles(rows);
    // When
    feed.release();
    const applied = feed.syncCandles(rows);
    // Then
    expect(applied).toBe('reset');
  });
});
