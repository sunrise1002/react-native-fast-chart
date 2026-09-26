import type { Candle } from './Candle';
import { CandleBuffer, type CandleColumns } from './CandleBuffer';
import {
  getBarValuesIssue,
  normalizeCandles,
  type CandleIssue,
} from './CandleValidation';
import {
  findExactIndex,
  findNearest,
  lowerBound,
  upperBound,
} from './TimeSearch';

/**
 * What a mutation did:
 * - `reset`: whole dataset replaced (`count` = new length, `fromIndex` 0).
 * - `append`: `count` bars added at the end (`fromIndex` = first new index).
 * - `updateLast`: last bar changed in place (`count` 0).
 * - `prepend`: `count` bars added at the front; every previous index shifted
 *   by `count` (`fromIndex` 0).
 * - `patch`: bars from `fromIndex` on may differ; `count` = length delta.
 */
export type CandleStoreChangeKind =
  'reset' | 'append' | 'updateLast' | 'prepend' | 'patch';

/** Change notification of a `CandleStore` (reused object — copy fields to keep them). */
export interface CandleStoreChange {
  readonly kind: CandleStoreChangeKind;
  /** Store version after the change. */
  readonly version: number;
  readonly count: number;
  readonly fromIndex: number;
}

/**
 * Receives every change synchronously. The `change` object is reused by the
 * store: copy fields you want to keep, do not retain the object.
 */
export type CandleStoreListener = (
  change: CandleStoreChange,
  store: CandleStore
) => void;

interface MutableChange {
  kind: CandleStoreChangeKind;
  version: number;
  count: number;
  fromIndex: number;
}

function firstInvalid(candles: readonly Candle[], minTime: number): number {
  let last = minTime;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i] as Candle;
    if (
      c === null ||
      typeof c !== 'object' ||
      getBarValuesIssue(c.time, c.open, c.high, c.low, c.close, c.volume) !==
        null ||
      c.time <= last
    ) {
      return i;
    }
    last = c.time;
  }
  return -1;
}

/**
 * Sorted OHLCV storage (spec §8.2). Bars are strictly ascending by `time`
 * (Unix ms, bar open). Data lives in `Float64Array` columns (`columns`);
 * `Candle` objects are only created by the convenience accessors.
 *
 * Mutations validate their input and return `false` (no change, no event)
 * when rejected, so hot realtime paths never throw. `setData` is the only
 * tolerant entry point (it normalizes). Overlapping/unsorted history goes
 * through `mergeCandles` (`HistoryMerge.ts`).
 */
export class CandleStore {
  private readonly buffer = new CandleBuffer();
  private listeners: readonly CandleStoreListener[] = [];
  private readonly change: MutableChange = {
    kind: 'reset',
    version: 0,
    count: 0,
    fromIndex: 0,
  };
  private versionValue = 0;
  private resetVersionValue = 0;
  private prependedValue = 0;

  constructor(initial?: readonly unknown[]) {
    if (initial !== undefined) {
      this.setData(initial);
    }
  }

  /** Bumped on every mutation. */
  get version(): number {
    return this.versionValue;
  }
  /** Version of the last `reset`; pollers rebuild when it moved. */
  get resetVersion(): number {
    return this.resetVersionValue;
  }
  /** Bars prepended since the last reset; the difference between two reads
   *  is the index shift to apply to cached indices. */
  get prependedSinceReset(): number {
    return this.prependedValue;
  }
  get lastChange(): CandleStoreChange {
    return this.change;
  }
  get length(): number {
    return this.buffer.length;
  }
  /** Raw columns for zero-allocation readers. Re-read after mutations. */
  get columns(): CandleColumns {
    return this.buffer.columns;
  }
  /** Time of bar `i`, or `NaN` when out of range. */
  timeAt(i: number): number {
    const c = this.buffer.columns;
    return i >= 0 && i < c.length ? (c.time[c.offset + i] as number) : NaN;
  }
  get firstTime(): number {
    return this.timeAt(0);
  }
  get lastTime(): number {
    return this.timeAt(this.buffer.length - 1);
  }

