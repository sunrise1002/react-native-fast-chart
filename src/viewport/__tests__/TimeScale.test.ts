/**
 * Test perspective table — TimeScale (x ↔ index, pan, zoom)
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                    |
 * |------|---------------------------------------------------|--------------------|---------------------------------------------|
 * | X1   | last bar with rightOffset 0 / 5                   | Equivalence        | center at width - (offset + .5) * spacing   |
 * | X2   | random fractional indices round trip              | Invariant          | xToIndex(indexToX(i)) = i (1e-9)            |
 * | X3   | spacing 0 / negative                              | Abnormal           | xToIndex NaN, visibleBarCount 0             |
 * | X4   | xToNearestIndex at slot edges                     | Boundary           | rounds to nearest bar                       |
 * | X5   | prepend k bars (barCount += k)                    | Invariant          | old bars keep their x (shifted index)       |
 * | W1   | body width ratio 0.8 / >1 / <0 / NaN / ∞ spacing  | Equiv. / Invalid   | 0.8s / s / 0 / 0 / 0                        |
 * | Z1   | clampBarSpacing below / above / NaN               | Boundary / invalid | min / max / min                             |
 * | B1   | bounds for a large dataset                        | Equivalence        | [V - margin - n, maxRightOffset]            |
 * | B2   | bounds for a dataset shorter than the viewport    | Boundary           | swapped, both alignments reachable          |
 * | B3   | zoomed in so V < minVisibleBars                   | Boundary           | no slack: margins 0                         |
 * | B4   | empty dataset                                     | Boundary (empty)   | finite bounds                               |
 * | P1   | pan dx > 0 / dx < 0                               | Equivalence        | rightOffset -/+ dx / spacing                |
 * | P2   | pan with NaN dx / zero spacing                    | Abnormal           | unchanged                                   |
 * | P3   | clampRightOffset past both bounds / NaN           | Boundary           | bound / min                                 |
 * | P4   | elasticRightOffset inside / overshoot / limit 0   | Equiv. / Boundary  | identity / < elastic limit / hard clamp     |
 * | Z2   | zoom in/out around random focal points            | Invariant          | focal index preserved within 1e-9           |
 * | Z3   | zoom focal at 0 and at width                      | Boundary           | preserved                                   |
 * | Z4   | zoom with spacing 0 / NaN focal                   | Abnormal           | rightOffset unchanged                       |
 * | R1   | fit logical range [from, to]                      | Equivalence        | edges at from - .5 / to + .5                |
 * | R2   | range with to < from / width 0                    | Abnormal           | NaN spacing                                 |
 * | L1   | isLastBarVisible default / scrolled back / empty  | Equiv. / Boundary  | true / false / false                        |
 */
import { describe, expect, it } from '@jest/globals';
import { createSeededRandom } from '../../testing/fixtures/random';
import {
  barSpacingForRange,
  candleBodyWidth,
  clampBarSpacing,
  clampRightOffset,
  elasticRightOffset,
  indexToX,
  isLastBarVisible,
  maxRightOffset,
  minRightOffset,
  panRightOffset,
  rightOffsetForRange,
  visibleBarCount,
  xToIndex,
  xToNearestIndex,
  zoomRightOffset,
  type TimeScaleOptions,
  type TimeScaleState,
} from '../TimeScale';

const OPTIONS: TimeScaleOptions = {
  minBarSpacing: 0.5,
  maxBarSpacing: 64,
  maxRightOffsetBars: 50,
  leftMarginBars: 10,
  minVisibleBars: 2,
};

const state = (patch: Partial<TimeScaleState> = {}): TimeScaleState => ({
  width: 800,
  barSpacing: 8,
  rightOffset: 0,
  barCount: 1000,
  ...patch,
});

