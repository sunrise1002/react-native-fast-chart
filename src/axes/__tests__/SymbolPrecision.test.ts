/**
 * Test perspective table — SymbolPrecision
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | SP1  | null / undefined / {} symbol                           | Boundary (empty)   | all NaN (automatic)                        |
 * | SP2  | forex { pricePrecision: 5 }                            | Equivalence        | 5 decimals, no tick size                   |
 * | SP3  | crypto micro { tickSize: 1e-8 }                        | Equivalence        | 8 decimals derived from the tick           |
 * | SP4  | futures { tickSize: 0.25 } + pricePrecision 1          | Equivalence        | explicit precision wins over tick          |
 * | SP5  | legacy axes.pricePrecision only / with symbol          | Equivalence        | legacy used / symbol wins                  |
 * | SP6  | pricePrecision 0 / 12 / 13 / 2.6                       | Boundary           | 0 / 12 / clamped 12 / rounded 3            |
 * | SP7  | invalid tick (0, -1, NaN, ∞, "0.1")                    | Invalid            | tick NaN, decimals automatic               |
 * | SP8  | invalid precision (-1, NaN, ∞, "2")                    | Invalid            | ignored → next source                      |
 * | SP9  | quantityStep 0.001 / volumePrecision 1 wins            | Equivalence        | 3 / 1 volume decimals                      |
 * | SP10 | invalid quantityStep (0, -1, NaN) / volumePrecision -1 | Invalid            | NaN                                        |
 * | SN1  | snapToTickSize 101.13 @0.25, 0.3 @0.1, -1.26 @0.5      | Equivalence        | 101.25 / 0.3 (no float noise) / -1.5       |
 * | SN2  | snapToTickSize tick 0 / NaN / ∞ / negative             | Invalid            | price unchanged                            |
 * | SN3  | snapToTickSize price NaN / ∞                           | Invalid            | NaN                                        |
 * | SN4  | snapToTickSize price 0 / -0.01 @0.25                   | Boundary (0)       | 0 (never -0)                               |
 * | SS1  | snapStepToTickSize 0.3 @0.25, 0.5 @0.25, 0.1 @0.25     | Equivalence/±1     | 0.5 / 0.5 (exact) / 0.25 (one tick floor)  |
 * | SS2  | snapStepToTickSize invalid tick                        | Invalid            | step unchanged                             |
 * | SS3  | snapStepToTickSize step 0 / -1 / NaN / ∞               | Invalid / Boundary | NaN                                        |
 * | SS4  | snapStepToTickSize overflowing multiple (1e308 @ 0.3)  | Boundary (max)     | NaN                                        |
 * | IT1  | interactionTickSize tick 0.25 / decimals 2 / 0         | Equivalence/Bound. | 0.25 / 0.01 / 1                            |
 * | IT2  | interactionTickSize no tick, no decimals (NaN)         | Invalid / empty    | NaN (no snapping)                          |
 */
import { describe, expect, it } from '@jest/globals';
import {
  interactionTickSize,
  resolveSymbolPrecision,
  snapStepToTickSize,
  snapToTickSize,
  type ChartSymbolConfig,
} from '../SymbolPrecision';

type Symbol = Partial<ChartSymbolConfig>;
const bad = (value: unknown) => value as number;

