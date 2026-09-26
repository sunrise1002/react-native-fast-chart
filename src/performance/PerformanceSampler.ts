import {
  createFrameStats,
  DEFAULT_FRAME_TARGET_MS,
  recordFrameInterval,
  resetFrameStats,
  summarizeFrameStats,
  type FrameStatsSummary,
} from './FrameStats';

/**
 * Production performance telemetry (`onPerformanceSample`, spec §32).
 * Pure JS-thread aggregation of the frame samples the UI-thread profiler
 * flushes in batches: one report per `intervalMs`, constant memory.
 */

/** One telemetry report. */
export interface ChartPerformanceSample {
  /** Frame timestamp (ms, UI clock) of the first frame of the window. */
  startedAt: number;
  /** Window length, ms (≥ the configured interval). */
  durationMs: number;
  /** Average frames per second of the UI thread over the window. */
  fps: number;
  /**
   * UI frame intervals. `dropped` is counted against a 60 Hz budget, so
   * on 120 Hz (ProMotion) devices judge smoothness by `fps` / `p95Ms`.
   */
  frame: FrameStatsSummary;
  /** Layer rebuilds (candle paths + indicator picture) in the window. */
  build: { count: number; avgMs: number; maxMs: number };
  /** Bars loaded when the report was produced. */
  bars: number;
}

export type ChartPerformanceSampleHandler = (
  sample: ChartPerformanceSample
) => void;

/** Smallest accepted report interval, ms. */
export const MIN_PERFORMANCE_SAMPLE_MS = 1000;

export interface PerformanceSampler {
  /**
   * Adds flushed `[timestamp, buildMs, …]` pairs (`buildMs` `NaN` = no
   * rebuild that frame). Returns a report when the window is complete.
   */
  push(samples: readonly number[], bars: number): ChartPerformanceSample | null;
  reset(): void;
}

/** Clamps a configured interval to `>= MIN_PERFORMANCE_SAMPLE_MS`. */
export function sanitizeSampleInterval(intervalMs: number): number {
  return intervalMs >= MIN_PERFORMANCE_SAMPLE_MS && intervalMs < Infinity
    ? intervalMs
    : MIN_PERFORMANCE_SAMPLE_MS;
}

export function createPerformanceSampler(
  intervalMs: number,
  targetMs = DEFAULT_FRAME_TARGET_MS
): PerformanceSampler {
  const interval = sanitizeSampleInterval(intervalMs);
  const frames = createFrameStats(targetMs);
  let startedAt = NaN;
  let last = NaN;
  let builds = 0;
  let buildSum = 0;
  let buildMax = 0;

  const reset = () => {
    resetFrameStats(frames);
    startedAt = NaN;
    last = NaN;
    builds = 0;
    buildSum = 0;
    buildMax = 0;
  };

  return {
    push(samples, bars) {
      let report: ChartPerformanceSample | null = null;
      for (let i = 0; i + 1 < samples.length; i += 2) {
        const t = samples[i] as number;
        if (!Number.isFinite(t)) {
          continue;
        }
        if (Number.isNaN(startedAt)) {
          startedAt = t;
        } else {
          recordFrameInterval(frames, t - last);
        }
        last = t;
        const build = samples[i + 1] as number;
        if (build >= 0 && build < Infinity) {
          builds++;
          buildSum += build;
          buildMax = build > buildMax ? build : buildMax;
        }
        const duration = t - startedAt;
        if (duration >= interval && report === null) {
          const frame = summarizeFrameStats(frames);
          report = {
            startedAt,
            durationMs: duration,
            // At least one positive interval ends a window: avgMs > 0.
            fps: 1000 / frame.avgMs,
            frame,
            build: {
              count: builds,
              avgMs: builds > 0 ? buildSum / builds : 0,
              maxMs: buildMax,
            },
            bars: bars >= 0 && bars < Infinity ? bars : 0,
          };
          reset();
          // The report's last frame opens the next window.
          startedAt = t;
          last = t;
        }
      }
      return report;
    },
    reset,
  };
}
