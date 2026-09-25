/**
 * Test perspective table — sticky-mode crosshair drag handlers (worklets
 * called from the RNGH touch callbacks; RNGH's jest utils cannot fire
 * touch events, so they are driven directly with a fake state manager).
 * Engine fixture: 1000 bars, plot 400 dp, crosshair shown at bar 999.
 *
 * | Case | Input / Precondition                              | Perspective      | Expected                                     |
 * | XG12 | exceedsSlop at, below and above the slop          | Boundary (±)     | false / false / true                         |
 * | XG13 | sticky touch down: hidden / 2 fingers / no touch  | Invalid          | fails                                        |
 * | XG14 | sticky touch down + move within / past slop       | Equivalence      | tracks / activates once                      |
 * | XG15 | sticky touch up after a drag / without a drag     | Equivalence      | end / fail + tap → finalize hides            |
 * | XG16 | finalize without a tap (cancelled)                | Equivalence      | crosshair kept, bookkeeping reset            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { makeMutable } from 'react-native-reanimated';
import { makeEngine, settle } from '../../engine/__tests__/engineTestUtils';
import { showCrosshair } from '../../engine/CrosshairActions';
import {
  exceedsSlop,
  STICKY_DRAG_SLOP_DP,
  stickyFinalize,
  stickyTouchDown,
  stickyTouchMove,
  stickyTouchUp,
  type StickyTouch,
} from '../useCrosshairGesture';

beforeEach(() => {
  jest.useFakeTimers();
});

describe('sticky drag handlers', () => {
  const slop = STICKY_DRAG_SLOP_DP;

  function setup(shown = true) {
    const { state } = makeEngine();
    state.rightOffset.value = 0;
    if (shown) {
      showCrosshair(state, 396, 100);
    }
    const touch0 = makeMutable<StickyTouch>({
      x: 0,
      y: 0,
      drag: false,
      tap: false,
    });
    const manager = { activate: jest.fn(), fail: jest.fn(), end: jest.fn() };
    return { state, touch0, manager };
  }

  const touches = (x: number, y: number, n = 1) => ({
    numberOfTouches: n,
    allTouches: [{ id: 0, x, y, absoluteX: x, absoluteY: y }],
  });

  it.each([
    [slop, 0, false],
    [slop - 1, 0, false],
    [slop, 1, true],
  ])('XG12: exceedsSlop(%p, %p) → %p', (dx, dy, expected) => {
    // Given / When / Then
    expect(exceedsSlop(dx, dy, slop)).toBe(expected);
  });

  it('XG13: fails when hidden, for two fingers or without a touch', () => {
    // Given
    const hidden = setup(false);
    const shown = setup();
    // When
    stickyTouchDown(hidden.state, hidden.touch0, touches(1, 1), hidden.manager);
    stickyTouchDown(shown.state, shown.touch0, touches(1, 1, 2), shown.manager);
    stickyTouchDown(
      shown.state,
      shown.touch0,
      { numberOfTouches: 1, allTouches: [] },
      shown.manager
    );
    // Then
    expect(hidden.manager.fail).toHaveBeenCalledTimes(1);
    expect(shown.manager.fail).toHaveBeenCalledTimes(2);
  });

  it('XG14: activates once past the slop', () => {
    // Given
    const { state, touch0, manager } = setup();
    stickyTouchDown(state, touch0, touches(100, 100), manager);
    // When
    stickyTouchMove(touch0, touches(102, 102), manager);
    const within = manager.activate.mock.calls.length;
    stickyTouchMove(touch0, touches(110, 100), manager);
    stickyTouchMove(touch0, touches(120, 100), manager);
    stickyTouchMove(touch0, { numberOfTouches: 0, allTouches: [] }, manager);
    // Then
    expect(within).toBe(0);
    expect(manager.activate).toHaveBeenCalledTimes(1);
    expect(touch0.value.drag).toBe(true);
    expect(manager.fail).not.toHaveBeenCalled();
  });

  it('XG15: ends a drag; a tap fails and hides on finalize', () => {
    // Given
    const drag = setup();
    stickyTouchDown(drag.state, drag.touch0, touches(100, 100), drag.manager);
    stickyTouchMove(drag.touch0, touches(120, 100), drag.manager);
    const tap = setup();
    stickyTouchDown(tap.state, tap.touch0, touches(100, 100), tap.manager);
    // When
    stickyTouchUp(drag.touch0, drag.manager);
    stickyFinalize(drag.state, drag.touch0);
    stickyTouchUp(tap.touch0, tap.manager);
    stickyFinalize(tap.state, tap.touch0);
    settle(1000);
    // Then
    expect(drag.manager.end).toHaveBeenCalledTimes(1);
    expect(drag.state.crosshairOpacity.value).toBe(1);
    expect(tap.manager.fail).toHaveBeenCalledTimes(1);
    expect(tap.state.crosshairOpacity.value).toBe(0);
  });

  it('XG16: a cancelled touch keeps the crosshair', () => {
    // Given
    const { state, touch0, manager } = setup();
    stickyTouchDown(state, touch0, touches(100, 100), manager);
    // When: finalized without touch-up (cancelled by the long press)
    stickyFinalize(state, touch0);
    settle(1000);
    // Then
    expect(state.crosshairOpacity.value).toBe(1);
    expect(touch0.value).toEqual({ x: 0, y: 0, drag: false, tap: false });
  });
});
