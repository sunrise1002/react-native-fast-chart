import type {
  CandleStoreChange,
  CandleStoreChangeKind,
} from '../data/CandleStore';

/**
 * Coalesced store changes since the last indicator flush (spec §15):
 * `full` after a reset / prepend (indices moved → recalculate), otherwise
 * the earliest changed bar for an incremental tail update.
 */
export interface PendingIndicatorWork {
  full: boolean;
  /** Earliest changed bar (`Infinity` = none). */
  fromIndex: number;
}

export function createPendingWork(): PendingIndicatorWork {
  return { full: false, fromIndex: Infinity };
}

export function hasPendingWork(work: PendingIndicatorWork): boolean {
  return work.full || work.fromIndex !== Infinity;
}

export function clearPendingWork(work: PendingIndicatorWork): void {
  work.full = false;
  work.fromIndex = Infinity;
}

/**
 * Folds one store change into `work`. `lengthAfter` = store length after
 * the change (locates the `updateLast` bar).
 */
export function accumulateChange(
  work: PendingIndicatorWork,
  kind: CandleStoreChangeKind,
  fromIndex: number,
  lengthAfter: number
): void {
  switch (kind) {
    case 'append':
    case 'patch':
      work.fromIndex = Math.min(work.fromIndex, Math.max(0, fromIndex));
      return;
    case 'updateLast':
      work.fromIndex = Math.min(work.fromIndex, Math.max(0, lengthAfter - 1));
      return;
    default:
      // reset / prepend: every cached index is stale.
      work.full = true;
  }
}

/** Requests a callback before the next frame (injectable for tests). */
export type RequestFrame = (callback: () => void) => void;

export const defaultRequestFrame: RequestFrame = (callback) => {
  const raf = (
    globalThis as { requestAnimationFrame?: (cb: () => void) => unknown }
  ).requestAnimationFrame;
  if (typeof raf === 'function') {
    raf(callback);
  } else {
    setTimeout(callback, 0);
  }
};

/**
 * Synchronous v1 scheduler (spec Phase 7.5). Store changes are
 * accumulated and flushed once per frame, so a burst of ticks within one
 * frame costs a single incremental update per indicator. `flush` runs the
 * pending work immediately (tests, before reading results).
 *
 * The `run` callback is the backend seam: today it computes synchronously
 * on the JS thread; a worker / native backend can take over `run` and
 * publish results asynchronously without changing the store wiring.
 */
export class IndicatorScheduler {
  private readonly work = createPendingWork();
  private requested = false;
  private disposed = false;

  constructor(
    private readonly run: (work: PendingIndicatorWork) => void,
    private readonly requestFrame: RequestFrame = defaultRequestFrame
  ) {}

  /** Store listener entry point. */
  onStoreChange(change: CandleStoreChange, lengthAfter: number): void {
    accumulateChange(this.work, change.kind, change.fromIndex, lengthAfter);
    this.request();
  }

  /** Schedules a flush without new store work (e.g. one indicator changed). */
  request(): void {
    if (this.requested || this.disposed) {
      return;
    }
    this.requested = true;
    this.requestFrame(() => {
      if (this.requested) {
        this.flush();
      }
    });
  }

  /** Runs the pending work now (no-op when nothing is pending). */
  flush(): void {
    this.requested = false;
    if (this.disposed) {
      return;
    }
    const snapshot: PendingIndicatorWork = {
      full: this.work.full,
      fromIndex: this.work.fromIndex,
    };
    clearPendingWork(this.work);
    this.run(snapshot);
  }

  get pending(): Readonly<PendingIndicatorWork> {
    return this.work;
  }

  dispose(): void {
    this.disposed = true;
    this.requested = false;
  }
}
