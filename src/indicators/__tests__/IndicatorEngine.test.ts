/**
 * Test perspective table — IndicatorEngine (definitions, scheduling, incremental flow)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                        |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------------|
 * | E1   | add EMA 20 on 300 bars, flush                          | Normal             | result equals calculate, full update published  |
 * | E2   | updateLast / append ticks within one frame             | Normal (coalesce)  | one incremental update, from = committed        |
 * | E3   | setData (reset) / prepend                              | Normal             | full recalculation, new firstTime               |
 * | E4   | update config / style only / type change               | Normal             | recalc / no recalc / replaced                   |
 * | E4b  | type change of a non-last indicator                    | Boundary           | keeps its display position                      |
 * | E5   | remove                                                 | Normal             | removed update, result gone                     |
 * | E6   | setIndicators: keep, change, drop, default ids         | Normal             | cache kept for unchanged, ids `${type}-${i}`    |
 * | E7   | unknown type / duplicate id                            | Abnormal           | throws with message                             |
 * | E8   | remove / update unknown id                             | Abnormal           | false                                           |
 * | E9   | auto ids skip taken ids                                | Boundary           | unique                                          |
 * | E10  | empty store                                            | Boundary (empty)   | length-0 result                                 |
 * | E11  | flush with nothing to do                               | Boundary           | no listener call                                |
 */
import { describe, expect, it } from '@jest/globals';
import { BARS, ema, last, setup } from './engineFixture';

