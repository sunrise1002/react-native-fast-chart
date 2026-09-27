/**
 * Test perspective table — resolveTradingTheme
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                  |
 * |------|--------------------------------------------------------|--------------------|-------------------------------------------|
 * | RT1  | theme without `trading`                                | Boundary (empty)   | defaultTradingTheme copy                  |
 * | RT2  | partial override (buy, fillOpacity 0.3)                | Equivalence        | merged over defaults                      |
 * | RT3  | fillOpacity 0 / 1                                      | Boundary           | accepted                                  |
 * | RT4  | fillOpacity −0.1 / 1.1 / NaN / '0.5'                   | Invalid            | default kept                              |
 * | RT5  | color '' / number / null                               | Invalid            | default kept                              |
 * | RT6  | built-in dark / light themes                           | Equivalence        | complete, light overrides applied         |
 * | RT7  | mergeTheme with a `trading` override                   | Equivalence        | deep-merged                               |
 */
import { describe, expect, it } from '@jest/globals';
import {
  defaultTradingTheme,
  resolveTradingTheme,
  type ChartTheme,
  type ChartTradingTheme,
} from '../ChartTheme';
import { defaultDarkTheme } from '../defaultDarkTheme';
import { defaultLightTheme } from '../defaultLightTheme';
import { mergeTheme } from '../mergeTheme';

const withTrading = (trading: unknown): ChartTheme => ({
  ...defaultDarkTheme,
  trading: trading as Partial<ChartTradingTheme>,
});

describe('resolveTradingTheme', () => {
  it('RT1: defaults without a trading section', () => {
    // Given
    const theme = { ...defaultDarkTheme, trading: undefined };
    // When
    const resolved = resolveTradingTheme(theme);
    // Then
    expect(resolved).toEqual(defaultTradingTheme);
    expect(resolved).not.toBe(defaultTradingTheme);
  });

  it('RT2: partial overrides', () => {
    // Given / When
    const resolved = resolveTradingTheme(
      withTrading({ buy: '#00f', fillOpacity: 0.3 })
    );
    // Then
    expect(resolved).toEqual({
      ...defaultTradingTheme,
      buy: '#00f',
      fillOpacity: 0.3,
    });
  });

  it.each([[0], [1]])('RT3: fillOpacity %p accepted', (value) => {
    // Given / When / Then
    expect(
      resolveTradingTheme(withTrading({ fillOpacity: value })).fillOpacity
    ).toBe(value);
  });

  it.each([[-0.1], [1.1], [NaN], ['0.5']])(
    'RT4: fillOpacity %p ignored',
    (value) => {
      // Given / When / Then
      expect(
        resolveTradingTheme(withTrading({ fillOpacity: value })).fillOpacity
      ).toBe(defaultTradingTheme.fillOpacity);
    }
  );

  it.each([[''], [5], [null]])('RT5: color %p ignored', (value) => {
    // Given / When / Then
    expect(resolveTradingTheme(withTrading({ sell: value })).sell).toBe(
      defaultTradingTheme.sell
    );
    expect(resolveTradingTheme(withTrading(null))).toEqual(defaultTradingTheme);
  });

  it('RT6: built-in themes', () => {
    // Given / When
    const dark = resolveTradingTheme(defaultDarkTheme);
    const light = resolveTradingTheme(defaultLightTheme);
    // Then
    expect(dark).toEqual(defaultTradingTheme);
    expect(light.drawing).toBe('#1E53E5');
    expect(light.fillOpacity).toBe(0.1);
  });

  it('RT7: mergeTheme deep-merges trading overrides', () => {
    // Given / When
    const merged = mergeTheme(defaultDarkTheme, { trading: { entry: '#fff' } });
    // Then
    expect(resolveTradingTheme(merged)).toEqual({
      ...defaultTradingTheme,
      entry: '#fff',
    });
  });
});
