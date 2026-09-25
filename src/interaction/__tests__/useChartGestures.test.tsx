/**
 * Test perspective table — pinch, double tap, config and composition
 * (RNGH jest utils + real Reanimated, fake timers; pan: panGesture.test).
 *
 * | Case | Input / Precondition                          | Perspective      | Expected                                 |
 * |------|-----------------------------------------------|------------------|------------------------------------------|
 * | GS7  | pinch ×2 at focal x                           | Equivalence      | spacing 16                               |
 * | GS8  | pinch ×100                                    | Boundary (max)   | spacing clamped to 64                    |
 * | GS9  | double tap after zoom/scroll                  | Equivalence      | animated reset to 8 / 5                  |
 * | GS10 | failed double tap                             | Invalid          | nothing changes                          |
 * | GS11 | pan / pinch disabled by config                | Equivalence      | gesture ignored                          |
 * | GS12 | compose with / without crosshair             | Equivalence      | Race(crosshair, Simultaneous) / Simult.  |
 * | GS13 | crosshairGesture prop                         | Equivalence      | chart renders, pan still works           |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { Gesture, State } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { composeChartGestures, GESTURE_TEST_IDS } from '../useChartGestures';
import { chart, drag, pinch, tick } from './gestureTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

describe('pinch', () => {
  it('GS7: zooms around the focal point', async () => {
    // Given
    const { handle } = await chart();
    // When
    pinch(2);
    tick(2000);
    // Then
    expect(handle.state.barSpacing.value).toBe(16);
    expect(handle.state.activeGestures.value).toBe(0);
  });

  it('GS8: clamps the zoom to the max bar spacing', async () => {
    // Given
    const { handle } = await chart();
    // When
    pinch(100);
    // Then
    expect(handle.state.barSpacing.value).toBe(64);
  });
});

describe('double tap', () => {
  it('GS9: resets zoom and scroll', async () => {
    // Given
    const { handle } = await chart();
    pinch(3);
    drag([400]);
    tick(2000);
    // When
    act(() => {
      fireGestureHandler(getByGestureTestId(GESTURE_TEST_IDS.doubleTap), [
        { state: State.BEGAN },
        { state: State.ACTIVE },
        { state: State.END },
      ]);
    });
    tick(1000);
    // Then
    expect(handle.state.barSpacing.value).toBeCloseTo(8, 6);
    expect(handle.state.rightOffset.value).toBeCloseTo(5, 6);
  });

  it('GS10: ignores a failed double tap', async () => {
    // Given
    const { handle } = await chart();
    pinch(3);
    // When
    act(() => {
      fireGestureHandler(getByGestureTestId(GESTURE_TEST_IDS.doubleTap), [
        { state: State.BEGAN },
        { state: State.FAILED },
      ]);
    });
    tick(1000);
    // Then
    expect(handle.state.barSpacing.value).toBe(24);
  });
});

describe('configuration and composition', () => {
  it('GS11: ignores disabled gestures', async () => {
    // Given
    const { handle } = await chart({
      interaction: { panEnabled: false, pinchEnabled: false },
    });
    // When
    drag([80]);
    pinch(2);
    tick(1000);
    // Then
    expect(handle.state.rightOffset.value).toBe(5);
    expect(handle.state.barSpacing.value).toBe(8);
  });

  it('GS12: races the crosshair against the viewport gestures', () => {
    // Given
    const pan = Gesture.Pan();
    const pinchG = Gesture.Pinch();
    const tap = Gesture.Tap();
    const crosshair = Gesture.LongPress();
    // When
    const withCrosshair = composeChartGestures(pan, pinchG, tap, crosshair);
    const without = composeChartGestures(pan, pinchG, tap);
    // Then
    expect(withCrosshair.toGestureArray()).toEqual([
      crosshair,
      pan,
      pinchG,
      tap,
    ]);
    expect(without.toGestureArray()).toEqual([pan, pinchG, tap]);
    expect(withCrosshair.constructor.name).toBe('ComposedGesture');
    expect(without.constructor.name).toBe('SimultaneousGesture');
  });

  it('GS13: accepts a crosshair gesture', async () => {
    // Given
    const crosshair = Gesture.Pan().activateAfterLongPress(300);
    const { handle } = await chart(undefined, crosshair);
    // When
    drag([80]);
    // Then
    expect(handle.state.rightOffset.value).toBeCloseTo(-5, 9);
  });
});
