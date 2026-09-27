/**
 * Test perspective table — Stochastic / Stoch RSI / OBV / MFI / CCI / ADX
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | K1   | 4 hand bars, 2 / 1 / 2                                 | Golden (hand)        | %K 75, 20, 83.3; %D 47.5, 51.67              |
 * | K2   | 2000 generated bars, 14/1/3 and 5/3/3                  | Golden (reference)   | equals naive reference                       |
 * | K3   | flat window (HH = LL)                                  | Boundary (0 range)   | NaN (Pine division by zero)                  |
 * | K4   | NaN / ∞ high mid-series                                | Abnormal             | NaN for every window holding it              |
 * | K5   | period > length / empty / single bar                   | Boundary (0 / 1)     | NaN everywhere / length 0                    |
 * | K6   | config / label / guides / clamping                     | Invalid input        | defaults, clamped, 80/50/20 guides           |
 * | Q1   | generated bars, 3/3/14/14 and 1/1/2/3 hlc3             | Golden (reference)   | equals naive reference                       |
 * | Q2   | warm-up: first value index                             | Boundary             | first %K at rsi + stoch + k − 2              |
 * | O1   | hand closes / volumes                                  | Golden (hand)        | 0, 3, 3, 1, 7                                |
 * | O2   | generated bars                                         | Golden (reference)   | equals reference                             |
 * | O3   | NaN close / ∞ volume mid-series                        | Abnormal             | NaN at bar, total continues                  |
 * | O4   | empty / single bar / config                            | Boundary / Invalid   | length 0 / 0 / frozen `{}` config            |
 * | F1   | hand typical prices, period 2                          | Golden (hand)        | NaN, NaN, 66.67, 75                          |
 * | F2   | generated bars, 14 and 1                               | Golden (reference)   | equals reference                             |
 * | F3   | only rising / only falling                             | Boundary             | 100 / 0                                      |
 * | F4   | NaN volume mid-series                                  | Abnormal             | NaN while in the window, recovers            |
 * | C1   | closes 1,2,3,6, period 3                               | Golden (hand)        | NaN, NaN, 100, 100                           |
 * | C2   | generated bars, 20 hlc3 and 5 close                    | Golden (reference)   | equals reference                             |
 * | C3   | flat window                                            | Boundary (0 dev)     | NaN                                          |
 * | C4   | NaN mid-series / guides                                | Abnormal             | NaN while in the window; ±100 guides         |
 * | D1   | generated bars, 14/14 and 2/3                          | Golden (reference)   | +DI, −DI, ADX equal reference                |
 * | D2   | warm-up indices                                        | Boundary             | first DI at n, first ADX at n + m − 1        |
 * | D3   | flat bars (TR = 0)                                     | Boundary (0 TR)      | DI NaN (no previous), then kept (fixnan)     |
 * | D4   | NaN high mid-series                                    | Abnormal             | NaN at bar, previous bar kept                |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  ADX_LINE,
  ADX_MINUS_DI,
  ADX_PLUS_DI,
  adxModule,
} from '../builtins/Adx';
import { CCI_CONSTANT, cciModule } from '../builtins/Cci';
import { mfiModule } from '../builtins/Mfi';
import { obvModule } from '../builtins/Obv';
import { stochasticModule, stochValue } from '../builtins/Stochastic';
import { stochRsiModule } from '../builtins/StochRsi';
import type { PriceSource } from '../Indicator';
import type { IndicatorModule } from '../IndicatorRegistry';
import {
  refAdx,
  refCci,
  refMfi,
  refObv,
  refStochastic,
  refStochRsi,
} from './advancedRefs';
import { columnsOf, expectSeries, type Bar } from './indicatorTestUtils';

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
  store.setData(generateCandles({ count: 2000, seed: 11 }));
  return store.columns;
};
const bar = (high: number, low: number, close: number): Bar => ({
  open: close,
  high,
  low,
  close,
});
const firstFinite = (a: Float64Array) => a.findIndex(Number.isFinite);

describe('stochastic', () => {
  it('K1: hand-computed %K / %D', () => {
    // Given
    const c = columnsOf([
      bar(10, 8, 9),
      bar(12, 9, 11),
      bar(11, 7, 8),
      bar(13, 10, 12),
    ]);
    // When
    const r = calc(stochasticModule as IndicatorModule, c, {
      kPeriod: 2,
      kSmoothing: 1,
      dSmoothing: 2,
    });
    // Then
    expectSeries(col(r, 0), [NaN, 75, 20, 250 / 3]);
    expectSeries(col(r, 1), [NaN, NaN, 47.5, (20 + 250 / 3) / 2]);
  });

  it.each([
    [14, 1, 3],
    [5, 3, 3],
  ])('K2: generated bars equal the reference (%i/%i/%i)', (kp, ks, ds) => {
    // Given
    const c = generated();
    // When
    const r = calc(stochasticModule as IndicatorModule, c, {
      kPeriod: kp,
      kSmoothing: ks,
      dSmoothing: ds,
    });
    // Then
    const ref = refStochastic(c, kp, ks, ds);
    expectSeries(col(r, 0), ref.k);
    expectSeries(col(r, 1), ref.d);
  });

  it('K3: flat window has no value', () => {
    // Given
    const c = columnsOf([5, 5, 5, 6]);
    // When
    const r = calc(stochasticModule as IndicatorModule, c, {
      kPeriod: 2,
      kSmoothing: 1,
      dSmoothing: 1,
    });
    // Then
    expectSeries(col(r, 0), [NaN, NaN, NaN, 100]);
    expect(stochValue(1, 2, 2)).toBeNaN();
    expect(stochValue(1, 1, 2)).toBeNaN();
  });

  it.each([NaN, Infinity])(
    'K4: non-finite high (%p) poisons its windows',
    (v) => {
      // Given
      const bars = [1, 2, 3, 4, 5, 6].map((x) => bar(x + 1, x - 1, x));
      bars[2] = bar(v, 1, 3);
      const c = columnsOf(bars);
      // When
      const r = calc(stochasticModule as IndicatorModule, c, {
        kPeriod: 2,
        kSmoothing: 1,
        dSmoothing: 1,
      });
      // Then
      const k = Array.from(col(r, 0).subarray(0, 6));
      expect(k.map(Number.isNaN)).toEqual([
        true,
        false,
        true,
        true,
        false,
        false,
      ]);
    }
  );

  it('K5: period > length, empty, single bar', () => {
    // Given
    const m = stochasticModule as IndicatorModule;
    // When
    const long = calc(m, columnsOf([1, 2, 3]), { kPeriod: 10 });
    const empty = calc(m, columnsOf([]));
    const one = calc(m, columnsOf([bar(2, 1, 1.5)]), {
      kPeriod: 1,
      dSmoothing: 1,
    });
    // Then
    expect(Array.from(col(long).subarray(0, 3)).every(Number.isNaN)).toBe(true);
    expect(empty.length).toBe(0);
    expectSeries(col(one, 0), [50]);
    expectSeries(col(one, 1), [50]);
  });

  it('K6: config, label and guides', () => {
    // Given / When
    const def = stochasticModule.resolveConfig({});
    const bad = stochasticModule.resolveConfig({
      kPeriod: -1,
      dSmoothing: 'x',
    });
    const guides = stochasticModule.guides?.(def);
    // Then
    expect(def).toEqual({ kPeriod: 14, kSmoothing: 1, dSmoothing: 3 });
    expect(bad).toEqual({ kPeriod: 1, kSmoothing: 1, dSmoothing: 3 });
    expect(stochasticModule.formatLabel(def)).toBe('Stoch 14 1 3');
    expect(guides).toEqual({
      levels: [80, 50, 20],
      band: { upper: 80, lower: 20 },
    });
    expect(stochasticModule.meta.scale).toEqual({
      kind: 'fixed',
      min: 0,
      max: 100,
    });
  });
});

describe('stochastic RSI', () => {
  it.each([
    [3, 3, 14, 14, 'close'],
    [1, 1, 2, 3, 'hlc3'],
  ] as [number, number, number, number, PriceSource][])(
    'Q1: generated bars equal the reference (%i/%i/%i/%i %s)',
    (ks, ds, rp, sp, source) => {
      // Given
      const c = generated();
      // When
      const r = calc(stochRsiModule as IndicatorModule, c, {
        kSmoothing: ks,
        dSmoothing: ds,
        rsiPeriod: rp,
        stochPeriod: sp,
        source,
      });
      // Then
      const ref = refStochRsi(
        source === 'close' ? c : withCloseFromHlc3(c),
        ks,
        ds,
        rp,
        sp
      );
      expectSeries(col(r, 0), ref.k, 1e-7);
      expectSeries(col(r, 1), ref.d, 1e-7);
    }
  );

  it('Q2: first value after the combined warm-up', () => {
    // Given
    const c = generated();
    // When
    const r = calc(stochRsiModule as IndicatorModule, c);
    // Then
    expect(firstFinite(col(r, 0))).toBe(14 + 14 + 3 - 2);
    expect(firstFinite(col(r, 1))).toBe(14 + 14 + 3 + 3 - 3);
    expect(stochRsiModule.formatLabel(stochRsiModule.resolveConfig({}))).toBe(
      'Stoch RSI 3 3 14 14'
    );
    expect(
      stochRsiModule.guides?.(stochRsiModule.resolveConfig({}))?.levels
    ).toEqual([80, 50, 20]);
  });
});

/** Copy of `c` whose close is its hlc3 (the reference RSI reads close). */
function withCloseFromHlc3(c: ReturnType<typeof columnsOf>) {
  const close = Float64Array.from(c.close);
  for (let i = 0; i < c.length; i++) {
    const p = c.offset + i;
    close[p] =
      ((c.high[p] as number) + (c.low[p] as number) + (c.close[p] as number)) /
      3;
  }
  return { ...c, close };
}

