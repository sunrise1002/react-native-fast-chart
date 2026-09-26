/**
 * Test perspective table — ViewportShift (follow mode, prepend math, left edge)
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                        |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------------|
 * | F1   | follow on, last bar visible, 1 appended               | Equivalence        | 0 (follow)                                      |
 * | F2   | follow on, scrolled back                              | Equivalence        | -appended (hold)                                |
 * | F3   | follow off, at right edge                             | Equivalence        | -appended (hold)                                |
 * | F4   | appended 0 / -1 / NaN / Infinity                      | Boundary / Invalid | 0                                               |
 * | F5   | previousLength 0 / NaN (first data)                   | Boundary           | 0                                               |
 * | F6   | hold keeps every existing bar's pixel                 | Equivalence        | indexToX unchanged for all old bars             |
 * | F7   | follow scrolls exactly `appended` bars left           | Equivalence        | x shifts by -k * spacing                        |
 * | P1   | index 5 + 10 prepended                                | Equivalence        | 15                                              |
 * | P2   | index -1 (none) / NaN                                 | Invalid            | unchanged                                       |
 * | P3   | count 0 / negative / NaN / Infinity                   | Boundary / Invalid | unchanged                                       |
 * | P4   | index 0 + count 1                                     | Boundary (min)     | 1                                               |
 * | P5   | prepend keeps pixels (index shift math), huge counts  | Equivalence / huge | x(i + k) after === x(i) before                  |
 * | B1   | view starts exactly at bar 0 left edge                | Boundary           | 0                                               |
 * | B2   | scrolled 100 bars into history                        | Equivalence        | barCount - visible - 100 + ...                  |
 * | B3   | whitespace left of bar 0                              | Boundary           | negative                                        |
 * | B4   | barCount 0 / spacing 0 / width 0 / NaN fields         | Invalid            | NaN                                             |
 * | N1   | before ≤ threshold / == threshold / > threshold       | Boundary (±1)      | true / true / false                             |
 * | N2   | threshold 0 / negative / NaN                          | Boundary / Invalid | treated as 0                                    |
 * | N3   | empty / degenerate scale                              | Invalid            | false                                           |
 */
import { describe, expect, it } from '@jest/globals';
import { indexToX, isLastBarVisible, type TimeScaleState } from '../TimeScale';
import {
  appendOffsetShift,
  barsBeforeView,
  isNearHistoryStart,
  shiftIndexForPrepend,
} from '../ViewportShift';

const scale = (patch: Partial<TimeScaleState> = {}): TimeScaleState => ({
  width: 400,
  barSpacing: 8,
  rightOffset: 0,
  barCount: 1000,
  ...patch,
});

describe('appendOffsetShift (follow mode)', () => {
  it('F1: follows when enabled and at the right edge', () => {
    // Given / When / Then
    expect(appendOffsetShift(1, 100, true, true)).toBe(0);
  });

  it('F2: holds when scrolled back', () => {
    // Given / When / Then
    expect(appendOffsetShift(1, 100, false, true)).toBe(-1);
    expect(appendOffsetShift(3, 100, false, true)).toBe(-3);
  });

  it('F3: holds when follow is disabled', () => {
    // Given / When / Then
    expect(appendOffsetShift(2, 100, true, false)).toBe(-2);
  });

  it.each([0, -1, NaN, Infinity])('F4: appended %p → 0', (appended) => {
    // Given / When / Then
    expect(appendOffsetShift(appended, 100, false, false)).toBe(0);
  });

  it.each([0, -5, NaN])('F5: previousLength %p → 0', (previous) => {
    // Given / When / Then
    expect(appendOffsetShift(5, previous, false, false)).toBe(0);
  });

  it('F6: holding keeps every existing bar on the same pixel', () => {
    // Given: scrolled 200 bars back
    const before = scale({ rightOffset: -200 });
    expect(isLastBarVisible(before)).toBe(false);
    const k = 3;
    // When
    const shift = appendOffsetShift(k, before.barCount, false, true);
    const after = scale({
      barCount: before.barCount + k,
      rightOffset: before.rightOffset + shift,
    });
    // Then
    for (const i of [0, 500, 780, 999]) {
      expect(indexToX(after, i)).toBeCloseTo(indexToX(before, i), 9);
    }
  });

  it('F7: following scrolls by exactly the appended bars', () => {
    // Given: at the right edge
    const before = scale({ rightOffset: 2 });
    expect(isLastBarVisible(before)).toBe(true);
    // When
    const shift = appendOffsetShift(1, before.barCount, true, true);
    const after = scale({ barCount: 1001, rightOffset: 2 + shift });
    // Then: the new last bar lands where the old last bar was
    expect(indexToX(after, 1000)).toBeCloseTo(indexToX(before, 999), 9);
    expect(indexToX(after, 999)).toBeCloseTo(indexToX(before, 999) - 8, 9);
  });
});

