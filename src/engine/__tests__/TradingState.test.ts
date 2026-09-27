/**
 * Test perspective table — TradingState
 * (real Reanimated, fake timers; `scheduleOnUI` runs synchronously in jest.)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                    |
 * |------|----------------------------------------------------------|--------------------|---------------------------------------------|
 * | AS1  | scene after a pending drag                               | Equivalence        | override cleared                            |
 * | AS2  | scene during an active (not released) drag               | Equivalence        | override kept                               |
 * | AS3  | draft with the tool active / pending / tool off / empty  | Equivalence/Bound. | kept / cleared / cleared / cleared          |
 * | AS4  | selection adopted from the scene                         | Equivalence        | selectedId mirrored                         |
 * | AT1  | activeTool with / without a tool                         | Equivalence        | tool / ''                                   |
 * | CT1  | connectTradingToUi: initial push, updates, unsubscribe   | Equivalence        | mirrored until unsubscribed                 |
 * | CR1  | createTradingUiState / createTradingHitMap               | Boundary (empty)   | idle state / version −1                     |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import {
  activeTool,
  applyTradingScene,
  connectTradingToUi,
  createTradingHitMap,
  createTradingUiState,
  DRAG_DRAWING,
  DRAG_LINE,
  DRAG_NONE,
} from '../TradingState';
import { makeTradingEngine } from './tradingTestUtils';

let env: ReturnType<typeof makeTradingEngine>;

function flush() {
  act(() => {
    jest.advanceTimersByTime(20);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  env = makeTradingEngine();
});

describe('applyTradingScene', () => {
  it('AS1: a released drag ends with the next scene', () => {
    // Given
    env.state.tradingUi.value = {
      ...createTradingUiState(),
      dragKind: DRAG_LINE,
      dragKey: 'order:o',
      dragPrice: 5,
      dragPending: true,
    };
    // When
    env.sync();
    // Then
    expect(env.state.tradingUi.value).toMatchObject({
      dragKind: DRAG_NONE,
      dragKey: '',
      dragPending: false,
    });
    expect(env.state.tradingUi.value.dragPrice).toBeNaN();
  });

  it('AS2: an active drag survives unrelated scenes', () => {
    // Given
    env.state.tradingUi.value = {
      ...createTradingUiState(),
      dragKind: DRAG_DRAWING,
      dragKey: 'd',
      dragAnchors: [1, 2],
    };
    // When
    env.overlays.addPriceLine({ price: 5 });
    env.sync();
    // Then
    expect(env.state.tradingUi.value).toMatchObject({
      dragKind: DRAG_DRAWING,
      dragKey: 'd',
      dragAnchors: [1, 2],
    });
  });

  it.each([
    ['trendLine', false, [1, 2], [1, 2]],
    ['trendLine', true, [1, 2], []],
    [null, false, [1, 2], []],
    ['trendLine', false, [], []],
  ] as const)(
    'AS3: tool %p pending %p draft %p → %p',
    (tool, pending, draft, expected) => {
      // Given
      env.overlays.drawings.setTool(tool);
      env.state.tradingUi.value = {
        ...createTradingUiState(),
        draftAnchors: [...draft],
        draftPending: pending,
      };
      // When
      env.sync();
      // Then
      expect(env.state.tradingUi.value.draftAnchors).toEqual(expected);
      expect(env.state.tradingUi.value.draftPending).toBe(false);
    }
  );

  it('AS4 / AT1: selection and tool are mirrored', () => {
    // Given
    const id = env.overlays.drawings.add({
      type: 'horizontalLine',
      anchors: [{ time: 1, price: 1 }],
    });
    env.overlays.drawings.select(id);
    // When
    env.sync();
    // Then
    expect(env.state.tradingUi.value.selectedId).toBe(id);
    expect(activeTool(env.state)).toBe('');
    // When
    env.overlays.drawings.setTool('horizontalRay');
    env.sync();
    // Then
    expect(activeTool(env.state)).toBe('horizontalRay');
    expect(env.state.tradingUi.value.selectedId).toBe('');
  });
});

describe('connectTradingToUi', () => {
  it('CT1: mirrors scenes until unsubscribed', () => {
    // Given
    env.overlays.addPriceLine({ id: 'a', price: 1 });
    // When
    const off = connectTradingToUi(env.overlays, env.state);
    flush();
    // Then: initial push
    expect(env.state.tradingScene.value.lines).toHaveLength(1);
    // When
    env.overlays.addPriceLine({ id: 'b', price: 2 });
    flush();
    // Then
    expect(env.state.tradingScene.value.lines).toHaveLength(2);
    // When
    off();
    env.overlays.addPriceLine({ id: 'c', price: 3 });
    flush();
    // Then
    expect(env.state.tradingScene.value.lines).toHaveLength(2);
  });

  it('CR1: initial states', () => {
    // Given / When / Then
    expect(createTradingUiState()).toMatchObject({
      dragKind: DRAG_NONE,
      selectedId: '',
      draftAnchors: [],
    });
    expect(createTradingHitMap()).toEqual({ version: -1, count: 0, lines: [] });
  });
});