  subscribe(listener: CandleStoreListener): () => void {
    this.listeners = [...this.listeners, listener];
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Replaces the dataset. Already-clean input is copied in one pass;
   * anything else goes through `normalizeCandles` (sort, dedupe, drop
   * invalid). Returns the dropped rows.
   */
  setData(input: readonly unknown[]): CandleIssue[] {
    let candles = input as readonly Candle[];
    let issues: CandleIssue[] = [];
    if (firstInvalid(candles, -1) !== -1) {
      const result = normalizeCandles(input);
      candles = result.candles;
      issues = result.issues;
    }
    this.buffer.reset(candles.length);
    this.buffer.growBack(candles.length);
    this.writeFrom(0, candles);
    this.emit('reset', candles.length, 0);
    return issues;
  }

  clear(): void {
    this.buffer.reset(0);
    this.emit('reset', 0, 0);
  }

  append(candle: Candle): boolean {
    return this.appendValues(
      candle.time,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume
    );
  }

  /** Appends a bar newer than the last one. Allocation-free. */
  appendValues(
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): boolean {
    const n = this.buffer.length;
    if (
      getBarValuesIssue(time, open, high, low, close, volume) !== null ||
      (n > 0 && time <= this.lastTime)
    ) {
      return false;
    }
    this.buffer.reserveBack(1);
    this.buffer.growBack(1);
    this.buffer.write(n, time, open, high, low, close, volume);
    this.emit('append', 1, n);
    return true;
  }

  /** Appends several bars (all-or-nothing, one `append` event). */
  appendMany(candles: readonly Candle[]): boolean {
    const n = this.buffer.length;
    const minTime = n > 0 ? this.lastTime : -1;
    if (candles.length === 0 || firstInvalid(candles, minTime) !== -1) {
      return false;
    }
    this.buffer.reserveBack(candles.length);
    this.buffer.growBack(candles.length);
    this.writeFrom(n, candles);
    this.emit('append', candles.length, n);
    return true;
  }

  /** Replaces the last bar; `candle.time` must equal the last bar's time. */
  updateLast(candle: Candle): boolean {
    return (
      candle.time === this.lastTime &&
      this.updateLastValues(
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume
      )
    );
  }

  /** Overwrites the last bar's values (time unchanged). Allocation-free. */
  updateLastValues(
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): boolean {
    return this.updateValuesAt(
      this.buffer.length - 1,
      open,
      high,
      low,
      close,
      volume
    );
  }

  /** Overwrites bar `index` in place. Emits `updateLast` or `patch`. */
  updateValuesAt(
    index: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): boolean {
    const n = this.buffer.length;
    if (!Number.isInteger(index) || index < 0 || index >= n) {
      return false;
    }
    const time = this.timeAt(index);
    if (getBarValuesIssue(time, open, high, low, close, volume) !== null) {
      return false;
    }
    this.buffer.write(index, time, open, high, low, close, volume);
    if (index === n - 1) {
      this.emit('updateLast', 0, index);
    } else {
      this.emit('patch', 0, index);
    }
    return true;
  }

  /**
   * Prepends strictly older, sorted, valid bars (all-or-nothing). Amortized
   * O(k) — no full copy per call. Use `mergeCandles` for overlapping pages.
   */
  prepend(candles: readonly Candle[]): boolean {
    const k = candles.length;
    const n = this.buffer.length;
    if (
      k === 0 ||
      firstInvalid(candles, -1) !== -1 ||
      (n > 0 && (candles[k - 1] as Candle).time >= this.firstTime)
    ) {
      return false;
    }
    this.buffer.reserveFront(k);
    this.buffer.growFront(k);
    this.writeFrom(0, candles);
    this.emit('prepend', k, 0);
    return true;
  }

  /**
   * Replaces bars `[from, from + deleteCount)` with `candles`, keeping the
   * store strictly sorted (all-or-nothing). Emits one `patch` event.
   */
  splice(
    from: number,
    deleteCount: number,
    candles: readonly Candle[]
  ): boolean {
    const n = this.buffer.length;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(deleteCount) ||
      from < 0 ||
      deleteCount < 0 ||
      from + deleteCount > n ||
      (deleteCount === 0 && candles.length === 0)
    ) {
      return false;
    }
    const before = from > 0 ? this.timeAt(from - 1) : -1;
    const after =
      from + deleteCount < n ? this.timeAt(from + deleteCount) : Infinity;
    const k = candles.length;
    if (
      firstInvalid(candles, before) !== -1 ||
      (k > 0 && (candles[k - 1] as Candle).time >= after)
    ) {
      return false;
    }
    this.buffer.splice(from, deleteCount, k);
    this.writeFrom(from, candles);
    this.emit('patch', k - deleteCount, from);
    return true;
  }