describe('TimeScale: coordinates', () => {
  it.each([
    [0, 796],
    [5, 756],
  ])('X1: rightOffset %p puts the last bar at %p', (rightOffset, x) => {
    // Given
    const s = state({ rightOffset });
    // When / Then
    expect(indexToX(s, 999)).toBe(x);
    expect(xToIndex(s, x)).toBe(999);
  });

  it('X2: x ↔ index round trip for fractional indices', () => {
    // Given
    const random = createSeededRandom(7);
    for (let k = 0; k < 1000; k++) {
      const s = state({
        width: 100 + random() * 1000,
        barSpacing: 0.5 + random() * 60,
        rightOffset: (random() - 0.5) * 200,
        barCount: Math.floor(random() * 100_000),
      });
      const index = (random() - 0.5) * 200_000;
      // When
      const back = xToIndex(s, indexToX(s, index));
      // Then
      expect(Math.abs(back - index)).toBeLessThan(
        1e-9 * Math.max(1, Math.abs(index))
      );
    }
  });

  it.each([0, -3])('X3: degenerate spacing %p', (barSpacing) => {
    // Given
    const s = state({ barSpacing });
    // When / Then
    expect(xToIndex(s, 100)).toBeNaN();
    expect(visibleBarCount(s)).toBe(0);
  });

  it('X4: nearest bar under x', () => {
    // Given: bar 999 slot is [792, 800)
    const s = state();
    // When / Then
    expect(xToNearestIndex(s, 792.1)).toBe(999);
    expect(xToNearestIndex(s, 791.9)).toBe(998);
    expect(xToNearestIndex(s, 799.9)).toBe(999);
  });

  it('X5: prepending history does not move existing bars', () => {
    // Given
    const before = state({ rightOffset: -123.4 });
    const after = { ...before, barCount: before.barCount + 500 };
    // When / Then: bar i becomes bar i + 500 at the same x
    for (const i of [0, 10, 500, 999]) {
      expect(indexToX(after, i + 500)).toBeCloseTo(indexToX(before, i), 9);
    }
  });

  it.each([
    [10, 0.8, 8],
    [10, 1.5, 10],
    [10, -1, 0],
    [10, NaN, 0],
    [Infinity, 0.8, 0],
    [NaN, 0.8, 0],
  ])('W1: body width(%p, %p) = %p', (spacing, ratio, expected) => {
    // Given / When / Then
    expect(candleBodyWidth(spacing, ratio)).toBe(expected);
  });

  it.each([
    [0.1, 0.5],
    [100, 64],
    [NaN, 0.5],
    [12, 12],
  ])('Z1: clampBarSpacing(%p) = %p', (v, expected) => {
    // Given / When / Then
    expect(clampBarSpacing(v, OPTIONS)).toBe(expected);
  });
});

describe('TimeScale: pan bounds', () => {
  it('B1: large dataset', () => {
    // Given: 100 visible bars, 1000 stored
    const s = state();
    // When / Then
    expect(minRightOffset(s, OPTIONS)).toBe(100 - 10 - 1000);
    expect(maxRightOffset(s, OPTIONS)).toBe(50);
    // At the min bound the left edge shows 10 bars of whitespace
    const atMin = { ...s, rightOffset: minRightOffset(s, OPTIONS) };
    expect(xToIndex(atMin, 0)).toBeCloseTo(-10.5, 9);
  });

  it('B2: short dataset can slide between alignments', () => {
    // Given: 20 bars in a 100-bar viewport
    const s = state({ barCount: 20 });
    // When
    const lo = minRightOffset(s, OPTIONS);
    const hi = maxRightOffset(s, OPTIONS);
    // Then: lo = max padding (50), hi = left-aligned with 10 bars margin
    expect(lo).toBe(50);
    expect(hi).toBe(100 - 10 - 20);
  });

  it('B3: zoomed so far in that V < minVisibleBars', () => {
    // Given: 1.5 bars fit
    const s = state({ barSpacing: 64, width: 96 });
    // When / Then: no slack, the edge bars stay pinned
    expect(maxRightOffset(s, OPTIONS)).toBe(0);
    expect(minRightOffset(s, OPTIONS)).toBe(1.5 - 1000);
  });

  it('B4: empty dataset has finite bounds', () => {
    // Given
    const s = state({ barCount: 0 });
    // When / Then
    expect(Number.isFinite(minRightOffset(s, OPTIONS))).toBe(true);
    expect(Number.isFinite(maxRightOffset(s, OPTIONS))).toBe(true);
  });

  it.each([
    [80, -10],
    [-40, 5],
  ])('P1: pan by %p px', (dx, expected) => {
    // Given
    const s = state();
    // When / Then
    expect(panRightOffset(s, dx)).toBe(expected);
  });

  it('P2: invalid pan leaves the offset unchanged', () => {
    // Given / When / Then
    expect(panRightOffset(state({ rightOffset: 3 }), NaN)).toBe(3);
    expect(panRightOffset(state({ rightOffset: 3, barSpacing: 0 }), 10)).toBe(
      3
    );
  });

  it.each([
    [1e6, 50],
    [-1e6, -910],
    [NaN, -910],
    [7, 7],
  ])('P3: clampRightOffset(%p) = %p', (v, expected) => {
    // Given / When / Then
    expect(clampRightOffset(state(), v, OPTIONS)).toBe(expected);
  });

  it('P4: elastic overscroll', () => {
    // Given
    const s = state();
    // When / Then
    expect(elasticRightOffset(s, 10, OPTIONS, 5)).toBe(10);
    const over = elasticRightOffset(s, 80, OPTIONS, 5);
    expect(over).toBeGreaterThan(50);
    expect(over).toBeLessThan(55);
    expect(elasticRightOffset(s, 80, OPTIONS, 0)).toBe(50);
  });
});

