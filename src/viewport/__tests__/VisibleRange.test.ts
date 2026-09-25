/**
 * Test perspective table — visible range & overscan
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                  |
 * |------|----------------------------------------------------|--------------------|-------------------------------------------|
 * | V1   | 100 slots, 1000 bars, rightOffset 0, overscan 0    | Equivalence        | 900..999                                  |
 * | V2   | default overscan                                   | Equivalence        | 880..999 (clamped at the end)             |
 * | V3   | fractional pan (-0.3 bars)                         | Boundary           | partially visible bars included           |
 * | V4   | rightOffset = whole viewport (only whitespace)     | Boundary           | only overscan bars / empty without it     |
 * | V5   | scrolled far before the first bar                  | Boundary           | empty {0, -1}                             |
 * | V6   | barCount 0 / 1                                     | Boundary (0/1)     | empty / 0..0                              |
 * | V7   | spacing 0 / NaN width / Infinity rightOffset       | Abnormal           | empty                                     |
 * | V8   | overscan NaN / negative / 2.7 / Infinity           | Invalid / Boundary | 0 / 0 / 2 / whole dataset                 |
 * | V9   | `out` object passed                                | Allocation         | same object returned and overwritten      |
 * | V10  | random states                                      | Invariant          | never more than ceil(V) + 1 + 2*overscan  |
 * | L1   | logical range                                      | Equivalence        | [R - V, R]                                |
 */
import { describe, expect, it } from '@jest/globals';
import { createSeededRandom } from '../../testing/fixtures/random';
import type { TimeScaleState } from '../TimeScale';
import {
  DEFAULT_OVERSCAN_BARS,
  getVisibleLogicalRange,
  getVisibleRange,
} from '../VisibleRange';

const state = (patch: Partial<TimeScaleState> = {}): TimeScaleState => ({
  width: 800,
  barSpacing: 8,
  rightOffset: 0,
  barCount: 1000,
  ...patch,
});

describe('getVisibleRange', () => {
  it('V1: exact visible bars', () => {
    // Given / When
    const range = getVisibleRange(state(), 0);
    // Then
    expect(range).toEqual({ startIndex: 900, endIndex: 999 });
  });

  it('V2: default overscan', () => {
    // Given / When
    const range = getVisibleRange(state({ rightOffset: -100 }));
    // Then
    expect(DEFAULT_OVERSCAN_BARS).toBe(20);
    expect(range).toEqual({ startIndex: 780, endIndex: 919 });
  });

  it('V3: sub-bar pan includes partial bars', () => {
    // Given: shifted 0.3 bars into history
    const range = getVisibleRange(state({ rightOffset: -0.3 }), 0);
    // Then: bar 899 peeks in on the left, bar 999 still partially visible
    expect(range).toEqual({ startIndex: 899, endIndex: 999 });
  });

  it('V4: only whitespace visible', () => {
    // Given: the last bar sits just left of the plot
    const s = state({ rightOffset: 100 });
    // When / Then
    expect(getVisibleRange(s, 0)).toEqual({ startIndex: 0, endIndex: -1 });
    expect(getVisibleRange(s, 3)).toEqual({ startIndex: 997, endIndex: 999 });
  });

  it('V5: scrolled before the first bar', () => {
    // Given / When / Then
    expect(getVisibleRange(state({ rightOffset: -2000 }), 5)).toEqual({
      startIndex: 0,
      endIndex: -1,
    });
  });

  it('V6: tiny datasets', () => {
    // Given / When / Then
    expect(getVisibleRange(state({ barCount: 0 }))).toEqual({
      startIndex: 0,
      endIndex: -1,
    });
    expect(getVisibleRange(state({ barCount: 1 }))).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it.each([
    [{ barSpacing: 0 }],
    [{ width: NaN }],
    [{ rightOffset: Infinity }],
    [{ barCount: NaN }],
  ])('V7: degenerate state %p is empty', (patch) => {
    // Given / When / Then
    expect(getVisibleRange(state(patch))).toEqual({
      startIndex: 0,
      endIndex: -1,
    });
  });

  it.each([
    [NaN, 900],
    [-5, 900],
    [2.7, 898],
    [Infinity, 0],
  ])('V8: overscan %p starts at %p', (overscan, start) => {
    // Given / When / Then
    expect(getVisibleRange(state(), overscan).startIndex).toBe(start);
  });

  it('V9: writes into the given object', () => {
    // Given
    const out = { startIndex: -7, endIndex: -7 };
    // When
    const result = getVisibleRange(state(), 0, out);
    // Then
    expect(result).toBe(out);
    expect(out.startIndex).toBe(900);
    getVisibleRange(state({ barCount: 0 }), 0, out);
    expect(out).toEqual({ startIndex: 0, endIndex: -1 });
  });

  it('V10: never renders more than the viewport + overscan', () => {
    // Given
    const random = createSeededRandom(3);
    const out = { startIndex: 0, endIndex: -1 };
    for (let k = 0; k < 2000; k++) {
      const s = state({
        width: 50 + random() * 1500,
        barSpacing: 0.5 + random() * 40,
        rightOffset: (random() - 0.5) * 1000,
        barCount: Math.floor(random() * 100_000),
      });
      const overscan = Math.floor(random() * 30);
      // When
      getVisibleRange(s, overscan, out);
      // Then
      const count = out.endIndex - out.startIndex + 1;
      expect(count).toBeLessThanOrEqual(
        Math.ceil(s.width / s.barSpacing) + 1 + 2 * overscan
      );
      expect(out.startIndex).toBeGreaterThanOrEqual(0);
      expect(out.endIndex).toBeLessThan(s.barCount);
    }
  });
});

describe('getVisibleLogicalRange', () => {
  it('L1: fractional edges', () => {
    // Given
    const out = { from: 0, to: 0 };
    // When
    const range = getVisibleLogicalRange(state({ rightOffset: 2 }), out);
    // Then
    expect(range).toBe(out);
    expect(range).toEqual({ from: 901.5, to: 1001.5 });
    expect(getVisibleLogicalRange(state())).toEqual({ from: 899.5, to: 999.5 });
  });
});
