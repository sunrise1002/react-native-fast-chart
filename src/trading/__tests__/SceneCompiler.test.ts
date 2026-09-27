/**
 * Test perspective table — SceneCompiler / OverlayScene
 *
 * | Case | Input / Precondition                                         | Perspective        | Expected                                     |
 * |------|--------------------------------------------------------------|--------------------|----------------------------------------------|
 * | SC1  | empty sources                                                | Boundary (empty)   | empty scene, version / tool / selection kept |
 * | SC2  | visible + hidden price lines                                 | Equivalence        | hidden skipped; style fields copied          |
 * | SC3  | buy / sell orders, custom type / color, draggable            | Equivalence        | labels, theme colors, drag flags             |
 * | SC4  | long position with liq / TP / SL                             | Equivalence        | entry (live PnL), Liq., TP / SL (at line)    |
 * | SC5  | short position, no levels, tpSlDraggable false, bad mult.    | Equivalence/Inval. | only entry; sign −1; multiplier 1            |
 * | SC6  | fills (buy arrow, sell arrow, circle) out of time order      | Equivalence        | markers sorted by time with shapes           |
 * | SC7  | annotations of every type (defaults)                         | Equivalence        | line / vline / note / marker entries         |
 * | SC8  | drawings with theme / custom colors                          | Equivalence        | flattened anchors, palette entries           |
 * | SC9  | same color used twice                                        | Boundary (dedupe)  | one palette entry                            |
 * | FQ1  | formatQuantity decimals 3 / NaN / NaN quantity / ∞ decimals  | Equiv. / Invalid   | '0.500' / '0.5' / '' / as-is                  |
 * | OL1  | orderLabel empty type / zero quantity with NaN               | Boundary           | 'Limit Buy 0' / no quantity for NaN          |
 * | OS1  | isSceneEmpty with each collection non-empty                  | Equivalence        | false / true when all empty                  |
 * | OS2  | markerLowerBound before / between / after / empty            | Boundary           | 0 / index / length / 0                       |
 */
import { describe, expect, it } from '@jest/globals';
import {
  emptyOverlayScene,
  isSceneEmpty,
  markerLowerBound,
  PNL_AT_LINE,
  PNL_LIVE,
  PNL_NONE,
  type SceneMarker,
} from '../OverlayScene';
import {
  compileOverlayScene,
  formatQuantity,
  orderLabel,
  themeColor,
  type SceneSources,
} from '../SceneCompiler';
import { resolvePriceLine } from '../OverlayValidation';
import { createDrawing, type Drawing } from '../DrawingModel';
import type { PriceLine } from '../TradingTypes';

function sources(patch: Partial<SceneSources> = {}): SceneSources {
  return {
    priceLines: [],
    orders: [],
    fills: [],
    position: null,
    annotations: [],
    drawings: [],
    tool: '',
    selectedId: '',
    quantityDecimals: NaN,
    ...patch,
  };
}

const paletteOf = (scene: { palette: string[] }, index: number) =>
  scene.palette[index];

