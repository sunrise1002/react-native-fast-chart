import { useEffect } from 'react';
import {
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import type { ChartMetrics } from '../../performance/ChartMetrics';
import type { CandleFrame } from './useCandlePaths';

/** A layer frame with build timing (`useCandlePaths`, `useIndicatorLayer`). */
type TimedFrame = Pick<CandleFrame, 'buildMs' | 'builtAt'>;

/** Frames collected on the UI thread before one batched JS flush. */
export const PROFILER_FLUSH_FRAMES = 30;

/** Values per sample: frame timestamp, path build ms (`NaN` = no rebuild). */
const SAMPLE_STRIDE = 2;

/**
 * Pushes batched samples into `metrics`: frame timestamps feed the
 * `frame` channel (→ FPS), layer build times (candle paths + indicator
 * picture, summed per frame) the `render` channel.
 */
export function flushFrameSamples(
  metrics: ChartMetrics,
  samples: readonly number[]
): void {
  const render = metrics.channel('render');
  for (let i = 0; i + 1 < samples.length; i += SAMPLE_STRIDE) {
    metrics.markFrame(samples[i]);
    const build = samples[i + 1] as number;
    if (Number.isFinite(build)) {
      render.record(build);
    }
  }
}

/**
 * Hooks the P1 profiler into the UI frame loop. Disabled (callback
 * inactive, zero cost) unless `enabled` (`config.debug.profiling`).
 * Samples are buffered on the UI thread and flushed to JS every
 * `PROFILER_FLUSH_FRAMES` frames — never one JS call per frame.
 */
export function useFrameProfiler(
  enabled: boolean,
  frame: SharedValue<CandleFrame>,
  getMetrics: () => ChartMetrics,
  extraFrame?: { readonly value: TimedFrame }
): void {
  const batch = useSharedValue<number[]>([]);
  const lastBuiltAt = useSharedValue(Number.NaN);
  const lastExtraBuiltAt = useSharedValue(Number.NaN);
  // Resolved at flush time: the controller swaps its metrics instance when
  // `debug.profiling` changes (after this render's props were read).
  const flush = (samples: number[]) => flushFrameSamples(getMetrics(), samples);

  const callback = useFrameCallback((info) => {
    const current = frame.value;
    let build = NaN;
    if (current.builtAt !== lastBuiltAt.value) {
      lastBuiltAt.value = current.builtAt;
      build = current.buildMs;
    }
    const extra = extraFrame?.value;
    if (
      extra !== undefined &&
      extra.builtAt !== lastExtraBuiltAt.value &&
      Number.isFinite(extra.buildMs)
    ) {
      lastExtraBuiltAt.value = extra.builtAt;
      build = (Number.isFinite(build) ? build : 0) + extra.buildMs;
    }
    const samples = batch.value;
    samples.push(info.timestamp, build);
    if (samples.length >= PROFILER_FLUSH_FRAMES * SAMPLE_STRIDE) {
      batch.value = [];
      scheduleOnRN(flush, samples);
    }
  }, false);

  useEffect(() => {
    callback.setActive(enabled);
    return () => callback.setActive(false);
  }, [callback, enabled]);
}
