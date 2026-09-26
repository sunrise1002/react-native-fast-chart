import type { Candle } from '../data/Candle';
import type { CandleStore } from '../data/CandleStore';
import { mergeCandles } from '../data/HistoryMerge';
import { ListenerSet } from '../utils/ListenerSet';

/**
 * History pagination state (spec §23.2, Phase 16):
 * - `idle`: ready to request older bars;
 * - `loading`: one request in flight (further triggers are ignored);
 * - `exhausted`: the source has no older bars (until the next dataset);
 * - `error`: the last request failed (retried after `retryDelayMs`).
 */
export type HistoryLoadState = 'idle' | 'loading' | 'exhausted' | 'error';

/** Passed to `onLoadMore`: load bars strictly older than `before`. */
export interface LoadMoreRequest {
  /** Open time of the oldest loaded bar (Unix ms). */
  readonly before: number;
  /** Bars currently loaded. */
  readonly barCount: number;
}

/** Structured `onLoadMore` result. */
export interface LoadMoreResult {
  /** Older bars (any order; overlaps are merged). Omitted = none. */
  readonly candles?: readonly Candle[];
  /** `false` = no older history exists (stop requesting). */
  readonly hasMore?: boolean;
}

/**
 * Host callback. Return (a promise of) the older bars — the chart prepends
 * them without moving the view — or a `LoadMoreResult`. An empty array
 * means "no more history". Returning nothing means the host prepended
 * through the controller itself. A rejection puts the loader in `error`.
 */
export type LoadMoreHandler = (
  request: LoadMoreRequest
) =>
  | Promise<LoadMoreResult | readonly Candle[] | void>
  | LoadMoreResult
  | readonly Candle[]
  | void;

export interface HistoryLoaderOptions {
  /** Minimum delay before a failed request may be retried, ms. */
  retryDelayMs?: number;
  /** Clock (ms), injectable for tests. */
  now?: () => number;
}

/**
 * Single-flight "load more" coordinator (pure TS). The UI thread only
 * signals that the left edge is near (`request`); this class guards
 * against duplicate concurrent requests, remembers "no more history",
 * drops responses that arrive after the dataset was replaced (symbol /
 * timeframe switch) and prepends the returned bars through
 * `mergeCandles` (overlaps with the loaded range are deduplicated).
 */
export class HistoryLoader {
  private state: HistoryLoadState = 'idle';
  private handler: LoadMoreHandler | undefined;
  private token = 0;
  private errorAt = -Infinity;
  private error: unknown;
  private retryDelayMs: number;
  private readonly now: () => number;
  private readonly listeners = new ListenerSet<[]>();
  private readonly unsubscribeStore: () => void;

  constructor(
    private readonly store: CandleStore,
    options: HistoryLoaderOptions = {}
  ) {
    this.retryDelayMs = sanitizeDelay(options.retryDelayMs);
    this.now = options.now ?? Date.now;
    this.unsubscribeStore = store.subscribe((change) => {
      if (change.kind === 'reset') {
        this.reset();
      }
    });
  }

  getState(): HistoryLoadState {
    return this.state;
  }

  /** Error of the last failed request (`undefined` otherwise). */
  getError(): unknown {
    return this.error;
  }

  subscribe(listener: () => void): () => void {
    return this.listeners.add(listener);
  }

  setHandler(handler: LoadMoreHandler | undefined): void {
    this.handler = handler;
  }

  setRetryDelay(ms: number): void {
    this.retryDelayMs = sanitizeDelay(ms);
  }

  /**
   * Starts a request when possible; returns `true` when the handler was
   * called. Ignored while loading, when exhausted, without a handler or
   * data, and during the retry delay after an error.
   */
  request(): boolean {
    const { store, handler } = this;
    if (
      handler === undefined ||
      store.length === 0 ||
      this.state === 'loading' ||
      this.state === 'exhausted' ||
      (this.state === 'error' && this.now() - this.errorAt < this.retryDelayMs)
    ) {
      return false;
    }
    const token = ++this.token;
    this.error = undefined;
    this.setState('loading');
    let result: ReturnType<LoadMoreHandler>;
    try {
      result = handler({ before: store.firstTime, barCount: store.length });
    } catch (error) {
      this.fail(token, error);
      return true;
    }
    if (isPromiseLike(result)) {
      result.then(
        (value) => this.complete(token, value),
        (error: unknown) => this.fail(token, error)
      );
    } else {
      this.complete(token, result);
    }
    return true;
  }

  /**
   * Host override: `false` marks the history as exhausted, `true` makes it
   * requestable again (e.g. after a manual reload). Ignored while loading.
   */
  setHasMore(hasMore: boolean): void {
    if (this.state === 'loading') {
      return;
    }
    this.setState(hasMore ? 'idle' : 'exhausted');
  }

  /** Forgets the in-flight request and "no more history" (new dataset). */
  reset(): void {
    this.token++;
    this.error = undefined;
    this.errorAt = -Infinity;
    this.setState('idle');
  }

  dispose(): void {
    this.token++;
    this.unsubscribeStore();
    this.listeners.clear();
    this.handler = undefined;
  }

  private complete(
    token: number,
    value: LoadMoreResult | readonly Candle[] | void
  ): void {
    if (token !== this.token) {
      return; // stale: the dataset was replaced meanwhile
    }
    const { candles, hasMore } = normalizeResult(value);
    let exhausted = hasMore === false;
    if (candles !== undefined) {
      const merged =
        candles.length > 0 ? mergeCandles(this.store, candles) : null;
      // No older bar gained (empty page or only overlaps) and no explicit
      // `hasMore: true` → stop, otherwise the edge would re-trigger forever.
      if ((merged === null || merged.prepended === 0) && hasMore !== true) {
        exhausted = true;
      }
    }
    this.setState(exhausted ? 'exhausted' : 'idle');
  }

  private fail(token: number, error: unknown): void {
    if (token !== this.token) {
      return;
    }
    this.error = error;
    this.errorAt = this.now();
    this.setState('error');
  }

  private setState(next: HistoryLoadState): void {
    if (this.state !== next) {
      this.state = next;
      this.listeners.emit();
    }
  }
}

function sanitizeDelay(ms: number | undefined): number {
  return typeof ms === 'number' && ms >= 0 && ms < Infinity ? ms : 0;
}

function isPromiseLike(
  value: unknown
): value is PromiseLike<LoadMoreResult | readonly Candle[] | void> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function normalizeResult(value: unknown): LoadMoreResult {
  if (Array.isArray(value)) {
    return { candles: value as readonly Candle[] };
  }
  if (value !== null && typeof value === 'object') {
    const { candles, hasMore } = value as LoadMoreResult;
    return {
      candles: Array.isArray(candles) ? candles : undefined,
      hasMore: typeof hasMore === 'boolean' ? hasMore : undefined,
    };
  }
  return {};
}
