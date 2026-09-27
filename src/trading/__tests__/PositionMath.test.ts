/**
 * Test perspective table — PositionMath
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                              |
 * |------|--------------------------------------------------------|--------------------|---------------------------------------|
 * | PM1  | long 2 @100, price 110 / short 2 @100, price 110       | Equivalence        | +20 / −20                             |
 * | PM2  | multiplier 50 (futures)                                | Equivalence        | scaled PnL                            |
 * | PM3  | price == entry                                         | Boundary (0)       | 0                                     |
 * | PM4  | sign 0 / 2 / NaN                                       | Invalid            | NaN                                   |
 * | PM5  | size 0 / −1 / NaN / ∞                                  | Invalid / Boundary | NaN                                   |
 * | PM6  | multiplier 0 / −1 / ∞                                  | Invalid            | NaN                                   |
 * | PM7  | entry / price NaN or ∞                                 | Invalid            | NaN                                   |
 * | PM8  | huge values overflowing to ∞                           | Boundary (max)     | NaN                                   |
 * | PP1  | pnlPercent long +10 % / short +10 % / negative entry   | Equivalence        | 10 / −10 / relative to abs(entry)     |
 * | PP2  | pnlPercent entry 0 / invalid sign / NaN price          | Invalid / Boundary | NaN                                   |
 * | PP3  | pnlPercent overflow (1e308 / 1e-308)                   | Boundary (max)     | NaN                                   |
 * | IP1  | isProfit long above / short below / at entry           | Equivalence/Bound. | true / true / false                   |
 * | IP2  | isProfit NaN price                                     | Invalid            | false                                 |
 */
import { describe, expect, it } from '@jest/globals';
import { isProfit, pnlPercent, unrealizedPnl } from '../PositionMath';

describe('unrealizedPnl', () => {
  it('PM1: long and short positions', () => {
    // Given: 2 units at 100, last price 110
    // When / Then: a long earns, a short loses
    expect(unrealizedPnl(1, 2, 100, 110)).toBe(20);
    expect(unrealizedPnl(-1, 2, 100, 110)).toBe(-20);
  });

  it('PM2: the contract multiplier scales the PnL', () => {
    // Given / When / Then
    expect(unrealizedPnl(1, 1, 4000, 4001, 50)).toBe(50);
  });

  it('PM3: at the entry price the PnL is 0', () => {
    // Given / When / Then
    expect(unrealizedPnl(1, 3, 100, 100)).toBe(0);
  });

  it.each([[0], [2], [NaN]])('PM4: sign %p → NaN', (sign) => {
    // Given / When / Then
    expect(unrealizedPnl(sign, 1, 100, 110)).toBeNaN();
  });

  it.each([[0], [-1], [NaN], [Infinity]])('PM5: size %p → NaN', (size) => {
    // Given / When / Then
    expect(unrealizedPnl(1, size, 100, 110)).toBeNaN();
  });

  it.each([[0], [-1], [Infinity]])('PM6: multiplier %p → NaN', (m) => {
    // Given / When / Then
    expect(unrealizedPnl(1, 1, 100, 110, m)).toBeNaN();
  });

  it.each([
    [NaN, 110],
    [Infinity, 110],
    [100, NaN],
    [100, -Infinity],
  ])('PM7: entry %p / price %p → NaN', (entry, price) => {
    // Given / When / Then
    expect(unrealizedPnl(1, 1, entry, price)).toBeNaN();
  });

  it('PM8: an overflowing product → NaN', () => {
    // Given / When / Then
    expect(unrealizedPnl(1, 1e300, -1e300, 1e300)).toBeNaN();
  });
});

describe('pnlPercent', () => {
  it('PP1: relative move in the position direction', () => {
    // Given / When / Then
    expect(pnlPercent(1, 100, 110)).toBeCloseTo(10);
    expect(pnlPercent(-1, 100, 110)).toBeCloseTo(-10);
    expect(pnlPercent(1, -50, -40)).toBeCloseTo(20);
  });

  it.each([
    [1, 0, 1],
    [0, 100, 110],
    [1, 100, NaN],
    [1, NaN, 100],
  ])('PP2: sign %p entry %p price %p → NaN', (sign, entry, price) => {
    // Given / When / Then
    expect(pnlPercent(sign, entry, price)).toBeNaN();
  });

  it('PP3: an overflowing ratio → NaN', () => {
    // Given / When / Then
    expect(pnlPercent(1, 1e-308, 1e308)).toBeNaN();
  });
});

describe('isProfit', () => {
  it('IP1: direction-aware comparison', () => {
    // Given / When / Then
    expect(isProfit(1, 100, 101)).toBe(true);
    expect(isProfit(-1, 100, 99)).toBe(true);
    expect(isProfit(1, 100, 100)).toBe(false);
  });

  it('IP2: NaN is never a profit', () => {
    // Given / When / Then
    expect(isProfit(1, 100, NaN)).toBe(false);
  });
});