describe('TimeScale: zoom', () => {
  it('Z2: focal index is preserved', () => {
    // Given
    const random = createSeededRandom(99);
    for (let k = 0; k < 1000; k++) {
      const s = state({
        width: 200 + random() * 1000,
        barSpacing: 0.5 + random() * 60,
        rightOffset: (random() - 0.5) * 500,
        barCount: Math.floor(random() * 100_000),
      });
      const focalX = random() * s.width;
      const next = clampBarSpacing(
        s.barSpacing * (0.2 + random() * 5),
        OPTIONS
      );
      const focalIndex = xToIndex(s, focalX);
      // When
      const rightOffset = zoomRightOffset(s, next, focalX);
      // Then
      const after = xToIndex({ ...s, barSpacing: next, rightOffset }, focalX);
      expect(Math.abs(after - focalIndex)).toBeLessThan(
        1e-9 * Math.max(1, Math.abs(focalIndex))
      );
    }
  });

  it.each([0, 800])('Z3: focal at x = %p', (focalX) => {
    // Given
    const s = state({ rightOffset: 3.3 });
    const focalIndex = xToIndex(s, focalX);
    // When
    const rightOffset = zoomRightOffset(s, 20, focalX);
    // Then
    expect(xToIndex({ ...s, barSpacing: 20, rightOffset }, focalX)).toBeCloseTo(
      focalIndex,
      9
    );
  });

  it('Z4: invalid zoom leaves the offset unchanged', () => {
    // Given
    const s = state({ rightOffset: 2 });
    // When / Then
    expect(zoomRightOffset(s, 0, 100)).toBe(2);
    expect(zoomRightOffset(s, 10, NaN)).toBe(2);
    expect(
      zoomRightOffset(state({ rightOffset: 2, barSpacing: 0 }), 10, 1)
    ).toBe(2);
  });
});

describe('TimeScale: range fitting & realtime', () => {
  it('R1: fits a logical range', () => {
    // Given: show bars 100..199
    const barSpacing = barSpacingForRange(800, 100, 199);
    const rightOffset = rightOffsetForRange(1000, 199);
    const s = state({ barSpacing, rightOffset });
    // When / Then
    expect(barSpacing).toBe(8);
    expect(xToIndex(s, 0)).toBeCloseTo(99.5, 9);
    expect(xToIndex(s, 800)).toBeCloseTo(199.5, 9);
  });

  it.each([
    [800, 10, 5],
    [0, 0, 10],
    [-5, 0, 10],
  ])('R2: invalid range (%p, %p, %p) → NaN', (w, from, to) => {
    // Given / When / Then
    expect(barSpacingForRange(w, from, to)).toBeNaN();
  });

  it('L1: last bar visibility', () => {
    // Given / When / Then
    expect(isLastBarVisible(state())).toBe(true);
    expect(isLastBarVisible(state({ rightOffset: -5 }))).toBe(false);
    expect(isLastBarVisible(state({ rightOffset: 200 }))).toBe(false);
    expect(isLastBarVisible(state({ barCount: 0 }))).toBe(false);
  });
});