  /** New `Candle` for bar `i`, or `undefined` when out of range. */
  get(i: number): Candle | undefined {
    const c = this.buffer.columns;
    if (!(i >= 0 && i < c.length) || !Number.isInteger(i)) {
      return undefined;
    }
    const p = c.offset + i;
    return {
      time: c.time[p] as number,
      open: c.open[p] as number,
      high: c.high[p] as number,
      low: c.low[p] as number,
      close: c.close[p] as number,
      volume: c.volume[p] as number,
    };
  }

  /** Bars `[start, end)` (clamped, like `Array.prototype.slice`). */
  getRange(start: number, end: number): Candle[] {
    const n = this.buffer.length;
    const from = Math.max(0, Math.ceil(Number.isNaN(start) ? 0 : start));
    const to = Math.min(n, Math.ceil(Number.isNaN(end) ? 0 : end));
    const out: Candle[] = [];
    for (let i = from; i < to; i++) {
      out.push(this.get(i) as Candle);
    }
    return out;
  }

  /** Exact match, or `-1`. */
  findIndexByTime(time: number): number {
    const c = this.buffer.columns;
    return findExactIndex(c.time, c.offset, c.length, time);
  }

  /** Closest bar (ties → earlier), or `-1` when empty / NaN. */
  findNearestIndex(time: number): number {
    const c = this.buffer.columns;
    return findNearest(c.time, c.offset, c.length, time);
  }

  /** First index with `time >= t` (`length` when none). */
  lowerBound(time: number): number {
    const c = this.buffer.columns;
    return lowerBound(c.time, c.offset, c.length, time);
  }

  /** First index with `time > t` (`length` when none). */
  upperBound(time: number): number {
    const c = this.buffer.columns;
    return upperBound(c.time, c.offset, c.length, time);
  }

  private writeFrom(start: number, candles: readonly Candle[]): void {
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i] as Candle;
      this.buffer.write(
        start + i,
        c.time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume
      );
    }
  }

  private emit(
    kind: CandleStoreChangeKind,
    count: number,
    fromIndex: number
  ): void {
    const version = ++this.versionValue;
    if (kind === 'reset') {
      this.resetVersionValue = version;
      this.prependedValue = 0;
    } else if (kind === 'prepend') {
      this.prependedValue += count;
    }
    const change = this.change;
    change.kind = kind;
    change.version = version;
    change.count = count;
    change.fromIndex = fromIndex;
    // Copy-on-write array: (un)subscribing inside a listener is safe.
    const listeners = this.listeners;
    let failed = false;
    let error: unknown;
    for (let i = 0; i < listeners.length; i++) {
      try {
        (listeners[i] as CandleStoreListener)(change, this);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
    if (failed) {
      // Every listener ran; surface the first failure to the mutator.
      throw error;
    }
  }
}