describe('compileOverlayScene', () => {
  it('SC1: empty sources', () => {
    // Given / When
    const scene = compileOverlayScene(
      sources({ tool: 'rectangle', selectedId: 'd1' }),
      7
    );
    // Then
    expect(scene).toEqual({
      ...emptyOverlayScene(),
      version: 7,
      tool: 'rectangle',
      selectedId: 'd1',
    });
    expect(isSceneEmpty(scene)).toBe(true);
  });

  it('SC2: hidden price lines are skipped', () => {
    // Given
    const shown = resolvePriceLine('a', {
      price: 10,
      label: 'Alert',
      lineStyle: 'dotted',
      lineWidth: 2,
      draggable: true,
      axisLabel: false,
    }) as PriceLine;
    const hidden = resolvePriceLine('b', { price: 11, visible: false });
    // When
    const scene = compileOverlayScene(
      sources({ priceLines: [shown, hidden as PriceLine] }),
      1
    );
    // Then
    expect(scene.lines).toHaveLength(1);
    expect(scene.lines[0]).toMatchObject({
      key: 'priceLine:a',
      price: 10,
      label: 'Alert',
      style: 'dotted',
      width: 2,
      draggable: true,
      axisLabel: false,
      pnl: PNL_NONE,
    });
    expect(paletteOf(scene, scene.lines[0]?.color ?? -1)).toBe('@priceLine');
  });

  it('SC3: orders become labelled lines', () => {
    // Given
    const orders = [
      { id: 'o1', side: 'buy' as const, price: 10, quantity: 0.5 },
      {
        id: 'o2',
        side: 'sell' as const,
        price: 12,
        quantity: 2,
        type: 'Stop',
        color: '#abc',
        draggable: true,
      },
    ];
    // When
    const scene = compileOverlayScene(
      sources({ orders, quantityDecimals: 3 }),
      1
    );
    // Then
    const [buy, sell] = scene.lines;
    expect(buy?.label).toBe('Limit Buy 0.500');
    expect(buy?.draggable).toBe(false);
    expect(paletteOf(scene, buy?.color ?? -1)).toBe('@buy');
    expect(sell?.label).toBe('Stop Sell 2.000');
    expect(sell?.draggable).toBe(true);
    expect(paletteOf(scene, sell?.color ?? -1)).toBe('#abc');
  });

  it('SC4: a long position with every level', () => {
    // Given
    const position = {
      id: 'btc',
      side: 'long' as const,
      size: 1.5,
      entryPrice: 100,
      liquidationPrice: 60,
      takeProfit: 130,
      stopLoss: 90,
      multiplier: 2,
    };
    // When
    const scene = compileOverlayScene(sources({ position }), 1);
    // Then
    expect(
      scene.lines.map((l) => [l.key, l.label, l.draggable, l.pnl])
    ).toEqual([
      ['entry:btc', 'Long 1.5', false, PNL_LIVE],
      ['liquidation:btc', 'Liq.', false, PNL_NONE],
      ['takeProfit:btc', 'TP', true, PNL_AT_LINE],
      ['stopLoss:btc', 'SL', true, PNL_AT_LINE],
    ]);
    expect(scene.position).toMatchObject({
      id: 'btc',
      sign: 1,
      size: 1.5,
      entry: 100,
      multiplier: 2,
      shade: true,
    });
    expect(paletteOf(scene, scene.position?.profitColor ?? -1)).toBe('@profit');
  });

  it('SC5: a short position without levels', () => {
    // Given
    const position = {
      side: 'short' as const,
      size: 3,
      entryPrice: 50,
      takeProfit: 40,
      tpSlDraggable: false,
      showPnlArea: false,
      multiplier: -1,
    };
    // When
    const scene = compileOverlayScene(sources({ position }), 1);
    // Then
    expect(scene.lines.map((l) => [l.key, l.label, l.draggable])).toEqual([
      ['entry:position', 'Short 3', false],
      ['takeProfit:position', 'TP', false],
    ]);
    expect(scene.position).toMatchObject({
      sign: -1,
      multiplier: 1,
      shade: false,
    });
  });

  it('SC6: fills become markers sorted by time', () => {
    // Given
    const fills = [
      { id: 'b', side: 'sell' as const, time: 3, price: 1 },
      { id: 'a', side: 'buy' as const, time: 1, price: 1 },
      {
        id: 'c',
        side: 'buy' as const,
        time: 2,
        price: 1,
        shape: 'circle' as const,
      },
    ];
    // When
    const scene = compileOverlayScene(sources({ fills }), 1);
    // Then
    expect(scene.markers.map((m) => [m.key, m.shape, m.position])).toEqual([
      ['fill:a', 'arrowUp', 'price'],
      ['fill:c', 'circle', 'price'],
      ['fill:b', 'arrowDown', 'price'],
    ]);
  });

  it('SC7: annotations of every type', () => {
    // Given
    const annotations = [
      { type: 'horizontalLine' as const, id: 'h', price: 5 },
      { type: 'verticalLine' as const, id: 'v', time: 9 },
      { type: 'note' as const, id: 'n', time: 1, price: 2, text: 'Hi' },
      { type: 'marker' as const, id: 'm', time: 4 },
      {
        type: 'marker' as const,
        id: 'm2',
        time: 5,
        position: 'price' as const,
        price: 7,
        shape: 'square' as const,
        icon: 'N',
        text: 'CPI',
      },
    ];
    // When
    const scene = compileOverlayScene(sources({ annotations }), 1);
    // Then
    expect(scene.lines[0]).toMatchObject({
      key: 'annotation:h',
      style: 'dashed',
      axisLabel: false,
      label: '',
    });
    expect(scene.vlines).toEqual([
      { key: 'annotation:v', time: 9, color: 0, style: 'dashed', label: '' },
    ]);
    expect(scene.notes[0]).toMatchObject({ text: 'Hi', price: 2 });
    expect(scene.markers[0]).toMatchObject({
      position: 'above',
      shape: 'circle',
      icon: '',
      text: '',
    });
    expect(scene.markers[0]?.price).toBeNaN();
    expect(scene.markers[1]).toMatchObject({
      price: 7,
      icon: 'N',
      text: 'CPI',
    });
    expect(scene.palette).toEqual(['@annotation']);
  });

  it('SC8 / SC9: drawings are flattened, palette entries deduped', () => {
    // Given
    const d1 = createDrawing('d1', {
      type: 'trendLine',
      anchors: [
        { time: 1, price: 2 },
        { time: 3, price: 4 },
      ],
    }) as Drawing;
    const d2 = createDrawing('d2', {
      type: 'horizontalLine',
      anchors: [{ time: 1, price: 5 }],
      style: { color: '#123' },
      locked: true,
    }) as Drawing;
    const d3 = createDrawing('d3', {
      type: 'horizontalRay',
      anchors: [{ time: 1, price: 6 }],
    }) as Drawing;
    // When
    const scene = compileOverlayScene(sources({ drawings: [d1, d2, d3] }), 1);
    // Then
    expect(scene.drawings[0]).toMatchObject({
      id: 'd1',
      anchors: [1, 2, 3, 4],
      width: 1.5,
      style: 'solid',
      locked: false,
    });
    expect(scene.drawings[1]?.locked).toBe(true);
    expect(scene.palette).toEqual(['@drawing', '#123']);
    expect(scene.drawings[2]?.color).toBe(scene.drawings[0]?.color);
  });
});

