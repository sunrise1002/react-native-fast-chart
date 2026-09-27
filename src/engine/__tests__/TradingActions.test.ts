/**
 * Test perspective table — TradingActions (overlay gesture worklets)
 * Fixture: 10 bars, x(i) = 305 + 10 i, y(price) = 300 − price.
 *
 * | Case | Input / Precondition                                     | Perspective         | Expected                                   |
 * |------|----------------------------------------------------------|---------------------|--------------------------------------------|
 * | BD1  | touch on a draggable order's label box                   | Equivalence         | DRAG_LINE with key / target / start price  |
 * | BD2  | touch in the axis grab zone of the topmost line          | Equivalence         | topmost line wins                          |
 * | BD3  | non-draggable line / stale hit map / vertical miss       | Invalid / Boundary  | no line grab                               |
 * | BD4  | selected drawing body / anchor                           | Equivalence         | DRAG_DRAWING part BODY / 0                 |
 * | BD5  | unselected or locked drawing / miss                      | Invalid             | DRAG_NONE                                  |
 * | BD6  | drawing tool active / y below the plot / NaN y           | Boundary / Invalid  | DRAG_NONE                                  |
 * | BD7  | no data (drawing cannot be projected)                    | Boundary (empty)    | DRAG_NONE                                  |
 * | UD1  | line drag 10 dp up, tick 0.5                             | Equivalence         | +10 snapped; override written              |
 * | UD2  | line drag NaN y                                          | Invalid             | NaN, override untouched                    |
 * | UD3  | drawing body drag (+2 bars, +10) / anchor drag           | Equivalence         | shifted / one anchor moved                 |
 * | UD4  | drawing drag NaN x / DRAG_NONE start                     | Invalid             | override untouched / NaN                   |
 * | ED1  | release after a move                                     | Equivalence         | true, override kept pending                |
 * | ED2  | release without a move / nothing grabbed                 | Boundary            | false, override cleared                    |
 * | TP1  | draft taps: first anchor, second completes               | Equivalence         | snapped anchors, complete + pending        |
 * | TP2  | tap while the draft is pending / NaN position            | Invalid             | no anchor added                            |
 * | TP3  | selection tap on a drawing / same again / empty area     | Equivalence         | selected, changed flags, cleared           |
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { MIN, T0 } from '../../data/__tests__/bars';
import { HIT_BODY } from '../../trading/HitTest';
import {
  beginOverlayDrag,
  endOverlayDrag,
  noDragStart,
  tapOverlays,
  updateOverlayDrag,
} from '../TradingActions';
import { DRAG_DRAWING, DRAG_LINE, DRAG_NONE } from '../TradingState';
import { makeTradingEngine, setHits } from './tradingTestUtils';

let env: ReturnType<typeof makeTradingEngine>;

beforeEach(() => {
  env = makeTradingEngine();
});

function withOrders(): void {
  env.overlays.setOrders([
    { id: 'o1', side: 'buy', price: 105, quantity: 1, draggable: true },
    { id: 'o2', side: 'sell', price: 106, quantity: 1, draggable: true },
    { id: 'o3', side: 'sell', price: 150, quantity: 1 },
  ]);
  env.sync();
  setHits(env.state, [
    [195, 10, 80],
    [194, 10, 80],
    [150, 10, 80],
  ]);
}

function withDrawing(locked = false, select = true): string {
  const id = env.overlays.drawings.add({
    type: 'trendLine',
    anchors: [
      { time: T0 + 2 * MIN, price: 100 },
      { time: T0 + 6 * MIN, price: 110 },
    ],
    locked,
  });
  if (select) {
    env.overlays.drawings.select(id);
  }
  env.sync();
  return id;
}

describe('beginOverlayDrag', () => {
  it('BD1: grabs a draggable order by its label box', () => {
    // Given
    withOrders();
    // When: on o1's box, below o2's slop
    const start = beginOverlayDrag(env.state, 40, 204, 9);
    // Then
    expect(start).toMatchObject({
      kind: DRAG_LINE,
      key: 'order:o1',
      target: 'order',
      id: 'o1',
      startPrice: 105,
      startY: 204,
    });
  });

  it('BD2: the topmost line wins in the axis grab zone', () => {
    // Given
    withOrders();
    // When
    const start = beginOverlayDrag(env.state, 420, 195, 8);
    // Then
    expect(start.key).toBe('order:o2');
  });

  it('BD3: non-draggable, stale or missed lines are skipped', () => {
    // Given
    withOrders();
    // When / Then: o3 is not draggable
    expect(beginOverlayDrag(env.state, 40, 150, 8).kind).toBe(DRAG_NONE);
    // When / Then: vertical miss
    expect(beginOverlayDrag(env.state, 40, 220, 8).kind).toBe(DRAG_NONE);
    // When / Then: the hit map belongs to an older scene
    env.state.tradingHits.value = {
      ...env.state.tradingHits.value,
      version: -1,
    };
    expect(beginOverlayDrag(env.state, 40, 195, 8).kind).toBe(DRAG_NONE);
  });

  it('BD4: grabs the selected drawing (anchor first)', () => {
    // Given: anchors at (325, 200) and (365, 190)
    const id = withDrawing();
    // When
    const body = beginOverlayDrag(env.state, 345, 195, 8);
    const anchor = beginOverlayDrag(env.state, 326, 201, 8);
    // Then
    expect(body).toMatchObject({
      kind: DRAG_DRAWING,
      key: id,
      part: HIT_BODY,
    });
    expect(body.startAnchors).toEqual([T0 + 2 * MIN, 100, T0 + 6 * MIN, 110]);
    expect(anchor.part).toBe(0);
  });

  it.each([
    [false, false, 345, 195],
    [true, true, 345, 195],
    [false, true, 345, 100],
  ])(
    'BD5: locked %p / selected %p at (%p, %p) → none',
    (locked, select, x, y) => {
      // Given
      withDrawing(locked, select);
      // When / Then
      expect(beginOverlayDrag(env.state, x, y, 8).kind).toBe(DRAG_NONE);
    }
  );

  it.each([
    ['tool', 345, 195],
    ['below', 345, 301],
    ['nan', 345, NaN],
  ])('BD6: %s → none', (mode, x, y) => {
    // Given
    withDrawing();
    if (mode === 'tool') {
      env.overlays.drawings.setTool('rectangle');
      env.sync();
    }
    // When / Then
    expect(beginOverlayDrag(env.state, x, y, 8).kind).toBe(DRAG_NONE);
  });

  it('BD7: without data nothing can be grabbed', () => {
    // Given
    env = makeTradingEngine(0);
    withDrawing();
    // When / Then
    expect(beginOverlayDrag(env.state, 345, 195, 8).kind).toBe(DRAG_NONE);
  });
});

describe('updateOverlayDrag / endOverlayDrag', () => {
  it('UD1 / ED1: a line drag snaps and stays pending on release', () => {
    // Given
    withOrders();
    const start = beginOverlayDrag(env.state, 40, 197, 2);
    // When: 10.2 dp up
    const price = updateOverlayDrag(env.state, start, 40, 186.8, 0.5);
    // Then
    expect(price).toBe(115);
    expect(env.state.tradingUi.value).toMatchObject({
      dragKind: DRAG_LINE,
      dragKey: 'order:o1',
      dragPrice: 115,
      dragPending: false,
    });
    // When
    const moved = endOverlayDrag(env.state, start);
    // Then
    expect(moved).toBe(true);
    expect(env.state.tradingUi.value.dragPending).toBe(true);
  });

  it('UD2: a NaN finger position is ignored', () => {
    // Given
    withOrders();
    const start = beginOverlayDrag(env.state, 40, 197, 8);
    // When
    const price = updateOverlayDrag(env.state, start, 40, NaN, 0.5);
    // Then
    expect(price).toBeNaN();
    expect(env.state.tradingUi.value.dragKind).toBe(DRAG_NONE);
  });

  it('UD3: drawing body and anchor drags', () => {
    // Given
    withDrawing();
    const body = beginOverlayDrag(env.state, 345, 195, 8);
    // When: +2 bars, +10 price
    updateOverlayDrag(env.state, body, 365, 185, 0.5);
    // Then
    expect(env.state.tradingUi.value.dragAnchors).toEqual([
      T0 + 4 * MIN,
      110,
      T0 + 8 * MIN,
      120,
    ]);
    // When: anchor 1 to bar 8, price 150
    const anchor = beginOverlayDrag(env.state, 365, 190, 8);
    updateOverlayDrag(env.state, anchor, 385, 150, 0.5);
    // Then
    expect(env.state.tradingUi.value.dragAnchors).toEqual([
      T0 + 2 * MIN,
      100,
      T0 + 8 * MIN,
      150,
    ]);
  });

  it('UD4: invalid drawing drags and empty starts', () => {
    // Given
    withDrawing();
    const body = beginOverlayDrag(env.state, 345, 195, 8);
    // When
    const result = updateOverlayDrag(env.state, body, NaN, 185, 0.5);
    // Then
    expect(result).toBeNaN();
    expect(env.state.tradingUi.value.dragKind).toBe(DRAG_NONE);
    expect(updateOverlayDrag(env.state, noDragStart(), 1, 1, 0.5)).toBeNaN();
  });

  it('ED2: releases without a move clear the override', () => {
    // Given
    withOrders();
    const start = beginOverlayDrag(env.state, 40, 197, 8);
    // When / Then
    expect(endOverlayDrag(env.state, start)).toBe(false);
    expect(endOverlayDrag(env.state, noDragStart())).toBe(false);
    expect(env.state.tradingUi.value).toMatchObject({
      dragKind: DRAG_NONE,
      dragKey: '',
      dragPending: false,
    });
  });
});

describe('tapOverlays', () => {
  it('TP1: draft taps place snapped anchors', () => {
    // Given
    env.overlays.drawings.setTool('trendLine');
    env.sync();
    // When
    const first = tapOverlays(env.state, 327, 199.8, 8, 0.5);
    const second = tapOverlays(env.state, 394, 100, 8, 0.5);
    // Then
    expect(first).toMatchObject({ draft: true, complete: false });
    expect(first.anchors).toEqual([T0 + 2 * MIN, 100]);
    expect(second.complete).toBe(true);
    expect(second.anchors).toEqual([T0 + 2 * MIN, 100, T0 + 9 * MIN, 200]);
    expect(env.state.tradingUi.value.draftPending).toBe(true);
  });

  it.each([['pending'], ['nan']])('TP2: %s tap adds nothing', (mode) => {
    // Given
    env.overlays.drawings.setTool('horizontalLine');
    env.sync();
    if (mode === 'pending') {
      tapOverlays(env.state, 330, 100, 8, 0.5);
    }
    const before = env.state.tradingUi.value.draftAnchors;
    // When
    const result = tapOverlays(
      env.state,
      330,
      mode === 'nan' ? NaN : 90,
      8,
      0.5
    );
    // Then
    expect(result).toMatchObject({ draft: true, complete: false, anchors: [] });
    expect(env.state.tradingUi.value.draftAnchors).toBe(before);
  });

  it('TP3: selection taps', () => {
    // Given
    const id = withDrawing(false, false);
    // When / Then: select
    const hit = tapOverlays(env.state, 345, 195, 8, 0.5);
    expect(hit).toMatchObject({ selectedId: id, selectionChanged: true });
    expect(env.state.tradingUi.value.selectedId).toBe(id);
    // When / Then: same drawing again
    expect(tapOverlays(env.state, 345, 195, 8, 0.5).selectionChanged).toBe(
      false
    );
    // When / Then: empty area clears
    expect(tapOverlays(env.state, 100, 20, 8, 0.5)).toMatchObject({
      selectedId: '',
      selectionChanged: true,
    });
  });
});
