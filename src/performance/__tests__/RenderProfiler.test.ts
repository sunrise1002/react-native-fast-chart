/**
 * Test perspective table — RenderProfiler
 *
 * | Case | Input / Precondition                      | Perspective       | Expected                               |
 * |------|-------------------------------------------|-------------------|----------------------------------------|
 * | P1   | default options                           | Equivalence       | NOOP profiler (disabled)               |
 * | P2   | disabled: begin/end/record/stats/reset    | Zero-cost         | no-ops, empty stats                    |
 * | P3   | enabled, no samples                       | Boundary (0)      | empty stats                            |
 * | P4   | one sample                                | Boundary (1)      | min=max=avg=p95=last                   |
 * | P5   | samples 1..100                            | Equivalence       | avg 50.5, p95 95, max 100              |
 * | P6   | capacity overflow (wrap)                  | Boundary (max+1)  | oldest samples evicted                 |
 * | P7   | capacity 1                                | Boundary (min)    | only last sample kept                  |
 * | P8   | begin/end with injected clock             | Equivalence       | records clock delta                    |
 * | P9   | NaN / Infinity / negative durations       | Invalid           | ignored                                |
 * | P10  | 0 duration                                | Boundary (0)      | recorded                               |
 * | P11  | reset                                     | State             | stats empty, recording resumes         |
 * | P12  | invalid capacity (0, -1, 1.5, NaN, 1e6+1) | Abnormal          | RangeError with message                |
 * | P13  | defaultClock                              | Equivalence       | monotonic non-decreasing numbers       |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createRenderProfiler,
  defaultClock,
  EMPTY_TIMING_STATS,
  NOOP_PROFILER,
} from '../RenderProfiler';

const fakeClock = (...values: number[]) => {
  let i = 0;
  return () => values[i++] ?? 0;
};

describe('createRenderProfiler', () => {
  it('P1: is disabled by default', () => {
    // Given / When
    const profiler = createRenderProfiler();
    // Then
    expect(profiler).toBe(NOOP_PROFILER);
    expect(profiler.enabled).toBe(false);
  });

  it('P2: the disabled profiler records nothing', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: false });
    // When
    profiler.end(profiler.begin());
    profiler.record(5);
    profiler.reset();
    // Then
    expect(profiler.begin()).toBe(0);
    expect(profiler.stats()).toEqual(EMPTY_TIMING_STATS);
  });

  it('P3: enabled profiler without samples reports empty stats', () => {
    // Given / When
    const stats = createRenderProfiler({ enabled: true }).stats();
    // Then
    expect(stats).toEqual(EMPTY_TIMING_STATS);
  });

  it('P4: one sample populates every statistic', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: true });
    // When
    profiler.record(4);
    // Then
    expect(profiler.stats()).toEqual({
      count: 1,
      last: 4,
      min: 4,
      max: 4,
      avg: 4,
      p95: 4,
    });
  });

  it('P5: computes avg / p95 / max over many samples', () => {
    // Given: samples 100..1 (reverse order to exercise sorting)
    const profiler = createRenderProfiler({ enabled: true, capacity: 100 });
    // When
    for (let v = 100; v >= 1; v--) profiler.record(v);
    // Then
    expect(profiler.stats()).toEqual({
      count: 100,
      last: 1,
      min: 1,
      max: 100,
      avg: 50.5,
      p95: 95,
    });
  });

  it('P6: evicts the oldest samples when full', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: true, capacity: 3 });
    // When
    [100, 1, 2, 3].forEach((v) => profiler.record(v));
    // Then
    expect(profiler.stats()).toMatchObject({
      count: 3,
      min: 1,
      max: 3,
      last: 3,
    });
  });

  it('P7: capacity 1 keeps only the last sample', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: true, capacity: 1 });
    // When
    profiler.record(10);
    profiler.record(20);
    // Then
    expect(profiler.stats()).toMatchObject({ count: 1, avg: 20, p95: 20 });
  });

  it('P8: begin/end records the clock delta', () => {
    // Given
    const profiler = createRenderProfiler({
      enabled: true,
      clock: fakeClock(10, 16.5),
    });
    // When
    profiler.end(profiler.begin());
    // Then
    expect(profiler.stats().last).toBe(6.5);
  });

  it.each([Number.NaN, Infinity, -Infinity, -1])(
    'P9: ignores invalid duration %p',
    (value) => {
      // Given
      const profiler = createRenderProfiler({ enabled: true });
      // When
      profiler.record(value);
      // Then
      expect(profiler.stats().count).toBe(0);
    }
  );

  it('P10: records a zero duration', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: true });
    // When
    profiler.record(0);
    // Then
    expect(profiler.stats().count).toBe(1);
  });

  it('P11: reset clears samples and recording resumes', () => {
    // Given
    const profiler = createRenderProfiler({ enabled: true, capacity: 2 });
    [1, 2, 3].forEach((v) => profiler.record(v));
    // When
    profiler.reset();
    const afterReset = profiler.stats();
    profiler.record(7);
    // Then
    expect(afterReset).toEqual(EMPTY_TIMING_STATS);
    expect(profiler.stats()).toMatchObject({ count: 1, min: 7, max: 7 });
  });

  it.each([0, -1, 1.5, Number.NaN, 1_000_001])(
    'P12: rejects capacity %p',
    (capacity) => {
      // Given / When / Then
      expect(() => createRenderProfiler({ capacity })).toThrow(RangeError);
      expect(() => createRenderProfiler({ capacity })).toThrow(
        /capacity must be an integer/
      );
    }
  );

  it('P13: defaultClock is monotonic', () => {
    // Given / When
    const a = defaultClock();
    const b = defaultClock();
    // Then
    expect(Number.isFinite(a)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
