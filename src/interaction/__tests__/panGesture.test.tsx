/**
 * Test perspective table — pan gesture (RNGH jest utils + real Reanimated,
 * fake timers; harness in gestureTestUtils: pan bounds [-960, 48]).
 *
 * | Case | Input / Precondition                          | Perspective      | Expected                                 |
 * |------|-----------------------------------------------|------------------|------------------------------------------|
 * | GS1  | drag +80 dp, no velocity                      | Equivalence      | offset -5 (1:1), stays                   |
 * | GS2  | drag during which React is watched            | Performance      | no React render per gesture frame        |
 * | GS3  | drag with fling velocity                      | Equivalence      | glides further, ends in bounds           |
 * | GS4  | drag far past realtime, release               | Boundary         | rubber band, springs back to 48          |
 * | GS5  | touch down during an animation                | Equivalence      | animation stopped                        |
 * | GS5b | touch down while a pinch is active            | Equivalence      | running animation not stopped            |
 * | GS6  | touch without pan out of bounds; 0 / 1 active | Boundary         | springs back / left to the other gesture |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { State, type PanGesture } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { scrollToRealtime } from '../../engine/ViewportActions';
import { GESTURE_TEST_IDS } from '../useChartGestures';
import { chart, drag, tick } from './gestureTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

describe('pan', () => {
  it('GS1: drags 1:1 with the finger', async () => {
    // Given
    const { handle } = await chart();
    // When
    drag([40, 80]);
    tick(2000);
    // Then
    expect(handle.state.rightOffset.value).toBeCloseTo(-5, 9);
    expect(handle.state.activeGestures.value).toBe(0);
  });

  it('GS2: does not re-render React while panning', async () => {
    // Given
    const { handle } = await chart();
    const renders = handle.metrics.snapshot().renderCount;
    // When
    drag([10, 20, 30, 40, 50, 60], 500);
    tick(2000);
    // Then
    expect(handle.state.rightOffset.value).not.toBe(5);
    expect(handle.metrics.snapshot().renderCount).toBe(renders);
  });

  it('GS3: flings with the release velocity', async () => {
    // Given
    const { handle } = await chart();
    // When: finger moving right at 2000 dp/s → into history
    drag([40, 80], 2000);
    tick(100);
    const gliding = handle.state.rightOffset.value;
    tick(5000);
    // Then
    const end = handle.state.rightOffset.value;
    expect(gliding).toBeLessThan(-5);
    expect(end).toBeLessThan(gliding);
    expect(end).toBeGreaterThanOrEqual(-960 - 1e-6);
  });

  it('GS4: rubber-bands past the edge and springs back', async () => {
    // Given
    const { handle } = await chart();
    // When: 200 bars towards the future, released without velocity
    drag([-800, -1600]);
    const stretched = handle.state.rightOffset.value;
    tick(5000);
    // Then
    expect(stretched).toBeGreaterThan(48);
    expect(stretched).toBeLessThan(205);
    expect(handle.state.rightOffset.value).toBeCloseTo(48, 0);
  });

  it('GS5: a new touch stops a running animation', async () => {
    // Given
    const { handle } = await chart();
    handle.state.rightOffset.value = -300;
    scrollToRealtime(handle.state, handle.options, true);
    tick(60);
    // When
    act(() => {
      fireGestureHandler(getByGestureTestId(GESTURE_TEST_IDS.pan), [
        { state: State.BEGAN, translationX: 0 },
      ]);
    });
    const caught = handle.state.rightOffset.value;
    tick(1000);
    // Then
    expect(caught).toBeGreaterThan(-300);
    expect(caught).toBeLessThan(5);
    expect(handle.state.rightOffset.value).toBe(caught);
  });

  it('GS5b: touch down during a pinch leaves animations alone', async () => {
    // Given
    const { handle } = await chart();
    handle.state.activeGestures.value = 1;
    handle.state.rightOffset.value = -300;
    scrollToRealtime(handle.state, handle.options, true);
    // When
    act(() => {
      getByGestureTestId(GESTURE_TEST_IDS.pan).handlers.onBegin?.({} as never);
    });
    tick(1000);
    // Then
    expect(handle.state.rightOffset.value).toBeCloseTo(5, 6);
  });

  it.each([
    [0, 48],
    [1, 100],
  ])(
    'GS6: a touch that never pans, %p other gesture(s) active → offset %p',
    async (active, expected) => {
      // Given: jest-utils always drives a pan through ACTIVE, so call the
      // finalize handler of a touch that failed before activating.
      const { handle } = await chart();
      handle.state.rightOffset.value = 100;
      handle.state.activeGestures.value = active;
      const pan = getByGestureTestId(GESTURE_TEST_IDS.pan) as PanGesture;
      type FinalizeEvent = Parameters<
        NonNullable<typeof pan.handlers.onFinalize>
      >[0];
      // When
      act(() => {
        pan.handlers.onFinalize?.(
          { velocityX: 0 } as unknown as FinalizeEvent,
          false
        );
      });
      tick(5000);
      // Then
      expect(handle.state.rightOffset.value).toBeCloseTo(expected, 0);
    }
  );
});
