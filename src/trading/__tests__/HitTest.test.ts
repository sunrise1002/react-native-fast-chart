/**
 * Test perspective table — HitTest
 *
 * | Case | Input / Precondition                                   | Perspective         | Expected                          |
 * |------|--------------------------------------------------------|---------------------|-----------------------------------|
 * | DS1  | point on / beside / beyond a segment end               | Equivalence         | 0 / perpendicular / end distance  |
 * | DS2  | zero-length segment                                    | Boundary (0 len)    | point distance                    |
 * | DS3  | NaN point / ∞ overflow                                 | Invalid             | NaN-safe → Infinity               |
 * | HD1  | trendLine near the line / at distance slop + 1         | Equivalence / ±1    | BODY / NONE                       |
 * | HD2  | anchors first when withAnchors / ignored otherwise     | Equivalence         | 0, 1 / BODY                       |
 * | HD3  | horizontalLine across the width / beyond the width     | Equivalence / Bound.| BODY / NONE                       |
 * | HD4  | horizontalRay right of the anchor / left of it         | Equivalence         | BODY / NONE                       |
 * | HD5  | rectangle / fib inside the box, reversed anchors       | Equivalence         | BODY                              |
 * | HD6  | rectangle outside                                      | Equivalence (miss)  | NONE                              |
 * | HD7  | NaN px / py, negative / NaN slop                       | Invalid             | NONE                              |
 * | HD8  | slop 0 exactly on the line                             | Boundary (0)        | BODY                              |
 * | LH1  | on the label box / on the axis badge / plot grab zone  | Equivalence         | true                              |
 * | LH2  | vertical miss (slop + 1)                               | Boundary ±1         | false                             |
 * | LH3  | left of the grab zone without a box                    | Equivalence (miss)  | false                             |
 * | LH4  | NaN line y (off-screen line)                           | Invalid             | false                             |
 * | LH5  | right of the axis                                      | Boundary            | false                             |
 */
import { describe, expect, it } from '@jest/globals';
import {
  distanceToSegment,
  HIT_BODY,
  HIT_NONE,
  hitTestDrawing,
  hitTestLineHandle,
} from '../HitTest';

describe('distanceToSegment', () => {
  it('DS1: on, beside and beyond the segment', () => {
    // Given: segment (0,0) → (10,0)
    // When / Then
    expect(distanceToSegment(5, 0, 0, 0, 10, 0)).toBe(0);
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(distanceToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
    expect(distanceToSegment(-3, 4, 0, 0, 10, 0)).toBe(5);
  });

  it('DS2: a zero-length segment is a point', () => {
    // Given / When / Then
    expect(distanceToSegment(3, 4, 0, 0, 0, 0)).toBe(5);
  });

  it('DS3: invalid input never returns NaN', () => {
    // Given / When / Then
    expect(distanceToSegment(NaN, 0, 0, 0, 1, 0)).toBe(Infinity);
    expect(distanceToSegment(1e200, 1e200, 0, 0, 0, 0)).toBe(Infinity);
  });
});

describe('hitTestDrawing', () => {
  const line = [0, 0, 100, 100];

  it('HD1: trend line body within the slop only', () => {
    // Given: slop 5
    // When / Then
    expect(hitTestDrawing('trendLine', line, 200, 50, 53, 5, false)).toBe(
      HIT_BODY
    );
    expect(hitTestDrawing('trendLine', line, 200, 50, 60, 5, false)).toBe(
      HIT_NONE
    );
  });

  it('HD2: anchors win when handles are shown', () => {
    // Given / When / Then
    expect(hitTestDrawing('trendLine', line, 200, 2, 1, 5, true)).toBe(0);
    expect(hitTestDrawing('rectangle', line, 200, 99, 98, 5, true)).toBe(1);
    expect(hitTestDrawing('trendLine', line, 200, 2, 1, 5, false)).toBe(
      HIT_BODY
    );
  });

  it('HD3: a horizontal line spans the plot width', () => {
    // Given: anchor at (50, 40), plot 200 wide
    const p = [50, 40];
    // When / Then
    expect(hitTestDrawing('horizontalLine', p, 200, 190, 42, 5, false)).toBe(
      HIT_BODY
    );
    expect(hitTestDrawing('horizontalLine', p, 200, 206, 40, 5, false)).toBe(
      HIT_NONE
    );
  });

  it('HD4: a horizontal ray starts at its anchor', () => {
    // Given
    const p = [50, 40];
    // When / Then
    expect(hitTestDrawing('horizontalRay', p, 200, 150, 40, 5, false)).toBe(
      HIT_BODY
    );
    expect(hitTestDrawing('horizontalRay', p, 200, 30, 40, 5, false)).toBe(
      HIT_NONE
    );
  });

  it('HD5: box tools hit anywhere inside, anchors in any order', () => {
    // Given: reversed anchors
    const box = [100, 100, 0, 0];
    // When / Then
    expect(hitTestDrawing('rectangle', box, 200, 50, 50, 0, false)).toBe(
      HIT_BODY
    );
    expect(hitTestDrawing('fibRetracement', box, 200, 10, 90, 0, false)).toBe(
      HIT_BODY
    );
  });

  it('HD6: outside a rectangle', () => {
    // Given / When / Then
    expect(hitTestDrawing('rectangle', line, 200, 120, 50, 5, false)).toBe(
      HIT_NONE
    );
  });

  it.each([
    [NaN, 10, 5],
    [10, NaN, 5],
    [10, 10, -1],
    [10, 10, NaN],
  ])('HD7: px %p py %p slop %p → NONE', (px, py, slop) => {
    // Given / When / Then
    expect(hitTestDrawing('trendLine', line, 200, px, py, slop, true)).toBe(
      HIT_NONE
    );
  });

  it('HD8: slop 0 exactly on the line', () => {
    // Given / When / Then
    expect(hitTestDrawing('trendLine', line, 200, 30, 30, 0, false)).toBe(
      HIT_BODY
    );
  });
});

describe('hitTestLineHandle', () => {
  // Line at y 50, label box [10, 60], plot 300, axis to 360, grab 48.
  const hit = (px: number, py: number, box = true, y = 50): boolean =>
    hitTestLineHandle(y, 10, box ? 60 : 10, 300, 360, 48, px, py, 8);

  it('LH1: label box, axis badge and the plot grab zone', () => {
    // Given / When / Then
    expect(hit(30, 55)).toBe(true);
    expect(hit(330, 50)).toBe(true);
    expect(hit(260, 45, false)).toBe(true);
  });

  it('LH2: a vertical miss by slop + 1', () => {
    // Given / When / Then
    expect(hit(30, 59)).toBe(false);
  });

  it('LH3: the middle of the plot without a box', () => {
    // Given / When / Then
    expect(hit(30, 50, false)).toBe(false);
  });

  it('LH4: an off-screen line (NaN y)', () => {
    // Given / When / Then
    expect(hit(330, 50, true, NaN)).toBe(false);
  });

  it('LH5: right of the axis', () => {
    // Given / When / Then
    expect(hit(361, 50)).toBe(false);
  });
});
