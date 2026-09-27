/**
 * Test perspective table — DrawingDrag
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                  |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------|
 * | DA1  | body drag by 1.6 bars / +0.26 price, tick 0.5          | Equivalence        | times +2 slots, prices snapped            |
 * | DA2  | body drag past the last bar                            | Boundary (future)  | extrapolated slot times                   |
 * | DA3  | anchor 1 drag to (index 3.4, price 101.13), tick 0.25  | Equivalence        | only anchor 1 moves, snapped              |
 * | DA4  | anchor 0 of a one-anchor drawing                       | Boundary (min)     | moves it                                  |
 * | DA5  | shorter `out` array reused / longer out is truncated   | Boundary           | out length = start length                 |
 * | DA6  | empty series                                           | Boundary (empty)   | false                                     |
 * | DA7  | a / b NaN or ∞                                         | Invalid            | false                                     |
 * | DA8  | anchor index out of range (2 on 2 anchors) / −5        | Invalid            | false                                     |
 * | DA9  | body drag with a NaN start anchor                      | Invalid            | false                                     |
 * | DA10 | anchor drag with invalid barMs past the data           | Boundary           | clamped to the last bar                   |
 * | DA11 | anchor drag with a huge price (1e308 + tick)           | Boundary (max)     | finite snapped result or false            |
 * | DL1  | dragLinePrice 100 + 0.3 @ tick 0.25 / no tick          | Equivalence        | 100.25 / 100.3                            |
 * | DL2  | dragLinePrice NaN delta / ∞ start                      | Invalid            | NaN                                       |
 */
import { describe, expect, it } from '@jest/globals';
import { dragAnchors, dragLinePrice } from '../DrawingDrag';
import { HIT_BODY } from '../HitTest';
import { columns, minuteBars, MIN, T0 } from './fixtures';

const five = minuteBars(5);
const start = [T0 + MIN, 100, T0 + 3 * MIN, 102];

describe('dragAnchors', () => {
  it('DA1: body drag shifts whole slots and snaps prices', () => {
    // Given: a two-anchor drawing on bars 1 and 3
    const out: number[] = [];
    // When: dragged by 1.6 bars and +0.26
    const ok = dragAnchors(five, MIN, start, HIT_BODY, 1.6, 0.26, 0.5, out);
    // Then: +2 slots, prices snapped to 0.5
    expect(ok).toBe(true);
    expect(out).toEqual([T0 + 3 * MIN, 100.5, T0 + 5 * MIN, 102.5]);
  });

  it('DA2: body drag into the future whitespace', () => {
    // Given
    const out: number[] = [];
    // When: 10 bars to the right
    dragAnchors(five, MIN, start, HIT_BODY, 10, 0, NaN, out);
    // Then: extrapolated slot times
    expect(out[0]).toBe(T0 + 11 * MIN);
    expect(out[2]).toBe(T0 + 13 * MIN);
  });

  it('DA3: an anchor drag moves only that anchor', () => {
    // Given
    const out: number[] = [];
    // When: anchor 1 goes to index 3.4, price 101.13
    const ok = dragAnchors(five, MIN, start, 1, 3.4, 101.13, 0.25, out);
    // Then
    expect(ok).toBe(true);
    expect(out).toEqual([T0 + MIN, 100, T0 + 3 * MIN, 101.25]);
  });

  it('DA4: the single anchor of a horizontal line', () => {
    // Given
    const out: number[] = [];
    // When
    dragAnchors(five, MIN, [T0, 50], 0, 2, 55, NaN, out);
    // Then
    expect(out).toEqual([T0 + 2 * MIN, 55]);
  });

  it('DA5: a longer reused out array is truncated', () => {
    // Given: a stale out of 6 entries
    const out = [1, 2, 3, 4, 5, 6];
    // When
    dragAnchors(five, MIN, start, HIT_BODY, 0, 0, NaN, out);
    // Then
    expect(out).toEqual(start);
  });

  it('DA6: empty data → false', () => {
    // Given / When / Then
    expect(dragAnchors(columns([]), MIN, start, HIT_BODY, 1, 1, NaN, [])).toBe(
      false
    );
  });

  it.each([
    [NaN, 0],
    [0, NaN],
    [Infinity, 0],
    [0, -Infinity],
  ])('DA7: a %p / b %p → false', (a, b) => {
    // Given / When / Then
    expect(dragAnchors(five, MIN, start, 0, a, b, NaN, [])).toBe(false);
  });

  it.each([[2], [-5]])('DA8: anchor index %p out of range → false', (part) => {
    // Given / When / Then
    expect(dragAnchors(five, MIN, start, part, 1, 1, NaN, [])).toBe(false);
  });

  it('DA9: a NaN start anchor fails a body drag', () => {
    // Given
    const bad = [NaN, 100, T0, 101];
    // When / Then
    expect(dragAnchors(five, MIN, bad, HIT_BODY, 1, 0, NaN, [])).toBe(false);
  });

  it('DA10: invalid barMs clamps a future anchor to the last bar', () => {
    // Given
    const out: number[] = [];
    // When
    dragAnchors(five, NaN, start, 0, 9, 100, NaN, out);
    // Then
    expect(out[0]).toBe(T0 + 4 * MIN);
  });

  it('DA11: an overflowing snapped price fails', () => {
    // Given: a price whose snap overflows
    const out: number[] = [];
    // When
    const ok = dragAnchors(five, MIN, start, 0, 1, 1.7e308, 1e-300, out);
    // Then
    expect(ok).toBe(false);
  });
});

describe('dragLinePrice', () => {
  it('DL1: snaps to the tick when given', () => {
    // Given / When / Then
    expect(dragLinePrice(100, 0.3, 0.25)).toBe(100.25);
    expect(dragLinePrice(100, 0.3, NaN)).toBeCloseTo(100.3);
  });

  it.each([
    [100, NaN],
    [Infinity, 1],
  ])('DL2: %p + %p → NaN', (s, d) => {
    // Given / When / Then
    expect(dragLinePrice(s, d, 0.25)).toBeNaN();
  });
});
