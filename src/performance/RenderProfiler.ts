/** Monotonic clock returning milliseconds. */
export type Clock = () => number;

const perf = (globalThis as { performance?: { now(): number } }).performance;

/** `performance.now()` when available (Hermes, JSC, Node), else `Date.now()`. */
export const defaultClock: Clock =
  perf !== undefined && typeof perf.now === 'function'
    ? () => perf.now()
    : () => Date.now();

export interface TimingStats {
  /** Samples currently held (≤ capacity). */
  count: number;
  last: number;
  min: number;
  max: number;
  avg: number;
  /** 95th percentile (nearest-rank). */
  p95: number;
}

export const EMPTY_TIMING_STATS: Readonly<TimingStats> = Object.freeze({
  count: 0,
  last: 0,
  min: 0,
  max: 0,
  avg: 0,
  p95: 0,
});

/**
 * Records durations in a fixed-size ring buffer. Recording never
 * allocates; `stats()` sorts a preallocated scratch copy and is intended
 * for occasional reads (debug overlay, benchmarks), not every frame.
 */
export interface RenderProfiler {
  readonly enabled: boolean;
  /** Returns a start mark to pass to `end`. */
  begin(): number;
  /** Records `now - start`. */
  end(start: number): void;
  /** Records a duration directly. Non-finite or negative values are ignored. */
  record(durationMs: number): void;
  stats(): TimingStats;
  reset(): void;
}

export const DEFAULT_PROFILER_CAPACITY = 240;

class RingBufferProfiler implements RenderProfiler {
  readonly enabled = true;
  private readonly samples: Float64Array;
  private readonly scratch: Float64Array;
  private readonly clock: Clock;
  private head = 0;
  private size = 0;
  private lastValue = 0;

  constructor(capacity: number, clock: Clock) {
    this.samples = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
    this.clock = clock;
  }

  begin(): number {
    return this.clock();
  }

  end(start: number): void {
    this.record(this.clock() - start);
  }

  record(durationMs: number): void {
    if (!(durationMs >= 0) || durationMs === Infinity) {
      return;
    }
    this.samples[this.head] = durationMs;
    this.head = (this.head + 1) % this.samples.length;
    if (this.size < this.samples.length) {
      this.size++;
    }
    this.lastValue = durationMs;
  }

  stats(): TimingStats {
    const count = this.size;
    if (count === 0) {
      return { ...EMPTY_TIMING_STATS };
    }
    // The first `count` slots are the live samples when not yet wrapped;
    // once wrapped, all slots are live. Order does not matter for stats.
    const sorted = this.scratch.subarray(0, count);
    sorted.set(this.samples.subarray(0, count));
    sorted.sort();
    let sum = 0;
    for (let i = 0; i < count; i++) {
      sum += sorted[i] as number;
    }
    const rank = Math.ceil(0.95 * count) - 1;
    return {
      count,
      last: this.lastValue,
      min: sorted[0] as number,
      max: sorted[count - 1] as number,
      avg: sum / count,
      p95: sorted[rank] as number,
    };
  }

  reset(): void {
    this.head = 0;
    this.size = 0;
    this.lastValue = 0;
  }
}

/** Shared no-op profiler: every method is empty, so disabled cost ≈ a call. */
export const NOOP_PROFILER: RenderProfiler = Object.freeze({
  enabled: false,
  begin: () => 0,
  end: () => {},
  record: () => {},
  stats: () => ({ ...EMPTY_TIMING_STATS }),
  reset: () => {},
});

export interface RenderProfilerOptions {
  /** When `false` (default), returns `NOOP_PROFILER`. */
  enabled?: boolean;
  /** Ring buffer size, integer in `[1, 1_000_000]`. */
  capacity?: number;
  clock?: Clock;
}

/** @throws {RangeError} for an invalid `capacity`. */
export function createRenderProfiler(
  options: RenderProfilerOptions = {}
): RenderProfiler {
  const {
    enabled = false,
    capacity = DEFAULT_PROFILER_CAPACITY,
    clock = defaultClock,
  } = options;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1_000_000) {
    throw new RangeError(
      `createRenderProfiler: capacity must be an integer in [1, 1000000], got ${capacity}`
    );
  }
  return enabled ? new RingBufferProfiler(capacity, clock) : NOOP_PROFILER;
}
