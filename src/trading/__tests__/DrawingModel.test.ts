/**
 * Test perspective table — DrawingModel
 *
 * | Case | Input / Precondition                                     | Perspective         | Expected                                  |
 * |------|----------------------------------------------------------|---------------------|-------------------------------------------|
 * | DM1  | isDrawingType on every tool / 'circle' / 1 / null        | Equivalence/Invalid | true / false                              |
 * | DM2  | isLineStyle solid / dashed / dotted / 'bold' / undefined | Equivalence/Invalid | true / false                              |
 * | DM3  | sanitizeLineWidth 2 / 100 / 0 / −1 / NaN / ∞ / '2'       | Boundary / Invalid  | 2 / 16 cap / fallback                     |
 * | DM4  | isValidAnchor finite / NaN / ∞ / missing / null / string | Equivalence/Invalid | true / false                              |
 * | DM5  | resolveDrawingStyle partial / invalid fields / undefined | Equivalence/Invalid | merged, invalid fields ignored            |
 * | DM6  | normalizeAnchors exact count / too few / too many        | Boundary (±1)       | copies / null / null                      |
 * | DM7  | normalizeAnchors not an array / invalid anchor           | Invalid             | null                                      |
 * | DM8  | createDrawing valid (defaults, locked)                   | Equivalence         | stored drawing, copied anchors            |
 * | DM9  | createDrawing unknown type / bad anchors                 | Invalid             | null                                      |
 * | DM10 | patchDrawing anchors / style / locked / empty patch      | Equivalence         | patched copy; empty patch keeps values    |
 * | DM11 | patchDrawing invalid anchors                             | Invalid             | null                                      |
 * | DM12 | cloneDrawing                                             | Equivalence         | deep copy (no shared anchors / style)     |
 */
import { describe, expect, it } from '@jest/globals';
import {
  cloneDrawing,
  createDrawing,
  DEFAULT_DRAWING_STYLE,
  DRAWING_TYPES,
  isDrawingType,
  isLineStyle,
  isValidAnchor,
  MAX_LINE_WIDTH,
  normalizeAnchors,
  patchDrawing,
  resolveDrawingStyle,
  sanitizeLineWidth,
  type DrawingInput,
  type DrawingStyle,
} from '../DrawingModel';

const a = (time: number, price: number) => ({ time, price });

describe('type guards', () => {
  it('DM1: drawing types', () => {
    // Given / When / Then
    for (const type of DRAWING_TYPES) {
      expect(isDrawingType(type)).toBe(true);
    }
    for (const bad of ['circle', 1, null, undefined]) {
      expect(isDrawingType(bad)).toBe(false);
    }
  });

  it('DM2: line styles', () => {
    // Given / When / Then
    expect(['solid', 'dashed', 'dotted'].every(isLineStyle)).toBe(true);
    expect(isLineStyle('bold')).toBe(false);
    expect(isLineStyle(undefined)).toBe(false);
  });

  it.each([
    [2, 2],
    [100, MAX_LINE_WIDTH],
    [0, 1],
    [-1, 1],
    [NaN, 1],
    [Infinity, 1],
    ['2', 1],
  ])('DM3: line width %p → %p', (value, expected) => {
    // Given / When / Then
    expect(sanitizeLineWidth(value, 1)).toBe(expected);
  });

  it.each([
    [a(1, 2), true],
    [a(NaN, 2), false],
    [a(1, Infinity), false],
    [{ time: 1 }, false],
    [null, false],
    ['x', false],
  ])('DM4: anchor %p → %p', (value, expected) => {
    // Given / When / Then
    expect(isValidAnchor(value)).toBe(expected);
  });
});

