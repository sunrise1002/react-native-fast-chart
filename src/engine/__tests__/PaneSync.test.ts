/**
 * Test perspective table — PaneSync + controller pane API
 * (real Reanimated, fake timers; `scheduleOnUI` runs synchronously in jest.)
 *
 * | Case | Input / Precondition                                 | Perspective       | Expected                                         |
 * |------|------------------------------------------------------|-------------------|--------------------------------------------------|
 * | PS1  | toPaneLayoutSpec(price + indicator pane)             | Normal            | ids / ratios / minHeights in pane order          |
 * | PS2  | toPaneLayoutSpec([])                                 | Boundary (empty)  | empty arrays                                     |
 * | PS3  | connect: initial push, change pushed, unsubscribe    | Normal / Abnormal | layout split, then no longer updated             |
 * | CP1  | addIndicator(rsi) without a pane                     | Normal            | automatic pane synced, removed with the indicator|
 * | CP2  | addPane + indicator in it; removePane                | Normal            | pane and its indicators removed                  |
 * | CP3  | removePane('price') / unknown id                     | Invalid           | false, nothing changes                           |
 * | CP4  | movePane / setPaneHeightRatio / resizePanes          | Normal            | order / ratios updated                           |
 * | CP5  | movePane unknown / resizePanes wrong length / NaN    | Invalid           | false, unchanged / NaN entry keeps its ratio     |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import { PaneManager } from '../../panes/PaneManager';
import {
  asInternals,
  createTradingChartController,
} from '../ChartControllerImpl';
import { resizeCanvas } from '../LayoutActions';
import { connectPanesToUi, toPaneLayoutSpec } from '../PaneSync';
import { makeEngine } from './engineTestUtils';

function flush() {
  act(() => {
    jest.advanceTimersByTime(20);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

describe('toPaneLayoutSpec', () => {
  it('PS1: maps the panes in order', () => {
    // Given
    const panes = new PaneManager();
    panes.add({ id: 'a', heightRatio: 2, minHeight: 10 });
    // When
    const spec = toPaneLayoutSpec(panes.getPanes());
    // Then
    expect(spec).toEqual({
      ids: ['price', 'a'],
      ratios: [3, 2],
      minHeights: [80, 10],
    });
  });

  it('PS2: empty list', () => {
    // Given / When / Then
    expect(toPaneLayoutSpec([])).toEqual({
      ids: [],
      ratios: [],
      minHeights: [],
    });
  });
});

describe('connectPanesToUi', () => {
  it('PS3: pushes the current panes and every change until unsubscribed', () => {
    // Given
    const { state, options } = makeEngine();
    resizeCanvas(state, options, 464, 324, 24);
    const panes = new PaneManager();
    // When: initial push
    let unsubscribe = () => {};
    act(() => {
      unsubscribe = connectPanesToUi(panes, state, () => options);
    });
    flush();
    // Then
    expect(state.paneLayout.value.heights).toEqual([300]);
    // When: a pane is added
    act(() => {
      panes.add({ id: 'a' });
    });
    flush();
    // Then
    expect(state.paneLayout.value.heights).toEqual([225, 75]);
    expect(state.plotHeight.value).toBe(225);
    // When: unsubscribed, further changes are ignored
    unsubscribe();
    act(() => {
      panes.remove('a');
    });
    flush();
    // Then
    expect(state.paneLayout.value.ids).toEqual(['price', 'a']);
  });
});

function controller() {
  return asInternals(createTradingChartController());
}

describe('controller pane API', () => {
  it('CP1: indicator panes follow the indicators', () => {
    // Given
    const handle = controller();
    // When
    const id = handle.addIndicator({ type: 'rsi' });
    // Then
    expect(handle.getPanes().map((p) => [p.id, p.indicatorIds])).toEqual([
      ['price', []],
      [`pane:${id}`, [id]],
    ]);
    // When
    handle.removeIndicator(id);
    // Then
    expect(handle.getPanes()).toHaveLength(1);
  });

  it('CP2: removePane removes the pane and its indicators', () => {
    // Given
    const handle = controller();
    const pane = handle.addPane({ heightRatio: 2 });
    handle.addIndicator({ type: 'atr', paneId: pane });
    handle.addIndicator({ type: 'macd', paneId: pane });
    const ema = handle.addIndicator({ type: 'ema' });
    expect(handle.getPanes()[1]?.indicatorIds).toHaveLength(2);
    // When
    const removed = handle.removePane(pane);
    // Then
    expect(removed).toBe(true);
    expect(handle.getPanes().map((p) => p.id)).toEqual(['price']);
    expect(handle.getIndicators().map((e) => e.id)).toEqual([ema]);
  });

  it.each(['price', 'missing'])('CP3: removePane(%p) is rejected', (id) => {
    // Given
    const handle = controller();
    handle.addIndicator({ type: 'rsi' });
    // When
    const removed = handle.removePane(id);
    // Then
    expect(removed).toBe(false);
    expect(handle.getPanes()).toHaveLength(2);
    expect(handle.getIndicators()).toHaveLength(1);
  });

  it('CP4: move, set ratio and resize', () => {
    // Given
    const handle = controller();
    handle.addPane({ id: 'a' });
    handle.addPane({ id: 'b' });
    // When / Then
    expect(handle.movePane('b', 1)).toBe(true);
    expect(handle.getPanes().map((p) => p.id)).toEqual(['price', 'b', 'a']);
    expect(handle.setPaneHeightRatio('a', 2)).toBe(true);
    expect(handle.getPanes()[2]?.heightRatio).toBe(2);
    expect(handle.resizePanes([4, 1, 1])).toBe(true);
    expect(handle.getPanes().map((p) => p.heightRatio)).toEqual([4, 1, 1]);
  });

  it('CP5: invalid pane commands are rejected', () => {
    // Given
    const handle = controller();
    handle.addPane({ id: 'a' });
    const before = handle.getPanes();
    // When / Then
    expect(handle.movePane('missing', 0)).toBe(false);
    expect(handle.setPaneHeightRatio('missing', 2)).toBe(false);
    expect(handle.resizePanes([1])).toBe(false);
    expect(handle.getPanes()).toBe(before);
    // Invalid entries keep the current ratio.
    expect(handle.resizePanes([NaN, 2])).toBe(true);
    expect(handle.getPanes().map((p) => p.heightRatio)).toEqual([3, 2]);
  });
});
