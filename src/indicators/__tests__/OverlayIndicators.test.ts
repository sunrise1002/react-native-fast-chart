/**
 * Test perspective table — Donchian / Keltner / Supertrend / SAR / Ichimoku
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | DC1  | 3 hand bars, period 2                                  | Golden (hand)        | upper 5,5 lower 1,0 basis 3,2.5              |
 * | DC2  | generated bars, 20 and 1                               | Golden (reference)   | equals reference                             |
 * | DC3  | NaN low mid-series / period > length / empty           | Abnormal / Boundary  | NaN windows / all NaN / length 0             |
 * | KC1  | generated bars, defaults and 5 / 1.5 / 3 hl2           | Golden (reference)   | EMA ± k·ATR equal reference                  |
 * | KC2  | NaN high mid-series                                    | Abnormal             | NaN band at bar, basis continues             |
 * | KC3  | config clamping / label                                | Invalid input        | clamped multiplier, `KC 20 2 10`             |
 * | ST1  | generated bars, 10 / 3 and 3 / 1                       | Golden (reference)   | equals the Pine port                         |
 * | ST2  | output split                                           | Equivalence          | never both up and down; middle = (o + c) / 2 |
 * | ST3  | falling then rising prices                             | Normal (switch)      | down line first, up line after the turn      |
 * | ST4  | NaN close / ∞ open / ATR warm-up / empty               | Abnormal / Boundary  | NaN outputs; direction restarts              |
 * | SR1  | 4 hand bars, defaults                                  | Golden (hand)        | NaN, 8, 8, 13 (reversal)                     |
 * | SR2  | generated bars, defaults and 0.1 / 0.05 / 0.3          | Golden (reference)   | equals the Pine port                         |
 * | SR3  | NaN bar mid-series                                     | Abnormal             | NaN at bar; same values as without the bar   |
 * | SR4  | empty / single bar / config                            | Boundary (0 / 1)     | length 0 / NaN / clamped factors             |
 * | IC1  | generated bars, defaults and 2 / 3 / 5                 | Golden (reference)   | all five outputs equal reference             |
 * | IC2  | output offsets: default / displacement 2 / 1           | Boundary (min)       | [0,0,−25,25,25] / [0,0,−1,1,1] / no shift    |
 * | IC3  | NaN high / ∞ close / config clamping / label           | Abnormal / Invalid   | NaN windows / NaN; displacement ≤ 500        |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  CHANNEL_BASIS,
  CHANNEL_LOWER,
  CHANNEL_UPPER,
  donchianModule,
} from '../builtins/Donchian';
import {
  ICHIMOKU_BASE,
  ICHIMOKU_CONVERSION,
  ICHIMOKU_LAGGING,
  ICHIMOKU_SPAN_A,
  ICHIMOKU_SPAN_B,
  ichimokuModule,
} from '../builtins/Ichimoku';
import { keltnerModule } from '../builtins/Keltner';
import { parabolicSarModule } from '../builtins/ParabolicSar';
import {
  SUPERTREND_DOWN,
  SUPERTREND_MIDDLE,
  SUPERTREND_UP,
  supertrendModule,
} from '../builtins/Supertrend';
import { createIndicatorEntry } from '../IndicatorDefinitions';
import type { PriceSource } from '../Indicator';
import type { IndicatorModule } from '../IndicatorRegistry';
import {
  refDonchian,
  refIchimoku,
  refKeltner,
  refSar,
  refSupertrend,
} from './advancedRefs';
import { columnsOf, expectSeries, type Bar } from './indicatorTestUtils';

function calc(
  module: IndicatorModule,
  c: ReturnType<typeof columnsOf>,
  raw = {}
) {
  return module.indicator.calculate(c, module.resolveConfig(raw));
}
const col = (r: { outputs: Float64Array[]; length: number }, k = 0) =>
  (r.outputs[k] as Float64Array).subarray(0, r.length);
const generated = () => {
  const store = new CandleStore();
  store.setData(generateCandles({ count: 2000, seed: 5 }));
  return store.columns;
};
const bar = (high: number, low: number, close: number, open = close): Bar => ({
  open,
  high,
  low,
  close,
});
const trend = (xs: number[]) => xs.map((x) => bar(x + 1, x - 1, x));

describe('Donchian channels', () => {
  it('DC1: hand-computed channel', () => {
    // Given
    const c = columnsOf([bar(3, 1, 2), bar(5, 2, 4), bar(4, 0, 1)]);
    // When
    const r = calc(donchianModule as IndicatorModule, c, { period: 2 });
    // Then
    expectSeries(col(r, CHANNEL_UPPER), [NaN, 5, 5]);
    expectSeries(col(r, CHANNEL_LOWER), [NaN, 1, 0]);
    expectSeries(col(r, CHANNEL_BASIS), [NaN, 3, 2.5]);
  });

  it.each([20, 1])('DC2: generated bars equal the reference (%i)', (period) => {
    // Given
    const c = generated();
    // When
    const r = calc(donchianModule as IndicatorModule, c, { period });
    // Then
    const ref = refDonchian(c, period);
    expectSeries(col(r, CHANNEL_UPPER), ref.upper);
    expectSeries(col(r, CHANNEL_LOWER), ref.lower);
    expectSeries(col(r, CHANNEL_BASIS), ref.basis);
  });

  it('DC3: NaN low, period > length, empty', () => {
    // Given
    const bars = trend([1, 2, 3, 4, 5]);
    bars[1] = bar(3, NaN, 2);
    const m = donchianModule as IndicatorModule;
    // When
    const r = calc(m, columnsOf(bars), { period: 2 });
    const long = calc(m, columnsOf([1, 2]), { period: 3 });
    const empty = calc(m, columnsOf([]));
    // Then
    expectSeries(col(r, CHANNEL_UPPER), [NaN, 3, 4, 5, 6]);
    expectSeries(col(r, CHANNEL_LOWER), [NaN, NaN, NaN, 2, 3]);
    expect(Array.from(col(long, CHANNEL_BASIS)).every(Number.isNaN)).toBe(true);
    expect(empty.length).toBe(0);
    expect(donchianModule.formatLabel(donchianModule.resolveConfig({}))).toBe(
      'DC 20'
    );
  });
});

describe('Keltner channels', () => {
  it.each([
    [{}, 20, 2, 10, 'close'],
    [
      { period: 5, multiplier: 1.5, atrPeriod: 3, source: 'hl2' },
      5,
      1.5,
      3,
      'hl2',
    ],
  ] as [Record<string, unknown>, number, number, number, PriceSource][])(
    'KC1: generated bars equal the reference (%j)',
    (raw, p, k, a, s) => {
      // Given
      const c = generated();
      // When
      const r = calc(keltnerModule as IndicatorModule, c, raw);
      // Then
      const ref = refKeltner(c, p, k, a, s);
      expectSeries(col(r, CHANNEL_BASIS), ref.basis);
      expectSeries(col(r, CHANNEL_UPPER), ref.upper);
      expectSeries(col(r, CHANNEL_LOWER), ref.lower);
    }
  );

  it('KC2: NaN high leaves the basis and skips the true range', () => {
    // Given
    const bars = trend([1, 2, 3, 4, 5, 6]);
    bars[3] = bar(NaN, 3, 4);
    // When
    const r = calc(keltnerModule as IndicatorModule, columnsOf(bars), {
      period: 2,
      atrPeriod: 2,
    });
    // Then: EMA(2) of 1..4 is 1.5, 2.5, 3.5
    expect(col(r, CHANNEL_UPPER)[3]).toBeNaN();
    expect(col(r, CHANNEL_BASIS)[3]).toBeCloseTo(3.5);
    expect(Number.isFinite(col(r, CHANNEL_UPPER)[5])).toBe(true);
  });

  it('KC3: config clamping and label', () => {
    // Given / When
    const config = keltnerModule.resolveConfig({ multiplier: 0, atrPeriod: 0 });
    // Then
    expect(config).toEqual({
      period: 20,
      multiplier: 0.001,
      atrPeriod: 1,
      source: 'close',
    });
    expect(keltnerModule.formatLabel(keltnerModule.resolveConfig({}))).toBe(
      'KC 20 2 10'
    );
  });
});

describe('Supertrend', () => {
  it.each([
    [10, 3],
    [3, 1],
  ])(
    'ST1: generated bars equal the Pine port (%i, %p)',
    (atrPeriod, factor) => {
      // Given
      const c = generated();
      // When
      const r = calc(supertrendModule as IndicatorModule, c, {
        atrPeriod,
        factor,
      });
      // Then
      const ref = refSupertrend(c, atrPeriod, factor);
      expectSeries(col(r, SUPERTREND_UP), ref.up);
      expectSeries(col(r, SUPERTREND_DOWN), ref.down);
    }
  );

  it('ST2: exactly one trend line per valid bar, body middle', () => {
    // Given
    const c = generated();
    // When
    const r = calc(supertrendModule as IndicatorModule, c);
    // Then
    const up = col(r, SUPERTREND_UP);
    const down = col(r, SUPERTREND_DOWN);
    const middle = col(r, SUPERTREND_MIDDLE);
    let ups = 0;
    for (let i = 9; i < r.length; i++) {
      expect(Number.isNaN(up[i] as number)).toBe(
        !Number.isNaN(down[i] as number)
      );
      ups += Number.isNaN(up[i] as number) ? 0 : 1;
      const p = c.offset + i;
      expect(middle[i]).toBeCloseTo(
        ((c.open[p] as number) + (c.close[p] as number)) / 2
      );
    }
    expect(ups).toBeGreaterThan(0);
    expect(ups).toBeLessThan(r.length - 9);
  });

  it('ST3: downtrend line first, uptrend line after the turn', () => {
    // Given: falls for 10 bars, then rallies hard
    const xs = [
      ...Array.from({ length: 10 }, (_, i) => 100 - i),
      ...Array.from({ length: 10 }, (_, i) => 92 + 5 * i),
    ];
    // When
    const r = calc(supertrendModule as IndicatorModule, columnsOf(trend(xs)), {
      atrPeriod: 2,
      factor: 1,
    });
    // Then
    expect(Number.isFinite(col(r, SUPERTREND_DOWN)[5])).toBe(true);
    expect(Number.isFinite(col(r, SUPERTREND_UP)[19])).toBe(true);
    expect(col(r, SUPERTREND_UP)[19]).toBeLessThan(xs[19] as number);
  });

  it('ST4: NaN close, warm-up and empty input', () => {
    // Given
    const bars = trend([5, 6, 7, 8, 9, 10]);
    bars[3] = bar(9, 7, NaN);
    bars[5] = bar(11, 9, 10, Infinity);
    // When
    const r = calc(supertrendModule as IndicatorModule, columnsOf(bars), {
      atrPeriod: 2,
    });
    const empty = calc(supertrendModule as IndicatorModule, columnsOf([]));
    // Then
    expect(col(r, SUPERTREND_UP)[0]).toBeNaN();
    expect(col(r, SUPERTREND_DOWN)[0]).toBeNaN();
    expect(col(r, SUPERTREND_MIDDLE)[3]).toBeNaN();
    expect(col(r, SUPERTREND_MIDDLE)[5]).toBeNaN();
    expect(col(r, SUPERTREND_DOWN)[1]).toBeGreaterThan(6);
    // The bar after the gap restarts in a downtrend.
    expect(col(r, SUPERTREND_UP)[4]).toBeNaN();
    expect(Number.isFinite(col(r, SUPERTREND_DOWN)[4])).toBe(true);
    expect(empty.length).toBe(0);
    expect(
      supertrendModule.formatLabel(supertrendModule.resolveConfig({}))
    ).toBe('Supertrend 10 3');
  });
});

describe('Parabolic SAR', () => {
  it('SR1: hand-computed SAR with a reversal', () => {
    // Given
    const c = columnsOf([
      bar(10, 8, 9),
      bar(12, 9, 11),
      bar(13, 10, 12),
      bar(9, 5, 6),
    ]);
    // When
    const r = calc(parabolicSarModule as IndicatorModule, c);
    // Then
    expectSeries(col(r), [NaN, 8, 8, 13]);
  });

  it.each([
    [0.02, 0.02, 0.2],
    [0.1, 0.05, 0.3],
  ])(
    'SR2: generated bars equal the Pine port (%p/%p/%p)',
    (start, increment, maximum) => {
      // Given
      const c = generated();
      // When
      const r = calc(parabolicSarModule as IndicatorModule, c, {
        start,
        increment,
        maximum,
      });
      // Then
      expectSeries(col(r), refSar(c, start, increment, maximum));
    }
  );

  it('SR3: a NaN bar is skipped entirely', () => {
    // Given
    const bars = [
      bar(10, 8, 9),
      bar(12, 9, 11),
      bar(13, 10, 12),
      bar(14, 11, 13),
      bar(9, 5, 6),
    ];
    const gap = [...bars.slice(0, 2), bar(NaN, 1, 2), ...bars.slice(2)];
    // When
    const a = calc(parabolicSarModule as IndicatorModule, columnsOf(bars));
    const b = calc(parabolicSarModule as IndicatorModule, columnsOf(gap));
    // Then
    const expected = Array.from(col(a));
    expectSeries(col(b), [...expected.slice(0, 2), NaN, ...expected.slice(2)]);
  });

  it('SR4: empty, single bar, config', () => {
    // Given / When
    const empty = calc(parabolicSarModule as IndicatorModule, columnsOf([]));
    const one = calc(parabolicSarModule as IndicatorModule, columnsOf([5]));
    const config = parabolicSarModule.resolveConfig({ start: 0, maximum: 9 });
    // Then
    expect(empty.length).toBe(0);
    expectSeries(col(one), [NaN]);
    expect(config).toEqual({ start: 0.001, increment: 0.02, maximum: 1 });
    expect(parabolicSarModule.meta.series).toEqual([
      { kind: 'points', name: 'SAR', output: 0, defaultColor: '#2962FF' },
    ]);
  });
});

describe('Ichimoku cloud', () => {
  it.each([
    [{}, 9, 26, 52],
    [{ conversionPeriod: 2, basePeriod: 3, spanBPeriod: 5 }, 2, 3, 5],
  ])(
    'IC1: generated bars equal the reference (%j)',
    (raw, conv, base, spanB) => {
      // Given
      const c = generated();
      // When
      const r = calc(ichimokuModule as IndicatorModule, c, raw);
      // Then
      const ref = refIchimoku(c, conv, base, spanB);
      expectSeries(col(r, ICHIMOKU_CONVERSION), ref.conversion);
      expectSeries(col(r, ICHIMOKU_BASE), ref.base);
      expectSeries(col(r, ICHIMOKU_LAGGING), ref.lagging);
      expectSeries(col(r, ICHIMOKU_SPAN_A), ref.spanA);
      expectSeries(col(r, ICHIMOKU_SPAN_B), ref.spanB);
    }
  );

  it('IC2: display offsets per output', () => {
    // Given
    const offsets = ichimokuModule.outputOffsets as NonNullable<
      typeof ichimokuModule.outputOffsets
    >;
    const module = ichimokuModule as IndicatorModule;
    // When
    const def = offsets(ichimokuModule.resolveConfig({}));
    const two = offsets(ichimokuModule.resolveConfig({ displacement: 2 }));
    const one = createIndicatorEntry(
      module,
      { type: 'ichimoku', config: { displacement: 1 } },
      'a'
    );
    const entry = createIndicatorEntry(module, { type: 'ichimoku' }, 'b');
    // Then
    expect(def).toEqual([0, 0, -25, 25, 25]);
    expect(two).toEqual([0, 0, -1, 1, 1]);
    expect(one.entry.offsets).toBeUndefined();
    expect(entry.entry.offsets).toEqual([0, 0, -25, 25, 25]);
  });

  it('IC3: NaN high, clamping, label', () => {
    // Given
    const bars = trend([1, 2, 3, 4, 5]);
    bars[2] = bar(NaN, 2, 3);
    // When
    const r = calc(ichimokuModule as IndicatorModule, columnsOf(bars), {
      conversionPeriod: 2,
      basePeriod: 1,
      spanBPeriod: 1,
    });
    const config = ichimokuModule.resolveConfig({ displacement: 9999 });
    // Then
    expectSeries(col(r, ICHIMOKU_CONVERSION), [NaN, 1.5, NaN, NaN, 4.5]);
    expectSeries(col(r, ICHIMOKU_LAGGING), [1, 2, 3, 4, 5]);
    const inf = trend([1, 2]);
    inf[1] = bar(3, 1, Infinity);
    const lag = calc(ichimokuModule as IndicatorModule, columnsOf(inf));
    expectSeries(col(lag, ICHIMOKU_LAGGING), [1, NaN]);
    expect(config.displacement).toBe(500);
    expect(ichimokuModule.formatLabel(ichimokuModule.resolveConfig({}))).toBe(
      'Ichimoku 9 26 52 26'
    );
  });
});
