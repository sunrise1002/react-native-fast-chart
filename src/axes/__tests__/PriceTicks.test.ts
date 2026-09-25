/**
 * Test perspective table — PriceTicks
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | PT1  | nice step for spans hitting 1 / 2 / 2.5 / 5 / 10       | Equivalence        | exact nice values incl. 2.5 (no round-up)  |
 * | PT2  | nice step with minStep above / below the raw step      | Equivalence        | floored / unchanged                        |
 * | PT3  | span 0 / NaN / negative; target 0; overflow; minStep ∞ | Invalid / max      | NaN … NaN / raw step                       |
 * | PT4  | tick spacing font 12 / 4 / NaN / ∞                     | Boundary           | 42 / 24 floor / 24 / 24                    |
 * | PT5  | target count 300 dp / 23 dp / 0 / NaN / ∞              | Boundary           | 7 / 0 / 0 / 0 / 0                           |
 * | PT6  | priceTickStep target < 1                               | Boundary           | NaN                                         |
 * | PT7  | priceTickStep precision 2 on a tiny span               | Equivalence        | floored at 0.01                             |
 * | PT8  | generate [0, 100] over 300 dp                          | Equivalence        | multiples of 20, decimals 0                 |
 * | PT9  | generate micro range [0.0000123, 0.0000125]            | Equivalence        | decimals from step (> 7), ascending         |
 * | PT10 | generate with precision 4 / -1                         | Equivalence        | decimals 4 / from step                      |
 * | PT11 | generate min == max / max < min / NaN / ∞ / height 0   | Invalid / boundary | 0 ticks, step NaN                           |
 * | PT12 | capacity 2 (more ticks available)                      | Boundary (max)     | capped at 2                                 |
 * | PT13 | createPriceTicks capacity 0 / -1 / NaN / 2.2 / default | Boundary           | 0 / 0 / 0 / 3 / 64                           |
 * | PT14 | negative range [-105, -95]                             | Equivalence        | values within range, exact multiples        |
 */
import { describe, expect, it } from '@jest/globals';
import {
  createPriceTicks,
  generatePriceTicks,
  MIN_PRICE_TICK_SPACING_DP,
  nicePriceTickStep,
  PRICE_TICK_CAPACITY,
  priceTickSpacing,
  priceTickStep,
  priceTickTargetCount,
} from '../PriceTicks';

describe('nicePriceTickStep', () => {
  it.each([
    [10, 10, 1],
    [15, 10, 2],
    [25, 10, 2.5],
    [30, 10, 5],
    [60, 10, 10],
    [0.0025, 1, 0.0025],
    [7e6, 1, 1e7],
  ])('PT1: span %p / %p ticks → %p', (span, target, expected) => {
    // Given / When
    const step = nicePriceTickStep(span, target);
    // Then
    expect(step).toBeCloseTo(expected, 12);
  });

  it('PT2: floors the step at minStep', () => {
    // Given / When / Then
    expect(nicePriceTickStep(0.001, 10, 0.01)).toBeCloseTo(0.01, 12);
    expect(nicePriceTickStep(100, 10, 0.01)).toBe(10);
  });

  it.each([
    [0, 10, 0],
    [NaN, 10, 0],
    [-10, 10, 0],
    [10, 0, 0],
    [Infinity, 10, 0],
  ])('PT3: span %p / %p ticks (min %p) → NaN', (span, target, min) => {
    // Given / When / Then
    expect(nicePriceTickStep(span, target, min)).toBeNaN();
  });

  it('PT3: NaN when the nice step overflows', () => {
    // Given / When / Then: 1.7e308 → 2e308 = ∞
    expect(nicePriceTickStep(1.7e308, 1)).toBeNaN();
  });

  it('PT3: ignores an infinite minStep', () => {
    // Given / When / Then
    expect(nicePriceTickStep(10, 10, Infinity)).toBe(1);
  });
});

describe('priceTickSpacing / priceTickTargetCount', () => {
  it.each([
    [12, 42],
    [4, MIN_PRICE_TICK_SPACING_DP],
    [NaN, MIN_PRICE_TICK_SPACING_DP],
    [Infinity, MIN_PRICE_TICK_SPACING_DP],
  ])('PT4: font %p → spacing %p', (font, expected) => {
    // Given / When / Then
    expect(priceTickSpacing(font)).toBe(expected);
  });

  it.each([
    [300, 7],
    [42, 1],
    [41, 0],
    [0, 0],
    [NaN, 0],
    [Infinity, 0],
  ])('PT5: height %p at font 12 → %p ticks', (height, expected) => {
    // Given / When / Then
    expect(priceTickTargetCount(height, 12)).toBe(expected);
  });
});