describe('IndicatorEngine', () => {
  it('E1: computes on the next frame', () => {
    // Given
    const { store, engine, fire, updates } = setup();
    // When
    const id = engine.add({ type: 'ema', config: { period: 20 } });
    expect(engine.getResult(id)).toBeUndefined();
    fire();
    // Then
    expect(id).toBe('ema-1');
    const r = engine.getResult(id);
    expect(Array.from(r?.outputs[0]?.subarray(0, 300) ?? [])).toEqual(
      Array.from(ema(store, 20).outputs[0]?.subarray(0, 300) ?? [])
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.[0]).toMatchObject({
      id,
      removed: false,
      full: true,
      from: 0,
    });
  });

  it('E2: coalesces ticks into one incremental update', () => {
    // Given
    const { store, engine, fire, updates, frames } = setup();
    const id = engine.add({ type: 'ema', config: { period: 20 } });
    fire();
    const lastBar = store.get(299);
    if (!lastBar) throw new Error('missing bar');
    // When
    store.updateLast({ ...lastBar, close: lastBar.close + 5 });
    store.append({ ...lastBar, time: lastBar.time + 60_000 });
    store.updateLast({ ...lastBar, time: lastBar.time + 60_000, close: 1 });
    expect(frames).toHaveLength(1);
    fire();
    // Then
    const u = last(updates)[0];
    expect(u).toMatchObject({ id, full: false, from: 299 });
    expect(
      Array.from(engine.getResult(id)?.outputs[0]?.subarray(0, 301) ?? [])
    ).toEqual(Array.from(ema(store, 20).outputs[0]?.subarray(0, 301) ?? []));
  });

  it('E3: reset and prepend recalculate', () => {
    // Given
    const { store, engine, fire, updates } = setup();
    engine.add({ type: 'sma', id: 's', config: { period: 5 } });
    fire();
    // When: prepend
    const first = store.get(0);
    if (!first) throw new Error('missing bar');
    store.prepend([{ ...first, time: first.time - 60_000 }]);
    fire();
    // Then
    expect(last(updates)[0]).toMatchObject({
      id: 's',
      full: true,
      firstTime: first.time - 60_000,
    });
    // When: reset
    store.setData(BARS.slice(0, 10));
    fire();
    // Then
    expect(last(updates)[0]).toMatchObject({
      full: true,
      resetVersion: store.resetVersion,
    });
    expect(engine.getResult('s')?.length).toBe(10);
  });

  it('E4: update config / style / type', () => {
    // Given
    const { engine, fire, updates, frames } = setup();
    engine.add({ type: 'ema', id: 'x', config: { period: 20 } });
    fire();
    const entries = engine.getEntries();
    // When: style only
    expect(engine.update('x', { style: { lineWidth: 3 } })).toBe(true);
    // Then: no compute requested, entries replaced
    expect(frames).toHaveLength(0);
    expect(engine.getEntries()).not.toBe(entries);
    expect(engine.getEntries()[0]?.definition.style.lineWidth).toBe(3);
    // When: same config
    engine.update('x', { config: { period: 20 } });
    expect(frames).toHaveLength(0);
    // When: config
    engine.update('x', { config: { period: 10 } });
    fire();
    // Then
    expect(last(updates)[0]).toMatchObject({ id: 'x', full: true });
    expect(engine.getEntries()[0]?.label).toBe('EMA 10');
    // When: type change
    engine.update('x', { type: 'bollinger' });
    fire();
    // Then
    expect(engine.getEntries()[0]?.meta.type).toBe('bollinger');
    expect(engine.getResult('x')?.outputs).toHaveLength(3);
    // The full snapshot replaces the series: no separate removal.
    expect(last(updates)).toHaveLength(1);
    expect(last(updates)[0]).toMatchObject({
      id: 'x',
      removed: false,
      full: true,
    });
  });

  it('E4b: a type change keeps the display position', () => {
    // Given
    const { engine } = setup();
    engine.add({ type: 'ema', id: 'a' });
    engine.add({ type: 'sma', id: 'b' });
    // When
    engine.update('a', { type: 'wma' });
    // Then
    expect(engine.getEntries().map((e) => `${e.id}:${e.meta.type}`)).toEqual([
      'a:wma',
      'b:sma',
    ]);
  });

  it('E5: remove', () => {
    // Given
    const { engine, fire, updates } = setup();
    engine.add({ type: 'ema', id: 'x' });
    fire();
    // When
    expect(engine.remove('x')).toBe(true);
    fire();
    // Then
    expect(engine.getResult('x')).toBeUndefined();
    expect(engine.getEntries()).toEqual([]);
    expect(last(updates)).toEqual([{ id: 'x', removed: true }]);
  });

  it('E6: setIndicators', () => {
    // Given
    const { engine, fire, updates } = setup();
    engine.setIndicators([
      { type: 'ema', config: { period: 20 } },
      { type: 'ema', config: { period: 50 } },
      { type: 'sma', id: 'gone' },
    ]);
    fire();
    expect(engine.getEntries().map((e) => e.id)).toEqual([
      'ema-0',
      'ema-1',
      'gone',
    ]);
    const kept = engine.getResult('ema-0');
    // When
    engine.setIndicators([
      { type: 'ema', config: { period: 20 } },
      { type: 'wma', config: { period: 7 } },
    ]);
    fire();
    // Then
    expect(engine.getEntries().map((e) => `${e.id}:${e.label}`)).toEqual([
      'ema-0:EMA 20',
      'wma-1:WMA 7',
    ]);
    expect(engine.getResult('ema-0')).toBe(kept);
    const ids = last(updates).map((u) => `${u.id}:${u.removed}`);
    expect(ids).toEqual(
      expect.arrayContaining(['gone:true', 'ema-1:true', 'wma-1:false'])
    );
    expect(ids).not.toContain('ema-0:false');
  });

  it('E7: unknown type / duplicate id', () => {
    // Given
    const { engine } = setup();
    engine.add({ type: 'ema', id: 'a' });
    // When / Then
    expect(() => engine.add({ type: 'nope' })).toThrow(
      'Unknown indicator type "nope"'
    );
    expect(() => engine.add({ type: 'ema', id: 'a' })).toThrow(
      'Indicator "a" already exists'
    );
    expect(() => engine.setIndicators([{ type: 'nope' }])).toThrow(
      'Unknown indicator type'
    );
    expect(() => engine.update('a', { type: 'nope' })).toThrow(
      'Unknown indicator type'
    );
    expect(engine.getEntries().map((e) => e.id)).toEqual(['a']);
  });

  it('E8: unknown ids', () => {
    // Given
    const { engine } = setup();
    // When / Then
    expect(engine.remove('zz')).toBe(false);
    expect(engine.update('zz', { config: {} })).toBe(false);
    expect(engine.getResult('zz')).toBeUndefined();
  });

  it('E9: auto ids skip taken ids', () => {
    // Given
    const { engine } = setup();
    engine.add({ type: 'ema', id: 'ema-1' });
    // When
    const id = engine.add({ type: 'ema' });
    // Then
    expect(id).toBe('ema-2');
  });

  it('E10: empty store', () => {
    // Given
    const { engine } = setup({ bars: [] });
    // When
    engine.add({ type: 'bollinger', id: 'b' });
    engine.flush();
    // Then
    expect(engine.getResult('b')?.length).toBe(0);
  });

  it('E11: nothing to do publishes nothing', () => {
    // Given
    const { engine, fire, updates, profiler } = setup();
    engine.add({ type: 'ema' });
    fire();
    // When
    engine.flush();
    // Then
    expect(updates).toHaveLength(1);
    expect(profiler.end).toHaveBeenCalledTimes(1);
  });
});
