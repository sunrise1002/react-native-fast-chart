/**
 * Test perspective table — GestureActions (real Reanimated, fake timers)
 *
 * Fixture: 1000 bars, plot 400 dp, spacing 8, offset 5 → bounds [-960, 48].
 *
 * | Case | Input / Precondition                             | Perspective        | Expected                                   |
 * |------|--------------------------------------------------|--------------------|--------------------------------------------|
 * | GA1  | first begin during a fling                       | Equivalence        | fling stopped, raw = offset, count 1       |
 * | GA2  | second begin                                     | Equivalence        | count 2, raw kept                          |
 * | GA3  | begin with corrupt negative counter              | Invalid            | count 1                                    |
 * | GA4  | end with 2 active                                | Equivalence        | 1 left, no release                         |
 * | GA5  | end last gesture out of bounds                   | Boundary           | 0 left, springs back                       |
 * | GA6  | end with 0 active                                | Boundary (0)       | stays 0                                    |
 * | GA7  | pan +80 dp                                       | Equivalence        | 1:1 → offset -5 (10 bars back)             |
 * | GA8  | pan far past the realtime bound                  | Boundary           | rubber-banded: hi < offset < raw           |
 * | GA9  | pan dx NaN / raw offset NaN                      | Invalid            | unchanged                                  |
 * | GA10 | zoom ×2 at focal x                               | Equivalence        | focal bar fixed                            |
 * | GA11 | zoom to 1000 / 0.01                              | Boundary           | clamped to 64 / 0.5                        |
 * | GA12 | zoom focal NaN / ∞                               | Invalid            | unchanged                                  |
 * | GA13 | panVelocityToBars(800, 8) / spacing 0 / NaN      | Equiv. / invalid   | -100 / 0 / 0                               |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { xToIndex } from '../../viewport/TimeScale';
import { readTimeScale } from '../ChartSharedState';
import {
  beginViewportGesture,
  endViewportGesture,
  panVelocityToBars,
  panViewport,
  zoomViewport,
} from '../GestureActions';
import { releaseViewport } from '../ViewportActions';
import { makeEngine, settle } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

function started() {
  const engine = makeEngine();
  engine.state.rightOffset.value = 5;
  beginViewportGesture(engine.state);
  return engine;
}

describe('begin / end', () => {
  it('GA1: stops a running fling and seeds the raw offset', () => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = 0;
    releaseViewport(state, options, -300);
    jest.advanceTimersByTime(50);
    // When
    beginViewportGesture(state);
    const at = state.rightOffset.value;
    settle();
    // Then
    expect(state.rightOffset.value).toBe(at);
    expect(state.rawOffset.value).toBe(at);
    expect(state.activeGestures.value).toBe(1);
  });

  it('GA2: counts simultaneous gestures', () => {
    // Given
    const { state } = started();
    state.rawOffset.value = -7;
    // When
    beginViewportGesture(state);
    // Then
    expect(state.activeGestures.value).toBe(2);
    expect(state.rawOffset.value).toBe(-7);
  });

  it('GA3: recovers from a negative counter', () => {
    // Given
    const { state } = makeEngine();
    state.activeGestures.value = -3;
    // When
    beginViewportGesture(state);
    // Then
    expect(state.activeGestures.value).toBe(1);
  });

  it('GA4: keeps the viewport while another gesture is active', () => {
    // Given
    const { state, options } = started();
    beginViewportGesture(state);
    state.rightOffset.value = 100;
    // When
    const left = endViewportGesture(state, options, 0);
    settle();
    // Then
    expect(left).toBe(1);
    expect(state.rightOffset.value).toBe(100);
  });

  it('GA5: releases when the last gesture ends', () => {
    // Given
    const { state, options } = started();
    state.rightOffset.value = 100;
    // When
    const left = endViewportGesture(state, options, 0);
    settle();
    // Then
    expect(left).toBe(0);
    expect(state.rightOffset.value).toBeCloseTo(48, 0);
  });

  it('GA6: never goes below zero', () => {
    // Given
    const { state, options } = makeEngine();
    // When
    const left = endViewportGesture(state, options, 0);
    // Then
    expect(left).toBe(0);
    expect(state.activeGestures.value).toBe(0);
  });
});

describe('panViewport', () => {
  it('GA7: moves 1:1 with the finger', () => {
    // Given
    const { state, options } = started();
    // When
    panViewport(state, options, 80);
    // Then
    expect(state.rawOffset.value).toBe(-5);
    expect(state.rightOffset.value).toBe(-5);
  });

  it('GA8: rubber-bands past the bounds', () => {
    // Given
    const { state, options } = started();
    // When: 200 bars towards the future
    panViewport(state, options, -1600);
    // Then
    expect(state.rawOffset.value).toBe(205);
    expect(state.rightOffset.value).toBeGreaterThan(48);
    expect(state.rightOffset.value).toBeLessThan(205);
  });

  it.each([
    ['dx NaN', NaN, 5],
    ['raw offset NaN', 10, NaN],
  ])('GA9: ignores %s', (_label, dx, raw) => {
    // Given
    const { state, options } = started();
    state.rawOffset.value = raw;
    // When
    panViewport(state, options, dx);
    // Then
    expect(state.rightOffset.value).toBe(5);
  });
});

describe('zoomViewport', () => {
  it('GA10: keeps the bar under the focal point fixed', () => {
    // Given
    const { state, options } = started();
    state.rightOffset.value = -100;
    state.rawOffset.value = -100;
    const before = xToIndex(readTimeScale(state), 150);
    // When
    zoomViewport(state, options, 16, 150);
    // Then
    expect(state.barSpacing.value).toBe(16);
    expect(xToIndex(readTimeScale(state), 150)).toBeCloseTo(before, 9);
  });

  it.each([
    [1000, 64],
    [0.01, 0.5],
    [NaN, 0.5],
  ])('GA11: clamps spacing %p to %p', (next, clamped) => {
    // Given
    const { state, options } = started();
    // When
    zoomViewport(state, options, next, 200);
    // Then
    expect(state.barSpacing.value).toBe(clamped);
    expect(Number.isFinite(state.rightOffset.value)).toBe(true);
  });

  it.each([NaN, Infinity])('GA12: ignores focal x %p', (focal) => {
    // Given
    const { state, options } = started();
    // When
    zoomViewport(state, options, 16, focal);
    // Then
    expect(state.barSpacing.value).toBe(8);
    expect(state.rightOffset.value).toBe(5);
  });
});

describe('panVelocityToBars', () => {
  it.each([
    [800, 8, -100],
    [-80, 8, 10],
    [800, 0, 0],
    [NaN, 8, 0],
    [800, NaN, 0],
  ])('GA13: (%p dp/s, spacing %p) → %p bars/s', (v, spacing, bars) => {
    // Given / When / Then
    expect(panVelocityToBars(v, spacing)).toBe(bars);
  });
});
