/**
 * Test perspective table — FrameStats
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                     |
 * |------|--------------------------------------------------------|--------------------|----------------------------------------------|
 * | FS01 | createFrameStats default / 8.33 / 0 / -1 / NaN / ∞     | Equiv. / invalid   | 16.67 / 8.33 / default for the invalid ones  |
 * | FS02 | 100 steady 16.67 ms frames                             | Equivalence        | avg 16.67, p95 ≤ 16.75, max, 0 dropped       |
 * | FS03 | 95 fast frames + 5 slow (50 ms)                        | Boundary (p95)     | p95 in the fast bucket; 5 × 2 dropped        |
 * | FS04 | 94 fast + 6 slow                                       | Boundary (p95 + 1) | p95 = slow bucket edge                       |
 * | FS05 | interval > histogram range (500 ms)                    | Boundary (max)     | overflow bucket; p95 = max                   |
 * | FS06 | 0 / negative / NaN / Infinity intervals                | Invalid            | ignored                                      |
 * | FS07 | empty accumulator                                      | Boundary (empty)   | all-zero summary                             |
 * | FS08 | droppedFrames at 1.49 / 1.5 / 2 / 0 budgets, NaN        | Boundary           | 0 / 1 / 1 / 0 / 0                            |
 * | FS09 | resetFrameStats after frames                           | Equivalence        | empty summary, histogram cleared             |
 * | FS10 | single tiny frame (0.1 ms)                             | Boundary (min)     | p95 capped by max (0.1, not bucket edge)     |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createFrameStats,
  DEFAULT_FRAME_TARGET_MS,
  droppedFrames,
  FRAME_BUCKET_MS,
  FRAME_BUCKETS,
  recordFrameInterval,
  resetFrameStats,
  summarizeFrameStats,
} from '../FrameStats';

const T = DEFAULT_FRAME_TARGET_MS;

function record(ms: number, times: number, stats = createFrameStats()) {
  for (let i = 0; i < times; i++) {
    recordFrameInterval(stats, ms);
  }
  return stats;
}

describe('createFrameStats', () => {
  it.each([
    [undefined, T],
    [1000 / 120, 1000 / 120],
    [0, T],
    [-1, T],
    [NaN, T],
    [Infinity, T],
  ])('FS01: target %p → %p', (target, expected) => {
    // Given / When
    const stats = createFrameStats(target);
    // Then
    expect(stats.targetMs).toBeCloseTo(expected, 9);
    expect(stats.histogram.length).toBe(FRAME_BUCKETS);
  });
});

describe('recordFrameInterval / summarizeFrameStats', () => {
  it('FS02: a steady 60 Hz run drops nothing', () => {
    // Given / When
    const summary = summarizeFrameStats(record(T, 100));
    // Then
    expect(summary.frames).toBe(100);
    expect(summary.avgMs).toBeCloseTo(T, 9);
    expect(summary.p95Ms).toBeCloseTo(T, 9);
    expect(summary.maxMs).toBeCloseTo(T, 9);
    expect(summary.dropped).toBe(0);
  });

  it('FS03: 5 % slow frames stay above the p95 rank', () => {
    // Given
    const stats = record(10, 95);
    // When
    record(50, 5, stats);
    const summary = summarizeFrameStats(stats);
    // Then: 50 ms = 3 budgets → 2 dropped each
    expect(summary.p95Ms).toBeCloseTo(10 + FRAME_BUCKET_MS, 9);
    expect(summary.maxMs).toBe(50);
    expect(summary.dropped).toBe(10);
    expect(summary.avgMs).toBeCloseTo((95 * 10 + 5 * 50) / 100, 9);
  });

  it('FS04: 6 % slow frames move p95 to the slow bucket', () => {
    // Given
    const stats = record(10, 94);
    // When
    record(40.1, 6, stats);
    // Then: bucket [40, 40.25) → edge 40.25, capped by max 40.1
    expect(summarizeFrameStats(stats).p95Ms).toBeCloseTo(40.1, 9);
  });

  it('FS05: intervals beyond the histogram go to the overflow bucket', () => {
    // Given / When
    const stats = record(500, 1);
    // Then
    expect(stats.histogram[FRAME_BUCKETS - 1]).toBe(1);
    expect(summarizeFrameStats(stats).p95Ms).toBe(500);
  });

  it.each([0, -5, NaN, Infinity, -Infinity])(
    'FS06: ignores interval %p',
    (ms) => {
      // Given / When
      const stats = record(ms, 3);
      // Then
      expect(stats.count).toBe(0);
      expect(stats.sum).toBe(0);
    }
  );

  it('FS07: an empty run summarizes to zeros', () => {
    // Given / When / Then
    expect(summarizeFrameStats(createFrameStats())).toEqual({
      frames: 0,
      avgMs: 0,
      p95Ms: 0,
      maxMs: 0,
      dropped: 0,
    });
  });

  it('FS10: p95 never exceeds the slowest frame', () => {
    // Given / When
    const summary = summarizeFrameStats(record(0.1, 1));
    // Then
    expect(summary.p95Ms).toBe(0.1);
  });
});

describe('droppedFrames', () => {
  it.each([
    [1.49 * T, 0],
    [1.5 * T, 1],
    [2 * T, 1],
    [0, 0],
    [NaN, 0],
  ])('FS08: %p ms drops %p frames', (ms, expected) => {
    // Given / When / Then
    expect(droppedFrames(ms, T)).toBe(expected);
  });
});

describe('resetFrameStats', () => {
  it('FS09: clears every counter and the histogram', () => {
    // Given
    const stats = record(40, 10);
    // When
    resetFrameStats(stats);
    // Then
    expect(summarizeFrameStats(stats).frames).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.dropped).toBe(0);
    expect(stats.histogram.every((v) => v === 0)).toBe(true);
  });
});
