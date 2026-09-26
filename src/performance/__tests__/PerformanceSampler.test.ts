/**
 * Test perspective table — PerformanceSampler (onPerformanceSample)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | PS1  | sanitizeSampleInterval 1000 / 5000 / 999 / 0 / NaN / ∞ | Boundary (min ±1)  | 1000 / 5000 / 1000 ×4                      |
 * | PS2  | 60 fps frames for 1 s (interval 1000)                  | Equivalence        | one report, fps 60, 0 dropped              |
 * | PS3  | window not complete (999 ms)                           | Boundary (-1)      | null                                       |
 * | PS4  | builds 4 / 2 ms, NaN / -1 / ∞ build values             | Equivalence / inv. | count 2, avg 3, max 4                      |
 * | PS5  | a 50 ms hitch                                          | Equivalence        | dropped 2, maxMs 50                        |
 * | PS6  | reports across several pushes (batching)               | Equivalence        | window carries over, next starts at report |
 * | PS7  | non-finite timestamps / odd-length batch               | Invalid            | skipped / trailing value ignored           |
 * | PS8  | bars NaN / -1                                          | Invalid            | 0                                          |
 * | PS9  | empty batch                                            | Boundary (empty)   | null                                       |
 * | PS10 | reset() mid-window                                     | State              | window restarts                            |
 * | PS11 | clock going backwards inside a window                  | Invalid            | negative interval ignored                  |
 * | PS12 | two windows in one push                                | Boundary (max)     | first report returned, second window open  |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createPerformanceSampler,
  MIN_PERFORMANCE_SAMPLE_MS,
  sanitizeSampleInterval,
} from '../PerformanceSampler';

const FRAME = 1000 / 60;

/** `[t, build]` pairs for `count` frames from `start`. */
function frames(start: number, count: number, step = FRAME, build = NaN) {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(start + i * step, build);
  }
  return out;
}

describe('sanitizeSampleInterval', () => {
  it.each([
    [1000, 1000],
    [5000, 5000],
    [999, MIN_PERFORMANCE_SAMPLE_MS],
    [0, MIN_PERFORMANCE_SAMPLE_MS],
    [NaN, MIN_PERFORMANCE_SAMPLE_MS],
    [Infinity, MIN_PERFORMANCE_SAMPLE_MS],
  ])('PS1: %p → %p', (value, expected) => {
    // Given / When / Then
    expect(sanitizeSampleInterval(value)).toBe(expected);
  });
});

describe('createPerformanceSampler', () => {
  it('PS2: one report per window', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When
    const report = sampler.push(frames(0, 61), 500);
    // Then
    expect(report).not.toBeNull();
    expect(report?.startedAt).toBe(0);
    expect(report?.durationMs).toBeCloseTo(1000, 6);
    expect(report?.fps).toBeCloseTo(60, 6);
    expect(report?.frame.frames).toBe(60);
    expect(report?.frame.dropped).toBe(0);
    expect(report?.bars).toBe(500);
    expect(report?.build).toEqual({ count: 0, avgMs: 0, maxMs: 0 });
  });

  it('PS3: incomplete windows return null', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When / Then
    expect(sampler.push([0, NaN, 999, NaN], 1)).toBeNull();
  });

  it('PS4: build statistics ignore invalid values', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    const batch = [0, 4, 100, 2, 200, NaN, 300, -1, 400, Infinity, 1000, NaN];
    // When
    const report = sampler.push(batch, 1);
    // Then
    expect(report?.build).toEqual({ count: 2, avgMs: 3, maxMs: 4 });
  });

  it('PS5: hitches count as dropped frames', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    const batch = [...frames(0, 30), ...frames(29 * FRAME + 50, 40)];
    // When
    const report = sampler.push(batch, 1);
    // Then
    expect(report?.frame.maxMs).toBeCloseTo(50, 6);
    expect(report?.frame.dropped).toBe(2);
  });

  it('PS6: windows span several pushes', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When
    const first = sampler.push(frames(0, 30), 1);
    const second = sampler.push(frames(30 * FRAME, 31), 1);
    const third = sampler.push(frames(61 * FRAME, 61), 1);
    // Then
    expect(first).toBeNull();
    expect(second?.frame.frames).toBe(60);
    expect(third?.startedAt).toBeCloseTo(60 * FRAME, 6);
  });

  it('PS7: invalid timestamps and odd batches', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When
    const report = sampler.push(
      [0, NaN, NaN, 5, Infinity, NaN, 1000, NaN, 7],
      1
    );
    // Then
    expect(report?.frame.frames).toBe(1);
    expect(report?.build.count).toBe(0);
  });

  it.each([[NaN], [-1]])('PS8: bars %p → 0', (bars) => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When / Then
    expect(sampler.push([0, NaN, 1000, NaN], bars)?.bars).toBe(0);
  });

  it('PS9: empty batch', () => {
    // Given / When / Then
    expect(createPerformanceSampler(1000).push([], 1)).toBeNull();
  });

  it('PS10: reset restarts the window', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    sampler.push([0, NaN, 900, NaN], 1);
    // When
    sampler.reset();
    // Then
    expect(sampler.push([1000, NaN], 1)).toBeNull();
    expect(sampler.push([2000, NaN], 1)?.startedAt).toBe(1000);
  });

  it('PS11: backwards timestamps are not frame intervals', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When
    const report = sampler.push([500, NaN, 0, NaN, 1500, NaN], 1);
    // Then
    expect(report?.frame.frames).toBe(1);
    expect(report?.frame.maxMs).toBe(1500);
    expect(report?.fps).toBeCloseTo(1000 / 1500, 9);
  });

  it('PS12: only the first completed window is returned per push', () => {
    // Given
    const sampler = createPerformanceSampler(1000);
    // When
    const report = sampler.push([0, NaN, 1000, NaN, 2000, NaN, 2500, NaN], 1);
    // Then
    expect(report?.startedAt).toBe(0);
    expect(sampler.push([3000, NaN], 1)?.startedAt).toBe(1000);
  });
});
