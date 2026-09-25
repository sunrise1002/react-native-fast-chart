/**
 * Test perspective table — CrosshairActions (real Reanimated, fake timers)
 *
 * Fixture: 1000 bars, plot 400 dp, spacing 8, rightOffset 0
 * (x(i) = 400 - (999.5 - i) × 8 → x 396 = bar 999, x 4 = bar 950).
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                 |
 * |------|----------------------------------------------------|--------------------|------------------------------------------|
 * | CA1  | show at (396, 120)                                 | Equivalence        | opacity 1, bar 999, y 120, shown         |
 * | CA2  | move to x 4                                        | Equivalence        | bar 950                                  |
 * | CA3  | move beyond the data (x -500 / 5000)               | Boundary           | clamped bar                              |
 * | CA4  | move with NaN x / NaN y                            | Invalid            | index / y kept                           |
 * | CA5  | move without data                                  | Boundary (empty)   | index kept                               |
 * | CA6  | hide animated, no delay                            | Equivalence        | fades to 0 within the fade duration      |
 * | CA7  | hide with delay 1000                               | Equivalence        | still shown before, hidden after         |
 * | CA8  | hide not animated                                  | Equivalence        | 0 immediately                            |
 * | CA9  | show during a pending hide                         | Equivalence        | hide cancelled, stays 1                  |
 * | CA10 | hide delay NaN / ∞ / -1                            | Invalid            | treated as no delay                      |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  CROSSHAIR_FADE_MS,
  hideCrosshair,
  isCrosshairShown,
  moveCrosshair,
  showCrosshair,
} from '../CrosshairActions';
import { makeEngine, settle } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

function engine(bars = 1000) {
  const e = makeEngine(bars);
  e.state.rightOffset.value = 0;
  return e;
}

describe('show / move', () => {
  it('CA1: shows at the touch point', () => {
    // Given
    const { state } = engine();
    // When
    showCrosshair(state, 396, 120);
    // Then
    expect(state.crosshairOpacity.value).toBe(1);
    expect(state.crosshairIndex.value).toBe(999);
    expect(state.crosshairY.value).toBe(120);
    expect(isCrosshairShown(state)).toBe(true);
  });

  it('CA2: snaps to the nearest bar', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    moveCrosshair(state, 4, 10);
    // Then
    expect(state.crosshairIndex.value).toBe(950);
    expect(state.crosshairY.value).toBe(10);
  });

  it.each([
    [-50000, 0],
    [5000, 999],
  ])('CA3: x %p → bar %p', (x, expected) => {
    // Given
    const { state } = engine();
    // When
    moveCrosshair(state, x, 0);
    // Then
    expect(state.crosshairIndex.value).toBe(expected);
  });

  it('CA4: ignores non-finite coordinates', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    moveCrosshair(state, NaN, NaN);
    // Then
    expect(state.crosshairIndex.value).toBe(999);
    expect(state.crosshairY.value).toBe(120);
  });

  it('CA5: keeps the index without data', () => {
    // Given
    const { state } = engine(0);
    // When
    moveCrosshair(state, 100, 50);
    // Then
    expect(state.crosshairIndex.value).toBe(-1);
    expect(state.crosshairY.value).toBe(50);
  });
});

describe('hide', () => {
  it('CA6: fades out', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    hideCrosshair(state);
    settle(CROSSHAIR_FADE_MS + 50);
    // Then
    expect(state.crosshairOpacity.value).toBe(0);
    expect(isCrosshairShown(state)).toBe(false);
  });

  it('CA7: waits for the delay', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    hideCrosshair(state, 1000);
    settle(800);
    const during = state.crosshairOpacity.value;
    settle(1000);
    // Then
    expect(during).toBe(1);
    expect(state.crosshairOpacity.value).toBe(0);
  });

  it('CA8: hides immediately when not animated', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    hideCrosshair(state, 1000, false);
    // Then
    expect(state.crosshairOpacity.value).toBe(0);
  });

  it('CA9: show cancels a pending hide', () => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    hideCrosshair(state, 500);
    // When
    showCrosshair(state, 4, 10);
    settle(2000);
    // Then
    expect(state.crosshairOpacity.value).toBe(1);
  });

  it.each([[NaN], [Infinity], [-1]])('CA10: delay %p → no delay', (delay) => {
    // Given
    const { state } = engine();
    showCrosshair(state, 396, 120);
    // When
    hideCrosshair(state, delay);
    settle(CROSSHAIR_FADE_MS + 50);
    // Then
    expect(state.crosshairOpacity.value).toBe(0);
  });
});
