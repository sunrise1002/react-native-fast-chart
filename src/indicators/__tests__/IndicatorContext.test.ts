/**
 * Test perspective table — indicator context, choice params, output offsets
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | X1   | engine without / with a context option                 | Normal               | UTC default / the given zone                 |
 * | X2   | setContext with the same zone                          | Boundary (no-op)     | no frame requested, no update                |
 * | X3   | setContext with a new zone, VWAP + EMA active          | Normal               | only VWAP recalculated, in the new zone      |
 * | X4   | setContext with only context-free indicators           | Equivalence          | context stored, no frame requested           |
 * | O1   | outputOffsets fractional / non-finite / all zero       | Boundary / Invalid   | rounded / 0 / `offsets` omitted              |
 * | P1   | resolveChoiceParam valid / unknown / wrong type / null | Invalid input        | value / default / default / default          |
 * | P2   | label of a choice param default / non-default          | Equivalence          | omitted / appended                           |
 * | P3   | parseParamValue on a choice param                      | Normal / Invalid     | valid match / default flagged invalid        |
 * | V1   | getViewIndexRange inside / past the data               | Normal / Boundary    | unclamped edge indices                       |
 * | V2   | getViewIndexRange non-finite / zero spacing            | Abnormal             | empty range {0, −1}                          |
 */
import { describe, expect, it } from '@jest/globals';
import { parseParamValue } from '../../settings/IndicatorCatalog';
import { getViewIndexRange } from '../../viewport/VisibleRange';
import { emaModule } from '../builtins/MovingAverages';
import { VWAP_LINE, vwapModule } from '../builtins/Vwap';
import { DEFAULT_INDICATOR_CONTEXT } from '../Indicator';
import {
  formatIndicatorLabel,
  resolveChoiceParam,
  type ChoiceParam,
} from '../IndicatorConfig';
import { createIndicatorEntry } from '../IndicatorDefinitions';
import type { IndicatorModule } from '../IndicatorRegistry';
import { BARS, last, setup } from './engineFixture';

const COLORS: ChoiceParam & {
  readonly options: readonly ('red' | 'blue')[];
  readonly default: 'red' | 'blue';
} = {
  key: 'color',
  label: 'Color',
  kind: 'choice',
  options: ['red', 'blue'],
  default: 'red',
};

describe('indicator context', () => {
  it('X1: default and explicit context', () => {
    // Given / When
    const a = setup().engine;
    const b = setup({ context: { timeZone: 'Asia/Tokyo' } }).engine;
    // Then
    expect(a.getContext()).toBe(DEFAULT_INDICATOR_CONTEXT);
    expect(DEFAULT_INDICATOR_CONTEXT).toEqual({ timeZone: 'utc' });
    expect(Object.isFrozen(DEFAULT_INDICATOR_CONTEXT)).toBe(true);
    expect(b.getContext()).toEqual({ timeZone: 'Asia/Tokyo' });
  });

  it('X2: same zone is a no-op', () => {
    // Given
    const { engine, fire, frames, updates } = setup();
    engine.add({ type: 'vwap' });
    fire();
    const count = updates.length;
    // When
    engine.setContext({ timeZone: 'utc' });
    // Then
    expect(frames).toHaveLength(0);
    expect(updates).toHaveLength(count);
    expect(engine.getContext()).toBe(DEFAULT_INDICATOR_CONTEXT);
  });

  it('X3: a new zone recalculates only context-dependent indicators', () => {
    // Given
    const { store, engine, fire, updates } = setup();
    const vwap = engine.add({ type: 'vwap' });
    engine.add({ type: 'ema' });
    fire();
    // When
    // UTC−2: a new session at 02:00Z = bar 120 of the 1m fixture
    const before = Array.from(
      engine.getResult(vwap)?.outputs[VWAP_LINE]?.subarray(0, BARS.length) ?? []
    );
    engine.setContext({ timeZone: -120 });
    fire();
    // Then
    const ids = last(updates).map((u) => u.id);
    expect(ids).toEqual([vwap]);
    const expected = vwapModule.indicator.calculate(
      store.columns,
      vwapModule.resolveConfig({}),
      { timeZone: -120 }
    );
    const actual = engine.getResult(vwap)?.outputs[VWAP_LINE];
    expect(Array.from(actual?.subarray(0, BARS.length) ?? [])).toEqual(
      Array.from(expected.outputs[VWAP_LINE]?.subarray(0, BARS.length) ?? [])
    );
    expect(actual?.[119]).toBe(before[119]);
    expect(actual?.[150]).not.toBe(before[150]);
  });

  it('X4: context-free indicators ignore a zone change', () => {
    // Given
    const { engine, fire, frames } = setup();
    engine.add({ type: 'ema' });
    fire();
    // When
    engine.setContext({ timeZone: 60 });
    // Then
    expect(frames).toHaveLength(0);
    expect(engine.getContext()).toEqual({ timeZone: 60 });
  });
});

