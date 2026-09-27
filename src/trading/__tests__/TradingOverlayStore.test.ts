/**
 * Test perspective table — TradingOverlayStore
 *
 * | Case | Input / Precondition                                        | Perspective        | Expected                                        |
 * |------|-------------------------------------------------------------|--------------------|-------------------------------------------------|
 * | TS1  | addPriceLine generated / explicit id                        | Equivalence        | ids, scene recompiled, version bumped           |
 * | TS2  | addPriceLine duplicate / empty id                           | Invalid            | Error with message                              |
 * | TS3  | addPriceLine NaN / ∞ price                                  | Invalid            | RangeError "needs a finite price"               |
 * | TS4  | updatePriceLine valid / unknown / NaN price                 | Equiv. / Invalid   | true / false / false                            |
 * | TS5  | removePriceLine known / unknown                             | Equiv. / Invalid   | true / false                                    |
 * | TS6  | setOrders / setFills / setAnnotations with invalid entries  | Equivalence        | accepted counts; getters return copies          |
 * | TS7  | setPosition valid / null / invalid                          | Equiv. / Invalid   | true / cleared / false with no change           |
 * | TS8  | configure decimals 3 / same / −1 / ∞                        | Equiv. / Invalid   | recompiles only on change; labels use decimals  |
 * | TS9  | handleLineDrag change                                       | Equivalence        | event emitted, store unchanged                  |
 * | TS10 | handleLineDrag commit on price line / order / TP / SL       | Equivalence        | price written, scene recompiled, event          |
 * | TS11 | commit for an unknown line / no position                    | Invalid            | scene still recompiled (clears UI override)     |
 * | TS12 | handleLineDrag NaN price                                    | Invalid            | ignored, no event                               |
 * | TS13 | drag listener throws                                        | Abnormal (host)    | error propagates, store already updated         |
 * | TS14 | createDrawingFromDraft valid / keepTool / invalid           | Equiv. / Invalid   | id / tool kept / '' + recompile                 |
 * | TS15 | moveDrawing valid / unknown id                              | Equiv. / Invalid   | true / false + recompile                        |
 * | TS16 | subscribeDrawings on drawing changes; unsubscribe           | Equivalence        | notified; silent after unsubscribe              |
 * | TS17 | clearOverlays keeps drawings; dispose drops listeners       | Equivalence        | overlays empty; no more notifications           |
 * | TS18 | update 1 of 2 lines / orders; TP commit without a position  | Boundary (NULL)    | others kept; event only, no position            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { OverlayScene } from '../OverlayScene';
import { TradingOverlayStore } from '../TradingOverlayStore';
import type { OverlayDragEvent, PositionInput } from '../TradingTypes';

let store: TradingOverlayStore;
let scenes: OverlayScene[];

beforeEach(() => {
  store = new TradingOverlayStore();
  scenes = [];
  store.subscribeScene((s) => scenes.push(s));
});

const position: PositionInput = {
  side: 'long',
  size: 1,
  entryPrice: 100,
  takeProfit: 120,
  stopLoss: 90,
};

describe('price lines', () => {
  it('TS1: adds lines and recompiles', () => {
    // Given / When
    const a = store.addPriceLine({ price: 10 });
    const b = store.addPriceLine({ id: 'alert', price: 11 });
    // Then
    expect([a, b]).toEqual(['price-line-1', 'alert']);
    expect(store.getScene().lines.map((l) => l.id)).toEqual([a, b]);
    expect(scenes.map((s) => s.version)).toEqual([1, 2]);
  });

  it('TS1: generated ids skip taken ones', () => {
    // Given
    store.addPriceLine({ id: 'price-line-1', price: 1 });
    // When / Then
    expect(store.addPriceLine({ price: 2 })).toBe('price-line-2');
  });

  it('TS2: duplicate / empty ids throw', () => {
    // Given
    store.addPriceLine({ id: 'a', price: 1 });
    // When / Then
    expect(() => store.addPriceLine({ id: 'a', price: 2 })).toThrow(
      new Error('Duplicate price line id "a"')
    );
    expect(() => store.addPriceLine({ id: '', price: 2 })).toThrow(
      new Error('Invalid price line id')
    );
  });

  it.each([[NaN], [Infinity]])('TS3: price %p throws RangeError', (price) => {
    // Given / When / Then
    expect(() => store.addPriceLine({ id: 'a', price })).toThrow(RangeError);
    expect(() => store.addPriceLine({ id: 'a', price })).toThrow(
      'Price line "a" needs a finite price'
    );
    expect(scenes).toHaveLength(0);
  });

  it('TS4: updates', () => {
    // Given
    const id = store.addPriceLine({ price: 1 });
    // When / Then
    expect(store.updatePriceLine(id, { price: 2, label: 'x' })).toBe(true);
    expect(store.getPriceLines()[0]).toMatchObject({ price: 2, label: 'x' });
    expect(store.updatePriceLine('nope', { price: 2 })).toBe(false);
    expect(store.updatePriceLine(id, { price: NaN })).toBe(false);
  });

  it('TS5: removes', () => {
    // Given
    const id = store.addPriceLine({ price: 1 });
    // When / Then
    expect(store.removePriceLine(id)).toBe(true);
    expect(store.removePriceLine(id)).toBe(false);
    expect(store.getScene().lines).toHaveLength(0);
  });
});

describe('orders / fills / position / annotations', () => {
  it('TS6: list setters count accepted entries; getters copy', () => {
    // Given / When
    const orders = store.setOrders([
      { id: 'o', side: 'buy', price: 1, quantity: 1 },
      { id: 'o', side: 'buy', price: 2, quantity: 1 },
    ]);
    const fills = store.setFills([
      { id: 'f', side: 'sell', time: 1, price: 1 },
      { id: 'g', side: 'sell', time: NaN, price: 1 },
    ]);
    const annotations = store.setAnnotations([
      { type: 'note', id: 'n', time: 1, price: 1, text: 'hi' },
    ]);
    // Then
    expect([orders, fills, annotations]).toEqual([1, 1, 1]);
    const got = store.getOrders();
    (got[0] as { price: number }).price = 99;
    expect(store.getOrders()[0]?.price).toBe(1);
    expect(store.getFills()).toHaveLength(1);
    expect(store.getAnnotations()).toHaveLength(1);
  });

  it('TS7: position set / clear / invalid', () => {
    // Given / When / Then
    expect(store.setPosition(position)).toBe(true);
    expect(store.getPosition()?.takeProfit).toBe(120);
    expect(store.getScene().position?.entry).toBe(100);
    const before = scenes.length;
    expect(store.setPosition({ ...position, size: 0 })).toBe(false);
    expect(scenes).toHaveLength(before);
    expect(store.setPosition(null)).toBe(true);
    expect(store.getPosition()).toBeNull();
  });

  it('TS8: configure recompiles only on a change', () => {
    // Given
    store.setOrders([{ id: 'o', side: 'buy', price: 1, quantity: 0.5 }]);
    scenes.length = 0;
    // When
    store.configure(3, false);
    store.configure(3, true);
    // Then
    expect(scenes).toHaveLength(1);
    expect(store.getScene().lines[0]?.label).toBe('Limit Buy 0.500');
    // When: invalid decimals → as-is
    store.configure(-1, false);
    store.configure(Infinity, false);
    // Then
    expect(scenes).toHaveLength(2);
    expect(store.getScene().lines[0]?.label).toBe('Limit Buy 0.5');
  });
});

describe('line drags', () => {
  let events: OverlayDragEvent[];
  beforeEach(() => {
    events = [];
    store.subscribeDrag((e) => events.push(e));
  });

  it('TS9: change events do not touch the store', () => {
    // Given
    store.setPosition(position);
    scenes.length = 0;
    // When
    store.handleLineDrag('takeProfit', 'position', 125, 'change');
    // Then
    expect(events).toEqual([
      { phase: 'change', target: 'takeProfit', id: 'position', price: 125 },
    ]);
    expect(scenes).toHaveLength(0);
    expect(store.getPosition()?.takeProfit).toBe(120);
  });

  it('TS10: commits write the price', () => {
    // Given
    const line = store.addPriceLine({ price: 1, draggable: true });
    store.setOrders([{ id: 'o', side: 'buy', price: 5, quantity: 1 }]);
    store.setPosition(position);
    // When
    store.handleLineDrag('priceLine', line, 2, 'commit');
    store.handleLineDrag('order', 'o', 6, 'commit');
    store.handleLineDrag('takeProfit', 'position', 130, 'commit');
    store.handleLineDrag('stopLoss', 'position', 95, 'commit');
    // Then
    expect(store.getPriceLines()[0]?.price).toBe(2);
    expect(store.getOrders()[0]?.price).toBe(6);
    expect(store.getPosition()).toMatchObject({
      takeProfit: 130,
      stopLoss: 95,
    });
    expect(events.map((e) => e.phase)).toEqual([
      'commit',
      'commit',
      'commit',
      'commit',
    ]);
  });

  it('TS11: commits of unknown targets still recompile', () => {
    // Given
    scenes.length = 0;
    // When
    store.handleLineDrag('priceLine', 'ghost', 2, 'commit');
    store.handleLineDrag('takeProfit', 'position', 2, 'commit');
    // Then
    expect(scenes).toHaveLength(2);
    expect(events).toHaveLength(2);
  });

  it.each([[NaN], [Infinity]])('TS12: price %p is ignored', (price) => {
    // Given / When
    store.handleLineDrag('order', 'o', price, 'commit');
    // Then
    expect(events).toHaveLength(0);
  });

  it('TS13: a throwing listener leaves the store updated', () => {
    // Given
    store.setOrders([{ id: 'o', side: 'buy', price: 5, quantity: 1 }]);
    store.subscribeDrag(() => {
      throw new Error('host');
    });
    // When / Then
    expect(() => store.handleLineDrag('order', 'o', 7, 'commit')).toThrow(
      'host'
    );
    expect(store.getOrders()[0]?.price).toBe(7);
  });

  it('TS18: update among several lines, TP commit without a position', () => {
    // Given
    const a = store.addPriceLine({ price: 1 });
    store.addPriceLine({ id: 'b', price: 3 });
    store.setOrders([
      { id: 'o1', side: 'buy', price: 5, quantity: 1 },
      { id: 'o2', side: 'sell', price: 9, quantity: 1 },
    ]);
    // When
    store.updatePriceLine(a, { price: 2 });
    store.handleLineDrag('order', 'o2', 8, 'commit');
    store.handleLineDrag('takeProfit', 'position', 130, 'commit');
    // Then
    expect(store.getPriceLines().map((p) => p.price)).toEqual([2, 3]);
    expect(store.getOrders().map((o) => o.price)).toEqual([5, 8]);
    expect(store.getPosition()).toBeNull();
    expect(events).toHaveLength(2);
  });
});

describe('drawings', () => {
  it('TS14: drafts become drawings', () => {
    // Given
    store.drawings.setTool('trendLine');
    // When
    const id = store.createDrawingFromDraft('trendLine', [1, 1, 2, 2]);
    // Then
    expect(id).toBe('drawing-1');
    expect(store.getScene().selectedId).toBe(id);
    expect(store.getScene().tool).toBe('');
    // When: keepDrawingTool
    store.configure(NaN, true);
    store.drawings.setTool('horizontalLine');
    store.createDrawingFromDraft('horizontalLine', [1, 1]);
    // Then
    expect(store.getScene().tool).toBe('horizontalLine');
    // When: invalid draft
    const before = scenes.length;
    expect(store.createDrawingFromDraft('horizontalLine', [NaN, 1])).toBe('');
    // Then: recompiled (drops the UI draft)
    expect(scenes.length).toBe(before + 1);
  });

  it('TS15: moveDrawing', () => {
    // Given
    const id = store.drawings.add({
      type: 'horizontalRay',
      anchors: [{ time: 1, price: 1 }],
    });
    // When / Then
    expect(store.moveDrawing(id, [2, 3])).toBe(true);
    expect(store.getScene().drawings[0]?.anchors).toEqual([2, 3]);
    const before = scenes.length;
    expect(store.moveDrawing('nope', [2, 3])).toBe(false);
    expect(scenes.length).toBe(before + 1);
  });

  it('TS16: drawing subscribers', () => {
    // Given
    const listener = jest.fn();
    const off = store.subscribeDrawings(listener);
    // When
    store.drawings.setTool('rectangle');
    off();
    store.drawings.setTool(null);
    // Then
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('TS17: clearOverlays keeps drawings; dispose silences', () => {
    // Given
    store.addPriceLine({ price: 1 });
    store.setPosition(position);
    store.drawings.add({
      type: 'horizontalLine',
      anchors: [{ time: 1, price: 1 }],
    });
    // When
    store.clearOverlays();
    // Then
    expect(store.getScene().lines).toHaveLength(0);
    expect(store.getScene().position).toBeNull();
    expect(store.getScene().drawings).toHaveLength(1);
    // When
    store.dispose();
    const before = scenes.length;
    store.addPriceLine({ price: 2 });
    // Then
    expect(scenes).toHaveLength(before);
  });
});
