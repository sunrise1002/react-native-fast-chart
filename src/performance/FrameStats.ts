/**
 * Frame-interval statistics for benchmark runs (P8, spec §28): average,
 * p95, max and dropped frames over an unbounded run with constant memory.
 * Intervals go into a fixed histogram (`FRAME_BUCKET_MS` resolution, the
 * last bucket collects everything slower), so recording is O(1) and
 * allocation-free and runs as a worklet inside a frame callback on the UI
 * thread as well as in a JS `requestAnimationFrame` loop.
 */

/** Histogram resolution, ms. */
export const FRAME_BUCKET_MS = 0.25;
/** Buckets: 0 … 125 ms at 0.25 ms; the last one is the overflow bucket. */
export const FRAME_BUCKETS = 500;
/** Default frame budget: 60 Hz. */
export const DEFAULT_FRAME_TARGET_MS = 1000 / 60;

export interface FrameStatsAccumulator {
  /** Frame budget, ms (dropped-frame threshold). */
  targetMs: number;
  count: number;
  sum: number;
  max: number;
  dropped: number;
  histogram: Float64Array;
}

export interface FrameStatsSummary {
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Vsyncs missed: an interval of `k` budgets drops `k − 1` frames. */
  dropped: number;
}

export function createFrameStats(
  targetMs = DEFAULT_FRAME_TARGET_MS
): FrameStatsAccumulator {
  'worklet';
  return {
    targetMs:
      targetMs > 0 && targetMs < Infinity ? targetMs : DEFAULT_FRAME_TARGET_MS,
    count: 0,
    sum: 0,
    max: 0,
    dropped: 0,
    histogram: new Float64Array(FRAME_BUCKETS),
  };
}

/** Frames dropped by one interval (`round(interval / target) − 1`, ≥ 0). */
export function droppedFrames(intervalMs: number, targetMs: number): number {
  'worklet';
  const k = Math.round(intervalMs / targetMs) - 1;
  return k > 0 && k < Infinity ? k : 0;
}

/** Records one frame interval; non-finite and non-positive ones are ignored. */
export function recordFrameInterval(
  stats: FrameStatsAccumulator,
  intervalMs: number
): void {
  'worklet';
  if (!(intervalMs > 0 && intervalMs < Infinity)) {
    return;
  }
  const bucket = Math.floor(intervalMs / FRAME_BUCKET_MS);
  const index = bucket < FRAME_BUCKETS - 1 ? bucket : FRAME_BUCKETS - 1;
  stats.histogram[index] = (stats.histogram[index] as number) + 1;
  stats.count++;
  stats.sum += intervalMs;
  stats.max = intervalMs > stats.max ? intervalMs : stats.max;
  stats.dropped += droppedFrames(intervalMs, stats.targetMs);
}

/**
 * Nearest-rank 95th percentile: the upper edge of the bucket holding the
 * rank (capped by the max; the overflow bucket reports the max).
 */
function histogramP95(stats: FrameStatsAccumulator): number {
  'worklet';
  const rank = Math.ceil(stats.count * 0.95);
  let seen = 0;
  for (let b = 0; b < FRAME_BUCKETS - 1; b++) {
    seen += stats.histogram[b] as number;
    if (seen >= rank) {
      return Math.min(stats.max, (b + 1) * FRAME_BUCKET_MS);
    }
  }
  return stats.max;
}

/** Summary of the recorded intervals (all zeros when empty). */
export function summarizeFrameStats(
  stats: FrameStatsAccumulator
): FrameStatsSummary {
  'worklet';
  if (stats.count === 0) {
    return { frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0, dropped: 0 };
  }
  return {
    frames: stats.count,
    avgMs: stats.sum / stats.count,
    p95Ms: histogramP95(stats),
    maxMs: stats.max,
    dropped: stats.dropped,
  };
}

export function resetFrameStats(stats: FrameStatsAccumulator): void {
  'worklet';
  stats.count = 0;
  stats.sum = 0;
  stats.max = 0;
  stats.dropped = 0;
  stats.histogram.fill(0);
}
