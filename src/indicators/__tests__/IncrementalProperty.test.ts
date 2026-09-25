/**
 * Test perspective table — incremental update === full recalculation
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                  |
 * |------|--------------------------------------------------------|-------------------|-------------------------------------------|
 * | P1   | random appends / updateLast ticks (every indicator)    | Property          | update ≡ calculate (≤ 1e-9, in practice 0)|
 * | P2   | sequence crossing the 256-bar resync boundary          | Boundary          | still identical around 255/256/257        |
 * | P3   | tail patch (`changedIndex = committed`)                | Equivalence       | incremental path, identical               |
 * | P4   | change before `committed`                              | Abnormal          | falls back to full recalculation          |
 * | P5   | shrinking input                                        | Abnormal          | falls back to full recalculation          |
 * | P6   | NaN / ±Infinity ticks in the stream                    | Abnormal          | still identical                           |
 * | P7   | update from an empty result                            | Boundary (empty)  | identical to calculate                    |
 * | P8   | changedIndex NaN                                       | Invalid input     | full recalculation                        |
 * | P9   | growth past the result capacity                        | Boundary (max)    | reallocates, identical                    |
 */
import { describe, expect, it } from '@jest/globals';
import type { CandleColumns } from '../../data/CandleBuffer';
import { createSeededRandom } from '../../testing/fixtures/random';
import { bollingerModule } from '../builtins/Bollinger';
import { emaModule, smaModule, wmaModule } from '../builtins/MovingAverages';
import type { IndicatorResult } from '../Indicator';
import type { IndicatorModule } from '../IndicatorRegistry';
import { columnsOf, prefix } from './indicatorTestUtils';

type Case = [string, IndicatorModule, Record<string, unknown>];
const CASES: Case[] = [
  ['sma 14', smaModule as IndicatorModule, { period: 14 }],
  ['ema 20', emaModule as IndicatorModule, { period: 20 }],
  ['ema 1', emaModule as IndicatorModule, { period: 1 }],
  ['wma 30 hl2', wmaModule as IndicatorModule, { period: 30, source: 'hl2' }],
  ['bb 20 2', bollingerModule as IndicatorModule, { period: 20 }],
];

/** Mutable columns that simulate a realtime feed. */
function feed(capacity: number, seed: number) {
  const random = createSeededRandom(seed);
  const c = columnsOf(new Array<number>(capacity).fill(0));
  let price = 100;
  const setBar = (i: number, special = false) => {
    price += (random() - 0.5) * 2;
    const v = special ? ([NaN, Infinity, -Infinity][i % 3] as number) : price;
    c.open[i] = v;
    c.high[i] = v + 1;
    c.low[i] = v - 1;
    c.close[i] = v;
  };
  return { c, random, setBar };
}

function expectIdentical(a: IndicatorResult, b: IndicatorResult): void {
  expect(a.length).toBe(b.length);
  expect(a.committed).toBe(b.committed);
  for (let k = 0; k < b.outputs.length; k++) {
    const x = a.outputs[k] as Float64Array;
    const y = b.outputs[k] as Float64Array;
    for (let i = 0; i < b.length; i++) {
      const u = x[i] as number;
      const v = y[i] as number;
      if (Number.isNaN(v)) {
        expect(Number.isNaN(u)).toBe(true);
      } else if (!(Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(v)))) {
        throw new Error(`output ${k} bar ${i}: ${u} !== ${v}`);
      }
    }
  }
}

function run(
  module: IndicatorModule,
  raw: Record<string, unknown>,
  opts: {
    seed: number;
    steps: number;
    specials?: boolean;
    start?: number;
  }
) {
  const config = module.resolveConfig(raw);
  const ind = module.indicator;
  const { c, random, setBar } = feed(opts.start! + opts.steps + 1, opts.seed);
  let n = opts.start ?? 0;
  for (let i = 0; i < n; i++) {
    setBar(i);
  }
  let result = ind.calculate(prefix(c, n), config);
  for (let s = 0; s < opts.steps; s++) {
    const append = n === 0 || random() < 0.3;
    if (append) {
      n++;
    }
    setBar(n - 1, opts.specials === true && random() < 0.05);
    const update = ind.update as NonNullable<typeof ind.update>;
    result = update(result, prefix(c, n), n - 1, config);
    expectIdentical(result, ind.calculate(prefix(c, n), config));
  }
  return { result, c, n, config };
}

describe('incremental === full recalculation', () => {
  it.each(CASES)('P1: random ticks — %s', (_, module, raw) => {
    // Given / When / Then (asserted per tick inside `run`)
    const { n } = run(module, raw, { seed: 3, steps: 400, start: 50 });
    expect(n).toBeGreaterThan(50);
  });

  it.each(CASES)('P2: across the 256-bar resync boundary — %s', (_, m, raw) => {
    // Given: starts just below the boundary
    // When / Then
    const { n } = run(m, raw, { seed: 9, steps: 60, start: 250 });
    expect(n).toBeGreaterThan(257);
  });

  it.each(CASES)('P6: non-finite ticks — %s', (_, module, raw) => {
    // Given / When / Then
    run(module, raw, { seed: 21, steps: 300, start: 10, specials: true });
  });

  it.each(CASES)('P7: update from an empty result — %s', (_, module, raw) => {
    // Given / When / Then
    run(module, raw, { seed: 4, steps: 30, start: 0 });
  });
});

describe('update fallbacks', () => {
  const config = emaModule.resolveConfig({ period: 5 });
  const ind = emaModule.indicator;
  const update = ind.update as NonNullable<typeof ind.update>;
  const base = (): CandleColumns =>
    columnsOf(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i)));

  it('P3: tail patch at committed keeps the same result object', () => {
    // Given
    const c = base();
    const prev = ind.calculate(prefix(c, 30), config);
    // When
    const next = update(prev, c, prev.committed, config);
    // Then
    expect(next).toBe(prev);
    expect(next.changedFrom).toBe(29);
    expectIdentical(next, ind.calculate(c, config));
  });

  it('P4: change before committed recalculates', () => {
    // Given
    const c = base();
    const prev = ind.calculate(c, config);
    c.close[3] = 500;
    // When
    const next = update(prev, c, 3, config);
    // Then
    expect(next).not.toBe(prev);
    expect(next.changedFrom).toBe(0);
    expectIdentical(next, ind.calculate(c, config));
  });

  it('P5: shrinking input recalculates', () => {
    // Given
    const c = base();
    const prev = ind.calculate(c, config);
    // When
    const next = update(prev, prefix(c, 20), 39, config);
    // Then
    expect(next).not.toBe(prev);
    expect(next.length).toBe(20);
  });

  it('P8: NaN changedIndex recalculates', () => {
    // Given
    const c = base();
    const prev = ind.calculate(c, config);
    // When
    const next = update(prev, c, NaN, config);
    // Then
    expect(next).not.toBe(prev);
    expectIdentical(next, prev);
  });

  it('P9: growth past capacity reallocates columns', () => {
    // Given
    const c = columnsOf(Array.from({ length: 500 }, (_, i) => i));
    const prev = ind.calculate(prefix(c, 1), config);
    const capacity = (prev.outputs[0] as Float64Array).length;
    // When
    const next = update(prev, c, 0, config);
    // Then
    expect((next.outputs[0] as Float64Array).length).toBeGreaterThan(capacity);
    expectIdentical(next, ind.calculate(c, config));
  });
});
