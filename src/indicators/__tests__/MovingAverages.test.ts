/**
 * Test perspective table — SMA / EMA / WMA (golden + edge cases)
 *
 * | Case | Input / Precondition                              | Perspective          | Expected                                   |
 * |------|---------------------------------------------------|----------------------|--------------------------------------------|
 * | G1   | closes 1..10, period 3                            | Golden (hand)        | SMA 2..9, WMA x−2/3, EMA x−1               |
 * | G2   | closes 10,11,12,11,10, EMA 2                      | Golden (hand)        | 10.5, 11.5, 11.1667, 10.3889               |
 * | G3   | 2000 generated bars, periods 1/7/20/200           | Golden (reference)   | equals naive reference (1e-9)              |
 * | S1   | every price source                                | Equivalence          | reads open/high/low/close/hl2/hlc3/ohlc4   |
 * | B1   | period 1                                          | Boundary (min)       | value = source                             |
 * | B2   | period = length / length − 1 / period > length   | Boundary (±1)        | one value / NaN everywhere                 |
 * | B3   | empty input                                       | Boundary (empty)     | length 0                                   |
 * | B4   | single bar                                        | Boundary (1)         | period 1 → value, else NaN                 |
 * | B5   | physical offset > 0                               | Boundary             | reads [offset, offset+length)              |
 * | A1   | NaN inside SMA / WMA window                       | Abnormal             | NaN while in window, recovers after        |
 * | A2   | NaN / ±Infinity in EMA input                      | Abnormal             | NaN at bar, recursion skips it             |
 * | A3   | NaN during EMA seeding                            | Abnormal             | seed collects finite values only           |
 * | A4   | huge prices (1e12) with small moves               | Abnormal (precision) | matches reference (1e-9 rel.)              |
 * | A5   | NaN inside the window at the 256-bar resync       | Abnormal / Boundary  | NaN until it leaves the window             |
 * | C1   | config resolution: invalid / out-of-range values  | Invalid input        | defaults / clamped / rounded               |
 * | C2   | labels                                            | Equivalence          | `EMA 20`, `SMA 50 hl2`                      |
 */
import { describe, expect, it } from '@jest/globals';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { CandleStore } from '../../data/CandleStore';
import { emaModule, smaModule, wmaModule } from '../builtins/MovingAverages';
import { PRICE_SOURCES } from '../Indicator';
import {
  columnsOf,
  expectSeries,
  refEma,
  refSma,
  refWma,
} from './indicatorTestUtils';

const sma = (c = columnsOf([]), period = 3, source = 'close' as const) =>
  smaModule.indicator.calculate(c, { period, source });
const ema = (c = columnsOf([]), period = 3, source = 'close' as const) =>
  emaModule.indicator.calculate(c, { period, source });
const wma = (c = columnsOf([]), period = 3, source = 'close' as const) =>
  wmaModule.indicator.calculate(c, { period, source });

const ONE_TO_TEN = columnsOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const GENERATED = new CandleStore(generateCandles({ count: 2000, seed: 11 }))
  .columns;