describe('resolveSymbolPrecision', () => {
  it.each([[null], [undefined], [{}]])('SP1: %p → automatic', (symbol) => {
    // Given / When
    const out = resolveSymbolPrecision(symbol);
    // Then
    expect(out.priceDecimals).toBeNaN();
    expect(out.tickSize).toBeNaN();
    expect(out.volumeDecimals).toBeNaN();
  });

  it('SP2: forex precision', () => {
    // Given / When
    const out = resolveSymbolPrecision({ pricePrecision: 5 });
    // Then
    expect(out.priceDecimals).toBe(5);
    expect(out.tickSize).toBeNaN();
  });

  it('SP3: crypto micro tick derives 8 decimals', () => {
    // Given / When
    const out = resolveSymbolPrecision({ tickSize: 0.00000001 });
    // Then
    expect(out).toEqual({
      priceDecimals: 8,
      tickSize: 1e-8,
      volumeDecimals: NaN,
    });
  });

  it('SP4: explicit precision wins over the tick size', () => {
    // Given / When
    const out = resolveSymbolPrecision({ tickSize: 0.25, pricePrecision: 1 });
    // Then
    expect(out.priceDecimals).toBe(1);
    expect(out.tickSize).toBe(0.25);
  });

  it('SP5: legacy precision is used only when the symbol has none', () => {
    // Given / When / Then
    expect(resolveSymbolPrecision(null, 3).priceDecimals).toBe(3);
    expect(resolveSymbolPrecision({ pricePrecision: 4 }, 3).priceDecimals).toBe(
      4
    );
    expect(resolveSymbolPrecision({ tickSize: 0.5 }, 3).priceDecimals).toBe(3);
  });

  it.each([
    [0, 0],
    [12, 12],
    [13, 12],
    [2.6, 3],
  ])('SP6: pricePrecision %p → %p', (precision, expected) => {
    // Given / When / Then
    expect(
      resolveSymbolPrecision({ pricePrecision: precision }).priceDecimals
    ).toBe(expected);
  });

  it.each([[0], [-1], [NaN], [Infinity], [bad('0.1')]])(
    'SP7: tick size %p is ignored',
    (tickSize) => {
      // Given / When
      const out = resolveSymbolPrecision({ tickSize } as Symbol);
      // Then
      expect(out.tickSize).toBeNaN();
      expect(out.priceDecimals).toBeNaN();
    }
  );

  it.each([[-1], [NaN], [Infinity], [bad('2')]])(
    'SP8: pricePrecision %p falls through to the tick size',
    (pricePrecision) => {
      // Given / When
      const out = resolveSymbolPrecision({ pricePrecision, tickSize: 0.01 });
      // Then
      expect(out.priceDecimals).toBe(2);
    }
  );

  it('SP9: volume decimals from quantityStep, volumePrecision wins', () => {
    // Given / When / Then
    expect(resolveSymbolPrecision({ quantityStep: 0.001 }).volumeDecimals).toBe(
      3
    );
    expect(
      resolveSymbolPrecision({ quantityStep: 0.001, volumePrecision: 1 })
        .volumeDecimals
    ).toBe(1);
    expect(resolveSymbolPrecision({ quantityStep: 1 }).volumeDecimals).toBe(0);
  });

  it.each<Symbol>([
    { quantityStep: 0 },
    { quantityStep: -1 },
    { quantityStep: NaN },
    { volumePrecision: -1 },
    { volumePrecision: bad('2') },
  ])('SP10: invalid volume metadata %p → NaN', (symbol) => {
    // Given / When / Then
    expect(resolveSymbolPrecision(symbol).volumeDecimals).toBeNaN();
  });
});

describe('snapToTickSize', () => {
  it.each([
    [101.13, 0.25, 101.25],
    [0.30000000000000004, 0.1, 0.3],
    [-1.26, 0.5, -1.5],
    [0.000000123, 0.00000001, 0.00000012],
  ])('SN1: %p @ %p → %p', (price, tick, expected) => {
    // Given / When / Then
    expect(snapToTickSize(price, tick)).toBe(expected);
  });

  it.each([[0], [NaN], [Infinity], [-0.25]])(
    'SN2: tick %p leaves the price unchanged',
    (tick) => {
      // Given / When / Then
      expect(snapToTickSize(101.13, tick)).toBe(101.13);
    }
  );

  it.each([[NaN], [Infinity], [-Infinity]])('SN3: price %p → NaN', (price) => {
    // Given / When / Then
    expect(snapToTickSize(price, 0.25)).toBeNaN();
  });

  it.each([[0], [-0.01]])('SN4: price %p → +0', (price) => {
    // Given / When
    const out = snapToTickSize(price, 0.25);
    // Then
    expect(Object.is(out, 0)).toBe(true);
  });
});

describe('snapStepToTickSize', () => {
  it.each([
    [0.3, 0.25, 0.5],
    [0.5, 0.25, 0.5],
    [0.1, 0.25, 0.25],
    [0.30000000000000004, 0.1, 0.30000000000000004],
  ])('SS1: step %p @ %p → %p', (step, tick, expected) => {
    // Given / When / Then
    expect(snapStepToTickSize(step, tick)).toBeCloseTo(expected, 12);
  });

  it.each([[0], [NaN], [-1], [Infinity]])(
    'SS2: tick %p leaves the step unchanged',
    (tick) => {
      // Given / When / Then
      expect(snapStepToTickSize(0.3, tick)).toBe(0.3);
    }
  );

  it.each([[0], [-1], [NaN], [Infinity]])('SS3: step %p → NaN', (step) => {
    // Given / When / Then
    expect(snapStepToTickSize(step, 0.25)).toBeNaN();
  });

  it('SS4: an overflowing multiple → NaN', () => {
    // Given / When / Then
    expect(snapStepToTickSize(1.7e308, 0.3)).toBeNaN();
  });
});

describe('interactionTickSize', () => {
  it.each([
    [{ tickSize: 0.25, priceDecimals: 4, volumeDecimals: NaN }, 0.25],
    [{ tickSize: NaN, priceDecimals: 2, volumeDecimals: NaN }, 0.01],
    [{ tickSize: NaN, priceDecimals: 0, volumeDecimals: NaN }, 1],
  ])('IT1: %p → %p', (precision, expected) => {
    // Given: a resolved precision
    // When: the snap step is derived
    // Then: the tick wins, else one unit of the decimals
    expect(interactionTickSize(precision)).toBeCloseTo(expected, 12);
  });

  it('IT2: automatic precision → NaN', () => {
    // Given: neither a tick size nor fixed decimals
    const precision = { tickSize: NaN, priceDecimals: NaN, volumeDecimals: 3 };
    // When / Then: no snapping
    expect(interactionTickSize(precision)).toBeNaN();
  });
});
