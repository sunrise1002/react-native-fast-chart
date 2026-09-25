/**
 * Test perspective table — fixture generator & PRNG
 *
 * | Case | Input / Precondition                           | Perspective       | Expected                                  |
 * |------|------------------------------------------------|-------------------|-------------------------------------------|
 * | R1   | same seed twice                                | Equivalence       | identical sequences                       |
 * | R2   | different seeds                                | Equivalence       | different sequences                       |
 * | R3   | 10k draws                                      | Boundary (range)  | all in [0, 1), mean ≈ 0.5                 |
 * | R4   | seed 0 / negative / fractional                 | Boundary          | deterministic, values in range            |
 * | G1   | count 0                                        | Boundary (0)      | []                                        |
 * | G2   | count 1                                        | Boundary (1)      | one candle at startTime/startPrice        |
 * | G3   | same options twice                             | Determinism       | deep-equal output                         |
 * | G4   | different seed                                 | Equivalence       | different output                          |
 * | G5   | 100k candles                                   | Performance/valid | all valid, strictly ascending, < 1s       |
 * | G6   | volatility 0                                   | Boundary (min)    | flat prices                               |
 * | G7   | custom interval/start/precision 0              | Equivalence       | times and integer prices as configured    |
 * | G8   | high volatility, tiny price, precision 0..8    | Boundary          | prices stay ≥ 1/10^precision, valid       |
 * | G9   | invalid count (-1, 1.5, NaN, max+1)            | Abnormal          | RangeError with message                   |
 * | G10  | invalid interval / startTime / overflow        | Abnormal          | RangeError                                |
 * | G11  | invalid price / volatility / volume / precision| Abnormal          | RangeError                                |
 * | G12  | seed NaN / Infinity                            | Abnormal          | RangeError                                |
 */
import { describe, expect, it } from '@jest/globals';
import { validateCandles } from '../../data/CandleValidation';
import {
  generateCandles,
  MAX_GENERATED_CANDLES,
  type GenerateCandlesOptions,
} from '../fixtures/generateCandles';
import { createSeededRandom } from '../fixtures/random';

const draw = (seed: number, n: number) => {
  const random = createSeededRandom(seed);
  return Array.from({ length: n }, () => random());
};

describe('createSeededRandom', () => {
  it('R1: same seed yields identical sequence', () => {
    // Given / When / Then
    expect(draw(123, 50)).toEqual(draw(123, 50));
  });

  it('R2: different seeds yield different sequences', () => {
    // Given / When / Then
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it('R3: values are uniform-ish in [0, 1)', () => {
    // Given / When
    const values = draw(7, 10_000);
    // Then
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });

  it.each([0, -1, 1.7, 2 ** 40])('R4: seed %p is deterministic', (seed) => {
    // Given / When
    const values = draw(seed, 5);
    // Then
    expect(values).toEqual(draw(seed, 5));
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('generateCandles', () => {
  it('G1: count 0 returns an empty array', () => {
    // Given / When / Then
    expect(generateCandles({ count: 0 })).toEqual([]);
  });

  it('G2: count 1 starts at startTime and startPrice', () => {
    // Given / When
    const [first] = generateCandles({
      count: 1,
      startTime: 1000,
      startPrice: 50,
    });
    // Then
    expect(first?.time).toBe(1000);
    expect(first?.open).toBe(50);
  });

  it('G3: same options produce identical output', () => {
    // Given
    const options: GenerateCandlesOptions = { count: 500, seed: 99 };
    // When / Then
    expect(generateCandles(options)).toEqual(generateCandles(options));
  });

  it('G4: different seeds produce different output', () => {
    // Given / When / Then
    expect(generateCandles({ count: 10, seed: 1 })).not.toEqual(
      generateCandles({ count: 10, seed: 2 })
    );
  });

  it('G5: 100k candles are valid, ascending, and fast', () => {
    // Given / When
    const start = Date.now();
    const candles = generateCandles({ count: 100_000, seed: 42 });
    const elapsed = Date.now() - start;
    // Then
    expect(candles).toHaveLength(100_000);
    expect(validateCandles(candles)).toEqual({ valid: true, issues: [] });
    expect(candles.every((c) => c.low > 0)).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });

  it('G6: zero volatility gives flat prices', () => {
    // Given / When
    const candles = generateCandles({
      count: 20,
      volatility: 0,
      startPrice: 10,
    });
    // Then
    for (const c of candles) {
      expect([c.open, c.high, c.low, c.close]).toEqual([10, 10, 10, 10]);
    }
  });

  it('G7: honors interval, start time and integer precision', () => {
    // Given / When
    const candles = generateCandles({
      count: 3,
      startTime: 0,
      intervalMs: 5,
      precision: 0,
      startPrice: 1000,
    });
    // Then
    expect(candles.map((c) => c.time)).toEqual([0, 5, 10]);
    for (const c of candles) {
      expect(Number.isInteger(c.open) && Number.isInteger(c.close)).toBe(true);
    }
  });

  it.each([0, 2, 8])(
    'G8: extreme volatility with precision %p stays positive and valid',
    (precision) => {
      // Given / When
      const candles = generateCandles({
        count: 2_000,
        volatility: 0.9,
        startPrice: 0.01,
        precision,
        seed: 5,
      });
      // Then
      expect(validateCandles(candles).valid).toBe(true);
      expect(candles.every((c) => c.low >= 1 / 10 ** precision)).toBe(true);
    }
  );

  it.each([-1, 1.5, Number.NaN, MAX_GENERATED_CANDLES + 1])(
    'G9: rejects count %p',
    (count) => {
      // Given / When / Then
      expect(() => generateCandles({ count })).toThrow(RangeError);
      expect(() => generateCandles({ count })).toThrow(
        /generateCandles: count must be an integer/
      );
    }
  );

  it.each<[Partial<GenerateCandlesOptions>, RegExp]>([
    [{ intervalMs: 0 }, /intervalMs/],
    [{ intervalMs: 1.5 }, /intervalMs/],
    [{ startTime: -1 }, /startTime/],
    [{ startTime: Number.NaN }, /startTime/],
    [{ startTime: Number.MAX_SAFE_INTEGER }, /MAX_SAFE_INTEGER/],
  ])('G10: rejects time options %p', (options, message) => {
    // Given / When / Then
    expect(() => generateCandles({ count: 2, ...options })).toThrow(message);
  });

  it.each<[Partial<GenerateCandlesOptions>, RegExp]>([
    [{ startPrice: 0 }, /startPrice/],
    [{ startPrice: Infinity }, /startPrice/],
    [{ volatility: -0.1 }, /volatility/],
    [{ volatility: 1 }, /volatility/],
    [{ baseVolume: -1 }, /baseVolume/],
    [{ baseVolume: Number.NaN }, /baseVolume/],
    [{ precision: -1 }, /precision/],
    [{ precision: 9 }, /precision/],
    [{ precision: 1.5 }, /precision/],
  ])('G11: rejects numeric options %p', (options, message) => {
    // Given / When / Then
    expect(() => generateCandles({ count: 1, ...options })).toThrow(RangeError);
    expect(() => generateCandles({ count: 1, ...options })).toThrow(message);
  });

  it.each([Number.NaN, Infinity])('G12: rejects seed %p', (seed) => {
    // Given / When / Then
    expect(() => generateCandles({ count: 1, seed })).toThrow(/seed/);
  });
});
