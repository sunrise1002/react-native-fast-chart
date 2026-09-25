/**
 * Test perspective table — crosshair gestures + onCrosshairChange (RNGH
 * jest utils, real Reanimated, fake timers; harness plot 400 × 300, 1000
 * bars, spacing 8, rightOffset 5 → x 356 = bar 999, x 4 = bar 955).
 *
 * | Case | Input / Precondition                              | Perspective      | Expected                                     |
 * |------|---------------------------------------------------|------------------|----------------------------------------------|
 * | XG1  | long press at (356, 100), drag to x 4             | Equivalence      | shown, bar 999 → 955, y follows, no pan      |
 * | XG2  | hold mode release                                 | Equivalence      | visible until holdMs, then hidden            |
 * | XG3  | sticky mode release                               | Equivalence      | stays visible                                |
 * | XG4  | crosshairEnabled false                            | Equivalence      | no crosshair gesture registered              |
 * | XG5  | custom crosshairGesture prop                      | Equivalence      | replaces the built-in one                    |
 * | XG6  | longPressMs 0                                     | Boundary (0)     | still a valid long press (1 ms)              |
 * | XG7  | onCrosshairChange across bar changes and hide     | Equivalence      | one call per bar change, null on hide        |
 * | XG8  | moves within the same bar                         | Boundary         | no extra callback                            |
 * | XG9  | no handler                                        | Equivalence      | nothing dispatched, no error                 |
 * | XG10 | handler replaced after mount                      | Equivalence      | latest handler receives the change           |
 * | XG11 | readCrosshairBar -1 / length / 1.5 / offset       | Invalid/Boundary | null / null / null / physical offset honored |
 * | XG17 | sticky drag gesture updates + release             | Equivalence      | crosshair follows, stays visible             |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { Gesture, State } from 'react-native-gesture-handler';
import {
  fireGestureHandler,
  getByGestureTestId,
} from 'react-native-gesture-handler/jest-utils';
import { TradingChart } from '../../components/TradingChart';
import { columns } from '../../render/__tests__/columns';
import {
  readCrosshairBar,
  type CrosshairChange,
} from '../useCrosshairCallback';
import { CROSSHAIR_TEST_IDS } from '../useCrosshairGesture';
import { chart, tick } from './gestureTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

/** Long press at `points[0]`, then drag through the rest (no release). */
function press(points: [number, number][], release = true) {
  const [first, ...rest] = points;
  act(() => {
    fireGestureHandler(getByGestureTestId(CROSSHAIR_TEST_IDS.longPress), [
      { state: State.BEGAN, x: first?.[0], y: first?.[1] },
      { state: State.ACTIVE, x: first?.[0], y: first?.[1] },
      ...rest.map(([x, y]) => ({ x, y })),
      ...(release
        ? [{ state: State.END, x: points.at(-1)?.[0], y: points.at(-1)?.[1] }]
        : []),
    ]);
  });
}