describe('OBV', () => {
  it('O1: hand-computed cumulative volume', () => {
    // Given
    const c = columnsOf([10, 11, 11, 9, 12]);
    c.volume.set([5, 3, 4, 2, 6]);
    // When
    const r = calc(obvModule as IndicatorModule, c);
    // Then
    expectSeries(col(r), [0, 3, 3, 1, 7]);
  });

  it('O2: generated bars equal the reference', () => {
    // Given
    const c = generated();
    // When / Then
    expectSeries(col(calc(obvModule as IndicatorModule, c)), refObv(c));
  });

  it('O3: non-finite close / volume skip the bar', () => {
    // Given
    const c = columnsOf([10, NaN, 11, 12, 11]);
    c.volume.set([1, 2, 3, Infinity, 5]);
    // When
    const r = calc(obvModule as IndicatorModule, c);
    // Then: bar 2 compares with bar 0; bar 4 with bar 2 (bar 3 skipped)
    expectSeries(col(r), [0, NaN, 3, NaN, 3]);
  });

  it('O4: empty, single bar, config', () => {
    // Given / When
    const empty = calc(obvModule as IndicatorModule, columnsOf([]));
    const one = calc(obvModule as IndicatorModule, columnsOf([4]));
    const config = obvModule.resolveConfig({ period: 3 });
    // Then
    expect(empty.length).toBe(0);
    expectSeries(col(one), [0]);
    expect(config).toEqual({});
    expect(Object.isFrozen(config)).toBe(true);
    expect(obvModule.formatLabel(config)).toBe('OBV');
    expect(obvModule.meta.valueFormat).toEqual({ compact: true });
  });
});

