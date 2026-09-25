/**
 * Test perspective table — IndicatorScheduler / pending work
 *
 * | Case | Input / Precondition                         | Perspective       | Expected                                     |
 * |------|----------------------------------------------|-------------------|----------------------------------------------|
 * | W1   | append / patch changes                       | Equivalence       | earliest fromIndex kept                      |
 * | W2   | updateLast                                   | Equivalence       | fromIndex = lengthAfter − 1                  |
 * | W3   | reset / prepend                              | Equivalence       | full                                         |
 * | W4   | negative fromIndex / updateLast on empty     | Boundary (−1, 0)  | clamped to 0                                 |
 * | W5   | has / clear pending                          | Normal            | toggles                                      |
 * | S1   | burst of changes before the frame            | Normal            | one frame request, one run with merged work  |
 * | S2   | explicit flush before the frame              | Normal            | runs once, frame callback is a no-op         |
 * | S3   | request after dispose / flush after dispose  | Abnormal          | no frame requested, run not called           |
 * | S4   | defaultRequestFrame with / without rAF       | External env      | uses rAF, else setTimeout                    |
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { CandleStoreChange } from '../../data/CandleStore';
import {
  accumulateChange,
  clearPendingWork,
  createPendingWork,
  defaultRequestFrame,
  hasPendingWork,
  IndicatorScheduler,
  type PendingIndicatorWork,
} from '../IndicatorScheduler';

const change = (
  kind: CandleStoreChange['kind'],
  fromIndex: number
): CandleStoreChange =>
  ({ kind, fromIndex, count: 1, version: 1 }) as unknown as CandleStoreChange;

function manualFrames() {
  const callbacks: (() => void)[] = [];
  return {
    requestFrame: (cb: () => void) => {
      callbacks.push(cb);
    },
    callbacks,
    fire: () => callbacks.splice(0).forEach((cb) => cb()),
  };
}

describe('pending work', () => {
  it('W1: append / patch keep the earliest index', () => {
    // Given
    const w = createPendingWork();
    // When
    accumulateChange(w, 'append', 10, 11);
    accumulateChange(w, 'patch', 4, 11);
    accumulateChange(w, 'append', 11, 12);
    // Then
    expect(w).toEqual({ full: false, fromIndex: 4 });
  });

  it('W2: updateLast uses the last bar', () => {
    // Given
    const w = createPendingWork();
    // When
    accumulateChange(w, 'updateLast', 0, 20);
    // Then
    expect(w.fromIndex).toBe(19);
  });

  it.each(['reset', 'prepend'] as const)('W3: %s forces full', (kind) => {
    // Given
    const w = createPendingWork();
    // When
    accumulateChange(w, kind, 0, 5);
    // Then
    expect(w.full).toBe(true);
    expect(hasPendingWork(w)).toBe(true);
  });

  it('W4: clamps negative indices', () => {
    // Given
    const w = createPendingWork();
    const v = createPendingWork();
    // When
    accumulateChange(w, 'append', -3, 1);
    accumulateChange(v, 'updateLast', 0, 0);
    // Then
    expect(w.fromIndex).toBe(0);
    expect(v.fromIndex).toBe(0);
  });

  it('W5: has / clear', () => {
    // Given
    const w = createPendingWork();
    expect(hasPendingWork(w)).toBe(false);
    accumulateChange(w, 'append', 2, 3);
    expect(hasPendingWork(w)).toBe(true);
    // When
    clearPendingWork(w);
    // Then
    expect(hasPendingWork(w)).toBe(false);
  });
});

describe('IndicatorScheduler', () => {
  it('S1: coalesces a burst into one run', () => {
    // Given
    const frames = manualFrames();
    const runs: PendingIndicatorWork[] = [];
    const s = new IndicatorScheduler((w) => runs.push(w), frames.requestFrame);
    // When
    s.onStoreChange(change('updateLast', 0), 10);
    s.onStoreChange(change('append', 10), 11);
    s.onStoreChange(change('updateLast', 0), 11);
    // Then
    expect(frames.callbacks).toHaveLength(1);
    expect(s.pending.fromIndex).toBe(9);
    frames.fire();
    expect(runs).toEqual([{ full: false, fromIndex: 9 }]);
    expect(hasPendingWork(s.pending)).toBe(false);
  });

  it('S2: explicit flush makes the frame callback a no-op', () => {
    // Given
    const frames = manualFrames();
    const run = jest.fn();
    const s = new IndicatorScheduler(run, frames.requestFrame);
    s.onStoreChange(change('reset', 0), 3);
    // When
    s.flush();
    frames.fire();
    // Then
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ full: true, fromIndex: Infinity });
  });

  it('S3: disposed scheduler does nothing', () => {
    // Given
    const frames = manualFrames();
    const run = jest.fn();
    const s = new IndicatorScheduler(run, frames.requestFrame);
    s.request();
    // When
    s.dispose();
    frames.fire();
    s.request();
    s.flush();
    // Then
    expect(run).not.toHaveBeenCalled();
    expect(frames.callbacks).toHaveLength(0);
  });
});

describe('defaultRequestFrame', () => {
  const g = globalThis as { requestAnimationFrame?: unknown };
  const original = g.requestAnimationFrame;
  afterEach(() => {
    g.requestAnimationFrame = original;
    jest.useRealTimers();
  });

  it('S4: prefers requestAnimationFrame', () => {
    // Given
    const raf = jest.fn((cb: () => void) => cb());
    g.requestAnimationFrame = raf;
    const cb = jest.fn();
    // When
    defaultRequestFrame(cb);
    // Then
    expect(raf).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('S4: falls back to setTimeout', () => {
    // Given
    g.requestAnimationFrame = undefined;
    jest.useFakeTimers();
    const cb = jest.fn();
    // When
    defaultRequestFrame(cb);
    expect(cb).not.toHaveBeenCalled();
    jest.runAllTimers();
    // Then
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
