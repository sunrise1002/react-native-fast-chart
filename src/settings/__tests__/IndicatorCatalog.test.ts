/**
 * Test perspective table — IndicatorCatalog (headless indicator settings UI)
 *
 * | Case | Input / Precondition                                 | Perspective        | Expected                                     |
 * |------|------------------------------------------------------|--------------------|----------------------------------------------|
 * | C1   | allowedPlacements overlay / pane meta                | Equivalence        | ['overlay'] / ['pane', 'overlay']            |
 * | C2   | placementOf('price') / other pane                    | Equivalence        | overlay / pane                               |
 * | C3   | create overlay type (ema) with defaults              | Equivalence        | paneId 'price'                               |
 * | C4   | create pane type (rsi) with defaults                 | Equivalence        | no paneId (automatic pane)                   |
 * | C5   | pane type with placement 'overlay'                   | Equivalence        | paneId 'price'                               |
 * | C6   | overlay type with unsupported placement 'pane'       | Abnormal           | falls back to 'price'                        |
 * | C7   | id / config passed through (config copied)           | Equivalence        | same values, new object                      |
 * | C8   | unknown / empty type                                 | Exception          | Error "Unknown indicator type"               |
 * | V1   | integer text "14" / " 21 "                           | Equivalence        | 14 / 21, valid                               |
 * | V2   | integer "14.6" → rounded; "0" / "-1" → min; huge     | Boundary (0/±1)    | adjusted true, clamped                       |
 * | V3   | "" / "abc" / "NaN" / "Infinity" / NaN number         | Invalid            | default, valid false                         |
 * | V4   | number param 70.5 / 101 / numeric input             | Equivalence / max  | kept / clamped to 100                        |
 * | V5   | source param 'hl2' / 'bogus' / number                | Equivalence / inv. | valid / default invalid                      |
 */
import { describe, expect, it } from '@jest/globals';
import { createIndicatorRegistry } from '../../indicators/builtins';
import type {
  IndicatorParam,
  NumberParam,
} from '../../indicators/IndicatorConfig';
import {
  allowedPlacements,
  createIndicatorInput,
  parseParamValue,
  placementOf,
} from '../IndicatorCatalog';

const registry = createIndicatorRegistry();
const param = (type: string, key: string): IndicatorParam => {
  const found = registry.get(type)?.meta.params.find((p) => p.key === key);
  if (!found) throw new Error(`missing ${type}.${key}`);
  return found;
};

describe('placements', () => {
  it('C1: allowed placements by meta', () => {
    // Given
    const ema = registry.get('ema')?.meta;
    const rsi = registry.get('rsi')?.meta;
    if (!ema || !rsi) throw new Error('missing meta');
    // When / Then
    expect(allowedPlacements(ema)).toEqual(['overlay']);
    expect(allowedPlacements(rsi)).toEqual(['pane', 'overlay']);
  });

  it('C2: placement from the pane id', () => {
    // Given / When / Then
    expect(placementOf('price')).toBe('overlay');
    expect(placementOf('pane:rsi-1')).toBe('pane');
    expect(placementOf('')).toBe('pane');
  });
});

describe('createIndicatorInput', () => {
  it('C3: overlays go to the price pane', () => {
    // Given / When / Then
    expect(createIndicatorInput(registry, 'ema')).toEqual({
      type: 'ema',
      config: {},
      paneId: 'price',
    });
  });

  it('C4: pane indicators get an automatic pane', () => {
    // Given / When
    const input = createIndicatorInput(registry, 'rsi');
    // Then
    expect(input.paneId).toBeUndefined();
  });

  it('C5: a pane indicator can be overlaid', () => {
    // Given / When / Then
    expect(
      createIndicatorInput(registry, 'volume', { placement: 'overlay' }).paneId
    ).toBe('price');
  });

  it('C6: an unsupported placement falls back to the default', () => {
    // Given / When / Then
    expect(
      createIndicatorInput(registry, 'sma', { placement: 'pane' }).paneId
    ).toBe('price');
  });

  it('C7: passes id and a copy of config', () => {
    // Given
    const config = { period: 50 };
    // When
    const input = createIndicatorInput(registry, 'ema', {
      id: 'ema-slow',
      config,
    });
    // Then
    expect(input.id).toBe('ema-slow');
    expect(input.config).toEqual({ period: 50 });
    expect(input.config).not.toBe(config);
  });

  it.each(['nope', ''])('C8: unknown type %p throws', (type) => {
    // Given / When / Then
    expect(() => createIndicatorInput(registry, type)).toThrow(Error);
    expect(() => createIndicatorInput(registry, type)).toThrow(
      `Unknown indicator type "${type}"`
    );
  });
});

describe('parseParamValue', () => {
  const period = param('rsi', 'period') as NumberParam;
  const level = param('rsi', 'overbought');
  const source = param('rsi', 'source');

  it('V1: parses integer text', () => {
    // Given / When / Then
    expect(parseParamValue(period, '14')).toEqual({
      value: 14,
      valid: true,
      adjusted: false,
    });
    expect(parseParamValue(period, ' 21 ').value).toBe(21);
  });

  it.each([
    ['14.6', 15],
    ['0', 1],
    ['-1', 1],
    ['1e12', period.max],
  ])('V2: %p is adjusted to %p', (text, expected) => {
    // Given / When
    const parsed = parseParamValue(period, text);
    // Then
    expect(parsed).toEqual({ value: expected, valid: true, adjusted: true });
  });

  it.each(['', '   ', 'abc', 'NaN', 'Infinity', NaN, -Infinity])(
    'V3: %p is invalid',
    (input) => {
      // Given / When
      const parsed = parseParamValue(period, input);
      // Then
      expect(parsed).toEqual({
        value: period.default,
        valid: false,
        adjusted: false,
      });
    }
  );

  it('V4: number params keep fractions and clamp', () => {
    // Given / When / Then
    expect(parseParamValue(level, '70.5')).toEqual({
      value: 70.5,
      valid: true,
      adjusted: false,
    });
    expect(parseParamValue(level, 101)).toEqual({
      value: 100,
      valid: true,
      adjusted: true,
    });
  });

  it('V5: source params accept only listed options', () => {
    // Given / When / Then
    expect(parseParamValue(source, 'hl2')).toEqual({
      value: 'hl2',
      valid: true,
      adjusted: false,
    });
    expect(parseParamValue(source, 'bogus')).toEqual({
      value: 'close',
      valid: false,
      adjusted: false,
    });
    expect(parseParamValue(source, 3).valid).toBe(false);
  });
});
