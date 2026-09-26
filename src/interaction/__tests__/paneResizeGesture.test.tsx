/**
 * Test perspective table — pane separator drag (usePaneResizeGesture)
 * (chart 480 × 324 → stack 300; price 225 + RSI 75 → separator at y 225.
 * RNGH jest utils don't emit touch events, so the gesture callbacks are
 * invoked directly with a fake state manager.)
 *
 * | Case | Input / Precondition                            | Perspective       | Expected                                           |
 * |------|-------------------------------------------------|-------------------|----------------------------------------------------|
 * | RG1  | touch on the separator, drag −45, release       | Normal            | activates; layout follows; ratios committed        |
 * | RG2  | touch within the hit slop (y 225 + 12)          | Boundary (max)    | activates                                          |
 * | RG3  | touch just outside the slop (y 225 + 13)        | Boundary (max+1)  | fails; no layout change, no commit                 |
 * | RG4  | two touches / no touch data                     | Abnormal          | fails                                              |
 * | RG5  | single pane (no separator)                      | Boundary (empty)  | fails                                              |
 * | RG6  | update / finalize without a hit                 | Abnormal          | ignored, no commit                                 |
 * | RG7  | drag past the minimum height                    | Boundary (min)    | clamped to the RSI minimum (40)                    |
 * | RG8  | paneResizeEnabled false                         | Equivalence       | gesture disabled                                   |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import type { PanGesture } from 'react-native-gesture-handler';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { TradingChartProps } from '../../components/TradingChart';
import { PANE_RESIZE_TEST_ID } from '../usePaneResizeGesture';
import { chart, tick } from './gestureTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const RSI: Partial<TradingChartProps> = { indicators: [{ type: 'rsi' }] };

type Handlers = PanGesture['handlers'];

function gesture(): PanGesture {
  return getByGestureTestId(PANE_RESIZE_TEST_ID) as unknown as PanGesture;
}

function manager() {
  return {
    activate: jest.fn(),
    fail: jest.fn(),
    begin: jest.fn(),
    end: jest.fn(),
  };
}

function touchDown(y: number, touches = 1, hasTouch = true) {
  const m = manager();
  const handlers: Handlers = gesture().handlers;
  act(() => {
    handlers.onTouchesDown?.(
      {
        changedTouches: hasTouch
          ? [{ id: 0, x: 100, y, absoluteX: 100, absoluteY: y }]
          : [],
        allTouches: [],
        numberOfTouches: touches,
        eventType: 1,
        handlerTag: 1,
        state: 0,
        pointerType: 0,
      } as never,
      m as never
    );
  });
  return m;
}

function dragTo(translationY: number) {
  act(() => {
    gesture().handlers.onUpdate?.({ translationY } as never);
  });
  tick();
}

function release() {
  act(() => {
    gesture().handlers.onFinalize?.({} as never, true);
  });
  tick();
}

describe('usePaneResizeGesture', () => {
  it('RG1: drags the separator and commits the ratios', async () => {
    // Given
    const { handle } = await chart(undefined, undefined, RSI);
    expect(handle.state.paneLayout.value.heights).toEqual([225, 75]);
    // When
    const m = touchDown(225);
    dragTo(-45);
    // Then: live layout on the UI thread, config untouched
    expect(m.activate).toHaveBeenCalled();
    expect(m.fail).not.toHaveBeenCalled();
    expect(handle.state.paneLayout.value.heights).toEqual([180, 120]);
    expect(handle.state.plotHeight.value).toBe(180);
    expect(handle.getPanes()[1]?.heightRatio).toBe(1);
    // When
    release();
    // Then: committed once on release
    const ratios = handle.getPanes().map((p) => p.heightRatio);
    expect(ratios[0]! / ratios[1]!).toBeCloseTo(1.5, 9);
    expect(handle.state.paneLayout.value.heights).toEqual([180, 120]);
  });

  it('RG2: activates within the hit slop', async () => {
    // Given
    await chart(undefined, undefined, RSI);
    // When
    const m = touchDown(237);
    // Then
    expect(m.activate).toHaveBeenCalled();
  });

  it('RG3: fails just outside the hit slop', async () => {
    // Given
    const { handle } = await chart(undefined, undefined, RSI);
    // When
    const m = touchDown(238);
    dragTo(-45);
    release();
    // Then
    expect(m.fail).toHaveBeenCalled();
    expect(m.activate).not.toHaveBeenCalled();
    expect(handle.state.paneLayout.value.heights).toEqual([225, 75]);
    expect(handle.getPanes().map((p) => p.heightRatio)).toEqual([3, 1]);
  });

  it.each([
    [2, true],
    [1, false],
  ])('RG4: fails with %p touches (touch data %p)', async (touches, has) => {
    // Given
    await chart(undefined, undefined, RSI);
    // When
    const m = touchDown(225, touches, has);
    // Then
    expect(m.fail).toHaveBeenCalled();
    expect(m.activate).not.toHaveBeenCalled();
  });

  it('RG5: fails without separators', async () => {
    // Given
    await chart();
    // When
    const m = touchDown(0);
    // Then
    expect(m.fail).toHaveBeenCalled();
  });

  it('RG6: update / finalize without a hit are ignored', async () => {
    // Given
    const { handle } = await chart(undefined, undefined, RSI);
    const before = handle.getPanes();
    // When
    dragTo(-45);
    release();
    // Then
    expect(handle.state.paneLayout.value.heights).toEqual([225, 75]);
    expect(handle.getPanes()).toBe(before);
  });

  it('RG7: clamps to the minimum pane height', async () => {
    // Given
    const { handle } = await chart(undefined, undefined, RSI);
    // When
    touchDown(225);
    dragTo(100);
    release();
    // Then
    expect(handle.state.paneLayout.value.heights).toEqual([260, 40]);
  });

  it('RG8: disabled by config', async () => {
    // Given / When
    await chart({ interaction: { paneResizeEnabled: false } }, undefined, RSI);
    // Then
    expect(gesture().config.enabled).toBe(false);
  });
});
