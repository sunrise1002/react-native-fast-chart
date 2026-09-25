import {
  createRenderProfiler,
  defaultClock,
  EMPTY_TIMING_STATS,
  type Clock,
  type RenderProfiler,
  type TimingStats,
} from './RenderProfiler';

/** Timing channels tracked by the chart (spec §28). */
export type MetricChannel =
  'frame' | 'render' | 'indicator' | 'visibleRange' | 'data';

export const METRIC_CHANNELS: readonly MetricChannel[] = [
  'frame',
  'render',
  'indicator',
  'visibleRange',
  'data',
];

export interface ChartMetricsSnapshot {
  /** Frames per second derived from the average frame interval. */
  fps: number;
  channels: Record<MetricChannel, TimingStats>;
}

export interface ChartMetrics {
  readonly enabled: boolean;
  /** Profiler for a channel; the no-op profiler when disabled. */
  channel(name: MetricChannel): RenderProfiler;
  /**
   * Marks a frame boundary; records the interval since the previous mark
   * in the `frame` channel. Pass a frame timestamp (ms) or omit to use the clock.
   */
  markFrame(timestampMs?: number): void;
  snapshot(): ChartMetricsSnapshot;
  reset(): void;
}

export interface ChartMetricsOptions {
  enabled?: boolean;
  capacity?: number;
  clock?: Clock;
}

/** @throws {RangeError} for an invalid `capacity` (see `createRenderProfiler`). */
export function createChartMetrics(
  options: ChartMetricsOptions = {}
): ChartMetrics {
  const { enabled = false, clock = defaultClock } = options;
  const profilers = {} as Record<MetricChannel, RenderProfiler>;
  for (const name of METRIC_CHANNELS) {
    profilers[name] = createRenderProfiler({ ...options, enabled, clock });
  }
  const frame = profilers.frame;
  let lastFrame = Number.NaN;

  return {
    enabled,
    channel: (name) => profilers[name],
    markFrame(timestampMs) {
      if (!enabled) {
        return;
      }
      const now = timestampMs ?? clock();
      if (!Number.isFinite(now)) {
        return;
      }
      if (Number.isFinite(lastFrame)) {
        frame.record(now - lastFrame);
      }
      lastFrame = now;
    },
    snapshot() {
      const channels = {} as Record<MetricChannel, TimingStats>;
      for (const name of METRIC_CHANNELS) {
        channels[name] = enabled
          ? profilers[name].stats()
          : { ...EMPTY_TIMING_STATS };
      }
      const avgFrame = channels.frame.avg;
      return { fps: avgFrame > 0 ? 1000 / avgFrame : 0, channels };
    },
    reset() {
      lastFrame = Number.NaN;
      for (const name of METRIC_CHANNELS) {
        profilers[name].reset();
      }
    },
  };
}
