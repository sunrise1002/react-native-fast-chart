/**
 * Test perspective table — registry, config helpers, definitions
 *
 * | Case | Input / Precondition                               | Perspective    | Expected                                    |
 * |------|----------------------------------------------------|----------------|---------------------------------------------|
 * | R1   | built-in registry                                  | Normal         | overlays then volume, rsi, macd, atr        |
 * | R2   | register custom / get / has / unregister           | Normal         | lookups reflect changes                     |
 * | R3   | duplicate without replace / with replace           | Abnormal       | throws message / replaces                   |
 * | R4   | empty type                                         | Invalid input  | throws                                      |
 * | R5   | meta / indicator type mismatch                     | Invalid input  | throws with both types                      |
 * | R6   | registerBuiltInIndicators twice                    | Boundary       | no throw (replace)                          |
 * | P1   | resolveNumberParam: valid / NaN / string / null    | Invalid input  | value / default                              |
 * | P2   | resolveNumberParam: below min / above max / float  | Boundary       | clamped / rounded (integer only)            |
 * | P3   | resolveSourceParam valid / invalid                 | Equivalence    | value / default                              |
 * | P4   | paramDefaults frozen                               | Normal         | key → default, frozen                        |
 * | P5   | formatIndicatorLabel: missing values, non-default  | Boundary       | skips missing, appends non-default source   |
 * | D1   | normalizeIndicator defaults                        | Normal         | resolved config, price pane, visible style  |
 * | D2   | pane placement                                     | Equivalence    | `pane:<id>`                                  |
 * | D3   | patch over previous (config, style, pane)          | Normal         | merged                                       |
 * | D4   | sameConfig equal / different key count / NaN       | Boundary       | true / false / Object.is                     |
 * | D5   | createIndicatorEntry label                         | Normal         | label from resolved config                   |
 * | D6   | entry of a module with guides (RSI) / without      | Equivalence    | guides from config / undefined               |
 * | D7   | indicatorScale: explicit / overlay / pane default  | Equivalence    | spec / price / auto                          |
 */
import { describe, expect, it } from '@jest/globals';
import { PRICE_PANE_ID } from '../../panes/Pane';
import {
  createIndicatorRegistry,
  registerBuiltInIndicators,
} from '../builtins';
import { atrModule } from '../builtins/Atr';
import { emaModule, smaModule } from '../builtins/MovingAverages';
import { rsiModule } from '../builtins/Rsi';
import {
  formatIndicatorLabel,
  paramDefaults,
  periodParam,
  resolveNumberParam,
  resolveSourceParam,
  sourceParam,
  type NumberParam,
} from '../IndicatorConfig';
import {
  createIndicatorEntry,
  defaultPaneId,
  normalizeIndicator,
  sameConfig,
} from '../IndicatorDefinitions';
import {
  indicatorScale,
  IndicatorRegistry,
  type IndicatorModule,
} from '../IndicatorRegistry';

const paneModule: IndicatorModule = {
  ...(emaModule as IndicatorModule),
  meta: { ...emaModule.meta, type: 'custom', placement: 'pane' },
  indicator: {
    ...emaModule.indicator,
    type: 'custom',
  } as IndicatorModule['indicator'],
};

describe('IndicatorRegistry', () => {
  it('R1: built-ins', () => {
    // Given / When
    const r = createIndicatorRegistry();
    // Then
    expect(r.list().map((m) => m.type)).toEqual([
      'sma',
      'ema',
      'wma',
      'bollinger',
      'volume',
      'rsi',
      'macd',
      'atr',
    ]);
  });

  it('R2: register / get / has / unregister', () => {
    // Given
    const r = new IndicatorRegistry();
    // When
    r.register(paneModule);
    // Then
    expect(r.has('custom')).toBe(true);
    expect(r.get('custom')).toBe(paneModule);
    expect(r.unregister('custom')).toBe(true);
    expect(r.unregister('custom')).toBe(false);
    expect(r.get('custom')).toBeUndefined();
  });

  it('R3: duplicates', () => {
    // Given
    const r = new IndicatorRegistry();
    r.register(smaModule);
    // When / Then
    expect(() => r.register(smaModule)).toThrow(
      'IndicatorRegistry: "sma" is already registered'
    );
    expect(() => r.register(smaModule, true)).not.toThrow();
    expect(r.list()).toHaveLength(1);
  });

  it('R4: empty type', () => {
    // Given
    const bad = { ...paneModule, meta: { ...paneModule.meta, type: '' } };
    // When / Then
    expect(() => new IndicatorRegistry().register(bad)).toThrow(
      'IndicatorRegistry: indicator type must be non-empty'
    );
  });

  it('R5: type mismatch', () => {
    // Given
    const bad = { ...paneModule, indicator: emaModule.indicator };
    // When / Then
    expect(() =>
      new IndicatorRegistry().register(bad as IndicatorModule)
    ).toThrow('meta type "custom" does not match indicator type "ema"');
  });

  it('R6: built-ins can be registered twice', () => {
    // Given
    const r = createIndicatorRegistry();
    // When / Then
    expect(() => registerBuiltInIndicators(r)).not.toThrow();
  });
});

