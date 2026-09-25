/**
 * Test perspective table — CrosshairRenderer
 *
 * Time scale width 100, spacing 10, 10 bars (x(i) = 5 + 10 i); price pane
 * top 0 / height 100 / [0, 100].
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                  |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | NB1  | x at a bar center / between bars (rounding)           | Equivalence        | nearest bar                               |
 * | NB2  | x left of bar 0 / right of the last bar               | Boundary           | clamped to 0 / last                       |
 * | NB3  | no bars / NaN / ∞ x / zero spacing                    | Invalid            | -1                                        |
 * | CH1  | bar 3, finger y 42.3, pr 2                            | Equivalence        | x 35.25, y 42.25, price 57.7, bar time    |
 * | CH2  | finger above / below the pane                         | Boundary           | clamped into the pane                     |
 * | CH3  | bar off-screen (scrolled)                             | Boundary           | hidden                                    |
 * | CH4  | index -1 / = length / 1.5 / NaN; y NaN; height 0      | Invalid            | hidden, index -1                          |
 * | CH5  | pixel ratio NaN / 0                                   | Invalid            | treated as 1                              |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import { columns } from '../../__tests__/columns';
import {
  computeCrosshair,
  createCrosshairFrame,
  nearestBarIndex,
} from '../CrosshairRenderer';

const TIME: TimeScaleState = {
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount: 10,
};
const PRICE: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};
const T0 = Date.UTC(2024, 0, 1);
const SERIES = columns(
  Array.from({ length: 10 }, () => [1, 2, 0, 1, 5]),
  T0
);

function crosshair(
  index: number,
  y: number,
  pr = 2,
  time: TimeScaleState = TIME,
  price: PriceScaleSnapshot = PRICE
) {
  const out = createCrosshairFrame();
  const visible = computeCrosshair(SERIES, time, price, index, y, pr, out);
  return { visible, out };
}

describe('nearestBarIndex', () => {
  it.each([
    [35, 3],
    [39.9, 3],
    [40.1, 4],
  ])('NB1: x %p → bar %p', (x, expected) => {
    // Given / When / Then
    expect(nearestBarIndex(TIME, x)).toBe(expected);
  });

  it.each([
    [-50, 0],
    [0, 0],
    [100, 9],
    [500, 9],
  ])('NB2: x %p → clamped %p', (x, expected) => {
    // Given / When / Then
    expect(nearestBarIndex(TIME, x)).toBe(expected);
  });

  it.each<[string, TimeScaleState, number]>([
    ['no bars', { ...TIME, barCount: 0 }, 50],
    ['NaN x', TIME, NaN],
    ['∞ x', TIME, Infinity],
    ['zero spacing', { ...TIME, barSpacing: 0 }, 50],
  ])('NB3: %s → -1', (_label, time, x) => {
    // Given / When / Then
    expect(nearestBarIndex(time, x)).toBe(-1);
  });
});

describe('computeCrosshair', () => {
  it('CH1: snaps x to the bar center and y to a pixel center', () => {
    // Given / When
    const { visible, out } = crosshair(3, 42.3);
    // Then
    expect(visible).toBe(true);
    expect(out.index).toBe(3);
    expect(out.x).toBe(35.25);
    expect(out.y).toBe(42.25);
    expect(out.price).toBeCloseTo(57.7, 9);
    expect(out.time).toBe(T0 + 3 * 60_000);
  });

  it.each([
    [-20, 0.25, 100],
    [0, 0.25, 100],
    [100, 99.75, 0],
    [250, 99.75, 0],
  ])('CH2: finger y %p → line y %p, price %p', (y, lineY, price) => {
    // Given / When
    const { out } = crosshair(3, y);
    // Then
    expect(out.y).toBe(lineY);
    expect(out.y).toBeLessThanOrEqual(100);
    expect(out.price).toBe(price);
  });

  it('CH3: hidden when the bar is scrolled off-screen', () => {
    // Given: scrolled 20 bars into the future → all bars left of 0
    const time = { ...TIME, rightOffset: 20 };
    // When / Then
    expect(crosshair(3, 50, 2, time).visible).toBe(false);
  });

  it.each<[string, number, number, PriceScaleSnapshot]>([
    ['index -1', -1, 50, PRICE],
    ['index = length', 10, 50, PRICE],
    ['index 1.5', 1.5, 50, PRICE],
    ['index NaN', NaN, 50, PRICE],
    ['y NaN', 3, NaN, PRICE],
    ['height 0', 3, 50, { ...PRICE, height: 0 }],
  ])('CH4: %s → hidden', (_label, index, y, price) => {
    // Given / When
    const { visible, out } = crosshair(index, y, 2, TIME, price);
    // Then
    expect(visible).toBe(false);
    expect(out.index).toBe(-1);
  });

  it.each([[NaN], [0]])('CH5: pixel ratio %p → 1', (pr) => {
    // Given / When / Then
    expect(crosshair(3, 42.3, pr).out.x).toBe(35.5);
  });
});