describe('labels', () => {
  it.each([
    [0.5, 3, '0.500'],
    [0.5, NaN, '0.5'],
    [NaN, 2, ''],
    [2, Infinity, '2'],
  ])('FQ1: formatQuantity(%p, %p) → %p', (q, d, expected) => {
    // Given / When / Then
    expect(formatQuantity(q, d)).toBe(expected);
  });

  it('OL1: order labels', () => {
    // Given / When / Then
    expect(
      orderLabel({ id: 'o', side: 'buy', price: 1, quantity: 0, type: '' }, 0)
    ).toBe('Limit Buy 0');
    expect(
      orderLabel({ id: 'o', side: 'sell', price: 1, quantity: NaN }, 2)
    ).toBe('Limit Sell');
    expect(themeColor('buy')).toBe('@buy');
  });
});

describe('OverlayScene helpers', () => {
  it('OS1: isSceneEmpty per collection', () => {
    // Given
    const base = emptyOverlayScene();
    const marker: SceneMarker = {
      key: 'm',
      time: 1,
      price: NaN,
      position: 'above',
      shape: 'circle',
      color: 0,
      icon: '',
      text: '',
    };
    // When / Then
    expect(isSceneEmpty(base)).toBe(true);
    expect(isSceneEmpty({ ...base, markers: [marker] })).toBe(false);
    expect(
      isSceneEmpty({
        ...base,
        vlines: [{ key: 'v', time: 1, color: 0, style: 'solid', label: '' }],
      })
    ).toBe(false);
    expect(
      isSceneEmpty({
        ...base,
        notes: [{ key: 'n', time: 1, price: 1, text: '', color: 0 }],
      })
    ).toBe(false);
    expect(
      isSceneEmpty({
        ...base,
        drawings: [
          {
            id: 'd',
            type: 'trendLine',
            anchors: [],
            color: 0,
            width: 1,
            style: 'solid',
            locked: false,
          },
        ],
      })
    ).toBe(false);
  });

  it('OS2: markerLowerBound', () => {
    // Given
    const at = (time: number) =>
      ({ ...emptyMarker, key: String(time), time }) as SceneMarker;
    const emptyMarker = {
      price: NaN,
      position: 'above',
      shape: 'circle',
      color: 0,
      icon: '',
      text: '',
    };
    const markers = [at(1), at(3), at(3), at(7)];
    // When / Then
    expect(markerLowerBound(markers, 0)).toBe(0);
    expect(markerLowerBound(markers, 3)).toBe(1);
    expect(markerLowerBound(markers, 4)).toBe(3);
    expect(markerLowerBound(markers, 8)).toBe(4);
    expect(markerLowerBound([], 1)).toBe(0);
  });
});