describe('output offsets', () => {
  it.each([
    [
      [0, 1.6, -2.4, NaN, Infinity],
      [0, 2, -2, 0, 0],
    ],
    [[0, 0], undefined],
  ])('O1: offsets %p → %p', (raw, expected) => {
    // Given
    const module: IndicatorModule = {
      ...(emaModule as IndicatorModule),
      outputOffsets: () => raw,
    };
    // When
    const { entry } = createIndicatorEntry(module, { type: 'ema' }, 'e');
    // Then
    expect(entry.offsets).toEqual(expected);
  });
});

describe('choice params', () => {
  it.each([
    [{ color: 'blue' }, 'blue'],
    [{ color: 'green' }, 'red'],
    [{ color: 3 }, 'red'],
    [null, 'red'],
  ])('P1: resolveChoiceParam(%p) → %s', (raw, expected) => {
    // Given / When / Then
    expect(resolveChoiceParam(raw, COLORS)).toBe(expected);
  });

  it('P2: labels show non-default choices only', () => {
    // Given / When / Then
    expect(formatIndicatorLabel('X', [COLORS], { color: 'red' })).toBe('X');
    expect(formatIndicatorLabel('X', [COLORS], { color: 'blue' })).toBe(
      'X blue'
    );
    expect(formatIndicatorLabel('X', [COLORS], { color: 1 })).toBe('X');
  });

  it('P3: parseParamValue on a choice', () => {
    // Given / When
    const ok = parseParamValue(COLORS, 'blue');
    const bad = parseParamValue(COLORS, 'green');
    // Then
    expect(ok).toEqual({ value: 'blue', valid: true, adjusted: false });
    expect(bad).toEqual({ value: 'red', valid: false, adjusted: false });
  });
});

describe('getViewIndexRange', () => {
  it('V1: unclamped edges', () => {
    // Given: 10 bars, 5 empty slots on the right, 10 slots visible
    const time = { width: 100, barSpacing: 10, rightOffset: 5, barCount: 10 };
    // When
    const view = getViewIndexRange(time);
    const inside = getViewIndexRange({ ...time, rightOffset: 0 });
    // Then
    expect(view).toEqual({ startIndex: 5, endIndex: 14 });
    expect(inside).toEqual({ startIndex: 0, endIndex: 9 });
  });

  it.each([
    { width: NaN, barSpacing: 10, rightOffset: 0, barCount: 10 },
    { width: 100, barSpacing: 0, rightOffset: 0, barCount: 10 },
    { width: 100, barSpacing: 10, rightOffset: Infinity, barCount: 10 },
  ])('V2: degenerate scale %p is empty', (time) => {
    // Given
    const out = { startIndex: 3, endIndex: 4 };
    // When
    const view = getViewIndexRange(time, out);
    // Then
    expect(view).toBe(out);
    expect(view).toEqual({ startIndex: 0, endIndex: -1 });
  });
});