describe('shiftIndexForPrepend', () => {
  it('P1: shifts by the prepended count', () => {
    // Given / When / Then
    expect(shiftIndexForPrepend(5, 10)).toBe(15);
  });

  it.each([-1, NaN])('P2: index %p is returned unchanged', (index) => {
    // Given / When / Then
    expect(shiftIndexForPrepend(index, 10)).toBe(index);
  });

  it.each([0, -3, NaN, Infinity])('P3: count %p leaves the index', (count) => {
    // Given / When / Then
    expect(shiftIndexForPrepend(7, count)).toBe(7);
  });

  it('P4: minimal shift', () => {
    // Given / When / Then
    expect(shiftIndexForPrepend(0, 1)).toBe(1);
  });

  it.each([
    [1, 1],
    [500, 7.25],
    [1_000_000, 0.5],
  ])('P5: prepending %p bars keeps every pixel (spacing %p)', (k, spacing) => {
    // Given: any viewport, rightOffset untouched by a prepend
    const before = scale({ barSpacing: spacing, rightOffset: -37.4 });
    const after = { ...before, barCount: before.barCount + k };
    // When / Then
    for (const i of [0, 1, 250, 999]) {
      const moved = shiftIndexForPrepend(i, k);
      expect(indexToX(after, moved)).toBeCloseTo(indexToX(before, i), 6);
    }
    expect(barsBeforeView(after)).toBeCloseTo(barsBeforeView(before) + k, 6);
  });
});

describe('barsBeforeView', () => {
  it('B1: 0 when bar 0 left edge is at x = 0', () => {
    // Given: 50 slots visible, 50 bars
    const s = scale({ barCount: 50 });
    // When / Then
    expect(barsBeforeView(s)).toBeCloseTo(0, 9);
  });

  it('B2: counts bars hidden to the left', () => {
    // Given: 1000 bars, 50 visible, scrolled 100 back
    const s = scale({ rightOffset: -100 });
    // When / Then
    expect(barsBeforeView(s)).toBeCloseTo(1000 - 50 - 100, 9);
  });

  it('B3: negative with whitespace left of bar 0', () => {
    // Given
    const s = scale({ barCount: 40 });
    // When / Then
    expect(barsBeforeView(s)).toBeCloseTo(-10, 9);
  });

  it.each([
    { barCount: 0 },
    { barSpacing: 0 },
    { width: 0 },
    { width: NaN },
    { barSpacing: NaN },
    { rightOffset: NaN },
    { rightOffset: Infinity },
  ])('B4: invalid %p → NaN', (patch) => {
    // Given / When / Then
    expect(barsBeforeView(scale(patch))).toBeNaN();
  });
});

describe('isNearHistoryStart', () => {
  it('N1: threshold boundary ±1', () => {
    // Given: 100 bars before the view
    const s = scale({ barCount: 150 });
    expect(barsBeforeView(s)).toBeCloseTo(100, 9);
    // When / Then
    expect(isNearHistoryStart(s, 101)).toBe(true);
    expect(isNearHistoryStart(s, 100)).toBe(true);
    expect(isNearHistoryStart(s, 99)).toBe(false);
  });

  it.each([0, -10, NaN])('N2: threshold %p behaves like 0', (t) => {
    // Given
    const atStart = scale({ barCount: 50 });
    const later = scale({ barCount: 51 });
    // When / Then
    expect(isNearHistoryStart(atStart, t)).toBe(true);
    expect(isNearHistoryStart(later, t)).toBe(false);
  });

  it.each([{ barCount: 0 }, { barSpacing: 0 }, { width: NaN }])(
    'N3: invalid %p is never near',
    (patch) => {
      // Given / When / Then
      expect(isNearHistoryStart(scale(patch), 50)).toBe(false);
    }
  );
});
