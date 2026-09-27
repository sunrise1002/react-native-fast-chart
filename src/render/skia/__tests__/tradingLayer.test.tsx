/**
 * Test perspective table — useTradingLayer (+ tradingLevels / tradingDrawing)
 * (Skia mocked: recording picture canvas; real Reanimated, fake timers.
 * Fixture: 10 bars, x(i) = 305 + 10 i, y(price) = 300 − price, last close
 * 109, plot 400 × 300, axis 60, pixel ratio 1.)
 *
 * | Case | Input / Precondition                                    | Perspective        | Expected                                        |
 * |------|---------------------------------------------------------|--------------------|-------------------------------------------------|
 * | RL1  | empty scene                                             | Boundary (empty)   | empty picture, hit count 0                      |
 * | RL2  | overlays without data                                   | Boundary (empty)   | empty picture                                   |
 * | RL3  | order line                                              | Equivalence        | line, label box + text, axis badge, hit map     |
 * | RL4  | line outside the price range / axisLabel off            | Boundary / Equiv.  | skipped (NaN hit) / no badge                    |
 * | RL5  | line drag override                                      | Equivalence        | drawn at the dragged price                      |
 * | RL6  | long position in profit / short in loss                 | Equivalence        | PnL area rect, live PnL label                   |
 * | RL7  | TP line                                                 | Equivalence        | projected PnL at the TP price                   |
 * | RL8  | PnL area disabled / entry == last close                 | Boundary           | no area rect                                    |
 * | RL9  | fills of two sides + far future + before the data       | Equivalence/Bound. | one path per color; out-of-range skipped        |
 * | RL10 | annotation marker with icon / text                      | Equivalence        | icon and text drawn                             |
 * | RL11 | vertical line in view / out of view; note in / out      | Equivalence/Bound. | drawn / skipped                                 |
 * | RL12 | drawings of every type, one selected                    | Equivalence        | lines, rect fill + stroke, fib texts, handles   |
 * | RL13 | drawing drag override / draft handles                   | Equivalence        | override anchors; draft anchor handle           |
 * | RL14 | trend line fully outside the plot                       | Boundary           | no line (clipped away)                          |
 * | RP1  | resolvePaletteColor theme key / unknown key / literal   | Equivalence/Inval. | theme color / annotation / literal              |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { FakeDrawOp } from '../../../../jest/mocks/react-native-skia';
import { MIN, T0 } from '../../../data/__tests__/bars';
import { makeTradingEngine } from '../../../engine/__tests__/tradingTestUtils';
import {
  createTradingUiState,
  DRAG_DRAWING,
  DRAG_LINE,
} from '../../../engine/TradingState';
import { defaultTradingTheme } from '../../../theme/ChartTheme';
import { resolvePaletteColor, useTradingLayer } from '../useTradingLayer';
import { FONT, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

let env: ReturnType<typeof makeTradingEngine>;

function layer(count = 10) {
  env = makeTradingEngine(count);
  return renderHook(() => {
    const barMs = useSharedValue(MIN);
    return useTradingLayer(env.state, barMs, {
      font: FONT,
      trading: defaultTradingTheme,
      pixelRatio: 1,
      pricePrecision: 2,
      thousandsSeparator: ',',
    });
  });
}

function render(update: () => void) {
  act(() => {
    update();
    env.sync();
  });
  tick();
}

const count = (ops: readonly FakeDrawOp[], op: string) =>
  ops.filter((o) => o.op === op).length;

describe('levels', () => {
  it('RL1: an empty scene records nothing', () => {
    // Given
    const { result } = layer();
    // When
    tick();
    // Then
    expect(pic(result.current).ops).toHaveLength(0);
    expect(env.state.tradingHits.value.count).toBe(0);
  });

  it('RL2: no data → empty picture', () => {
    // Given
    const { result } = layer(0);
    // When
    render(() => env.overlays.addPriceLine({ price: 5 }));
    // Then
    expect(pic(result.current).ops).toHaveLength(0);
  });

  it('RL3: an order line with label and badge', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setOrders([
        { id: 'o', side: 'buy', price: 105, quantity: 1 },
      ])
    );
    // Then
    const p = pic(result.current);
    const line = p.ops.find((o) => o.op === 'line');
    expect(line).toMatchObject({ x0: 0, x1: 400, y0: 195.5 });
    expect(p.texts()).toEqual(['Limit Buy 1', '105.00']);
    expect(count(p.ops, 'rrect')).toBe(2);
    const hits = env.state.tradingHits.value;
    expect(hits.count).toBe(1);
    expect(hits.version).toBe(env.state.tradingScene.value.version);
    expect(hits.lines[0]).toBe(195.5);
    expect(hits.lines[2]).toBeGreaterThan(hits.lines[1] as number);
  });

  it('RL4: off-range lines are skipped; axisLabel false has no badge', () => {
    // Given
    const { result } = layer();
    // When
    render(() => {
      env.overlays.addPriceLine({ price: 500 });
      env.overlays.addPriceLine({ price: 50, axisLabel: false });
    });
    // Then
    const p = pic(result.current);
    expect(count(p.ops, 'line')).toBe(1);
    expect(p.texts()).toEqual([]);
    expect(env.state.tradingHits.value.lines[0]).toBeNaN();
  });

  it('RL5: a line drag override moves the line', () => {
    // Given
    const { result } = layer();
    render(() =>
      env.overlays.addPriceLine({ id: 'a', price: 100, draggable: true })
    );
    // When
    act(() => {
      env.state.tradingUi.value = {
        ...createTradingUiState(),
        dragKind: DRAG_LINE,
        dragKey: 'priceLine:a',
        dragPrice: 120,
      };
    });
    tick();
    // Then
    const p = pic(result.current);
    expect(p.ops.find((o) => o.op === 'line')).toMatchObject({ y0: 180.5 });
    expect(p.texts()).toContain('120.00');
  });

  it('RL6: position PnL area and live label', () => {
    // Given
    const { result } = layer();
    // When: long 2 @ 100, last close 109
    render(() =>
      env.overlays.setPosition({ side: 'long', size: 2, entryPrice: 100 })
    );
    // Then
    const p = pic(result.current);
    expect(p.ops.find((o) => o.op === 'rect')).toMatchObject({
      rect: { x: 0, y: 191, width: 400, height: 9 },
    });
    expect(p.texts()[0]).toBe('Long 2 +18.00 (+9.00%)');
    // When: short → loss
    render(() =>
      env.overlays.setPosition({ side: 'short', size: 1, entryPrice: 100 })
    );
    // Then
    expect(pic(result.current).texts()[0]).toBe('Short 1 -9.00 (-9.00%)');
  });

  it('RL7: TP shows the PnL at its price', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setPosition({
        side: 'long',
        size: 1,
        entryPrice: 100,
        takeProfit: 120,
        showPnlArea: false,
      })
    );
    // Then
    expect(pic(result.current).texts()).toContain('TP +20.00 (+20.00%)');
  });

  it('RL8: no area when disabled or flat', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setPosition({
        side: 'long',
        size: 1,
        entryPrice: 100,
        showPnlArea: false,
      })
    );
    // Then
    expect(count(pic(result.current).ops, 'rect')).toBe(0);
    // When: entry at the last close
    render(() =>
      env.overlays.setPosition({ side: 'long', size: 1, entryPrice: 109 })
    );
    // Then
    expect(count(pic(result.current).ops, 'rect')).toBe(0);
  });
});

describe('markers, vertical lines and notes', () => {
  it('RL9: one path per color, out-of-range fills skipped', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setFills([
        { id: 'a', side: 'buy', time: T0 + MIN, price: 101 },
        { id: 'b', side: 'buy', time: T0 + 3 * MIN, price: 103 },
        { id: 'c', side: 'sell', time: T0 + 5 * MIN, price: 105 },
        { id: 'far', side: 'sell', time: T0 + 100 * MIN, price: 105 },
        { id: 'early', side: 'sell', time: T0 - 5 * MIN, price: 105 },
      ])
    );
    // Then
    const paths = pic(result.current).ops.filter((o) => o.op === 'path');
    expect(paths).toHaveLength(2);
  });

  it('RL10: icon and text of an event marker', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setAnnotations([
        { type: 'marker', id: 'n', time: T0 + 2 * MIN, icon: 'N', text: 'CPI' },
        { type: 'marker', id: 'm', time: T0 + 3 * MIN, position: 'below' },
      ])
    );
    // Then
    expect(pic(result.current).texts()).toEqual(['N', 'CPI']);
  });

  it('RL11: vertical lines and notes in / out of view', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.setAnnotations([
        { type: 'verticalLine', id: 'v', time: T0 + 5 * MIN, label: 'Open' },
        { type: 'verticalLine', id: 'w', time: T0 + 500 * MIN },
        { type: 'note', id: 'n', time: T0 + 2 * MIN, price: 150, text: 'Hi' },
        { type: 'note', id: 'x', time: T0 + 2 * MIN, price: 900, text: 'No' },
      ])
    );
    // Then
    const p = pic(result.current);
    expect(p.ops.find((o) => o.op === 'line')).toMatchObject({
      x0: 355.5,
      y0: 0,
      y1: 300,
    });
    expect(p.texts()).toEqual(['Open', 'Hi']);
  });
});

describe('drawings', () => {
  const at = (i: number, price: number) => ({ time: T0 + i * MIN, price });

  it('RL12: every drawing type', () => {
    // Given
    const { result } = layer();
    // When
    render(() => {
      env.overlays.drawings.setAll([
        { id: 't', type: 'trendLine', anchors: [at(2, 100), at(6, 110)] },
        { id: 'h', type: 'horizontalLine', anchors: [at(2, 50)] },
        { id: 'r', type: 'horizontalRay', anchors: [at(4, 60)] },
        { id: 'box', type: 'rectangle', anchors: [at(1, 120), at(3, 130)] },
        {
          id: 'fib',
          type: 'fibRetracement',
          anchors: [at(0, 200), at(8, 100)],
        },
      ]);
      env.overlays.drawings.select('t');
    });
    // Then
    const p = pic(result.current);
    expect(count(p.ops, 'rect')).toBe(2);
    expect(p.texts()).toEqual([
      '0',
      '0.236',
      '0.382',
      '0.5',
      '0.618',
      '0.786',
      '1',
    ]);
    // trend + horizontal + ray + fib diagonal + 7 fib levels
    expect(count(p.ops, 'line')).toBe(11);
    // 2 anchors × (fill + stroke)
    expect(count(p.ops, 'rrect')).toBe(4);
    expect(p.ops.find((o) => o.op === 'line')).toMatchObject({
      x0: 325,
      y0: 200,
      x1: 365,
      y1: 190,
    });
  });

  it('RL13: drag override and draft handles', () => {
    // Given
    const { result } = layer();
    render(() => {
      env.overlays.drawings.add({
        id: 't',
        type: 'trendLine',
        anchors: [at(2, 100), at(6, 110)],
      });
    });
    // When
    act(() => {
      env.state.tradingUi.value = {
        ...createTradingUiState(),
        dragKind: DRAG_DRAWING,
        dragKey: 't',
        dragAnchors: [T0 + 3 * MIN, 150, T0 + 7 * MIN, 160],
      };
    });
    tick();
    // Then
    expect(pic(result.current).ops.find((o) => o.op === 'line')).toMatchObject({
      x0: 335,
      y0: 150,
    });
    // When: a draft with one anchor
    render(() => env.overlays.drawings.setTool('rectangle'));
    act(() => {
      env.state.tradingUi.value = {
        ...env.state.tradingUi.value,
        draftAnchors: [T0 + MIN, 150],
      };
    });
    tick();
    // Then
    expect(count(pic(result.current).ops, 'rrect')).toBe(2);
  });

  it('RL14: a trend line outside the plot is clipped away', () => {
    // Given
    const { result } = layer();
    // When
    render(() =>
      env.overlays.drawings.add({
        type: 'trendLine',
        anchors: [at(-100, 100), at(-90, 110)],
      })
    );
    // Then
    expect(count(pic(result.current).ops, 'line')).toBe(0);
  });
});

describe('resolvePaletteColor', () => {
  it('RP1: theme keys, unknown keys and literals', () => {
    // Given / When / Then
    expect(resolvePaletteColor('@buy', defaultTradingTheme)).toBe(
      defaultTradingTheme.buy
    );
    expect(resolvePaletteColor('@nope', defaultTradingTheme)).toBe(
      defaultTradingTheme.annotation
    );
    expect(resolvePaletteColor('#123456', defaultTradingTheme)).toBe('#123456');
  });
});