describe('long-press crosshair', () => {
  it('XG1: shows, snaps to bars and follows the finger', async () => {
    // Given
    const { handle } = await chart();
    const { state } = handle;
    // When
    press([[356, 100]], false);
    const first = state.crosshairIndex.value;
    press([
      [356, 100],
      [4, 150],
    ]);
    // Then
    expect(first).toBe(999);
    expect(state.crosshairIndex.value).toBe(955);
    expect(state.crosshairY.value).toBe(150);
    expect(state.crosshairOpacity.value).toBe(1);
    expect(state.rightOffset.value).toBe(5);
  });

  it('XG2: hold mode hides after holdMs', async () => {
    // Given
    const { handle } = await chart({ crosshair: { holdMs: 1000 } });
    // When
    press([[356, 100]]);
    tick(900);
    const held = handle.state.crosshairOpacity.value;
    tick(1000);
    // Then
    expect(held).toBe(1);
    expect(handle.state.crosshairOpacity.value).toBe(0);
  });

  it('XG3: sticky mode keeps the crosshair after release', async () => {
    // Given
    const { handle } = await chart({ crosshair: { mode: 'sticky' } });
    // When
    press([[356, 100]]);
    tick(5000);
    // Then
    expect(handle.state.crosshairOpacity.value).toBe(1);
    expect(getByGestureTestId(CROSSHAIR_TEST_IDS.stickyDrag)).toBeDefined();
  });

  it('XG4: registers no crosshair when disabled', async () => {
    // Given / When
    await chart({ interaction: { crosshairEnabled: false } });
    // Then
    expect(() => getByGestureTestId(CROSSHAIR_TEST_IDS.longPress)).toThrow();
  });

  it('XG5: a custom crosshair gesture replaces the built-in one', async () => {
    // Given / When
    await chart(undefined, Gesture.Pan().withTestId('custom'));
    // Then
    expect(getByGestureTestId('custom')).toBeDefined();
    expect(() => getByGestureTestId(CROSSHAIR_TEST_IDS.longPress)).toThrow();
  });

  it('XG6: longPressMs 0 still installs a long press', async () => {
    // Given
    const { handle } = await chart({ crosshair: { longPressMs: 0 } });
    // When
    press([[356, 100]], false);
    // Then
    expect(handle.state.crosshairOpacity.value).toBe(1);
  });

  it('XG17: the sticky drag moves the crosshair and keeps it on release', async () => {
    // Given
    const { handle } = await chart({ crosshair: { mode: 'sticky' } });
    press([[356, 100]]);
    // When: an activated sticky drag (touch handlers are unit-tested below)
    act(() => {
      fireGestureHandler(getByGestureTestId(CROSSHAIR_TEST_IDS.stickyDrag), [
        { state: State.BEGAN, x: 356, y: 100 },
        { state: State.ACTIVE, x: 356, y: 100 },
        { x: 4, y: 120 },
        { state: State.END, x: 4, y: 120 },
      ]);
    });
    tick(1000);
    // Then
    expect(handle.state.crosshairIndex.value).toBe(955);
    expect(handle.state.crosshairOpacity.value).toBe(1);
  });
});

describe('onCrosshairChange', () => {
  it('XG7/XG8: fires once per bar change and null on hide', async () => {
    // Given
    const onChange = jest.fn<(c: CrosshairChange | null) => void>();
    const { handle } = await chart({ crosshair: { holdMs: 100 } }, undefined, {
      onCrosshairChange: onChange,
    });
    // When: bar 999, same bar (+1 dp), bar 955, release → hide
    press([
      [356, 100],
      [357, 120],
      [4, 150],
    ]);
    tick(2000);
    // Then
    const calls = onChange.mock.calls.map((c) => c[0]?.index ?? null);
    expect(calls).toEqual([999, 955, null]);
    const bar = onChange.mock.calls[0]?.[0];
    const series = handle.state.series.value;
    expect(bar?.close).toBe(series.close[series.offset + 999]);
    expect(bar?.time).toBe(series.time[series.offset + 999]);
  });

  it('XG9: works without a handler', async () => {
    // Given
    const { handle } = await chart();
    // When / Then
    expect(() => press([[356, 100]])).not.toThrow();
    expect(handle.state.crosshairIndex.value).toBe(999);
  });

  it('XG10: uses the latest handler', async () => {
    // Given
    const first = jest.fn();
    const second = jest.fn();
    const { view, handle } = await chart(undefined, undefined, {
      onCrosshairChange: first,
    });
    view.rerender(
      <TradingChart
        testID="chart"
        controller={handle}
        onCrosshairChange={second}
        config={{ layout: { priceAxisWidth: 80 } }}
      />
    );
    // When
    press([[356, 100]], false);
    tick();
    // Then
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('XG11: readCrosshairBar guards the index', () => {
    // Given
    const series = columns([[1, 2, 0, 1.5, 7]], Date.UTC(2024, 0, 1), 2);
    // When / Then
    expect(readCrosshairBar(series, -1)).toBeNull();
    expect(readCrosshairBar(series, 1)).toBeNull();
    expect(readCrosshairBar(series, 0.5)).toBeNull();
    expect(readCrosshairBar(series, 0)).toEqual({
      index: 0,
      time: Date.UTC(2024, 0, 1),
      open: 1,
      high: 2,
      low: 0,
      close: 1.5,
      volume: 7,
    });
  });
});