describe('IndicatorConfig', () => {
  const p = periodParam(14);
  const f: NumberParam = { ...p, key: 'f', kind: 'number', min: 0.5, max: 3 };

  it('P1: invalid numbers fall back to the default', () => {
    // Given / When / Then
    expect(resolveNumberParam({ period: 20 }, p)).toBe(20);
    expect(resolveNumberParam({ period: NaN }, p)).toBe(14);
    expect(resolveNumberParam({ period: Infinity }, p)).toBe(14);
    expect(resolveNumberParam({ period: '20' }, p)).toBe(14);
    expect(resolveNumberParam(null, p)).toBe(14);
    expect(resolveNumberParam(undefined, p)).toBe(14);
  });

  it('P2: clamps and rounds', () => {
    // Given / When / Then
    expect(resolveNumberParam({ period: 0 }, p)).toBe(1);
    expect(resolveNumberParam({ period: 1 }, p)).toBe(1);
    expect(resolveNumberParam({ period: 5000 }, p)).toBe(5000);
    expect(resolveNumberParam({ period: 5001 }, p)).toBe(5000);
    expect(resolveNumberParam({ period: 2.5 }, p)).toBe(3);
    expect(resolveNumberParam({ f: 1.25 }, f)).toBe(1.25);
    expect(resolveNumberParam({ f: 0.1 }, f)).toBe(0.5);
  });

  it('P3: sources', () => {
    // Given
    const s = sourceParam('hl2');
    // When / Then
    expect(resolveSourceParam({ source: 'ohlc4' }, s)).toBe('ohlc4');
    expect(resolveSourceParam({ source: 'volume' }, s)).toBe('hl2');
    expect(resolveSourceParam(undefined, sourceParam())).toBe('close');
  });

  it('P4: defaults are frozen', () => {
    // Given / When
    const d = paramDefaults([p, sourceParam()]);
    // Then
    expect(d).toEqual({ period: 14, source: 'close' });
    expect(Object.isFrozen(d)).toBe(true);
  });

  it('P5: labels', () => {
    // Given
    const params = [p, sourceParam()];
    // When / Then
    expect(formatIndicatorLabel('X', params, {})).toBe('X');
    expect(
      formatIndicatorLabel('X', params, { period: 3, source: 'close' })
    ).toBe('X 3');
    expect(
      formatIndicatorLabel('X', params, { period: 3, source: 'low' })
    ).toBe('X 3 low');
    expect(formatIndicatorLabel('X', params, { source: 7 })).toBe('X');
  });
});

describe('IndicatorDefinitions', () => {
  it('D1: defaults', () => {
    // Given / When
    const d = normalizeIndicator(
      emaModule as IndicatorModule,
      { type: 'ema' },
      'e'
    );
    // Then
    expect(d).toEqual({
      id: 'e',
      type: 'ema',
      paneId: PRICE_PANE_ID,
      config: { period: 9, source: 'close' },
      style: { visible: true },
    });
    expect(Object.isFrozen(d.config)).toBe(true);
  });

  it('D2: pane placement', () => {
    // Given / When / Then
    expect(defaultPaneId(paneModule.meta, 'x')).toBe('pane:x');
    expect(normalizeIndicator(paneModule, { type: 'custom' }, 'x').paneId).toBe(
      'pane:x'
    );
  });

  it('D3: patches over the previous definition', () => {
    // Given
    const m = emaModule as IndicatorModule;
    const prev = normalizeIndicator(
      m,
      {
        type: 'ema',
        config: { period: 20, source: 'hl2' },
        style: { lineWidth: 3 },
        paneId: 'p',
      },
      'e'
    );
    // When
    const next = normalizeIndicator(
      m,
      { type: 'ema', config: { period: 30 }, style: { visible: false } },
      'e',
      prev
    );
    // Then
    expect(next.config).toEqual({ period: 30, source: 'hl2' });
    expect(next.style).toEqual({ visible: false, lineWidth: 3 });
    expect(next.paneId).toBe('p');
  });

  it('D4: sameConfig', () => {
    // Given / When / Then
    expect(sameConfig({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
    expect(sameConfig({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameConfig({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameConfig({ a: NaN }, { a: NaN })).toBe(true);
    expect(sameConfig({}, {})).toBe(true);
  });

  it('D5: entry label', () => {
    // Given / When
    const { entry, config } = createIndicatorEntry(
      emaModule as IndicatorModule,
      { type: 'ema', config: { period: 50 } },
      'e'
    );
    // Then
    expect(entry.label).toBe('EMA 50');
    expect(entry.meta).toBe(emaModule.meta);
    expect(config).toEqual({ period: 50, source: 'close' });
  });

  it('D6: entry guides', () => {
    // Given / When
    const rsi = createIndicatorEntry(
      rsiModule as IndicatorModule,
      { type: 'rsi', config: { overbought: 80 } },
      'r'
    ).entry;
    const ema = createIndicatorEntry(
      emaModule as IndicatorModule,
      { type: 'ema' },
      'e'
    ).entry;
    // Then
    expect(rsi.guides?.levels).toEqual([80, 50, 30]);
    expect(ema.guides).toBeUndefined();
    expect(rsi.label).toBe('RSI 14');
  });

  it('D7: scale strategy defaults', () => {
    // Given
    const pane = { ...emaModule.meta, placement: 'pane' as const };
    // When / Then
    expect(indicatorScale(rsiModule.meta)).toEqual({
      kind: 'fixed',
      min: 0,
      max: 100,
    });
    expect(indicatorScale(emaModule.meta)).toEqual({ kind: 'price' });
    expect(indicatorScale(pane)).toEqual({ kind: 'auto' });
    expect(atrModule.formatLabel({ period: 5 })).toBe('ATR 5');
  });
});
