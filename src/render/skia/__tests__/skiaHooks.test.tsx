/**
 * Test perspective table — Skia hooks (Skia mocked: paths record rects;
 * real Reanimated, fake timers)
 *
 * Fixture: 1000 bars, plot 400 × 300 dp, spacing 8, price range set.
 *
 * | Case | Input / Precondition                           | Perspective        | Expected                                  |
 * |------|------------------------------------------------|--------------------|-------------------------------------------|
 * | H1   | visible data                                   | Equivalence        | ~52 bars in 4 paths (bodies + wicks)      |
 * | H2   | viewport change after mount                    | Equivalence        | new frame, new path objects               |
 * | H3   | narrow bars (spacing 1)                        | Equivalence        | wick-only: body paths empty               |
 * | H4   | no data / NaN price range / zero-height plot   | Boundary / invalid | 0 bars, all paths empty                   |
 * | H5   | profiling on / off                             | Equivalence        | buildMs finite / NaN                      |
 * | H6   | grid over a valid viewport                     | Equivalence        | horizontal + vertical rects               |
 * | H7   | grid with custom step fns / invalid plot       | Equivalence / inv. | uses them / empty path                    |
 * | F1   | flushFrameSamples pairs                        | Equivalence        | frames marked, finite builds recorded     |
 * | F2   | odd trailing value / empty / disabled metrics  | Boundary           | ignored / no-op                           |
 * | F3   | useFrameProfiler enabled / disabled            | Equivalence        | frames flushed in batches / none          |
 * | K1   | uiNow with / without performance.now           | Equiv. / fallback  | performance.now / Date.now                |
 * | P1   | computePlotSize valid / too small / NaN / ∞    | Boundary / invalid | minus gutters / 0                         |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { FakePath } from '../../../../jest/mocks/react-native-skia';
import { DEFAULT_CHART_CONFIG } from '../../../core/ChartConfig';
import { makeEngine } from '../../../engine/__tests__/engineTestUtils';
import { createChartMetrics } from '../../../performance/ChartMetrics';
import { computePlotSize } from '../SkiaChartCanvas';
import { uiNow } from '../uiClock';
import { useCandlePaths, type CandleStyle } from '../useCandlePaths';
import {
  flushFrameSamples,
  PROFILER_FLUSH_FRAMES,
  useFrameProfiler,
} from '../useFrameProfiler';
import { useGridPath } from '../useGridPath';

beforeEach(() => {
  jest.useFakeTimers();
});

const STYLE: CandleStyle = {
  bodyRatio: 0.8,
  wickWidth: 1,
  pixelRatio: 2,
  profiling: false,
};

const rects = (path: { readonly value: unknown }) =>
  (path.value as FakePath).rects.length;

function tick(ms = 20) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

function engine(bars = 1000) {
  const e = makeEngine(bars);
  e.state.rightOffset.value = 0;
  e.state.priceMin.value = 0;
  e.state.priceMax.value = 1e6;
  return e;
}

describe('useCandlePaths', () => {
  it('H1: batches the visible bars into four paths', () => {
    // Given
    const { state } = engine();
    // When
    const { result } = renderHook(() => useCandlePaths(state, STYLE));
    tick();
    // Then: 50 slots + 1 overscan on the left (right side has no bars)
    const r = result.current;
    expect(r.frame.value.bars).toBe(51);
    expect(rects(r.bullBodies) + rects(r.bearBodies)).toBe(51);
    expect(rects(r.bullWicks) + rects(r.bearWicks)).toBe(51);
  });

  it('H2: rebuilds when the viewport changes', () => {
    // Given
    const { state } = engine();
    const { result } = renderHook(() => useCandlePaths(state, STYLE));
    tick();
    const before = result.current.bullWicks.value;
    // When
    state.barSpacing.value = 16;
    tick();
    // Then
    expect(result.current.bullWicks.value).not.toBe(before);
    expect(result.current.frame.value.bars).toBe(26);
  });

  it('H3: draws wicks only for narrow bars', () => {
    // Given
    const { state } = engine();
    state.barSpacing.value = 1;
    // When
    const { result } = renderHook(() => useCandlePaths(state, STYLE));
    tick();
    // Then
    const r = result.current;
    expect(rects(r.bullBodies) + rects(r.bearBodies)).toBe(0);
    expect(rects(r.bullWicks) + rects(r.bearWicks)).toBe(401);
  });

  it.each([
    ['no data', 0, () => {}],
    [
      'NaN price range',
      1000,
      (s: ReturnType<typeof engine>['state']) => {
        s.priceMin.value = NaN;
      },
    ],
    [
      'zero-height plot',
      1000,
      (s: ReturnType<typeof engine>['state']) => {
        s.plotHeight.value = 0;
      },
    ],
  ])('H4: %s → empty paths', (_label, bars, mutate) => {
    // Given
    const { state } = engine(bars);
    mutate(state);
    // When
    const { result } = renderHook(() => useCandlePaths(state, STYLE));
    tick();
    // Then
    const r = result.current;
    expect(r.frame.value.bars).toBe(0);
    for (const p of [r.bullBodies, r.bearBodies, r.bullWicks, r.bearWicks]) {
      expect(rects(p)).toBe(0);
    }
  });

  it.each([
    [true, true],
    [false, false],
  ])('H5: profiling %p → finite build time %p', (profiling, finite) => {
    // Given
    const { state } = engine();
    // When
    const { result } = renderHook(() =>
      useCandlePaths(state, { ...STYLE, profiling })
    );
    tick();
    // Then
    const f = result.current.frame.value;
    expect(Number.isFinite(f.buildMs)).toBe(finite);
    expect(Number.isFinite(f.builtAt)).toBe(finite);
  });
});

describe('useGridPath', () => {
  it('H6: draws grid lines over the plot', () => {
    // Given
    const { state } = engine();
    // When
    const { result } = renderHook(() =>
      useGridPath(state, { lineWidth: 1, pixelRatio: 2 })
    );
    tick();
    // Then: 300 px / 60 → ~5 price lines, 400 px / 90 → ~4-5 time lines
    expect(rects(result.current)).toBeGreaterThanOrEqual(8);
  });

  it('H7: uses custom tick sources; invalid plot → empty', () => {
    // Given
    const { state } = engine();
    const priceStep = () => {
      'worklet';
      return 250_000;
    };
    const barStep = () => {
      'worklet';
      return 1000;
    };
    // When
    const custom = renderHook(() =>
      useGridPath(state, { lineWidth: 1, pixelRatio: 1, priceStep, barStep })
    );
    tick();
    const count = rects(custom.result.current);
    state.plotWidth.value = 0;
    tick();
    // Then: 0, 250k, 500k, 750k, 1M horizontal; no multiple of 1000 visible
    expect(count).toBe(5);
    expect(rects(custom.result.current)).toBe(0);
  });
});

describe('frame profiler', () => {
  it('F1: marks frames and records finite build times', () => {
    // Given
    const metrics = createChartMetrics({ enabled: true });
    // When
    flushFrameSamples(metrics, [0, 2, 16, NaN, 32, 3]);
    // Then
    const snap = metrics.snapshot();
    expect(snap.channels.frame.count).toBe(2);
    expect(snap.channels.frame.avg).toBe(16);
    expect(snap.channels.render.count).toBe(2);
    expect(snap.channels.render.max).toBe(3);
  });

  it.each([
    ['odd trailing value', true, [0, 1, 16]],
    ['empty batch', true, []],
    ['disabled metrics', false, [0, 1, 16, 1]],
  ])('F2: %s', (_label, enabled, samples) => {
    // Given
    const metrics = createChartMetrics({ enabled });
    // When
    flushFrameSamples(metrics, samples);
    // Then
    expect(metrics.snapshot().channels.frame.count).toBe(0);
  });

  it.each([
    [true, true],
    [false, false],
  ])('F3: enabled %p → frames recorded %p', (enabled, recorded) => {
    // Given
    const { state } = engine();
    const metrics = createChartMetrics({ enabled: true });
    // When
    renderHook(() => {
      const paths = useCandlePaths(state, { ...STYLE, profiling: true });
      useFrameProfiler(enabled, paths.frame, () => metrics);
    });
    tick(PROFILER_FLUSH_FRAMES * 3 * 17);
    // Then
    const snap = metrics.snapshot();
    expect(snap.channels.frame.count > 0).toBe(recorded);
    expect(snap.channels.render.count > 0).toBe(recorded);
  });
});

describe('uiNow', () => {
  it('K1: uses performance.now and falls back to Date.now', () => {
    // Given
    const spy = jest.spyOn(performance, 'now').mockReturnValue(123);
    const original = globalThis.performance;
    // When
    const perf = uiNow();
    Object.defineProperty(globalThis, 'performance', {
      value: undefined,
      configurable: true,
    });
    jest.setSystemTime(456);
    const fallback = uiNow();
    Object.defineProperty(globalThis, 'performance', {
      value: original,
      configurable: true,
    });
    spy.mockRestore();
    // Then
    expect(perf).toBe(123);
    expect(fallback).toBe(456);
  });
});

describe('computePlotSize', () => {
  const layout = DEFAULT_CHART_CONFIG.layout;

  it.each([
    [464, 324, 400, 300],
    [64, 24, 0, 0],
    [10, 10, 0, 0],
    [NaN, NaN, 0, 0],
    [Infinity, Infinity, 0, 0],
  ])('P1: canvas %p × %p → plot %p × %p', (w, h, pw, ph) => {
    // Given / When / Then
    expect(computePlotSize(w, h, layout)).toEqual({ width: pw, height: ph });
  });
});
