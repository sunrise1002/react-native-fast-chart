import type { Candle } from './Candle';
import type { CandleStore } from './CandleStore';
import { getBarValuesIssue, normalizeCandles } from './CandleValidation';
import type { CandleIssue } from './CandleValidation';
import { mergeCandles } from './HistoryMerge';
import {
  getBucketStart,
  getNextBucketStart,
  parseTimeframe,
  type TimeframeSpec,
} from './Timeframe';

/**
 * Outcome of one realtime update:
 * - `created`: a new bar was appended (timeframe rollover).
 * - `updated`: the last (live) bar was updated in place.
 * - `patched`: an older bar was updated or inserted (late data).
 * - `ignored`: valid but intentionally not applied (see `lateTicks`).
 * - `rejected`: invalid input (NaN, negative size, bad time, ...).
 */
export type AggregateResult =
  'created' | 'updated' | 'patched' | 'ignored' | 'rejected';

export interface RealtimeBarAggregatorOptions {
  /** Bar interval, e.g. `'1m'` (see `parseTimeframe`). */
  timeframe: string;
  /**
   * Insert flat bars (`o=h=l=c=previous close`, `volume 0`) for intervals
   * without trades. Default `false`: gaps stay gaps, no fabricated bars.
   */
  fillGaps?: boolean;
  /** Gaps longer than this are never filled. Default `10_000`. */
  maxGapFillBars?: number;
  /**
   * Trades older than the live bar: `'apply'` (default) updates the matching
   * stored bar's high/low/volume (its close is kept — later trades already
   * set it); `'ignore'` drops them. Trades for bars not in the store are
   * always ignored (a single trade must not fabricate a historical bar).
   */
  lateTicks?: 'apply' | 'ignore';
}

/** Pre-aggregated kline update (Binance `k` payload field names). */
export interface KlineUpdate {
  /** Bar open time, Unix ms (used as-is). */
  t: number;
  o: number | string;
  h: number | string;
  l: number | string;
  c: number | string;
  v: number | string;
  /** Exchange says the bar is final; later trades for it are ignored. */
  isClosed?: boolean;
}

/** How `applySnapshot` treats the store's bars inside the snapshot range. */
export type SnapshotMode = 'merge' | 'replace';

const DEFAULT_MAX_GAP_FILL = 10_000;

/**
 * Turns trades or kline updates into OHLCV bars in a `CandleStore`
 * (spec §9, Phase 1.3). Trades never allocate on the hot path (`updated`).
 * Detects store resets (symbol/timeframe switch) via `store.resetVersion`.
 */
export class RealtimeBarAggregator {
  readonly timeframe: TimeframeSpec;
  private readonly fillGaps: boolean;
  private readonly maxGapFillBars: number;
  private readonly applyLateTicks: boolean;
  private seenResetVersion = -1;
  /** Bucket of the bar whose close was set by `lastTradeTime`. */
  private tradeBucket = NaN;
  private lastTradeTime = -Infinity;
  /** Bars at or before this time are final (from `isClosed` klines). */
  private closedUntil = -Infinity;

  /** @throws {RangeError} when `options.timeframe` is malformed. */
  constructor(
    private readonly store: CandleStore,
    options: RealtimeBarAggregatorOptions
  ) {
    const spec = parseTimeframe(options.timeframe);
    if (spec === null) {
      throw new RangeError(`Invalid timeframe: ${String(options.timeframe)}`);
    }
    this.timeframe = spec;
    this.fillGaps = options.fillGaps ?? false;
    this.maxGapFillBars = options.maxGapFillBars ?? DEFAULT_MAX_GAP_FILL;
    this.applyLateTicks = options.lateTicks !== 'ignore';
  }

  /** Aggregates one trade. `time` is the trade time in Unix ms. */
  addTrade(price: number, quantity: number, time: number): AggregateResult {
    if (
      getBarValuesIssue(time, price, price, price, price, quantity) !== null
    ) {
      return 'rejected';
    }
    this.syncWithStore();
    const store = this.store;
    const bucket = getBucketStart(time, this.timeframe);
    if (bucket <= this.closedUntil) {
      return 'ignored';
    }
    const n = store.length;
    const last = n > 0 ? store.lastTime : -Infinity;
    if (bucket > last) {
      this.fillGapsBefore(bucket);
      store.appendValues(bucket, price, price, price, price, quantity);
      this.tradeBucket = bucket;
      this.lastTradeTime = time;
      return 'created';
    }
    const cols = store.columns;
    if (bucket === last) {
      const p = cols.offset + n - 1;
      const isLatest =
        bucket !== this.tradeBucket || time >= this.lastTradeTime;
      store.updateLastValues(
        cols.open[p] as number,
        Math.max(cols.high[p] as number, price),
        Math.min(cols.low[p] as number, price),
        isLatest ? price : (cols.close[p] as number),
        (cols.volume[p] as number) + quantity
      );
      if (isLatest) {
        this.tradeBucket = bucket;
        this.lastTradeTime = time;
      }
      return 'updated';
    }
    const index = this.applyLateTicks ? store.findIndexByTime(bucket) : -1;
    if (index < 0) {
      return 'ignored';
    }
    const p = cols.offset + index;
    store.updateValuesAt(
      index,
      cols.open[p] as number,
      Math.max(cols.high[p] as number, price),
      Math.min(cols.low[p] as number, price),
      cols.close[p] as number,
      (cols.volume[p] as number) + quantity
    );
    return 'patched';
  }

