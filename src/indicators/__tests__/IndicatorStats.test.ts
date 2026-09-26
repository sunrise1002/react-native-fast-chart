/**
 * Test perspective table — IndicatorStats (§33.6 "no full recalc per tick")
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                    |
 * |------|--------------------------------------------------------|-------------------|---------------------------------------------|
 * | S1   | fresh collector                                        | Boundary (0)      | all zero, empty byId                        |
 * | S2   | full + incremental updates                             | Equivalence       | counted per id and in totals, 1 flush       |
 * | S3   | empty batch / removed-only batch                       | Boundary (empty)  | no flush counted                            |
 * | S4   | snapshot is a copy                                     | Abnormal          | mutating it does not affect the collector   |
 * | S5   | reset                                                  | Equivalence       | zeros                                       |
 * | S6   | engine: add → 1 full; 100 ticks → incremental only     | Equivalence       | full stays 1, incremental = flushes         |
 * | S7   | engine: updateIndicator config of one of two           | Equivalence       | only that id gets a full run                |
 * | S8   | engine: style-only update                              | Boundary          | no computation                              |
 * | S9   | engine: prepend / setData                              | Equivalence       | full recalculation (expected)               |
 * | S10  | engine: resetComputeStats                              | Equivalence       | zeros                                       |
 */
import { describe, expect, it } from '@jest/globals';
import type { IndicatorResult } from '../Indicator';
import type { IndicatorUpdate } from '../IndicatorCompute';
import { IndicatorStatsCollector } from '../IndicatorStats';
import { BARS, setup } from './engineFixture';

const result = {} as IndicatorResult;
const upd = (id: string, full: boolean): IndicatorUpdate => ({
  id,
  removed: false,
  full,
  from: 0,
  result,
  resetVersion: 0,
  firstTime: 0,
});

describe('IndicatorStatsCollector', () => {
  it('S1: starts at zero', () => {
    // Given / When / Then
    expect(new IndicatorStatsCollector().snapshot()).toEqual({
      full: 0,
      incremental: 0,
      flushes: 0,
      byId: {},
    });
  });

  it('S2: counts per id and in totals', () => {
    // Given
    const stats = new IndicatorStatsCollector();
    // When
    stats.record([upd('a', true), upd('b', false), upd('a', false)]);
    // Then
    expect(stats.snapshot()).toEqual({
      full: 1,
      incremental: 2,
      flushes: 1,
      byId: { a: { full: 1, incremental: 1 }, b: { full: 0, incremental: 1 } },
    });
  });

  it('S3: empty and removed-only batches are not flushes', () => {
    // Given
    const stats = new IndicatorStatsCollector();
    // When
    stats.record([]);
    stats.record([{ id: 'a', removed: true }]);
    // Then
    expect(stats.snapshot().flushes).toBe(0);
    expect(stats.snapshot().byId).toEqual({});
  });

  it('S4: snapshots are copies', () => {
    // Given
    const stats = new IndicatorStatsCollector();
    stats.record([upd('a', true)]);
    const snap = stats.snapshot();
    // When
    (snap.byId.a as { full: number }).full = 99;
    // Then
    expect(stats.snapshot().byId.a?.full).toBe(1);
  });

  it('S5: reset zeroes everything', () => {
    // Given
    const stats = new IndicatorStatsCollector();
    stats.record([upd('a', true)]);
    // When
    stats.reset();
    // Then
    expect(stats.snapshot()).toEqual({
      full: 0,
      incremental: 0,
      flushes: 0,
      byId: {},
    });
  });
});

describe('IndicatorEngine compute stats', () => {
  it('S6: realtime ticks never recalculate fully', () => {
    // Given
    const { store, engine, fire } = setup();
    const ema = engine.add({ type: 'ema', config: { period: 20 } });
    const rsi = engine.add({ type: 'rsi' });
    fire();
    // When: 100 ticks with a rollover every 10 ticks, one frame each
    for (let t = 0; t < 100; t++) {
      const lastBar = store.get(store.length - 1);
      if (!lastBar) throw new Error('missing bar');
      if (t % 10 === 9) {
        store.append({ ...lastBar, time: lastBar.time + 60_000 });
      } else {
        store.updateLast({ ...lastBar, close: lastBar.close + 0.1 });
      }
      fire();
    }
    // Then
    const stats = engine.getComputeStats();
    expect(stats.byId[ema]).toEqual({ full: 1, incremental: 100 });
    expect(stats.byId[rsi]).toEqual({ full: 1, incremental: 100 });
    expect(stats.full).toBe(2);
    expect(stats.flushes).toBe(101);
  });

  it('S7: a config change recalculates only that indicator', () => {
    // Given
    const { engine, fire } = setup();
    const a = engine.add({ type: 'ema', config: { period: 20 } });
    const b = engine.add({ type: 'ema', config: { period: 50 } });
    fire();
    engine.resetComputeStats();
    // When
    engine.update(a, { config: { period: 30 } });
    fire();
    // Then
    const stats = engine.getComputeStats();
    expect(stats.byId[a]).toEqual({ full: 1, incremental: 0 });
    expect(stats.byId[b]).toBeUndefined();
  });

  it('S8: a style-only update computes nothing', () => {
    // Given
    const { engine, fire } = setup();
    const a = engine.add({ type: 'ema', config: { period: 20 } });
    fire();
    engine.resetComputeStats();
    // When
    engine.update(a, { style: { lineWidth: 3 } });
    fire();
    // Then
    expect(engine.getComputeStats().full).toBe(0);
    expect(engine.getComputeStats().incremental).toBe(0);
  });

  it('S9: prepend and setData are full recalculations', () => {
    // Given
    const { store, engine, fire } = setup({ bars: BARS.slice(100) });
    engine.add({ type: 'ema', config: { period: 20 } });
    fire();
    engine.resetComputeStats();
    // When
    store.prepend(BARS.slice(0, 100));
    fire();
    store.setData(BARS);
    fire();
    // Then
    expect(engine.getComputeStats()).toMatchObject({
      full: 2,
      incremental: 0,
    });
  });

  it('S10: resetComputeStats zeroes the counters', () => {
    // Given
    const { engine, fire } = setup();
    engine.add({ type: 'ema' });
    fire();
    // When
    engine.resetComputeStats();
    // Then
    expect(engine.getComputeStats()).toEqual({
      full: 0,
      incremental: 0,
      flushes: 0,
      byId: {},
    });
  });
});
