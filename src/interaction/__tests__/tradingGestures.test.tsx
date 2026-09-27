/**
 * Test perspective table — overlay gestures (useTradingGestures via
 * TradingChart; RNGH jest utils don't emit touch events, so the gesture
 * callbacks are invoked directly with a fake state manager. Plot 400 × 300,
 * tick size 0.5.)
 *
 * | Case | Input / Precondition                                    | Perspective        | Expected                                        |
 * |------|---------------------------------------------------------|--------------------|-------------------------------------------------|
 * | TG1  | touch a draggable line's label, drag 30 dp up, release  | Equivalence        | activates; snapped 'change'; one 'commit'       |
 * | TG2  | same snapped price twice                                | Boundary           | one 'change' only                               |
 * | TG3  | touch away from any overlay                             | Equivalence (miss) | fails; nothing emitted                          |
 * | TG4  | two touches / no touch data                             | Invalid            | fails                                           |
 * | TG5  | update / finalize without a grab                        | Invalid            | ignored                                         |
 * | TG6  | release without moving                                  | Boundary (0 move)  | no commit                                       |
 * | TG7  | tap a drawing, drag its body, release                   | Equivalence        | selected; anchors moved in the store            |
 * | TG8  | drawing tool: two taps                                  | Equivalence        | drawing created and selected, tool off          |
 * | TG9  | tap failed / below the plot / empty area                | Invalid / Boundary | no change / selection cleared                   |
 * | TG10 | trading.dragEnabled false                               | Equivalence        | both gestures disabled                          |
 * | TG11 | composeChartGestures with the overlay tap / drawing mode| Equivalence        | Exclusive(doubleTap, tap) / tap alone           |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import {
  Gesture,
  type PanGesture,
  type TapGesture,
} from 'react-native-gesture-handler';
import { getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import { snapToTickSize } from '../../axes/SymbolPrecision';
import type { ChartControllerInternals } from '../../engine/ChartHandle';
import type { OverlayDragEvent } from '../../trading/TradingTypes';
import { priceToY, yToPrice } from '../../viewport/PriceScale';
import { indexToX } from '../../viewport/TimeScale';
import { readTimeScale } from '../../engine/ChartSharedState';
import { composeChartGestures } from '../useChartGestures';
import { TRADING_GESTURE_TEST_IDS } from '../useTradingGestures';
import { chart, tick } from './gestureTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const drag = () =>
  getByGestureTestId(TRADING_GESTURE_TEST_IDS.drag) as unknown as PanGesture;
const tap = () =>
  getByGestureTestId(TRADING_GESTURE_TEST_IDS.tap) as unknown as TapGesture;

function manager() {
  return {
    activate: jest.fn(),
    fail: jest.fn(),
    begin: jest.fn(),
    end: jest.fn(),
  };
}

function touchDown(x: number, y: number, touches = 1, hasTouch = true) {
  const m = manager();
  act(() => {
    drag().handlers.onTouchesDown?.(
      {
        changedTouches: hasTouch
          ? [{ id: 0, x, y, absoluteX: x, absoluteY: y }]
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

function moveTo(x: number, y: number) {
  act(() => {
    drag().handlers.onUpdate?.({ x, y } as never);
  });
  tick();
}

function release() {
  act(() => {
    drag().handlers.onFinalize?.({} as never, true);
  });
  tick();
}

function tapAt(x: number, y: number, success = true) {
  act(() => {
    tap().handlers.onEnd?.({ x, y } as never, success);
  });
  tick();
}

function scale(handle: ChartControllerInternals) {
  const s = handle.state;
  return {
    mode: 'linear' as const,
    top: 0,
    height: s.plotHeight.value,
    min: s.priceMin.value,
    max: s.priceMax.value,
  };
}

async function withLine(
  onOverlayDrag = jest.fn<(e: OverlayDragEvent) => void>()
) {
  const { handle } = await chart({ symbol: { tickSize: 0.5 } }, undefined, {
    onOverlayDrag,
  });
  const mid = snapToTickSize(
    (handle.state.priceMin.value + handle.state.priceMax.value) / 2,
    0.5
  );
  act(() => {
    handle.addPriceLine({
      id: 'alert',
      price: mid,
      draggable: true,
      label: 'Alert',
    });
  });
  tick();
  const y = priceToY(scale(handle), mid);
  return { handle, mid, y, onOverlayDrag };
}

describe('line drag', () => {
  it('TG1: drags a level with snapped change events and one commit', async () => {
    // Given
    const { handle, mid, y, onOverlayDrag } = await withLine();
    // When
    const m = touchDown(20, y);
    moveTo(20, y - 30);
    // Then
    expect(m.activate).toHaveBeenCalled();
    const expected = snapToTickSize(
      mid + yToPrice(scale(handle), y - 30) - yToPrice(scale(handle), y),
      0.5
    );
    expect(onOverlayDrag).toHaveBeenCalledWith({
      phase: 'change',
      target: 'priceLine',
      id: 'alert',
      price: expected,
    });
    expect(handle.getPriceLines()[0]?.price).toBe(mid);
    // When
    release();
    // Then
    expect(onOverlayDrag).toHaveBeenLastCalledWith({
      phase: 'commit',
      target: 'priceLine',
      id: 'alert',
      price: expected,
    });
    expect(handle.getPriceLines()[0]?.price).toBe(expected);
    expect(handle.state.tradingUi.value.dragKey).toBe('');
  });

  it('TG2: repeated positions emit one change', async () => {
    // Given
    const { y, onOverlayDrag } = await withLine();
    touchDown(20, y);
    // When
    moveTo(20, y - 30);
    moveTo(20, y - 30);
    // Then
    expect(onOverlayDrag).toHaveBeenCalledTimes(1);
  });

  it('TG3: a touch away from overlays fails', async () => {
    // Given
    const { y, onOverlayDrag } = await withLine();
    // When
    const m = touchDown(200, y + 60);
    // Then
    expect(m.fail).toHaveBeenCalled();
    expect(m.activate).not.toHaveBeenCalled();
    expect(onOverlayDrag).not.toHaveBeenCalled();
  });

  it.each([
    [2, true],
    [1, false],
  ])('TG4: %p touches, touch data %p → fails', async (touches, hasTouch) => {
    // Given
    const { y } = await withLine();
    // When
    const m = touchDown(20, y, touches, hasTouch);
    // Then
    expect(m.fail).toHaveBeenCalled();
  });

  it('TG5 / TG6: updates without a grab and releases without a move', async () => {
    // Given
    const { handle, mid, y, onOverlayDrag } = await withLine();
    // When: no grab
    moveTo(20, y - 30);
    release();
    // Then
    expect(onOverlayDrag).not.toHaveBeenCalled();
    // When: grab, release in place
    touchDown(20, y);
    release();
    // Then
    expect(onOverlayDrag).not.toHaveBeenCalled();
    expect(handle.getPriceLines()[0]?.price).toBe(mid);
  });
});

describe('drawings', () => {
  it('TG7: tap to select, then drag the body', async () => {
    // Given: a horizontal line through the middle of the plot
    const { handle } = await chart({ symbol: { tickSize: 0.5 } });
    const series = handle.state.series.value;
    const last = series.length - 1;
    const time = series.time[last] as number;
    const price = snapToTickSize(
      (handle.state.priceMin.value + handle.state.priceMax.value) / 2,
      0.5
    );
    let id = '';
    act(() => {
      id = handle.addDrawing({
        type: 'horizontalRay',
        anchors: [{ time, price }],
      });
    });
    tick();
    const x = indexToX(readTimeScale(handle.state), last - 5);
    const y = priceToY(scale(handle), price);
    // When
    tapAt(x - 40, y);
    // Then: the ray starts at `x - 50`… the tap left of it misses
    expect(handle.getSelectedDrawingId()).toBeNull();
    // When
    tapAt(x + 40, y);
    // Then
    expect(handle.getSelectedDrawingId()).toBe(id);
    // When: drag the body 20 dp up
    const m = touchDown(x + 40, y);
    moveTo(x + 40, y - 20);
    release();
    // Then
    expect(m.activate).toHaveBeenCalled();
    const moved = handle.getDrawings()[0]?.anchors[0];
    expect(moved?.time).toBe(time);
    expect(moved?.price).toBeGreaterThan(price);
  });

  it('TG8: tap-tap creates a drawing with the active tool', async () => {
    // Given
    const { handle } = await chart();
    act(() => {
      handle.setDrawingTool('trendLine');
    });
    tick();
    // When
    tapAt(100, 100);
    tapAt(300, 200);
    // Then
    const drawings = handle.getDrawings();
    expect(drawings).toHaveLength(1);
    expect(drawings[0]?.type).toBe('trendLine');
    expect(handle.getSelectedDrawingId()).toBe(drawings[0]?.id);
    expect(handle.getDrawingTool()).toBeNull();
  });

  it('TG9: failed taps, taps below the plot, empty area', async () => {
    // Given
    const { handle } = await chart();
    act(() => {
      handle.setDrawingTool('horizontalLine');
    });
    tick();
    // When
    tapAt(100, 100, false);
    tapAt(100, 310);
    // Then
    expect(handle.getDrawings()).toHaveLength(0);
    // When: a drawing is selected, then the empty area is tapped
    act(() => {
      handle.setDrawingTool(null);
      const id = handle.addDrawing({
        type: 'horizontalLine',
        anchors: [{ time: 0, price: -1e9 }],
      });
      handle.selectDrawing(id);
    });
    tick();
    tapAt(100, 100);
    // Then
    expect(handle.getSelectedDrawingId()).toBeNull();
  });
});

describe('composition', () => {
  it('TG10: dragEnabled false disables the overlay gestures', async () => {
    // Given / When
    await chart({ trading: { dragEnabled: false } });
    // Then
    expect(drag().config.enabled).toBe(false);
    expect(tap().config.enabled).toBe(false);
  });

  it('TG11: the overlay tap waits for the double tap unless drawing', () => {
    // Given
    const pan = Gesture.Pan();
    const pinch = Gesture.Pinch();
    const doubleTap = Gesture.Tap();
    const overlay = Gesture.Tap();
    // When
    const normal = composeChartGestures(pan, pinch, doubleTap, undefined, {
      tap: overlay,
      drawingMode: false,
    });
    const drawing = composeChartGestures(pan, pinch, doubleTap, undefined, {
      tap: overlay,
      drawingMode: true,
    });
    // Then
    expect(normal.toGestureArray()).toEqual([pan, pinch, doubleTap, overlay]);
    expect(drawing.toGestureArray()).toEqual([pan, pinch, overlay]);
  });
});