describe('priceTickStep', () => {
  it('PT6: NaN when the pane cannot fit a tick', () => {
    // Given / When / Then
    expect(priceTickStep(0, 100, 10, 12)).toBeNaN();
  });

  it('PT7: pricePrecision floors the step at one price unit', () => {
    // Given / When
    const auto = priceTickStep(100, 100.001, 300, 12);
    const precise = priceTickStep(100, 100.001, 300, 12, 2);
    // Then
    expect(auto).toBeLessThan(0.01);
    expect(precise).toBeCloseTo(0.01, 12);
  });
});

describe('generatePriceTicks', () => {
  it('PT8: emits multiples of a nice step', () => {
    // Given
    const out = createPriceTicks();
    // When: 300 dp at font 12 → 7 ticks → 100 / 7 → 20
    const count = generatePriceTicks(0, 100, 300, 12, out);
    // Then
    expect(count).toBe(6);
    expect(Array.from(out.values.subarray(0, count))).toEqual([
      0, 20, 40, 60, 80, 100,
    ]);
    expect(out.step).toBe(20);
    expect(out.decimals).toBe(0);
  });

  it('PT9: supports micro prices', () => {
    // Given
    const out = createPriceTicks();
    // When
    const count = generatePriceTicks(0.0000123, 0.0000125, 300, 12, out);
    // Then
    expect(count).toBeGreaterThan(1);
    expect(out.decimals).toBeGreaterThan(7);
    for (let i = 1; i < count; i++) {
      expect(out.values[i]).toBeGreaterThan(out.values[i - 1] as number);
    }
    expect(out.values[0]).toBeGreaterThanOrEqual(0.0000123 - 1e-15);
  });

  it.each([
    [4, 4],
    [-1, 0],
  ])('PT10: precision %p → decimals %p', (precision, decimals) => {
    // Given
    const out = createPriceTicks();
    // When
    generatePriceTicks(0, 100, 300, 12, out, precision);
    // Then
    expect(out.decimals).toBe(decimals);
  });

  it.each([
    [50, 50, 300],
    [100, 0, 300],
    [NaN, 100, 300],
    [0, Infinity, 300],
    [0, 100, 0],
  ])('PT11: [%p, %p] over %p dp → no ticks', (min, max, height) => {
    // Given
    const out = createPriceTicks();
    out.count = 5;
    // When
    const count = generatePriceTicks(min, max, height, 12, out);
    // Then
    expect(count).toBe(0);
    expect(out.count).toBe(0);
    expect(out.step).toBeNaN();
  });

  it('PT12: caps at the buffer capacity', () => {
    // Given
    const out = createPriceTicks(2);
    // When
    const count = generatePriceTicks(0, 100, 300, 12, out);
    // Then
    expect(count).toBe(2);
    expect(Array.from(out.values)).toEqual([0, 20]);
  });

  it('PT14: handles negative ranges', () => {
    // Given
    const out = createPriceTicks();
    // When
    const count = generatePriceTicks(-105, -95, 300, 12, out);
    // Then
    expect(count).toBeGreaterThan(1);
    for (let i = 0; i < count; i++) {
      const v = out.values[i] as number;
      expect(v).toBeGreaterThanOrEqual(-105);
      expect(v).toBeLessThanOrEqual(-95);
      expect(Math.abs(v / out.step - Math.round(v / out.step))).toBeLessThan(
        1e-9
      );
    }
  });
});

describe('createPriceTicks', () => {
  it.each([
    [0, 0],
    [-1, 0],
    [NaN, 0],
    [2.2, 3],
  ])('PT13: capacity %p → %p', (capacity, size) => {
    // Given / When / Then
    expect(createPriceTicks(capacity).values.length).toBe(size);
  });

  it('PT13: default capacity', () => {
    // Given / When
    const ticks = createPriceTicks();
    // Then
    expect(ticks.values.length).toBe(PRICE_TICK_CAPACITY);
    expect(ticks.count).toBe(0);
    expect(ticks.step).toBeNaN();
  });
});