describe('resolveDrawingStyle', () => {
  it('DM5: merges valid fields and ignores invalid ones', () => {
    // Given
    const base: DrawingStyle = {
      color: '#fff',
      lineWidth: 2,
      lineStyle: 'dotted',
    };
    // When
    const merged = resolveDrawingStyle({ color: '#f00', lineWidth: 3 }, base);
    const invalid = resolveDrawingStyle(
      {
        color: 5 as unknown as string,
        lineWidth: -1,
        lineStyle: 'bold' as 'solid',
      },
      base
    );
    // Then
    expect(resolveDrawingStyle({ lineStyle: 'dashed' }, base).lineStyle).toBe(
      'dashed'
    );
    expect(merged).toEqual({
      color: '#f00',
      lineWidth: 3,
      lineStyle: 'dotted',
    });
    expect(invalid).toEqual(base);
    expect(resolveDrawingStyle(undefined)).toEqual(DEFAULT_DRAWING_STYLE);
    expect(
      resolveDrawingStyle(null as unknown as Partial<DrawingStyle>)
    ).toEqual(DEFAULT_DRAWING_STYLE);
  });
});

describe('normalizeAnchors', () => {
  it('DM6: requires the exact anchor count', () => {
    // Given / When / Then
    expect(normalizeAnchors('trendLine', [a(1, 1), a(2, 2)])).toEqual([
      a(1, 1),
      a(2, 2),
    ]);
    expect(normalizeAnchors('trendLine', [a(1, 1)])).toBeNull();
    expect(normalizeAnchors('horizontalLine', [a(1, 1), a(2, 2)])).toBeNull();
    expect(normalizeAnchors('horizontalRay', [])).toBeNull();
  });

  it.each([[null], ['x'], [[a(1, 1), a(NaN, 2)]]])(
    'DM7: invalid anchors %p → null',
    (anchors) => {
      // Given / When / Then
      expect(normalizeAnchors('rectangle', anchors)).toBeNull();
    }
  );
});

describe('createDrawing / patchDrawing / cloneDrawing', () => {
  const input: DrawingInput = {
    type: 'fibRetracement',
    anchors: [a(1, 10), a(2, 20)],
    locked: true,
  };

  it('DM8: builds a stored drawing with defaults', () => {
    // Given / When
    const d = createDrawing('d1', input);
    // Then
    expect(d).toEqual({
      id: 'd1',
      type: 'fibRetracement',
      anchors: [a(1, 10), a(2, 20)],
      style: { ...DEFAULT_DRAWING_STYLE },
      locked: true,
    });
    expect(d?.anchors[0]).not.toBe(input.anchors[0]);
  });

  it.each([
    [{ type: 'circle', anchors: [a(1, 1)] }],
    [{ type: 'trendLine', anchors: [a(1, 1)] }],
  ])('DM9: invalid input %p → null', (bad) => {
    // Given / When / Then
    expect(createDrawing('x', bad as DrawingInput)).toBeNull();
  });

  it('DM10: patches anchors, style and lock', () => {
    // Given
    const d = createDrawing('d1', input);
    if (d === null) throw new Error('fixture');
    // When
    const moved = patchDrawing(d, { anchors: [a(3, 30), a(4, 40)] });
    const styled = patchDrawing(d, { style: { color: '#0f0' }, locked: false });
    const same = patchDrawing(d, {});
    // Then
    expect(moved?.anchors).toEqual([a(3, 30), a(4, 40)]);
    expect(styled?.style.color).toBe('#0f0');
    expect(styled?.locked).toBe(false);
    expect(same).toEqual(d);
  });

  it('DM11: invalid patch anchors → null', () => {
    // Given
    const d = createDrawing('d1', input);
    if (d === null) throw new Error('fixture');
    // When / Then
    expect(patchDrawing(d, { anchors: [a(1, 1)] })).toBeNull();
  });

  it('DM12: clones deeply', () => {
    // Given
    const d = createDrawing('d1', input);
    if (d === null) throw new Error('fixture');
    // When
    const copy = cloneDrawing(d);
    // Then
    expect(copy).toEqual(d);
    expect(copy.anchors).not.toBe(d.anchors);
    expect(copy.style).not.toBe(d.style);
  });
});
