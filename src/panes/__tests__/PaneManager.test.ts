/**
 * Test perspective table — Pane helpers / PaneManager
 *
 * | Case | Input / Precondition                                    | Perspective          | Expected                                       |
 * |------|---------------------------------------------------------|----------------------|------------------------------------------------|
 * | H1   | sanitizePaneRatio: valid / 0 / < 0 / NaN / ∞ / tiny/huge | Boundary / Invalid   | value / fallback / clamped to [1e-3, 1e3]      |
 * | H2   | sanitizePaneMinHeight: 0 / < 0 / NaN / string           | Boundary / Invalid   | 0 / fallback                                   |
 * | M1   | new manager                                             | Normal               | only the price pane (ratio 3, min 80)          |
 * | M2   | add (generated id, explicit id, index, sanitized sizes) | Normal               | inserted, listeners notified                   |
 * | M3   | add duplicate / empty id / price id                     | Abnormal             | throws with message                            |
 * | M4   | add at index 0 / huge / NaN                             | Boundary             | clamped behind price / appended                |
 * | M5   | remove indicator pane / price / unknown                 | Normal / Abnormal    | definition returned / undefined                |
 * | M6   | move: forward / to 0 / beyond end / same / price / NaN  | Boundary / Abnormal  | reordered / clamped / false                    |
 * | M7   | setHeightRatio valid / invalid / unknown                | Normal / Invalid     | true + changed / false                         |
 * | M8   | resize: all / wrong length / invalid entries / no-op    | Normal / Abnormal    | applied / false / kept / no emit               |
 * | S1   | sync creates automatic panes in entry order             | Normal               | panes appended, indicatorIds filled            |
 * | S2   | sync removes empty automatic panes, keeps explicit      | Normal               | auto dropped, explicit kept empty              |
 * | S3   | sync unchanged                                          | Boundary             | same snapshot, no emit                         |
 * | S4   | sync price-pane overlays + reorder of indicators        | Equivalence          | price indicatorIds updated                     |
 * | S5   | sync empty list                                         | Boundary (empty)     | only price + explicit panes                    |
 * | D1   | dispose / unsubscribe                                   | Normal               | no further notifications                       |
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  MAX_PANE_RATIO,
  MIN_PANE_RATIO,
  PRICE_PANE_ID,
  sanitizePaneMinHeight,
  sanitizePaneRatio,
} from '../Pane';
import { PaneManager } from '../PaneManager';

const ref = (id: string, paneId: string) => ({ id, definition: { paneId } });
const ids = (m: PaneManager) => m.getPanes().map((p) => p.id);

describe('pane helpers', () => {
  it('H1: sanitizePaneRatio', () => {
    // Given / When / Then
    expect(sanitizePaneRatio(2, 1)).toBe(2);
    expect(sanitizePaneRatio(0, 1)).toBe(1);
    expect(sanitizePaneRatio(-1, 1)).toBe(1);
    expect(sanitizePaneRatio(NaN, 1)).toBe(1);
    expect(sanitizePaneRatio(Infinity, 1)).toBe(1);
    expect(sanitizePaneRatio('2', 1)).toBe(1);
    expect(sanitizePaneRatio(1e-9, 1)).toBe(MIN_PANE_RATIO);
    expect(sanitizePaneRatio(1e9, 1)).toBe(MAX_PANE_RATIO);
  });

  it('H2: sanitizePaneMinHeight', () => {
    // Given / When / Then
    expect(sanitizePaneMinHeight(0, 5)).toBe(0);
    expect(sanitizePaneMinHeight(-1, 5)).toBe(5);
    expect(sanitizePaneMinHeight(NaN, 5)).toBe(5);
    expect(sanitizePaneMinHeight(Infinity, 5)).toBe(5);
    expect(sanitizePaneMinHeight(undefined, 5)).toBe(5);
  });
});

describe('PaneManager', () => {
  it('M1: starts with the price pane', () => {
    // Given / When
    const m = new PaneManager();
    // Then
    expect(m.getPanes()).toEqual([
      {
        id: PRICE_PANE_ID,
        type: 'price',
        heightRatio: 3,
        minHeight: 80,
        indicatorIds: [],
      },
    ]);
  });

  it('M2: add', () => {
    // Given
    const m = new PaneManager();
    const listener = jest.fn();
    m.subscribe(listener);
    // When
    const a = m.add();
    const b = m.add({ id: 'b', heightRatio: 2, minHeight: 10, index: 1 });
    const c = m.add({ heightRatio: NaN, minHeight: -3 });
    // Then
    expect([a, b, c]).toEqual(['pane-1', 'b', 'pane-2']);
    expect(ids(m)).toEqual(['price', 'b', 'pane-1', 'pane-2']);
    expect(m.getPane('b')).toMatchObject({ heightRatio: 2, minHeight: 10 });
    expect(m.getPane('pane-2')).toMatchObject({
      heightRatio: 1,
      minHeight: 40,
    });
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('M3: add rejects duplicates and empty ids', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'x' });
    // When / Then
    expect(() => m.add({ id: 'x' })).toThrow(
      'PaneManager: pane "x" already exists'
    );
    expect(() => m.add({ id: PRICE_PANE_ID })).toThrow('already exists');
    expect(() => m.add({ id: '' })).toThrow(
      'PaneManager: pane id must be a non-empty string'
    );
  });

  it('M4: add index clamping and generated id collisions', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'pane-1' });
    // When
    const first = m.add({ index: 0 });
    m.add({ id: 'end', index: 99 });
    m.add({ id: 'nan', index: NaN });
    // Then
    expect(first).toBe('pane-2');
    expect(ids(m)).toEqual(['price', 'pane-2', 'pane-1', 'end', 'nan']);
  });

  it('M5: remove', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'x' });
    // When
    const removed = m.remove('x');
    // Then
    expect(removed?.id).toBe('x');
    expect(m.remove(PRICE_PANE_ID)).toBeUndefined();
    expect(m.remove('nope')).toBeUndefined();
    expect(ids(m)).toEqual(['price']);
  });

  it('M6: move', () => {
    // Given
    const m = new PaneManager();
    ['a', 'b', 'c'].forEach((id) => m.add({ id }));
    // When / Then
    expect(m.move('a', 3)).toBe(true);
    expect(ids(m)).toEqual(['price', 'b', 'c', 'a']);
    expect(m.move('a', 0)).toBe(true);
    expect(ids(m)).toEqual(['price', 'a', 'b', 'c']);
    expect(m.move('b', 50)).toBe(true);
    expect(ids(m)).toEqual(['price', 'a', 'c', 'b']);
    const snapshot = m.getPanes();
    expect(m.move('a', 1)).toBe(true);
    expect(m.getPanes()).toBe(snapshot);
    expect(m.move(PRICE_PANE_ID, 2)).toBe(false);
    expect(m.move('nope', 1)).toBe(false);
    expect(m.move('a', NaN)).toBe(false);
  });

  it('M7: setHeightRatio', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'a' });
    // When / Then
    expect(m.setHeightRatio('a', 2.5)).toBe(true);
    expect(m.getPane('a')?.heightRatio).toBe(2.5);
    expect(m.setHeightRatio('a', 0)).toBe(false);
    expect(m.setHeightRatio('a', 1e9)).toBe(false);
    expect(m.setHeightRatio('nope', 1)).toBe(false);
    expect(m.getPane('a')?.heightRatio).toBe(2.5);
  });

  it('M8: resize', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'a' });
    const listener = jest.fn();
    m.subscribe(listener);
    // When / Then
    expect(m.resize([2, 2])).toBe(true);
    expect(m.getPanes().map((p) => p.heightRatio)).toEqual([2, 2]);
    expect(m.resize([1])).toBe(false);
    expect(m.resize([NaN, 4])).toBe(true);
    expect(m.getPanes().map((p) => p.heightRatio)).toEqual([2, 4]);
    expect(m.resize([2, 4])).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('S1: sync creates automatic panes in entry order', () => {
    // Given
    const m = new PaneManager();
    // When
    m.sync([
      ref('rsi', 'pane:rsi'),
      ref('ema', PRICE_PANE_ID),
      ref('macd', 'pane:macd'),
      ref('rsi2', 'pane:rsi'),
    ]);
    // Then
    expect(ids(m)).toEqual(['price', 'pane:rsi', 'pane:macd']);
    expect(m.getPane('pane:rsi')?.indicatorIds).toEqual(['rsi', 'rsi2']);
    expect(m.getPane(PRICE_PANE_ID)?.indicatorIds).toEqual(['ema']);
    expect(m.getPane('pane:macd')).toMatchObject({
      type: 'indicator',
      heightRatio: 1,
    });
  });

  it('S2: empty automatic panes disappear, explicit panes stay', () => {
    // Given
    const m = new PaneManager();
    m.add({ id: 'mine' });
    m.sync([ref('rsi', 'pane:rsi'), ref('atr', 'mine')]);
    // When
    m.sync([]);
    // Then
    expect(ids(m)).toEqual(['price', 'mine']);
    expect(m.getPane('mine')?.indicatorIds).toEqual([]);
  });

  it('S3: unchanged sync keeps the snapshot', () => {
    // Given
    const m = new PaneManager();
    const refs = [ref('rsi', 'pane:rsi')];
    m.sync(refs);
    const snapshot = m.getPanes();
    const listener = jest.fn();
    m.subscribe(listener);
    // When
    m.sync(refs);
    // Then
    expect(m.getPanes()).toBe(snapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it('S4: indicator order changes update the pane', () => {
    // Given
    const m = new PaneManager();
    m.sync([ref('a', PRICE_PANE_ID), ref('b', PRICE_PANE_ID)]);
    // When
    m.sync([ref('b', PRICE_PANE_ID), ref('a', PRICE_PANE_ID)]);
    // Then
    expect(m.getPane(PRICE_PANE_ID)?.indicatorIds).toEqual(['b', 'a']);
  });

  it('S5: resized automatic panes keep their ratio across syncs', () => {
    // Given
    const m = new PaneManager();
    m.sync([ref('rsi', 'pane:rsi')]);
    m.setHeightRatio('pane:rsi', 2);
    // When
    m.sync([ref('rsi', 'pane:rsi'), ref('atr', 'pane:atr')]);
    // Then
    expect(m.getPane('pane:rsi')?.heightRatio).toBe(2);
  });

  it('D1: dispose and unsubscribe stop notifications', () => {
    // Given
    const m = new PaneManager();
    const a = jest.fn();
    const b = jest.fn();
    const off = m.subscribe(a);
    m.subscribe(b);
    // When
    off();
    m.add();
    m.dispose();
    m.add();
    // Then
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});
