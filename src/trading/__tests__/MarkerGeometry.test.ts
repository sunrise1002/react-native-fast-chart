/**
 * Test perspective table — MarkerGeometry
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                  |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | MC1  | position above / below                                | Equivalence        | beyond high / low by gap + half size      |
 * | MC2  | position price with arrowUp / arrowDown / circle      | Equivalence        | tip on the price / centered               |
 * | MC3  | size 0                                                | Boundary (0)       | gap-only offsets                          |
 * | MS1  | circle / square / diamond contours                    | Equivalence        | addCircle / 4-point closed contours       |
 * | MS2  | arrowUp tip at the top edge, arrowDown at the bottom  | Equivalence        | 7-point contour, tip on the box edge      |
 * | MS3  | size 0 / −1 / NaN                                     | Boundary / Invalid | false, nothing added                      |
 * | MS4  | cx / cy NaN or ∞                                      | Invalid            | false, nothing added                      |
 */
import { describe, expect, it } from '@jest/globals';
import {
  addMarkerShape,
  MARKER_GAP,
  markerCenterY,
  type MarkerPathSink,
} from '../MarkerGeometry';

function recorder() {
  const ops: string[] = [];
  const points: [number, number][] = [];
  const sink: MarkerPathSink = {
    moveTo: (x, y) => {
      ops.push('M');
      points.push([x, y]);
    },
    lineTo: (x, y) => {
      ops.push('L');
      points.push([x, y]);
    },
    close: () => ops.push('Z'),
    addCircle: (x, y, r) => {
      ops.push(`C${r}`);
      points.push([x, y]);
    },
  };
  return { ops, points, sink };
}

describe('markerCenterY', () => {
  it('MC1: above the high / below the low', () => {
    // Given: high at 50, low at 80, size 10
    // When / Then
    expect(markerCenterY('above', 'circle', 50, 80, 60, 10)).toBe(
      50 - MARKER_GAP - 5
    );
    expect(markerCenterY('below', 'circle', 50, 80, 60, 10)).toBe(
      80 + MARKER_GAP + 5
    );
  });

  it('MC2: at the price, arrows put the tip on it', () => {
    // Given / When / Then
    expect(markerCenterY('price', 'arrowUp', 0, 0, 60, 10)).toBe(65);
    expect(markerCenterY('price', 'arrowDown', 0, 0, 60, 10)).toBe(55);
    expect(markerCenterY('price', 'diamond', 0, 0, 60, 10)).toBe(60);
  });

  it('MC3: size 0 leaves only the gap', () => {
    // Given / When / Then
    expect(markerCenterY('above', 'square', 50, 80, 60, 0)).toBe(
      50 - MARKER_GAP
    );
  });
});

describe('addMarkerShape', () => {
  it('MS1: circle, square and diamond', () => {
    // Given
    const c = recorder();
    const s = recorder();
    const d = recorder();
    // When
    addMarkerShape(c.sink, 'circle', 10, 20, 8);
    addMarkerShape(s.sink, 'square', 10, 20, 8);
    addMarkerShape(d.sink, 'diamond', 10, 20, 8);
    // Then
    expect(c.ops).toEqual(['C4']);
    expect(s.ops).toEqual(['M', 'L', 'L', 'L', 'Z']);
    expect(s.points[0]).toEqual([6, 16]);
    expect(d.points[0]).toEqual([10, 16]);
  });

  it('MS2: arrows have their tip on the box edge', () => {
    // Given
    const up = recorder();
    const down = recorder();
    // When
    expect(addMarkerShape(up.sink, 'arrowUp', 0, 0, 10)).toBe(true);
    addMarkerShape(down.sink, 'arrowDown', 0, 0, 10);
    // Then
    expect(up.ops).toEqual(['M', 'L', 'L', 'L', 'L', 'L', 'L', 'Z']);
    expect(up.points[0]).toEqual([0, -5]);
    expect(down.points[0]).toEqual([0, 5]);
    expect(up.points[3]?.[1]).toBe(5);
  });

  it.each([[0], [-1], [NaN]])('MS3: size %p adds nothing', (size) => {
    // Given
    const r = recorder();
    // When / Then
    expect(addMarkerShape(r.sink, 'circle', 0, 0, size)).toBe(false);
    expect(r.ops).toEqual([]);
  });

  it.each([
    [NaN, 0],
    [0, Infinity],
    [-Infinity, 0],
  ])('MS4: center (%p, %p) adds nothing', (x, y) => {
    // Given
    const r = recorder();
    // When / Then
    expect(addMarkerShape(r.sink, 'square', x, y, 10)).toBe(false);
    expect(r.ops).toEqual([]);
  });
});