describe('MFI', () => {
  it('F1: hand-computed money flow index', () => {
    // Given: h = l = c, volume 1 → flow = tp
    const c = columnsOf([1, 2, 1, 3]);
    // When
    const r = calc(mfiModule as IndicatorModule, c, { period: 2 });
    // Then
    expectSeries(col(r), [NaN, NaN, 100 - 100 / 3, 75]);
  });

  it.each([14, 1])('F2: generated bars equal the reference (%i)', (period) => {
    // Given
    const c = generated();
    // When / Then
    expectSeries(
      col(calc(mfiModule as IndicatorModule, c, { period })),
      refMfi(c, period)
    );
  });

  it('F3: only rising / only falling', () => {
    // Given
    const up = columnsOf([1, 2, 3, 4]);
    const down = columnsOf([4, 3, 2, 1]);
    // When
    const a = calc(mfiModule as IndicatorModule, up, { period: 2 });
    const b = calc(mfiModule as IndicatorModule, down, { period: 2 });
    // Then
    expectSeries(col(a), [NaN, NaN, 100, 100]);
    expectSeries(col(b), [NaN, NaN, 0, 0]);
  });

  it('F4: NaN volume poisons its window, then recovers', () => {
    // Given
    const c = columnsOf([1, 2, 1, 3, 4, 5]);
    c.volume[2] = NaN;
    // When
    const r = calc(mfiModule as IndicatorModule, c, { period: 2 });
    // Then
    expectSeries(col(r), [NaN, NaN, NaN, NaN, 100, 100]);
    expect(mfiModule.formatLabel(mfiModule.resolveConfig({}))).toBe('MFI 14');
    expect(mfiModule.guides?.(mfiModule.resolveConfig({}))).toEqual({
      levels: [80, 50, 20],
      band: { upper: 80, lower: 20 },
    });
  });
});

