/**
 * Test perspective table — themes
 *
 * | Case | Input / Precondition                    | Perspective      | Expected                                  |
 * |------|-----------------------------------------|------------------|-------------------------------------------|
 * | T1   | dark theme spec colors                  | Equivalence      | Binance palette values                    |
 * | T2   | dark & light share the same key shape   | Structure        | identical nested key sets                 |
 * | T3   | nested override (candle.bullish)        | Equivalence      | only that leaf changes                    |
 * | T4   | override undefined / null / {}          | Boundary (empty) | equal copy                                |
 * | T5   | palette array override                  | Equivalence      | replaced whole                            |
 * | T6   | base theme after merge                  | Safety           | not mutated                               |
 * | T7   | empty palette array                     | Boundary (empty) | [] assigned                               |
 */
import { describe, expect, it } from '@jest/globals';
import type { ChartTheme } from '../ChartTheme';
import { defaultDarkTheme } from '../defaultDarkTheme';
import { defaultLightTheme } from '../defaultLightTheme';
import { mergeTheme } from '../mergeTheme';

const keyShape = (value: unknown): unknown =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, keyShape((value as Record<string, unknown>)[k])])
      )
    : typeof value;

describe('default themes', () => {
  it('T1: dark theme uses the Binance-like palette', () => {
    // Given / When / Then
    expect(defaultDarkTheme.background).toBe('#0B0E11');
    expect(defaultDarkTheme.surface).toBe('#161A1E');
    expect(defaultDarkTheme.candle.bullish).toBe('#0ECB81');
    expect(defaultDarkTheme.candle.bearish).toBe('#F6465D');
  });

  it('T2: dark and light themes have the same shape', () => {
    // Given / When / Then
    expect(keyShape(defaultLightTheme)).toEqual(keyShape(defaultDarkTheme));
    expect(defaultLightTheme.indicatorPalette.length).toBeGreaterThan(0);
  });
});

describe('mergeTheme', () => {
  it('T3: overrides a nested leaf only', () => {
    // Given / When
    const theme = mergeTheme(defaultDarkTheme, {
      candle: { bullish: '#00FF00' },
    });
    // Then
    expect(theme.candle.bullish).toBe('#00FF00');
    expect(theme.candle.bearish).toBe(defaultDarkTheme.candle.bearish);
    expect(theme.grid).toEqual(defaultDarkTheme.grid);
  });

  it.each([undefined, null, {}])(
    'T4: override %p returns an equal copy',
    (o) => {
      // Given / When
      const theme = mergeTheme(defaultLightTheme, o);
      // Then
      expect(theme).toEqual(defaultLightTheme);
      expect(theme).not.toBe(defaultLightTheme);
    }
  );

  it('T5: replaces arrays instead of merging', () => {
    // Given / When
    const theme = mergeTheme(defaultDarkTheme, {
      indicatorPalette: ['#123456'],
    });
    // Then
    expect(theme.indicatorPalette).toEqual(['#123456']);
  });

  it('T6: does not mutate the base theme', () => {
    // Given
    const snapshot: ChartTheme = JSON.parse(JSON.stringify(defaultDarkTheme));
    // When
    mergeTheme(defaultDarkTheme, {
      axis: { fontSize: 20 },
      background: '#000',
    });
    // Then
    expect(defaultDarkTheme).toEqual(snapshot);
  });

  it('T7: accepts an empty palette', () => {
    // Given / When / Then
    expect(
      mergeTheme(defaultDarkTheme, { indicatorPalette: [] }).indicatorPalette
    ).toEqual([]);
  });
});
