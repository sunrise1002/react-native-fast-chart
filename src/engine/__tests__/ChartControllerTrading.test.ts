/**
 * Test perspective table — TradingChartController trading API (spec 22)
 *
 * | Case | Input / Precondition                                    | Perspective        | Expected                                        |
 * |------|---------------------------------------------------------|--------------------|-------------------------------------------------|
 * | CT1  | price line add / update / remove / get                  | Equivalence        | delegated; update / remove unknown → false      |
 * | CT2  | orders / fills / position / annotations set + get       | Equivalence        | accepted counts, copies                         |
 * | CT3  | invalid inputs (NaN price, bad side)                    | Invalid            | RangeError with message / 0 / false             |
 * | CT4  | clearOverlays                                           | Equivalence        | overlays empty, drawings kept                   |
 * | CT5  | drawing tool set / get / null / unknown                 | Equiv. / invalid   | null when none; unknown → false                 |
 * | CT6  | drawings add / update / select / remove / setDrawings   | Equivalence        | delegated, subscribe notified                   |
 * | CT7  | invalid drawing / select unknown                        | Invalid            | Error with message / false                      |
 * | CT8  | subscribeOverlayDrag + commit, unsubscribe              | Equivalence        | event received once; none after unsubscribe     |
 * | CT9  | getSettings includes drawings; applySettings restores   | Equivalence        | same drawings on a new controller               |
 * | CT10 | applySettings without drawings                          | Boundary (NULL)    | drawings left untouched                         |
 * | CT11 | configure volumePrecision 3 / none                      | Equivalence        | order labels with 3 decimals / as-is            |
 * | CT12 | dispose                                                 | Equivalence        | listeners released                              |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resolveChartConfig } from '../../core/ChartConfig';
import { generateCandles } from '../../testing/fixtures/generateCandles';
import {
  asInternals,
  createTradingChartController,
} from '../createTradingChartController';

beforeEach(() => {
  jest.useFakeTimers();
});

const BARS = generateCandles({ count: 50, seed: 3 });
const T = BARS[10]?.time as number;

function chart() {
  const handle = asInternals(createTradingChartController());
  handle.setData(BARS);
  return handle;
}

describe('overlays', () => {
  it('CT1: price line lifecycle', () => {
    // Given
    const c = chart();
    // When
    const id = c.addPriceLine({ price: 100, label: 'Alert' });
    // Then
    expect(id).not.toBe('');
    expect(c.updatePriceLine(id, { price: 101 })).toBe(true);
    expect(c.getPriceLines()[0]?.price).toBe(101);
    expect(c.updatePriceLine('nope', { price: 1 })).toBe(false);
    expect(c.removePriceLine(id)).toBe(true);
    expect(c.removePriceLine(id)).toBe(false);
    expect(c.getPriceLines()).toEqual([]);
  });

  it('CT2: orders, fills, position, annotations', () => {
    // Given
    const c = chart();
    // When
    const orders = c.setOrders([
      { id: 'o', side: 'buy', price: 90, quantity: 1 },
    ]);
    const fills = c.setFills([{ id: 'f', side: 'sell', price: 95, time: T }]);
    const position = c.setPosition({ side: 'long', size: 1, entryPrice: 92 });
    const notes = c.setAnnotations([
      { id: 'a', type: 'note', time: T, price: 93, text: 'hi' },
    ]);
    // Then
    expect([orders, fills, position, notes]).toEqual([1, 1, true, 1]);
    expect(c.getOrders()[0]?.id).toBe('o');
    expect(c.getFills()[0]?.id).toBe('f');
    expect(c.getPosition()?.entryPrice).toBe(92);
    expect(c.getAnnotations()[0]?.id).toBe('a');
  });

  it('CT3: invalid inputs are rejected', () => {
    // Given
    const c = chart();
    // When / Then
    expect(() => c.addPriceLine({ id: 'p', price: NaN })).toThrow(
      new RangeError('Price line "p" needs a finite price')
    );
    expect(
      c.setOrders([{ id: 'o', side: 'hold' as 'buy', price: 1, quantity: 1 }])
    ).toBe(0);
    expect(c.setPosition({ side: 'long', size: 1, entryPrice: Infinity })).toBe(
      false
    );
    expect(c.getPosition()).toBeNull();
  });

  it('CT4: clearOverlays keeps drawings', () => {
    // Given
    const c = chart();
    c.addPriceLine({ price: 1 });
    c.setPosition({ side: 'short', size: 2, entryPrice: 5 });
    c.addDrawing({ type: 'horizontalLine', anchors: [{ time: T, price: 1 }] });
    // When
    c.clearOverlays();
    // Then
    expect(c.getPriceLines()).toEqual([]);
    expect(c.getPosition()).toBeNull();
    expect(c.getDrawings()).toHaveLength(1);
  });
});

describe('drawings', () => {
  it('CT5: drawing tool', () => {
    // Given
    const c = chart();
    // Then
    expect(c.getDrawingTool()).toBeNull();
    // When / Then
    expect(c.setDrawingTool('rectangle')).toBe(true);
    expect(c.getDrawingTool()).toBe('rectangle');
    expect(c.setDrawingTool('circle' as 'rectangle')).toBe(false);
    expect(c.getDrawingTool()).toBe('rectangle');
    expect(c.setDrawingTool(null)).toBe(true);
    expect(c.getDrawingTool()).toBeNull();
  });

  it('CT6: drawing lifecycle notifies subscribers', () => {
    // Given
    const c = chart();
    const listener = jest.fn();
    const off = c.subscribeDrawings(listener);
    // When
    const id = c.addDrawing({
      type: 'trendLine',
      anchors: [
        { time: T, price: 1 },
        { time: T + 60_000, price: 2 },
      ],
    });
    // Then
    expect(listener).toHaveBeenCalled();
    expect(c.selectDrawing(id)).toBe(true);
    expect(c.getSelectedDrawingId()).toBe(id);
    expect(c.updateDrawing(id, { locked: true })).toBe(true);
    expect(c.getDrawings()[0]?.locked).toBe(true);
    expect(c.removeDrawing(id)).toBe(true);
    expect(c.getSelectedDrawingId()).toBeNull();
    expect(
      c.setDrawings([
        { type: 'horizontalLine', anchors: [{ time: T, price: 1 }] },
        { type: 'horizontalRay', anchors: [{ time: T, price: 2 }] },
      ])
    ).toBe(2);
    off();
    listener.mockClear();
    c.setDrawings([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('CT7: invalid drawings and selections', () => {
    // Given
    const c = chart();
    // When / Then
    expect(() =>
      c.addDrawing({
        id: 'd',
        type: 'trendLine',
        anchors: [{ time: T, price: 1 }],
      })
    ).toThrow(new Error('Invalid drawing "d" (type or anchors)'));
    expect(c.selectDrawing('missing')).toBe(false);
    expect(c.updateDrawing('missing', { locked: true })).toBe(false);
    expect(c.removeDrawing('missing')).toBe(false);
  });
});

describe('integration', () => {
  it('CT8: overlay drag listeners', () => {
    // Given
    const c = chart();
    const id = c.addPriceLine({ price: 10, draggable: true });
    const listener = jest.fn();
    const off = c.subscribeOverlayDrag(listener);
    // When
    c.trading.handleLineDrag('priceLine', id, 12, 'commit');
    // Then
    expect(listener).toHaveBeenCalledWith({
      phase: 'commit',
      target: 'priceLine',
      id,
      price: 12,
    });
    expect(c.getPriceLines()[0]?.price).toBe(12);
    // When
    off();
    c.trading.handleLineDrag('priceLine', id, 13, 'change');
    // Then
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('CT9: settings round trip with drawings', () => {
    // Given
    const a = chart();
    a.addDrawing({
      id: 'fib',
      type: 'fibRetracement',
      anchors: [
        { time: T, price: 1 },
        { time: T + 60_000, price: 2 },
      ],
      style: { color: '#ff0000' },
    });
    // When
    const settings = a.getSettings();
    const b = chart();
    b.applySettings(settings);
    // Then
    expect(settings.drawings).toHaveLength(1);
    expect(b.getDrawings()).toEqual(a.getDrawings());
  });

  it('CT10: settings without drawings leave drawings as-is', () => {
    // Given
    const c = chart();
    c.addDrawing({ type: 'horizontalLine', anchors: [{ time: T, price: 1 }] });
    const settings = c.getSettings();
    delete settings.drawings;
    // When
    c.applySettings(settings);
    // Then
    expect(c.getDrawings()).toHaveLength(1);
  });

  it('CT11: configure sets the order quantity decimals', () => {
    // Given
    const c = chart();
    c.setOrders([{ id: 'o', side: 'buy', price: 90, quantity: 1.5 }]);
    // When
    c.configure(resolveChartConfig({ symbol: { volumePrecision: 3 } }));
    // Then
    expect(c.trading.getScene().lines[0]?.label).toBe('Limit Buy 1.500');
    // When
    c.configure(resolveChartConfig({}));
    // Then
    expect(c.trading.getScene().lines[0]?.label).toBe('Limit Buy 1.5');
  });

  it('CT12: dispose releases listeners', () => {
    // Given
    const c = chart();
    const drag = jest.fn();
    const drawings = jest.fn();
    c.subscribeOverlayDrag(drag);
    c.subscribeDrawings(drawings);
    // When
    c.dispose();
    c.trading.handleLineDrag('priceLine', 'x', 1, 'change');
    // Then
    expect(drag).not.toHaveBeenCalled();
  });
});
