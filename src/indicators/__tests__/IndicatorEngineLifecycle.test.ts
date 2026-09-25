/**
 * Test perspective table — IndicatorEngine failures, profiling, lifecycle + backend
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                        |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------------|
 * | E12  | faulty custom indicator                                | External failure   | removed update, others computed, error rethrown |
 * | E13  | indicator without `update`                             | Equivalence        | tick uses calculate                             |
 * | E14  | profiler channel                                       | Normal             | begin/end per publishing flush                  |
 * | E15  | snapshotUpdates / entries stability / dispose          | Normal             | full snapshots; same ref; no more flushes       |
 * | B1   | backend: store changed but no fromIndex recorded       | Boundary           | full recalculation                              |
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CandleStore } from '../../data/CandleStore';
import { createIndicatorRegistry } from '../builtins';
import { emaModule } from '../builtins/MovingAverages';
import { IndicatorCache } from '../IndicatorCache';
import {
  synchronousIndicatorBackend,
  type IndicatorUpdate,
} from '../IndicatorCompute';
import { IndicatorEngine } from '../IndicatorEngine';
import type { IndicatorModule } from '../IndicatorRegistry';
import { BARS, last, setup } from './engineFixture';

describe('IndicatorEngine — failures and lifecycle', () => {
  it('E12: isolates a faulty indicator', () => {
    // Given
    const registry = createIndicatorRegistry();
    const boom: IndicatorModule = {
      ...(emaModule as IndicatorModule),
      meta: { ...emaModule.meta, type: 'boom' },
      indicator: {
        type: 'boom',
        calculate: () => {
          throw new Error('boom failed');
        },
      },
    };
    registry.register(boom);
    const { engine, updates } = setup({ registry });
    engine.add({ type: 'ema', id: 'ok' });
    engine.add({ type: 'boom', id: 'bad' });
    // When / Then
    expect(() => engine.flush()).toThrow('boom failed');
    expect(engine.getResult('ok')?.length).toBe(300);
    expect(engine.getResult('bad')).toBeUndefined();
    expect(last(updates).map((u) => `${u.id}:${u.removed}`)).toEqual([
      'ok:false',
      'bad:true',
    ]);
  });

  it('E13: indicators without update recalculate on ticks', () => {
    // Given
    const registry = createIndicatorRegistry();
    const calculate = jest.fn(emaModule.indicator.calculate);
    registry.register({
      ...(emaModule as IndicatorModule),
      meta: { ...emaModule.meta, type: 'plain' },
      indicator: { type: 'plain', calculate } as IndicatorModule['indicator'],
    });
    const { store, engine, fire, updates } = setup({ registry });
    engine.add({ type: 'plain', id: 'p' });
    fire();
    // When
    const bar = store.get(299);
    if (!bar) throw new Error('missing bar');
    store.updateLast({ ...bar, close: bar.close + 1 });
    fire();
    // Then
    expect(calculate).toHaveBeenCalledTimes(2);
    expect(last(updates)[0]).toMatchObject({ full: true });
  });

  it('E14: profiles publishing flushes', () => {
    // Given
    const { engine, profiler } = setup();
    engine.add({ type: 'ema' });
    // When
    engine.flush();
    // Then
    expect(profiler.begin).toHaveBeenCalled();
    expect(profiler.end).toHaveBeenCalledWith(1);
  });

  it('E14: default profiler', () => {
    // Given
    const engine = new IndicatorEngine(new CandleStore(BARS));
    // When
    engine.add({ type: 'ema', id: 'e' });
    engine.flush();
    // Then
    expect(engine.getResult('e')?.length).toBe(300);
    expect(engine.registry.has('bollinger')).toBe(true);
  });

  it('E15: snapshots, stable entries, dispose', () => {
    // Given
    const { store, engine, fire, frames, updates } = setup();
    const entriesListener = jest.fn();
    engine.subscribeEntries(entriesListener);
    engine.add({ type: 'ema', id: 'a' });
    engine.add({ type: 'sma', id: 'b' });
    fire();
    // When / Then
    expect(engine.snapshotUpdates().map((u) => u.id)).toEqual(['a', 'b']);
    expect(engine.snapshotUpdates().every((u) => !u.removed && u.full)).toBe(
      true
    );
    expect(engine.getEntries()).toBe(engine.getEntries());
    expect(entriesListener).toHaveBeenCalledTimes(2);
    // When
    engine.dispose();
    const bar = store.get(299);
    if (!bar) throw new Error('missing bar');
    store.updateLast({ ...bar, close: bar.low });
    // Then
    expect(frames).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(engine.snapshotUpdates()).toEqual([]);
  });
});

describe('synchronousIndicatorBackend', () => {
  it('B1: store changed without a recorded index → full', () => {
    // Given
    const store = new CandleStore(BARS);
    const cache = new IndicatorCache();
    const task = {
      id: 'e',
      module: emaModule as IndicatorModule,
      config: { period: 3, source: 'close' },
      configVersion: 0,
      dirty: true,
    };
    const dataset = () => ({
      columns: store.columns,
      version: store.version,
      resetVersion: store.resetVersion,
      firstTime: store.firstTime,
    });
    synchronousIndicatorBackend.compute(
      dataset(),
      [task],
      { full: false, fromIndex: Infinity },
      cache,
      []
    );
    const bar = store.get(299);
    if (!bar) throw new Error('missing bar');
    store.updateLast({ ...bar, close: bar.low });
    const updates: IndicatorUpdate[] = [];
    // When
    const failure = synchronousIndicatorBackend.compute(
      dataset(),
      [task],
      { full: false, fromIndex: Infinity },
      cache,
      updates
    );
    // Then
    expect(failure).toBeUndefined();
    expect(updates[0]).toMatchObject({ full: true, from: 0 });
    expect(cache.peek('e')?.datasetVersion).toBe(store.version);
  });
});
