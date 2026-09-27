/**
 * Test perspective table — OverlayValidation
 *
 * | Case | Input / Precondition                                        | Perspective         | Expected                              |
 * |------|-------------------------------------------------------------|---------------------|---------------------------------------|
 * | RP1  | resolvePriceLine minimal input                              | Equivalence         | defaults (dashed, axis label, …)      |
 * | RP2  | resolvePriceLine patch over a base                          | Equivalence         | base fields kept, patch applied       |
 * | RP3  | resolvePriceLine price NaN / ∞ / missing without base       | Invalid             | null                                  |
 * | RP4  | resolvePriceLine invalid field types                        | Invalid             | defaults used                         |
 * | VO1  | isValidOrder valid / quantity 0                             | Equivalence / Bound.| true                                  |
 * | VO2  | isValidOrder bad id / side / price / quantity / type / null | Invalid             | false                                 |
 * | VF1  | isValidFill valid / circle shape                            | Equivalence         | true                                  |
 * | VF2  | isValidFill bad time / shape / color / null                 | Invalid             | false                                 |
 * | NP1  | normalizePosition full input                                | Equivalence         | normalized copy                       |
 * | NP2  | normalizePosition invalid levels                            | Invalid (partial)   | levels null, position kept            |
 * | NP3  | normalizePosition bad side / size 0 / ∞ / entry NaN / id ''  | Invalid / Boundary  | null                                  |
 * | VA1  | isValidAnnotation each type valid                           | Equivalence         | true                                  |
 * | VA2  | isValidAnnotation bad type / id / coordinates / enums       | Invalid             | false                                 |
 * | FU1  | filterUnique drops invalid and duplicates, copies           | Equivalence         | first-wins items + dropped count      |
 * | FU2  | filterUnique null / not an array / empty                    | Boundary (empty)    | no items, 0 dropped                   |
 */
import { describe, expect, it } from '@jest/globals';
import {
  filterUnique,
  isValidAnnotation,
  isValidFill,
  isValidOrder,
  normalizePosition,
  resolvePriceLine,
} from '../OverlayValidation';
import type { PriceLineInput } from '../TradingTypes';

describe('resolvePriceLine', () => {
  it('RP1: defaults', () => {
    // Given / When / Then
    expect(resolvePriceLine('p', { price: 5 })).toEqual({
      id: 'p',
      price: 5,
      color: '',
      lineWidth: 1,
      lineStyle: 'dashed',
      label: '',
      axisLabel: true,
      draggable: false,
      visible: true,
    });
  });

  it('RP2: patch over a base', () => {
    // Given
    const base = resolvePriceLine('p', {
      price: 5,
      label: 'Alert',
      color: '#f00',
      draggable: true,
    });
    if (base === null) throw new Error('fixture');
    // When
    const next = resolvePriceLine(
      'p',
      { lineStyle: 'solid', visible: false },
      base
    );
    // Then
    expect(next).toEqual({
      ...base,
      lineStyle: 'solid',
      visible: false,
    });
  });

  it.each([[NaN], [Infinity], [undefined]])('RP3: price %p → null', (price) => {
    // Given / When / Then
    expect(resolvePriceLine('p', { price } as PriceLineInput)).toBeNull();
  });

  it('RP4: invalid field types fall back to defaults', () => {
    // Given
    const input = {
      price: 1,
      color: 3,
      lineWidth: -2,
      lineStyle: 'bold',
      label: 7,
      axisLabel: 'no',
      draggable: 1,
      visible: 'yes',
    } as unknown as PriceLineInput;
    // When
    const line = resolvePriceLine('p', input);
    // Then
    expect(line).toEqual(resolvePriceLine('p', { price: 1 }));
  });
});

const order = { id: 'o', side: 'buy', price: 10, quantity: 1 };
const fill = { id: 'f', side: 'sell', time: 1000, price: 10 };

describe('orders and fills', () => {
  it('VO1: valid orders', () => {
    // Given / When / Then
    expect(isValidOrder(order)).toBe(true);
    expect(isValidOrder({ ...order, quantity: 0, type: 'Stop' })).toBe(true);
  });

  it.each([
    [{ ...order, id: '' }],
    [{ ...order, side: 'long' }],
    [{ ...order, price: NaN }],
    [{ ...order, quantity: -1 }],
    [{ ...order, quantity: Infinity }],
    [{ ...order, quantity: '1' }],
    [{ ...order, type: 3 }],
    [{ ...order, color: 3 }],
    [null],
    ['order'],
  ])('VO2: invalid order %p', (value) => {
    // Given / When / Then
    expect(isValidOrder(value)).toBe(false);
  });

  it('VF1: valid fills', () => {
    // Given / When / Then
    expect(isValidFill(fill)).toBe(true);
    expect(isValidFill({ ...fill, shape: 'circle', color: '#fff' })).toBe(true);
  });

  it.each([
    [{ ...fill, time: NaN }],
    [{ ...fill, price: Infinity }],
    [{ ...fill, side: 'x' }],
    [{ ...fill, shape: 'star' }],
    [{ ...fill, color: 1 }],
    [{ ...fill, id: 5 }],
    [null],
  ])('VF2: invalid fill %p', (value) => {
    // Given / When / Then
    expect(isValidFill(value)).toBe(false);
  });
});

