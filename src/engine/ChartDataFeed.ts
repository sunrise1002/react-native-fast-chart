import type {
  SetDataOptions,
  UpsertBarResult,
  ViewportResetPolicy,
} from '../core/ChartController';
import type { Candle } from '../data/Candle';
import {
  applyCandleDiff,
  diffCandles,
  type AppliedCandleDiff,
} from '../data/CandleDiff';
import type { CandleStore } from '../data/CandleStore';
import { upsertCandle } from '../data/CandleUpsert';
import type { CandleIssue } from '../data/CandleValidation';
import { mergeCandles, type MergeResult } from '../data/HistoryMerge';
import {
  droppedRowsIssue,
  rejectedBarIssue,
  type ChartErrorChannel,
} from './ChartErrorChannel';

/**
 * Data half of the controller: dataset replacement, the `candles` prop
 * diff, realtime bars and history pages. Dropped / rejected rows are
 * reported to the error channel (spec §26: malformed data is tolerated,
 * never thrown into the host's feed).
 */
export class ChartDataFeed {
  /** Viewport policy of the pending / last dataset reset. */
  resetPolicy: ViewportResetPolicy = 'reset';
  private lastCandlesProp: readonly Candle[] | null = null;

  constructor(
    private readonly store: CandleStore,
    private readonly errors: ChartErrorChannel
  ) {}

  setData(candles: readonly Candle[], options?: SetDataOptions): CandleIssue[] {
    this.resetPolicy = options?.viewport ?? 'reset';
    this.lastCandlesProp = null;
    const issues = this.store.setData(candles);
    if (this.store.length < candles.length) {
      this.errors.report(
        droppedRowsIssue(candles.length, this.store.length, issues)
      );
    }
    return issues;
  }

  /** `candles` prop path: diffs against the previous prop and applies. */
  syncCandles(candles: readonly Candle[]): AppliedCandleDiff {
    const diff = diffCandles(this.lastCandlesProp, candles, this.store.columns);
    this.lastCandlesProp = candles;
    if (diff.kind === 'reset') {
      this.resetPolicy = 'reset';
    }
    const applied = applyCandleDiff(this.store, candles, diff);
    if (applied === 'reset' && this.store.length < candles.length) {
      this.errors.report(droppedRowsIssue(candles.length, this.store.length));
    }
    return applied;
  }

  appendBar(candle: Candle): boolean {
    return this.checked('appendBar', candle, this.store.append(candle));
  }

  updateLastBar(candle: Candle): boolean {
    return this.checked('updateLastBar', candle, this.store.updateLast(candle));
  }

  upsertBar(candle: Candle): UpsertBarResult {
    const result = upsertCandle(this.store, candle);
    this.checked('upsertBar', candle, result !== 'rejected');
    return result;
  }

  prependBars(candles: readonly Candle[]): MergeResult {
    return mergeCandles(this.store, candles);
  }

  /** Drops the reference to the last `candles` prop. */
  release(): void {
    this.lastCandlesProp = null;
  }

  /** Reports a rejected realtime bar; passes `ok` through. */
  private checked(operation: string, candle: Candle, ok: boolean): boolean {
    if (!ok) {
      this.errors.report(rejectedBarIssue(operation, candle));
    }
    return ok;
  }
}
