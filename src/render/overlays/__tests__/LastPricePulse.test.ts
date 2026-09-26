/**
 * Test perspective table — LastPricePulse
 *
 * | Case | Input / Precondition             | Perspective        | Expected                                 |
 * |------|----------------------------------|--------------------|------------------------------------------|
 * | L1   | progress 0                       | Boundary (min)     | min radius, max opacity                  |
 * | L2   | progress 1                       | Boundary (max)     | max radius, opacity 0                    |
 * | L3   | progress 0.5                     | Equivalence        | midway radius, ease-out opacity          |
 * | L4   | progress -1 / > 1 / Infinity     | Boundary (±1)      | clamped                                  |
 * | L5   | progress NaN                     | Invalid            | min radius, opacity 0                    |
 * | L6   | monotonic over [0, 1]            | Equivalence        | radius grows, opacity falls              |
 */
import { describe, expect, it } from '@jest/globals';
import {
  PULSE_MAX_OPACITY,
  PULSE_MAX_RADIUS,
  PULSE_MIN_RADIUS,
  pulseOpacity,
  pulseRadius,
} from '../LastPricePulse';

describe('LastPricePulse', () => {
  it('L1: starts small and opaque', () => {
    // Given / When / Then
    expect(pulseRadius(0)).toBe(PULSE_MIN_RADIUS);
    expect(pulseOpacity(0)).toBe(PULSE_MAX_OPACITY);
  });

  it('L2: ends large and invisible', () => {
    // Given / When / Then
    expect(pulseRadius(1)).toBe(PULSE_MAX_RADIUS);
    expect(pulseOpacity(1)).toBe(0);
  });

  it('L3: midway values', () => {
    // Given / When / Then
    expect(pulseRadius(0.5)).toBeCloseTo(
      (PULSE_MIN_RADIUS + PULSE_MAX_RADIUS) / 2,
      9
    );
    expect(pulseOpacity(0.5)).toBeCloseTo(PULSE_MAX_OPACITY * 0.25, 9);
  });

  it('L4: clamps out-of-range progress', () => {
    // Given / When / Then
    expect(pulseRadius(-1)).toBe(PULSE_MIN_RADIUS);
    expect(pulseOpacity(-1)).toBe(0);
    expect(pulseRadius(2)).toBe(PULSE_MAX_RADIUS);
    expect(pulseOpacity(2)).toBe(0);
    expect(pulseRadius(Infinity)).toBe(PULSE_MAX_RADIUS);
    expect(pulseOpacity(Infinity)).toBe(0);
  });

  it('L5: NaN is idle', () => {
    // Given / When / Then
    expect(pulseRadius(NaN)).toBe(PULSE_MIN_RADIUS);
    expect(pulseOpacity(NaN)).toBe(0);
  });

  it('L6: radius grows and opacity falls monotonically', () => {
    // Given
    let r = -Infinity;
    let o = Infinity;
    // When / Then
    for (let p = 0; p <= 1; p += 0.05) {
      expect(pulseRadius(p)).toBeGreaterThanOrEqual(r);
      expect(pulseOpacity(p)).toBeLessThanOrEqual(o);
      r = pulseRadius(p);
      o = pulseOpacity(p);
    }
  });
});