describe('CCI', () => {
  it('C1: hand-computed CCI', () => {
    // Given
    const c = columnsOf([1, 2, 3, 6]);
    // When
    const r = calc(cciModule as IndicatorModule, c, {
      period: 3,
      source: 'close',
    });
    // Then
    expectSeries(col(r), [NaN, NaN, 100, 100]);
    expect(CCI_CONSTANT).toBe(0.015);
  });

  it.each([
    [20, 'hlc3'],
    [5, 'close'],
  ] as [number, PriceSource][])(
    'C2: generated bars equal the reference (%i %s)',
    (period, source) => {
      // Given
      const c = generated();
      // When / Then
      expectSeries(
        col(calc(cciModule as IndicatorModule, c, { period, source })),
        refCci(c, period, source),
        1e-7
      );
    }
  );

  it('C3: flat window has no value', () => {
    // Given / When
    const r = calc(cciModule as IndicatorModule, columnsOf([2, 2, 2, 3]), {
      period: 3,
    });
    // Then
    expectSeries(col(r), [NaN, NaN, NaN, 100]);
  });

  it('C4: NaN poisons its windows; guides and label', () => {
    // Given
    const c = columnsOf([1, 2, NaN, 3, 6, 9]);
    // When
    const r = calc(cciModule as IndicatorModule, c, { period: 2 });
    // Then
    expect(Array.from(col(r).subarray(0, 6)).map(Number.isNaN)).toEqual([
      true,
      false,
      true,
      true,
      false,
      false,
    ]);
    expect(cciModule.guides?.(cciModule.resolveConfig({}))).toEqual({
      levels: [100, 0, -100],
      band: { upper: 100, lower: -100 },
    });
    expect(cciModule.formatLabel(cciModule.resolveConfig({}))).toBe('CCI 20');
  });
});

describe('ADX / DMI', () => {
  it.each([
    [14, 14],
    [2, 3],
  ])('D1: generated bars equal the reference (DI %i, ADX %i)', (di, adx) => {
    // Given
    const c = generated();
    // When
    const r = calc(adxModule as IndicatorModule, c, {
      diPeriod: di,
      adxPeriod: adx,
    });
    // Then
    const ref = refAdx(c, di, adx);
    expectSeries(col(r, ADX_PLUS_DI), ref.plus, 1e-7);
    expectSeries(col(r, ADX_MINUS_DI), ref.minus, 1e-7);
    expectSeries(col(r, ADX_LINE), ref.adx, 1e-7);
  });

  it('D2: warm-up indices and label', () => {
    // Given
    const c = generated();
    // When
    const r = calc(adxModule as IndicatorModule, c);
    // Then
    expect(firstFinite(col(r, ADX_PLUS_DI))).toBe(14);
    expect(firstFinite(col(r, ADX_LINE))).toBe(27);
    expect(adxModule.formatLabel(adxModule.resolveConfig({}))).toBe(
      'DMI 14 14'
    );
  });

  it('D3: zero true range keeps the previous DI (fixnan)', () => {
    // Given: flat bars, then movement, then flat again
    const bars = [5, 5, 5, 6, 7, 7, 7, 7].map((x) => bar(x, x, x));
    const c = columnsOf(bars);
    // When
    const r = calc(adxModule as IndicatorModule, c, {
      diPeriod: 2,
      adxPeriod: 1,
    });
    // Then: TR average 0 at bar 2 with no previous DI
    const plus = Array.from(col(r, ADX_PLUS_DI).subarray(0, 8));
    expect(plus.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(plus[3]).toBeCloseTo(100);
    expect(plus[7]).toBe(plus[6]);
    expect(Number.isFinite(plus[7])).toBe(true);
  });

  it('D4: NaN high is skipped, previous bar kept', () => {
    // Given
    const bars = [1, 2, 3, 4, 5, 6, 7].map((x) => bar(x + 1, x - 1, x));
    bars[3] = bar(NaN, 3, 4);
    const withGap = columnsOf(bars);
    const without = columnsOf(bars.filter((_, i) => i !== 3));
    // When
    const a = calc(adxModule as IndicatorModule, withGap, {
      diPeriod: 2,
      adxPeriod: 2,
    });
    const b = calc(adxModule as IndicatorModule, without, {
      diPeriod: 2,
      adxPeriod: 2,
    });
    // Then
    expect(col(a, ADX_LINE)[3]).toBeNaN();
    expect(col(a, ADX_LINE)[6]).toBeCloseTo(col(b, ADX_LINE)[5] as number, 12);
  });
});
