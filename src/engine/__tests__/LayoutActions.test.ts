/**
 * Test perspective table — LayoutActions (real Reanimated)
 *
 * | Case | Input / Precondition                               | Perspective        | Expected                                 |
 * |------|----------------------------------------------------|--------------------|------------------------------------------|
 * | LA1  | plotSizeFor 464 - 64                               | Equivalence        | 400                                      |
 * | LA2  | canvas = gutter / smaller / gutter 0 / gutter < 0  | Boundary           | 0 / 0 / canvas / canvas                  |
 * | LA3  | canvas NaN / ∞; gutter NaN                         | Invalid            | 0 / 0 / canvas                           |
 * | LA4  | resizeCanvas 464 × 324                             | Equivalence        | canvas stored, plot 400 × 300            |
 * | LA5  | resizeCanvas NaN / -1 / ∞                          | Invalid            | canvas 0, plot 0                         |
 * | LA6  | setPriceAxisWidth 80                               | Equivalence        | plot shrinks to 384                      |
 * | LA7  | setPriceAxisWidth same value                       | Boundary           | no write                                 |
 * | LA8  | setPriceAxisWidth NaN / -1 / ∞                     | Invalid            | ignored                                  |
 * | LA9  | setPriceAxisWidth 0                                | Boundary (0)       | plot = canvas width                      |
 * | LA10 | setPaneSpec price 3 : RSI 1                        | Normal             | stack 300, price 225, RSI 75 at 225      |
 * | LA11 | resizeCanvas with two panes                        | Normal             | layout follows the new stack height      |
 * | LA12 | setPaneSpec before layout (stack 0)                | Boundary (0)       | all heights 0, plot 0                    |
 * | LA13 | setPaneSpec with no panes                          | Boundary (empty)   | plot height 0                            |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  plotSizeFor,
  resizeCanvas,
  setPaneSpec,
  setPriceAxisWidth,
} from '../LayoutActions';
import { makeEngine } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

function laidOut() {
  const engine = makeEngine();
  resizeCanvas(engine.state, engine.options, 464, 324, 24);
  return engine;
}

describe('plotSizeFor', () => {
  it.each([
    [464, 64, 400],
    [64, 64, 0],
    [10, 64, 0],
    [100, 0, 100],
    [100, -5, 100],
    [NaN, 64, 0],
    [Infinity, 64, 0],
    [100, NaN, 100],
  ])('LA1-3: canvas %p, gutter %p → %p', (canvas, gutter, expected) => {
    // Given / When / Then
    expect(plotSizeFor(canvas, gutter)).toBe(expected);
  });
});

describe('resizeCanvas', () => {
  it('LA4: stores the canvas and derives the plot', () => {
    // Given / When
    const { state } = laidOut();
    // Then
    expect(state.canvasWidth.value).toBe(464);
    expect(state.canvasHeight.value).toBe(324);
    expect(state.plotWidth.value).toBe(400);
    expect(state.plotHeight.value).toBe(300);
  });

  it.each([[NaN], [-1], [Infinity]])('LA5: size %p → 0', (size) => {
    // Given
    const { state, options } = laidOut();
    // When
    resizeCanvas(state, options, size, size, 24);
    // Then
    expect(state.canvasWidth.value).toBe(0);
    expect(state.plotWidth.value).toBe(0);
    expect(state.plotHeight.value).toBe(0);
  });
});

describe('setPriceAxisWidth', () => {
  it('LA6: resizes the plot', () => {
    // Given
    const { state, options } = laidOut();
    // When
    setPriceAxisWidth(state, options, 80, 24);
    // Then
    expect(state.priceAxisWidth.value).toBe(80);
    expect(state.plotWidth.value).toBe(384);
    expect(state.plotHeight.value).toBe(300);
  });

  it('LA7: no-op for the current width', () => {
    // Given
    const { state, options } = laidOut();
    state.plotWidth.value = 123;
    // When
    setPriceAxisWidth(state, options, 64, 24);
    // Then
    expect(state.plotWidth.value).toBe(123);
  });

  it.each([[NaN], [-1], [Infinity]])('LA8: width %p ignored', (width) => {
    // Given
    const { state, options } = laidOut();
    // When
    setPriceAxisWidth(state, options, width, 24);
    // Then
    expect(state.priceAxisWidth.value).toBe(64);
    expect(state.plotWidth.value).toBe(400);
  });

  it('LA9: zero width gives the whole canvas to the plot', () => {
    // Given
    const { state, options } = laidOut();
    // When
    setPriceAxisWidth(state, options, 0, 24);
    // Then
    expect(state.plotWidth.value).toBe(464);
  });
});

describe('pane layout', () => {
  const SPEC = { ids: ['price', 'rsi'], ratios: [3, 1], minHeights: [0, 0] };

  it('LA10: setPaneSpec splits the stack', () => {
    // Given
    const { state, options } = laidOut();
    // When
    setPaneSpec(state, options, SPEC);
    // Then
    expect(state.stackHeight.value).toBe(300);
    expect(state.paneLayout.value).toEqual({
      ids: ['price', 'rsi'],
      tops: [0, 225],
      heights: [225, 75],
      total: 300,
    });
    expect(state.plotHeight.value).toBe(225);
    expect(state.plotWidth.value).toBe(400);
  });

  it('LA11: resizing the canvas re-lays out the panes', () => {
    // Given
    const { state, options } = laidOut();
    setPaneSpec(state, options, SPEC);
    // When
    resizeCanvas(state, options, 464, 424, 24);
    // Then
    expect(state.paneLayout.value.heights).toEqual([300, 100]);
    expect(state.plotHeight.value).toBe(300);
  });

  it('LA12 / LA13: no stack or no panes', () => {
    // Given
    const engine = makeEngine();
    // When
    setPaneSpec(engine.state, engine.options, SPEC);
    const before = engine.state.paneLayout.value.heights;
    const laid = laidOut();
    setPaneSpec(laid.state, laid.options, {
      ids: [],
      ratios: [],
      minHeights: [],
    });
    // Then
    expect(before).toEqual([0, 0]);
    expect(engine.state.plotHeight.value).toBe(0);
    expect(laid.state.plotHeight.value).toBe(0);
  });
});