describe('normalizePosition', () => {
  it('NP1: normalizes a full position', () => {
    // Given
    const input = {
      id: 'pos',
      side: 'short',
      size: 2,
      entryPrice: 100,
      liquidationPrice: 150,
      takeProfit: 80,
      stopLoss: 110,
      multiplier: 10,
      tpSlDraggable: false,
      showPnlArea: false,
    };
    // When / Then
    expect(normalizePosition(input)).toEqual(input);
  });

  it('NP2: invalid levels are dropped', () => {
    // Given
    const input = {
      side: 'long',
      size: 1,
      entryPrice: 100,
      liquidationPrice: NaN,
      takeProfit: 'x',
      stopLoss: Infinity,
    };
    // When
    const p = normalizePosition(input);
    // Then
    expect(p).toEqual({
      side: 'long',
      size: 1,
      entryPrice: 100,
      liquidationPrice: null,
      takeProfit: null,
      stopLoss: null,
      tpSlDraggable: true,
      showPnlArea: true,
    });
  });

  it.each([
    [{ side: 'flat', size: 1, entryPrice: 1 }],
    [{ side: 'long', size: 0, entryPrice: 1 }],
    [{ side: 'long', size: Infinity, entryPrice: 1 }],
    [{ side: 'long', size: '1', entryPrice: 1 }],
    [{ side: 'long', size: 1, entryPrice: NaN }],
    [{ side: 'long', size: 1, entryPrice: 1, id: '' }],
    [null],
    [42],
  ])('NP3: invalid position %p → null', (value) => {
    // Given / When / Then
    expect(normalizePosition(value)).toBeNull();
  });
});

describe('isValidAnnotation', () => {
  it.each([
    [{ type: 'horizontalLine', id: 'a', price: 1, lineStyle: 'dotted' }],
    [{ type: 'verticalLine', id: 'a', time: 1, label: 'Open' }],
    [{ type: 'note', id: 'a', time: 1, price: 2, text: 'hi' }],
    [{ type: 'marker', id: 'a', time: 1 }],
    [{ type: 'marker', id: 'a', time: 1, position: 'price', price: 2 }],
    [{ type: 'marker', id: 'a', time: 1, shape: 'diamond', icon: 'N' }],
  ])('VA1: valid %p', (value) => {
    // Given / When / Then
    expect(isValidAnnotation(value)).toBe(true);
  });

  it.each([
    [{ type: 'arrow', id: 'a' }],
    [{ type: 'note', id: '', time: 1, price: 1, text: '' }],
    [{ type: 'note', id: 'a', time: 1, price: 1, text: 5 }],
    [{ type: 'horizontalLine', id: 'a', price: NaN }],
    [{ type: 'horizontalLine', id: 'a', price: 1, lineStyle: 'bold' }],
    [{ type: 'verticalLine', id: 'a', time: Infinity }],
    [{ type: 'verticalLine', id: 'a', time: 1, color: 3 }],
    [{ type: 'marker', id: 'a', time: 1, position: 'left' }],
    [{ type: 'marker', id: 'a', time: 1, position: 'price' }],
    [{ type: 'marker', id: 'a', time: 1, shape: 'star' }],
    [{ type: 'marker', id: 'a', time: 1, text: 1 }],
    [null],
  ])('VA2: invalid %p', (value) => {
    // Given / When / Then
    expect(isValidAnnotation(value)).toBe(false);
  });
});

describe('filterUnique', () => {
  it('FU1: first valid entry per id wins; items are copies', () => {
    // Given
    const list = [
      order,
      { ...order, price: 11 },
      { id: 'bad' },
      { ...order, id: 'o2' },
    ];
    // When
    const { items, dropped } = filterUnique(list, isValidOrder);
    // Then
    expect(items.map((o) => [o.id, o.price])).toEqual([
      ['o', 10],
      ['o2', 10],
    ]);
    expect(items[0]).not.toBe(order);
    expect(dropped).toBe(2);
  });

  it.each([[null], [undefined], [{}], [[]]])('FU2: %p → empty', (list) => {
    // Given / When
    const result = filterUnique(list as unknown[], isValidOrder);
    // Then
    expect(result).toEqual({ items: [], dropped: 0 });
  });
});
