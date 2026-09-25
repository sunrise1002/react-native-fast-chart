/**
 * Test perspective table — PixelSnap + RenderModel rect lists
 *
 * | Case | Input / Precondition                         | Perspective        | Expected                              |
 * |------|----------------------------------------------|--------------------|---------------------------------------|
 * | P1   | pixelRatio 1 / 2.625                         | Equivalence        | returned unchanged                    |
 * | P2   | pixelRatio 0 / -1 / NaN / ∞                  | Boundary / invalid | 1                                     |
 * | P3   | snapToPixel(1.26, 2) / (1.24, 2)             | Equivalence        | 1.5 / 1                               |
 * | P4   | snapToPixel with invalid pr                  | Invalid            | integer rounding                      |
 * | P5   | lineWidthPx(1, 3) / (0.5, 1) / (0.4, 1)      | Equivalence / min  | 3 / 1 / 1 (min 1)                     |
 * | P6   | lineWidthPx(NaN / ∞ / -1, 2)                 | Invalid            | 1                                     |
 * | R1   | createRectList(4)                            | Equivalence        | 16 floats, count 0                    |
 * | R2   | createRectList(0 / -1 / NaN / ∞ / 2.5)       | Boundary / invalid | empty (0) / empty / … / ceil(2.5)=3   |
 * | R3   | pushRect into an empty list                  | Boundary           | grows to 16 floats                    |
 * | R4   | pushRect past capacity                       | Boundary (+1)      | doubles, keeps old data               |
 */
import { describe, expect, it } from '@jest/globals';
import { lineWidthPx, sanitizePixelRatio, snapToPixel } from '../PixelSnap';
import { createRectList, pushRect } from '../RenderModel';

describe('PixelSnap', () => {
  it.each([1, 2.625])('P1: keeps valid pixel ratio %p', (pr) => {
    // Given / When / Then
    expect(sanitizePixelRatio(pr)).toBe(pr);
  });

  it.each([0, -1, NaN, Infinity])('P2: pixel ratio %p → 1', (pr) => {
    // Given / When / Then
    expect(sanitizePixelRatio(pr)).toBe(1);
  });

  it('P3: snaps to the nearest device pixel', () => {
    // Given / When / Then
    expect(snapToPixel(1.26, 2)).toBe(1.5);
    expect(snapToPixel(1.24, 2)).toBe(1);
  });

  it('P4: rounds to whole dp when the ratio is invalid', () => {
    // Given / When / Then
    expect(snapToPixel(1.6, NaN)).toBe(2);
  });

  it.each([
    [1, 3, 3],
    [0.5, 1, 1],
    [0.4, 1, 1],
  ])('P5: lineWidthPx(%p, %p) = %p', (w, pr, px) => {
    // Given / When / Then
    expect(lineWidthPx(w, pr)).toBe(px);
  });

  it.each([NaN, Infinity, -1])('P6: lineWidthPx(%p) → 1', (w) => {
    // Given / When / Then
    expect(lineWidthPx(w, 2)).toBe(1);
  });
});

describe('RectList', () => {
  it('R1: preallocates 4 floats per rect', () => {
    // Given / When
    const list = createRectList(4);
    // Then
    expect(list.data).toHaveLength(16);
    expect(list.count).toBe(0);
  });

  it.each([
    [0, 0],
    [-1, 0],
    [NaN, 0],
    [Infinity, 0],
    [2.5, 12],
  ])('R2: capacity %p → %p floats', (capacity, floats) => {
    // Given / When / Then
    expect(createRectList(capacity).data).toHaveLength(floats);
  });

  it('R3: grows an empty list to 16 floats', () => {
    // Given
    const list = createRectList(0);
    // When
    pushRect(list, 1, 2, 3, 4);
    // Then
    expect(list.data).toHaveLength(16);
    expect(Array.from(list.data.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    expect(list.count).toBe(1);
  });

  it('R4: doubles when full and keeps existing rects', () => {
    // Given
    const list = createRectList(4);
    for (let i = 0; i < 4; i++) {
      pushRect(list, i, i, i, i);
    }
    // When
    pushRect(list, 9, 9, 9, 9);
    // Then
    expect(list.data).toHaveLength(32);
    expect(list.count).toBe(5);
    expect(list.data[12]).toBe(3);
    expect(list.data[16]).toBe(9);
  });
});