  /** Inserts or replaces a complete bar (exchange kline stream). */
  upsertBar(kline: KlineUpdate): AggregateResult {
    const time = kline.t;
    const open = Number(kline.o);
    const high = Number(kline.h);
    const low = Number(kline.l);
    const close = Number(kline.c);
    const volume = Number(kline.v);
    if (getBarValuesIssue(time, open, high, low, close, volume) !== null) {
      return 'rejected';
    }
    this.syncWithStore();
    const store = this.store;
    const n = store.length;
    const last = n > 0 ? store.lastTime : -Infinity;
    let result: AggregateResult;
    if (time > last) {
      this.fillGapsBefore(time);
      store.appendValues(time, open, high, low, close, volume);
      result = 'created';
    } else if (time === last) {
      store.updateLastValues(open, high, low, close, volume);
      result = 'updated';
    } else {
      const index = store.findIndexByTime(time);
      const bar: Candle = { time, open, high, low, close, volume };
      if (index >= 0) {
        store.updateValuesAt(index, open, high, low, close, volume);
      } else {
        store.splice(store.lowerBound(time), 0, [bar]);
      }
      result = 'patched';
    }
    // A full bar supersedes the trade-derived close of that bucket.
    if (time === this.tradeBucket) {
      this.lastTradeTime = -Infinity;
    }
    if (kline.isClosed === true && time > this.closedUntil) {
      this.closedUntil = time;
    }
    return result;
  }

  /**
   * Applies a reconnect snapshot (typically the last N bars from REST).
   * `'merge'` (default): snapshot bars replace matching bars, missing bars
   * are added, other stored bars are kept. `'replace'`: every stored bar at
   * or after the snapshot's first time is dropped first (removes bars built
   * from ticks received before the disconnect that the exchange never
   * confirmed). Returns the snapshot rows dropped by normalization.
   */
  applySnapshot(
    input: readonly unknown[],
    mode: SnapshotMode = 'merge'
  ): CandleIssue[] {
    this.syncWithStore();
    this.tradeBucket = NaN;
    this.lastTradeTime = -Infinity;
    this.closedUntil = -Infinity;
    if (mode === 'merge') {
      return mergeCandles(this.store, input, { policy: 'replace' }).issues;
    }
    const { candles, issues } = normalizeCandles(input);
    const store = this.store;
    if (candles.length === 0) {
      return issues;
    }
    if (store.length === 0) {
      store.setData(candles);
    } else {
      const from = store.lowerBound((candles[0] as Candle).time);
      store.splice(from, store.length - from, candles);
    }
    this.seenResetVersion = store.resetVersion;
    return issues;
  }

  /** Forgets per-bar trade state (call after switching symbol manually). */
  reset(): void {
    this.tradeBucket = NaN;
    this.lastTradeTime = -Infinity;
    this.closedUntil = -Infinity;
    this.seenResetVersion = this.store.resetVersion;
  }

  private syncWithStore(): void {
    if (this.seenResetVersion !== this.store.resetVersion) {
      this.reset();
    }
  }

  private fillGapsBefore(bucket: number): void {
    const store = this.store;
    const n = store.length;
    if (!this.fillGaps || n === 0) {
      return;
    }
    const cols = store.columns;
    const prevClose = cols.close[cols.offset + n - 1] as number;
    const bars: Candle[] = [];
    let t = getNextBucketStart(store.lastTime, this.timeframe);
    while (t < bucket) {
      if (bars.length >= this.maxGapFillBars) {
        return;
      }
      bars.push({
        time: t,
        open: prevClose,
        high: prevClose,
        low: prevClose,
        close: prevClose,
        volume: 0,
      });
      t = getNextBucketStart(t, this.timeframe);
    }
    store.appendMany(bars); // no-op for an empty list
  }
}
