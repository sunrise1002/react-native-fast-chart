/**
 * Test perspective table — Volume / RSI / MACD / ATR / seeded average
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | S1   | seeded average: seeding, recursion, peek               | Normal               | SMA seed, then alpha recursion; peek pure    |
 * | S2   | seeded average: NaN / ±∞ input                         | Abnormal             | NaN, state unchanged                         |
 * | V1   | volumes 1..6, MA 3                                     | Golden (hand)        | copy + 2,3,4,5                               |
 * | V2   | MA 0 (off) / NaN volume                                | Boundary / Abnormal  | MA NaN everywhere / NaN value, MA gap        |
 * | V3   | label with / without MA                                | Equivalence          | `Vol 20` / `Vol`                             |
 * | R1   | closes 1,2,3,2,3, period 2                             | Golden (hand)        | NaN, NaN, 100, 50, 75                        |
 * | R2   | 2000 generated bars, periods 2 / 14 / 100              | Golden (reference)   | equals naive Wilder reference                |
 * | R3   | monotonic up / down / flat                             | Boundary             | 100 / 0 / 100 (no loss)                      |
 * | R4   | NaN / ∞ close mid-series                               | Abnormal             | NaN at bar; next change vs last finite value |
 * | R5   | period > length / empty / single bar                   | Boundary (0 / 1)     | NaN everywhere / length 0                    |
 * | R6   | guides: default / swapped / out-of-range config        | Boundary / Invalid   | [70,50,30] band; swapped sorted; clamped     |
 * | M1   | closes 1,2,4,8 fast 1 slow 2 signal 2                  | Golden (hand)        | macd, signal, histogram                      |
 * | M2   | 2000 generated bars, 12 / 26 / 9 and 3 / 5 / 2         | Golden (reference)   | equals reference                             |
 * | M3   | NaN close                                              | Abnormal             | NaN outputs at bar, recursion continues      |
 * | M4   | slow > length                                          | Boundary             | NaN everywhere                               |
 * | A1   | hand bars, period 2                                    | Golden (hand)        | NaN, 2, 2.5, 3.25                            |
 * | A2   | trueRange: first bar / gaps up / gaps down / NaN       | Boundary / Abnormal  | h−l / |h−pc| / |l−pc| / NaN                  |
 * | A3   | 2000 generated bars, periods 1 / 14 / 50               | Golden (reference)   | equals reference                             |
 * | A4   | NaN high mid-series                                    | Abnormal             | NaN at bar, prev close kept                  |
 * | C1   | config resolution of all four                          | Invalid input        | defaults / clamped                           |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import { atrModule, trueRange } from '../builtins/Atr';
import { macdModule } from '../builtins/Macd';
import { rsiModule, rsiFromAverages } from '../builtins/Rsi';
import {
  createSeededAverage,
  emaAlpha,
  rmaAlpha,
  stepSeededAverage,
} from '../builtins/SeededAverage';
import { volumeModule } from '../builtins/Volume';
import type { IndicatorModule } from '../IndicatorRegistry';
import {
  columnsOf,
  expectSeries,
  refAtr,
  refMacd,
  refRsi,
  refSma,
} from './indicatorTestUtils';

function calc(
  module: IndicatorModule,
  c: ReturnType<typeof columnsOf>,
  raw = {}
) {
  return module.indicator.calculate(c, module.resolveConfig(raw));
}
const col = (r: { outputs: Float64Array[] }, k = 0) =>
  r.outputs[k] as Float64Array;
const generated = () => {
  const store = new CandleStore();
  store.setData(generateCandles({ count: 2000, seed: 7 }));
  return store.columns;
};

describe('seeded average', () => {
  it('S1: seeds with the SMA, then recurses; peek leaves state', () => {
    // Given
    const s = createSeededAverage();
    // When
    const a = stepSeededAverage(s, 2, 2, 0.5, true);
    const b = stepSeededAverage(s, 4, 2, 0.5, true);
    const peek = stepSeededAverage(s, 10, 2, 0.5, false);
    const c = stepSeededAverage(s, 5, 2, 0.5, true);
    // Then
    expect([a, b, peek, c]).toEqual([NaN, 3, 6.5, 4]);
    expect(emaAlpha(9)).toBe(0.2);
    expect(rmaAlpha(4)).toBe(0.25);
  });

  it('S2: non-finite input yields NaN and keeps the state', () => {
    // Given
    const s = createSeededAverage();
    stepSeededAverage(s, 1, 1, 0.5, true);
    // When
    const values = [NaN, Infinity, -Infinity].map((x) =>
      stepSeededAverage(s, x, 1, 0.5, true)
    );
    // Then
    expect(values.every(Number.isNaN)).toBe(true);
    expect(s).toEqual({ value: 1, seedSum: 1, seedCount: 1 });
  });
});

describe('volume', () => {
  const withVolume = (volumes: number[]) => {
    const c = columnsOf(volumes.map(() => 10));
    volumes.forEach((v, i) => (c.volume[i] = v));
    return c;
  };

  it('V1: volume copy and MA 3', () => {
    // Given
    const c = withVolume([1, 2, 3, 4, 5, 6]);
    // When
    const r = calc(volumeModule as IndicatorModule, c, { maPeriod: 3 });
    // Then
    expectSeries(col(r, 0), [1, 2, 3, 4, 5, 6]);
    expectSeries(col(r, 1), [NaN, NaN, 2, 3, 4, 5]);
  });

  it('V2: MA off, NaN volume', () => {
    // Given
    const c = withVolume([1, NaN, 3, 4, 5]);
    // When
    const off = calc(volumeModule as IndicatorModule, c);
    const on = calc(volumeModule as IndicatorModule, c, { maPeriod: 2 });
    // Then
    expectSeries(col(off, 0), [1, NaN, 3, 4, 5]);
    expectSeries(col(off, 1), [NaN, NaN, NaN, NaN, NaN]);
    expectSeries(col(on, 1), [NaN, NaN, NaN, 3.5, 4.5]);
  });

  it('V3: labels and MA reference over generated data', () => {
    // Given
    const c = generated();
    // When
    const r = calc(volumeModule as IndicatorModule, c, { maPeriod: 20 });
    // Then
    expect(volumeModule.formatLabel({ maPeriod: 20 })).toBe('Vol 20');
    expect(volumeModule.formatLabel({ maPeriod: 0 })).toBe('Vol');
    expectSeries(col(r, 1), refSma(c, 20, 'volume'));
  });
});

describe('rsi', () => {
  it('R1: hand-computed Wilder RSI', () => {
    // Given
    const c = columnsOf([1, 2, 3, 2, 3]);
    // When
    const r = calc(rsiModule as IndicatorModule, c, { period: 2 });
    // Then
    expectSeries(col(r), [NaN, NaN, 100, 50, 75]);
  });

  it.each([2, 14, 100])('R2: matches the reference — period %i', (p) => {
    // Given
    const c = generated();
    // When
    const r = calc(rsiModule as IndicatorModule, c, { period: p });
    // Then
    expectSeries(col(r), refRsi(c, p), 1e-8);
  });

  it('R3: monotonic and flat series', () => {
    // Given / When
    const up = calc(rsiModule as IndicatorModule, columnsOf([1, 2, 3, 4]), {
      period: 2,
    });
    const down = calc(rsiModule as IndicatorModule, columnsOf([4, 3, 2, 1]), {
      period: 2,
    });
    const flat = calc(rsiModule as IndicatorModule, columnsOf([5, 5, 5, 5]), {
      period: 2,
    });
    // Then
    expectSeries(col(up), [NaN, NaN, 100, 100]);
    expectSeries(col(down), [NaN, NaN, 0, 0]);
    expectSeries(col(flat), [NaN, NaN, 100, 100]);
    expect(rsiFromAverages(1, 3)).toBe(25);
  });

  it('R4: non-finite close is skipped', () => {
    // Given
    const c = columnsOf([1, 2, NaN, 3, Infinity, 2]);
    // When
    const r = calc(rsiModule as IndicatorModule, c, { period: 2 });
    // Then: changes +1 (bar 1), +1 (bar 3 vs bar 1), −1 (bar 5 vs bar 3)
    expectSeries(col(r), [NaN, NaN, NaN, 100, NaN, 50]);
  });

  it('R5: period > length, empty, single bar', () => {
    // Given / When
    const long = calc(rsiModule as IndicatorModule, columnsOf([1, 2, 3]), {
      period: 3,
    });
    const empty = calc(rsiModule as IndicatorModule, columnsOf([]));
    const one = calc(rsiModule as IndicatorModule, columnsOf([1]), {
      period: 1,
    });
    // Then
    expectSeries(col(long), [NaN, NaN, NaN]);
    expect(empty.length).toBe(0);
    expectSeries(col(one), [NaN]);
  });

  it('R6: guides and label', () => {
    // Given
    const guides = rsiModule.guides as NonNullable<typeof rsiModule.guides>;
    // When
    const def = guides(rsiModule.resolveConfig({}));
    const swapped = guides(
      rsiModule.resolveConfig({ overbought: 20, oversold: 80 })
    );
    const clamped = rsiModule.resolveConfig({ overbought: 500, oversold: -3 });
    // Then
    expect(def).toEqual({
      levels: [70, 50, 30],
      band: { upper: 70, lower: 30 },
    });
    expect(swapped.band).toEqual({ upper: 80, lower: 20 });
    expect([clamped.overbought, clamped.oversold]).toEqual([100, 0]);
    expect(rsiModule.formatLabel(rsiModule.resolveConfig({}))).toBe('RSI 14');
  });
});

describe('macd', () => {
  it('M1: hand-computed MACD', () => {
    // Given
    const c = columnsOf([1, 2, 4, 8]);
    // When
    const r = calc(macdModule as IndicatorModule, c, {
      fastPeriod: 1,
      slowPeriod: 2,
      signalPeriod: 2,
    });
    // Then
    const slow2 = 4 * (2 / 3) + 1.5 / 3;
    const slow3 = 8 * (2 / 3) + slow2 / 3;
    const macd = [NaN, 0.5, 4 - slow2, 8 - slow3];
    const sig2 = (0.5 + (4 - slow2)) / 2;
    const sig3 = (8 - slow3) * (2 / 3) + sig2 / 3;
    expectSeries(col(r, 0), macd);
    expectSeries(col(r, 1), [NaN, NaN, sig2, sig3]);
    expectSeries(col(r, 2), [NaN, NaN, 4 - slow2 - sig2, 8 - slow3 - sig3]);
  });

  it.each([
    [12, 26, 9],
    [3, 5, 2],
  ])('M2: matches the reference — %i %i %i', (f, s, g) => {
    // Given
    const c = generated();
    // When
    const r = calc(macdModule as IndicatorModule, c, {
      fastPeriod: f,
      slowPeriod: s,
      signalPeriod: g,
    });
    // Then
    const ref = refMacd(c, f, s, g);
    expectSeries(col(r, 0), ref.macd);
    expectSeries(col(r, 1), ref.signal);
    expectSeries(col(r, 2), ref.histogram);
  });

  it('M3: NaN close yields NaN at that bar only', () => {
    // Given
    const c = columnsOf([1, 2, NaN, 4, 5]);
    // When
    const r = calc(macdModule as IndicatorModule, c, {
      fastPeriod: 1,
      slowPeriod: 1,
      signalPeriod: 1,
    });
    // Then
    expectSeries(col(r, 0), [0, 0, NaN, 0, 0]);
    expectSeries(col(r, 2), [0, 0, NaN, 0, 0]);
  });

  it('M4: slow period longer than the data, label', () => {
    // Given / When
    const r = calc(macdModule as IndicatorModule, columnsOf([1, 2, 3]));
    // Then
    expectSeries(col(r, 0), [NaN, NaN, NaN]);
    expect(macdModule.formatLabel(macdModule.resolveConfig({}))).toBe(
      'MACD 12 26 9'
    );
  });
});

describe('atr', () => {
  const bars = [
    { open: 9, high: 10, low: 8, close: 9 },
    { open: 10, high: 11, low: 9, close: 10 },
    { open: 11, high: 12, low: 9, close: 11 },
    { open: 14, high: 15, low: 13, close: 14 },
  ];

  it('A1: hand-computed Wilder ATR', () => {
    // Given
    const c = columnsOf(bars);
    // When
    const r = calc(atrModule as IndicatorModule, c, { period: 2 });
    // Then
    expectSeries(col(r), [NaN, 2, 2.5, 3.25]);
  });

  it('A2: true range cases', () => {
    // Given
    const c = columnsOf([
      { open: 5, high: 6, low: 4, close: 5 },
      { open: 5, high: NaN, low: 4, close: 5 },
    ]);
    // When / Then
    expect(trueRange(c, 0, NaN)).toBe(2);
    expect(trueRange(c, 0, 1)).toBe(5); // gap up: |6 − 1|
    expect(trueRange(c, 0, 10)).toBe(6); // gap down: |4 − 10|
    expect(trueRange(c, 0, 5)).toBe(2); // inside: h − l
    expect(trueRange(c, 1, 5)).toBeNaN();
  });

  it.each([1, 14, 50])('A3: matches the reference — period %i', (p) => {
    // Given
    const c = generated();
    // When
    const r = calc(atrModule as IndicatorModule, c, { period: p });
    // Then
    expectSeries(col(r), refAtr(c, p));
  });

  it('A4: NaN high is skipped, previous close kept', () => {
    // Given
    const c = columnsOf([
      bars[0] as (typeof bars)[number],
      { open: 1, high: NaN, low: 1, close: 1 },
      bars[1] as (typeof bars)[number],
    ]);
    // When
    const r = calc(atrModule as IndicatorModule, c, { period: 1 });
    // Then: bar 2 TR vs close 9 of bar 0 = max(2, 2, 0)
    expectSeries(col(r), [2, NaN, 2]);
  });
});

describe('config resolution', () => {
  it('C1: defaults and clamping', () => {
    // Given / When
    const v = volumeModule.resolveConfig({ maPeriod: -4 });
    const m = macdModule.resolveConfig({ fastPeriod: 'x', slowPeriod: 1e9 });
    const a = atrModule.resolveConfig(null);
    const r = rsiModule.resolveConfig({ period: 2.6, source: 'bogus' });
    // Then
    expect(v).toEqual({ maPeriod: 0 });
    expect(m).toEqual({
      fastPeriod: 12,
      slowPeriod: 5000,
      signalPeriod: 9,
      source: 'close',
    });
    expect(a).toEqual({ period: 14 });
    expect(r).toEqual({
      period: 3,
      source: 'close',
      overbought: 70,
      oversold: 30,
    });
  });
});
