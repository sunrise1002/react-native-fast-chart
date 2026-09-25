/**
 * Test perspective table — ViewportActions (real Reanimated, fake timers)
 *
 * Fixture: 1000 bars, plot 400 dp, spacing 8 → pan bounds [-960, 48],
 * realtime offset 5.
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                  |
 * |------|---------------------------------------------------|--------------------|-------------------------------------------|
 * | V1   | stopViewportAnimations mid-animation              | Equivalence        | value frozen                              |
 * | V2   | release in bounds, velocity 0 / NaN               | Boundary / invalid | no animation                              |
 * | V3   | release out of bounds (above / below), velocity 0 | Boundary           | settles back into bounds                  |
 * | V4   | release with fling velocity ±                     | Equivalence        | glides, ends inside bounds                |
 * | V5   | release with NaN bounds (NaN option)              | Invalid            | untouched                                 |
 * | V6   | scrollToRealtime animated / immediate             | Equivalence        | offset 5 after 280 ms / at once           |
 * | V7   | scrollToRealtime, NaN realtime offset             | Invalid            | offset untouched                          |
 * | V8   | realtimeRightOffset over max                      | Boundary           | clamped to 48                             |
 * | V9   | resetViewport after zoom / scroll                 | Equivalence        | spacing 8, offset 5                       |
 * | V10  | resetViewport initial spacing above max           | Boundary           | clamped to max 64                         |
 * | V10b | resetViewport with NaN realtime bounds            | Invalid            | spacing reset, offset untouched           |
 * | V17  | elasticLimit valid / width 0 / spacing 0 / NaN    | Boundary / invalid | 15% of plot in bars / 0                   |
 * | V11  | showLogicalRange(900, 999)                        | Equivalence        | spacing 4, offset 0                       |
 * | V12  | showLogicalRange to < from / NaN / width 0        | Invalid            | untouched                                 |
 * | V13  | showLogicalRange spanning 10 000 bars             | Boundary (huge)    | spacing clamped to min                    |
 * | V14  | resizePlot first layout                           | Equivalence        | size set + viewport reset                 |
 * | V15  | resizePlot later                                  | Equivalence        | size set, offset kept                     |
 * | V16  | resizePlot NaN / -1 / ∞                           | Invalid            | 0, no reset                               |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { withTiming } from 'react-native-reanimated';
import {
  realtimeRightOffset,
  releaseViewport,
  resetViewport,
  resizePlot,
  scrollToRealtime,
  showLogicalRange,
  stopViewportAnimations,
  VIEWPORT_ANIMATION_MS,
} from '../ViewportActions';
import { elasticLimit, readTimeScale } from '../ChartSharedState';
import { makeEngine, settle } from './engineTestUtils';

const LO = -960;
const HI = 48;

beforeEach(() => {
  jest.useFakeTimers();
});

describe('stopViewportAnimations', () => {
  it('V1: freezes a running animation', () => {
    // Given
    const { state } = makeEngine();
    state.rightOffset.value = withTiming(-100, { duration: 1000 });
    jest.advanceTimersByTime(300);
    // When
    stopViewportAnimations(state);
    const frozen = state.rightOffset.value;
    settle();
    // Then
    expect(frozen).toBeGreaterThan(-100);
    expect(frozen).toBeLessThan(5);
    expect(state.rightOffset.value).toBe(frozen);
  });
});

describe('releaseViewport', () => {
  it.each([0, NaN])('V2: in bounds with velocity %p does nothing', (v) => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = -20;
    // When
    releaseViewport(state, options, v);
    settle();
    // Then
    expect(state.rightOffset.value).toBe(-20);
  });

  it.each([
    [HI + 20, HI],
    [LO - 20, LO],
  ])('V3: springs %p back to %p', (start, bound) => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = start;
    // When
    releaseViewport(state, options, 0);
    settle();
    // Then
    expect(state.rightOffset.value).toBeCloseTo(bound, 0);
    expect(state.rightOffset.value).toBeGreaterThanOrEqual(LO - 1e-6);
    expect(state.rightOffset.value).toBeLessThanOrEqual(HI + 1e-6);
  });

  it.each([
    [-200, 'history'],
    [200, 'realtime'],
  ])('V4: flings with %p bars/s towards %s and stays in bounds', (v) => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = 0;
    // When
    releaseViewport(state, options, v);
    jest.advanceTimersByTime(100);
    const moving = state.rightOffset.value;
    settle();
    // Then
    expect(Math.sign(moving)).toBe(Math.sign(v));
    expect(state.rightOffset.value).toBeGreaterThanOrEqual(LO - 1e-6);
    expect(state.rightOffset.value).toBeLessThanOrEqual(HI + 1e-6);
  });

  it('V5: ignores invalid bounds', () => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = 5000;
    // When
    releaseViewport(state, { ...options, maxRightOffsetBars: NaN }, 100);
    settle();
    // Then
    expect(state.rightOffset.value).toBe(5000);
  });
});

describe('scrollToRealtime / realtimeRightOffset', () => {
  it('V6: animates or jumps to the realtime offset', () => {
    // Given
    const a = makeEngine();
    const b = makeEngine();
    a.state.rightOffset.value = -500;
    b.state.rightOffset.value = -500;
    // When
    scrollToRealtime(a.state, a.options, true);
    scrollToRealtime(b.state, b.options, false);
    // Then
    expect(b.state.rightOffset.value).toBe(5);
    expect(a.state.rightOffset.value).toBe(-500);
    jest.advanceTimersByTime(VIEWPORT_ANIMATION_MS + 50);
    expect(a.state.rightOffset.value).toBeCloseTo(5, 6);
  });

  it('V7: does nothing when the target is not finite', () => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = -3;
    // When
    scrollToRealtime(
      state,
      { ...options, realtimeRightOffset: NaN, maxRightOffsetBars: NaN },
      false
    );
    // Then
    expect(state.rightOffset.value).toBe(-3);
  });

  it('V8: clamps the realtime offset to the pan bounds', () => {
    // Given
    const { state, options } = makeEngine();
    // When
    const target = realtimeRightOffset(readTimeScale(state), {
      ...options,
      realtimeRightOffset: 1000,
    });
    // Then
    expect(target).toBe(HI);
  });
});

describe('resetViewport', () => {
  it('V9: restores the initial zoom at realtime', () => {
    // Given
    const { state, options } = makeEngine();
    state.barSpacing.value = 30;
    state.rightOffset.value = -300;
    // When
    resetViewport(state, options, true);
    settle();
    // Then
    expect(state.barSpacing.value).toBeCloseTo(8, 6);
    expect(state.rightOffset.value).toBeCloseTo(5, 6);
  });

  it('V10: clamps the initial spacing to the zoom limits', () => {
    // Given
    const { state, options } = makeEngine();
    // When
    resetViewport(state, { ...options, initialBarSpacing: 1000 }, false);
    // Then
    expect(state.barSpacing.value).toBe(64);
  });
});

describe('resetViewport — invalid bounds', () => {
  it('V10b: keeps the offset when the realtime target is not finite', () => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = -42;
    // When
    resetViewport(
      state,
      { ...options, realtimeRightOffset: NaN, maxRightOffsetBars: NaN },
      false
    );
    // Then
    expect(state.barSpacing.value).toBe(8);
    expect(state.rightOffset.value).toBe(-42);
  });
});

describe('elasticLimit', () => {
  it.each([
    [400, 8, 7.5],
    [0, 8, 0],
    [400, 0, 0],
    [NaN, 8, 0],
  ])('V17: width %p, spacing %p → %p bars', (width, barSpacing, bars) => {
    // Given / When / Then
    expect(
      elasticLimit({ width, barSpacing, rightOffset: 0, barCount: 10 })
    ).toBe(bars);
  });
});

describe('showLogicalRange', () => {
  it('V11: fits the range into the plot', () => {
    // Given
    const { state, options } = makeEngine();
    // When
    showLogicalRange(state, options, 900, 999, false);
    // Then
    expect(state.barSpacing.value).toBe(4);
    expect(state.rightOffset.value).toBe(0);
  });

  it.each([
    ['to < from', 10, 5, 400],
    ['NaN to', 0, NaN, 400],
    ['NaN from', NaN, 10, 400],
    ['width 0', 0, 10, 0],
  ])('V12: ignores %s', (_label, from, to, width) => {
    // Given
    const { state, options } = makeEngine();
    state.plotWidth.value = width;
    // When
    showLogicalRange(state, options, from, to, false);
    // Then
    expect(state.barSpacing.value).toBe(8);
    expect(state.rightOffset.value).toBe(5);
  });

  it('V13: clamps huge ranges to the minimum spacing', () => {
    // Given
    const { state, options } = makeEngine();
    // When
    showLogicalRange(state, options, 0, 9999, true);
    settle();
    // Then
    expect(state.barSpacing.value).toBeCloseTo(options.minBarSpacing, 6);
  });
});

describe('resizePlot', () => {
  it('V14: resets the viewport on the first layout', () => {
    // Given
    const { state, options } = makeEngine();
    state.plotWidth.value = 0;
    state.rightOffset.value = -100;
    // When
    resizePlot(state, options, 320, 200);
    // Then
    expect([state.plotWidth.value, state.plotHeight.value]).toEqual([320, 200]);
    expect(state.rightOffset.value).toBe(5);
  });

  it('V15: keeps the scroll position on later resizes', () => {
    // Given
    const { state, options } = makeEngine();
    state.rightOffset.value = -100;
    // When
    resizePlot(state, options, 500, 250);
    // Then
    expect(state.plotWidth.value).toBe(500);
    expect(state.rightOffset.value).toBe(-100);
  });

  it.each([NaN, -1, Infinity])('V16: sanitizes size %p to 0', (size) => {
    // Given
    const { state, options } = makeEngine();
    state.plotWidth.value = 0;
    state.rightOffset.value = -100;
    // When
    resizePlot(state, options, size, size);
    // Then
    expect([state.plotWidth.value, state.plotHeight.value]).toEqual([0, 0]);
    expect(state.rightOffset.value).toBe(-100);
  });
});
