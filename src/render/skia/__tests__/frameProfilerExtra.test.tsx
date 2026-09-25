/**
 * Test perspective table — useFrameProfiler extra (indicator) frame
 * (own file: Reanimated's jest frame loop does not restart for later
 * tests once a profiled hook has flushed and unmounted in the same file.)
 *
 * | Case | Input / Precondition                         | Perspective | Expected                              |
 * |------|----------------------------------------------|-------------|---------------------------------------|
 * | F4   | candle frame unprofiled, extra frame built   | Equivalence | extra build time recorded exactly once |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { createChartMetrics } from '../../../performance/ChartMetrics';
import { useCandlePaths, type CandleStyle } from '../useCandlePaths';
import { PROFILER_FLUSH_FRAMES, useFrameProfiler } from '../useFrameProfiler';
import { engine, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const STYLE: CandleStyle = {
  bodyRatio: 0.8,
  wickWidth: 1,
  pixelRatio: 2,
  profiling: false,
};

describe('frame profiler — extra frame', () => {
  it('F4: adds the extra build time once per rebuild', () => {
    // Given: candle paths not profiled (NaN), extra frame built once
    const { state } = engine();
    const metrics = createChartMetrics({ enabled: true });
    const extra = makeMutable({ buildMs: 5, builtAt: 1 });
    // When
    renderHook(() => {
      const paths = useCandlePaths(state, { ...STYLE, profiling: false });
      useFrameProfiler(true, paths.frame, () => metrics, extra);
    });
    tick(PROFILER_FLUSH_FRAMES * 3 * 17);
    // Then
    const render = metrics.snapshot().channels.render;
    expect(render.count).toBe(1);
    expect(render.max).toBe(5);
  });
});