describe('moving averages — golden values', () => {
  it('G1: hand-computed SMA / WMA / EMA over 1..10, period 3', () => {
    // Given
    const c = ONE_TO_TEN;
    // When
    const s = sma(c).outputs[0] as Float64Array;
    const w = wma(c).outputs[0] as Float64Array;
    const e = ema(c).outputs[0] as Float64Array;
    // Then
    expectSeries(s, [NaN, NaN, 2, 3, 4, 5, 6, 7, 8, 9]);
    expectSeries(
      w,
      [NaN, NaN, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x - 2 / 3)
    );
    expectSeries(e, [NaN, NaN, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('G2: hand-computed EMA 2 (alpha 2/3, SMA seed)', () => {
    // Given
    const c = columnsOf([10, 11, 12, 11, 10]);
    // When
    const e = ema(c, 2).outputs[0] as Float64Array;
    // Then
    expectSeries(e, [NaN, 10.5, 11.5, 67 / 6, 187 / 18]);
  });

  it.each([1, 7, 20, 200])('G3: period %i matches the reference', (p) => {
    // Given
    const c = GENERATED;
    // When / Then
    expectSeries(sma(c, p).outputs[0] as Float64Array, refSma(c, p));
    expectSeries(wma(c, p).outputs[0] as Float64Array, refWma(c, p));
    expectSeries(ema(c, p).outputs[0] as Float64Array, refEma(c, p));
  });

  it('S1: every price source', () => {
    // Given
    const c = columnsOf([
      { open: 1, high: 4, low: 0, close: 3 },
      { open: 3, high: 8, low: 2, close: 5 },
    ]);
    const expected: Record<string, number[]> = {
      open: [1, 3],
      high: [4, 8],
      low: [0, 2],
      close: [3, 5],
      hl2: [2, 5],
      hlc3: [7 / 3, 5],
      ohlc4: [2, 4.5],
    };
    for (const source of PRICE_SOURCES) {
      // When
      const r = smaModule.indicator.calculate(c, { period: 1, source });
      // Then
      expectSeries(r.outputs[0] as Float64Array, expected[source] as number[]);
    }
  });
});

describe('moving averages — boundaries', () => {
  it('B1: period 1 returns the source', () => {
    // Given / When / Then
    for (const f of [sma, ema, wma]) {
      expectSeries(
        f(ONE_TO_TEN, 1).outputs[0] as Float64Array,
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      );
    }
  });

  it('B2: period = length, length − 1 and > length', () => {
    // Given
    const c = columnsOf([1, 2, 3, 4]);
    // When / Then
    expectSeries(sma(c, 4).outputs[0] as Float64Array, [NaN, NaN, NaN, 2.5]);
    expectSeries(sma(c, 3).outputs[0] as Float64Array, [NaN, NaN, 2, 3]);
    for (const f of [sma, ema, wma]) {
      const r = f(c, 5);
      expect(r.length).toBe(4);
      expectSeries(r.outputs[0] as Float64Array, [NaN, NaN, NaN, NaN]);
    }
  });

  it('B3: empty input', () => {
    // Given / When
    const r = ema(columnsOf([]), 3);
    // Then
    expect(r.length).toBe(0);
    expect(r.committed).toBe(0);
    expect(r.outputs).toHaveLength(1);
  });

  it('B4: single bar', () => {
    // Given
    const c = columnsOf([42]);
    // When / Then
    expectSeries(sma(c, 1).outputs[0] as Float64Array, [42]);
    expectSeries(ema(c, 2).outputs[0] as Float64Array, [NaN]);
  });

  it('B5: honours the physical offset', () => {
    // Given
    const c = columnsOf([1, 2, 3, 4, 5], 7);
    // When / Then
    expectSeries(sma(c, 2).outputs[0] as Float64Array, [
      NaN,
      1.5,
      2.5,
      3.5,
      4.5,
    ]);
  });

  it('B5: slots beyond length are NaN', () => {
    // Given / When
    const r = sma(ONE_TO_TEN, 2);
    // Then
    const out = r.outputs[0] as Float64Array;
    expect(out.length).toBeGreaterThan(10);
    expect(Number.isNaN(out[10] as number)).toBe(true);
  });
});

describe('moving averages — abnormal input', () => {
  it('A1: NaN inside the SMA / WMA window', () => {
    // Given
    const c = columnsOf([1, 2, NaN, 4, 5, 6, 7]);
    // When
    const s = sma(c, 2).outputs[0] as Float64Array;
    const w = wma(c, 2).outputs[0] as Float64Array;
    // Then
    expectSeries(s, [NaN, 1.5, NaN, NaN, 4.5, 5.5, 6.5]);
    expectSeries(w, [NaN, 5 / 3, NaN, NaN, 14 / 3, 17 / 3, 20 / 3]);
  });

  it('A2: non-finite EMA input yields NaN and is skipped', () => {
    // Given
    const c = columnsOf([2, 4, NaN, Infinity, -Infinity, 6]);
    // When
    const e = ema(c, 1).outputs[0] as Float64Array;
    // Then
    expectSeries(e, [2, 4, NaN, NaN, NaN, 6]);
    const e3 = ema(columnsOf([1, 2, 3, NaN, 5]), 3).outputs[0] as Float64Array;
    expectSeries(e3, [NaN, NaN, 2, NaN, 3.5]);
  });

  it('A3: seeding collects finite values only', () => {
    // Given
    const c = columnsOf([1, NaN, 3, 5]);
    // When
    const e = ema(c, 2).outputs[0] as Float64Array;
    // Then
    expectSeries(e, [NaN, NaN, 2, 5 * (2 / 3) + 2 / 3]);
  });

  it('A4: huge prices keep precision', () => {
    // Given
    const values = Array.from({ length: 1500 }, (_, i) => 1e12 + Math.sin(i));
    const c = columnsOf(values);
    // When / Then
    expectSeries(sma(c, 50).outputs[0] as Float64Array, refSma(c, 50), 1e-12);
    expectSeries(wma(c, 50).outputs[0] as Float64Array, refWma(c, 50), 1e-12);
  });

  it('A5: NaN in the window at the resync boundary', () => {
    // Given: bar 255 is NaN, bar 256 recomputes the window
    const values = Array.from({ length: 260 }, (_, i) => (i === 255 ? NaN : i));
    const c = columnsOf(values);
    // When
    const s = sma(c, 3).outputs[0] as Float64Array;
    // Then
    expect(Number.isNaN(s[256] as number)).toBe(true);
    expect(Number.isNaN(s[257] as number)).toBe(true);
    expect(s[258]).toBe(257);
    expect(s[254]).toBe(253);
    // Given / When: the resync bar itself is NaN (shift falls back to 0)
    const atResync = columnsOf(
      Array.from({ length: 260 }, (_, i) => (i === 256 ? NaN : i))
    );
    const t = sma(atResync, 2).outputs[0] as Float64Array;
    // Then
    expect(Number.isNaN(t[257] as number)).toBe(true);
    expect(t[258]).toBe(257.5);
  });
});

describe('moving average modules', () => {
  it('C1: resolves invalid configs tolerantly', () => {
    // Given / When / Then
    expect(emaModule.resolveConfig(undefined)).toEqual({
      period: 9,
      source: 'close',
    });
    expect(smaModule.resolveConfig({ period: 20.6, source: 'hl2' })).toEqual({
      period: 21,
      source: 'hl2',
    });
    expect(wmaModule.resolveConfig({ period: 0, source: 'bogus' })).toEqual({
      period: 1,
      source: 'close',
    });
    expect(smaModule.resolveConfig({ period: 1e9 }).period).toBe(5000);
    expect(smaModule.resolveConfig({ period: NaN }).period).toBe(9);
    expect(smaModule.resolveConfig({ period: '20' }).period).toBe(9);
    expect(smaModule.resolveConfig(null).period).toBe(9);
  });

  it('C2: labels', () => {
    // Given / When / Then
    expect(emaModule.formatLabel({ period: 20, source: 'close' })).toBe(
      'EMA 20'
    );
    expect(smaModule.formatLabel({ period: 50, source: 'hl2' })).toBe(
      'SMA 50 hl2'
    );
    expect(wmaModule.meta.placement).toBe('overlay');
    expect(wmaModule.meta.defaultConfig).toEqual({
      period: 9,
      source: 'close',
    });
  });
});
