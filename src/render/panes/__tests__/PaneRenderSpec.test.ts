/**
 * Test perspective table — resolvePaneSpecs / resolveIndicatorDrawSpec histograms
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                        |
 * |------|----------------------------------------------------------|--------------------|-------------------------------------------------|
 * | P1   | RSI + MACD + volume panes                                | Normal             | one spec per pane in pane order                 |
 * | P2   | RSI                                                      | Normal             | fixed scale, decimals 2, guides 70/50/30 + band |
 * | P3   | MACD default / sign mode / explicit color                | Equivalence        | 4 trend colors / strong pair / single color     |
 * | P4   | volume in its pane / on the price pane                   | Equivalence        | candle mode with theme colors, overlay flag     |
 * | P5   | price pane without non-price indicators                  | Boundary (empty)   | no price spec                                   |
 * | P6   | empty indicator pane (explicit)                          | Boundary (empty)   | spec with auto scale, default format            |
 * | P7   | hidden indicator first                                   | Equivalence        | skipped, scale from the next visible one        |
 * | P8   | indicator on an unknown pane                             | Abnormal           | ignored                                         |
 * | P9   | guides: duplicates, NaN levels, invalid band, 2 bands    | Invalid / Boundary | merged unique finite levels, first valid band   |
 * | P10  | valueFormat decimals NaN / 20                            | Invalid / Boundary | −1 / 12                                         |
 * | P11  | palette slots for pane indicators / empty palette        | Boundary           | cycle / fallback color                          |
 * | P12  | refs                                                     | Normal             | histograms then strokes                         |
 * | H1   | histogram w/o default colors (sign / trend), one default | Boundary           | base / single default color repeated            |
 * | H2   | 2 default colors in sign mode                            | Equivalence        | both used                                       |
 */
import { describe, expect, it } from '@jest/globals';
import { createIndicatorRegistry } from '../../../indicators/builtins';
import type { IndicatorInput } from '../../../indicators/Indicator';
import {
  createIndicatorEntry,
  type IndicatorEntry,
} from '../../../indicators/IndicatorDefinitions';
import type {
  IndicatorModule,
  IndicatorSeriesDescriptor,
} from '../../../indicators/IndicatorRegistry';
import { MACD_HISTOGRAM_COLORS } from '../../../indicators/builtins/Macd';
import { createPricePane, type PaneDefinition } from '../../../panes/Pane';
import {
  FALLBACK_INDICATOR_COLOR,
  resolveIndicatorDrawSpec,
} from '../../indicators/OverlayRenderSpec';
import { resolvePaneSpecs } from '../PaneRenderSpec';

const registry = createIndicatorRegistry();
const THEME = {
  indicatorPalette: ['#111', '#222'],
  volume: { up: '#0F0', down: '#F00' },
};
const VOLUME = THEME.volume;

function entry(
  input: IndicatorInput,
  id = input.type,
  module?: IndicatorModule
): IndicatorEntry {
  const m = module ?? registry.get(input.type);
  if (!m) throw new Error('unknown');
  return createIndicatorEntry(m, input, id).entry;
}

function pane(id: string): PaneDefinition {
  return {
    id,
    type: 'indicator',
    heightRatio: 1,
    minHeight: 0,
    indicatorIds: [],
  };
}

function withSeries(
  series: IndicatorSeriesDescriptor[],
  patch: Partial<IndicatorModule['meta']> = {}
): IndicatorModule {
  const base = registry.get('atr') as IndicatorModule;
  return { ...base, meta: { ...base.meta, series, ...patch } };
}

const PRICE = createPricePane();

describe('resolvePaneSpecs', () => {
  it('P1 / P2: pane order and RSI settings', () => {
    // Given
    const entries = [
      entry({ type: 'macd' }),
      entry({ type: 'rsi' }),
      entry({ type: 'volume' }),
    ];
    const panes = [
      PRICE,
      pane('pane:rsi'),
      pane('pane:macd'),
      pane('pane:volume'),
    ];
    // When
    const specs = resolvePaneSpecs(entries, panes, THEME);
    // Then
    expect(specs.map((s) => s.paneId)).toEqual([
      'pane:rsi',
      'pane:macd',
      'pane:volume',
    ]);
    const [rsi] = specs;
    expect(rsi).toMatchObject({
      overlay: false,
      scale: { kind: 'fixed', min: 0, max: 100 },
      format: { decimals: 2, compact: false },
      guides: { levels: [70, 50, 30], band: { upper: 70, lower: 30 } },
      refs: [{ id: 'rsi', output: 0 }],
    });
    expect(rsi?.indicators[0]?.strokes[0]?.color).toBe('#7E57C2');
  });

  it('P3: MACD histogram color modes', () => {
    // Given
    const panes = [PRICE, pane('pane:m')];
    const make = (input: Partial<IndicatorInput>) =>
      resolvePaneSpecs(
        [entry({ type: 'macd', paneId: 'pane:m', ...input }, 'm')],
        panes,
        THEME
      )[0]?.indicators[0]?.histograms[0];
    // When
    const trend = make({});
    const sign = make({ style: { visible: true, histogramColorMode: 'sign' } });
    const single = make({ style: { visible: true, colors: ['#ABC'] } });
    const signSingle = make({
      style: { visible: true, colors: ['#ABC'], histogramColorMode: 'sign' },
    });
    // Then
    expect(trend).toMatchObject({
      mode: 'trend',
      colors: [...MACD_HISTOGRAM_COLORS],
    });
    expect(sign?.colors).toEqual([
      MACD_HISTOGRAM_COLORS[0],
      MACD_HISTOGRAM_COLORS[2],
    ]);
    expect(single?.colors).toEqual(['#ABC', '#ABC', '#ABC', '#ABC']);
    expect(signSingle?.colors).toEqual(['#ABC', '#ABC']);
  });

  it('P4: volume pane and volume overlay', () => {
    // Given
    const inPane = entry({ type: 'volume', config: { maPeriod: 20 } });
    const onPrice = entry({ type: 'volume', paneId: 'price' }, 'v2');
    // When
    const [own] = resolvePaneSpecs(
      [inPane],
      [PRICE, pane('pane:volume')],
      THEME
    );
    const [overlay] = resolvePaneSpecs(
      [onPrice, entry({ type: 'ema' })],
      [PRICE],
      THEME
    );
    // Then
    expect(own).toMatchObject({
      scale: { kind: 'volume' },
      format: { decimals: -1, compact: true },
    });
    expect(own?.indicators[0]?.histograms).toEqual([
      { output: 0, mode: 'candle', colors: ['#0F0', '#F00'], opacity: 1 },
    ]);
    expect(own?.indicators[0]?.legend.map((l) => l.color)).toEqual([
      '#0F0',
      '#F0B90B',
    ]);
    expect(overlay).toMatchObject({ paneId: 'price', overlay: true });
    expect(overlay?.indicators.map((i) => i.id)).toEqual(['v2']);
  });

  it('P5 / P6: price pane without extras, empty explicit pane', () => {
    // Given / When
    const specs = resolvePaneSpecs(
      [entry({ type: 'ema' })],
      [PRICE, pane('mine')],
      THEME
    );
    // Then
    expect(specs).toEqual([
      {
        paneId: 'mine',
        overlay: false,
        scale: { kind: 'auto' },
        format: { decimals: -1, compact: false },
        indicators: [],
        guides: { levels: [], band: null },
        refs: [],
      },
    ]);
  });

  it('P7: hidden indicators are skipped', () => {
    // Given
    const entries = [
      entry({ type: 'rsi', paneId: 'p', style: { visible: false } }),
      entry({ type: 'atr', paneId: 'p' }),
    ];
    // When
    const [spec] = resolvePaneSpecs(entries, [PRICE, pane('p')], THEME);
    // Then
    expect(spec?.scale).toEqual({ kind: 'auto' });
    expect(spec?.indicators.map((i) => i.id)).toEqual(['atr']);
    expect(spec?.guides.levels).toEqual([]);
  });

  it('P8: indicators on unknown panes are ignored', () => {
    // Given / When
    const specs = resolvePaneSpecs(
      [entry({ type: 'rsi', paneId: 'ghost' })],
      [PRICE],
      THEME
    );
    // Then
    expect(specs).toEqual([]);
  });

  it('P9: guides are merged', () => {
    // Given
    const rsi = registry.get('rsi') as IndicatorModule;
    const odd: IndicatorModule = {
      ...rsi,
      guides: () => ({ levels: [50, NaN, 90], band: { upper: NaN, lower: 0 } }),
    };
    const other: IndicatorModule = {
      ...rsi,
      guides: () => ({ levels: [], band: { upper: 90, lower: 10 } }),
    };
    const entries = [
      entry({ type: 'rsi', paneId: 'p' }, 'a', odd),
      entry({ type: 'rsi', paneId: 'p' }, 'b', other),
      entry({ type: 'rsi', paneId: 'p' }, 'c'),
      entry({ type: 'atr', paneId: 'p' }, 'd'),
    ];
    // When
    const [spec] = resolvePaneSpecs(entries, [PRICE, pane('p')], THEME);
    // Then
    expect(spec?.guides).toEqual({
      levels: [50, 90, 70, 30],
      band: { upper: 90, lower: 10 },
    });
  });

  it('P10: value format decimals are sanitized', () => {
    // Given
    const line: IndicatorSeriesDescriptor = {
      kind: 'line',
      name: 'L',
      output: 0,
    };
    const nan = withSeries([line], { valueFormat: { decimals: NaN } });
    const big = withSeries([line], { valueFormat: { decimals: 20 } });
    // When
    const [a] = resolvePaneSpecs(
      [entry({ type: 'atr', paneId: 'p' }, 'a', nan)],
      [PRICE, pane('p')],
      THEME
    );
    const [b] = resolvePaneSpecs(
      [entry({ type: 'atr', paneId: 'p' }, 'b', big)],
      [PRICE, pane('p')],
      THEME
    );
    // Then
    expect(a?.format.decimals).toBe(-1);
    expect(b?.format.decimals).toBe(12);
  });

  it('P11: palette slots and empty palette', () => {
    // Given
    const plain = withSeries([{ kind: 'line', name: 'L', output: 0 }]);
    const entries = ['a', 'b', 'c'].map((id) =>
      entry({ type: 'atr', paneId: 'p' }, id, plain)
    );
    // When
    const [cycled] = resolvePaneSpecs(entries, [PRICE, pane('p')], THEME);
    const [empty] = resolvePaneSpecs(entries, [PRICE, pane('p')], {
      ...THEME,
      indicatorPalette: [],
    });
    // Then
    expect(cycled?.indicators.map((i) => i.strokes[0]?.color)).toEqual([
      '#111',
      '#222',
      '#111',
    ]);
    expect(empty?.indicators[0]?.strokes[0]?.color).toBe(
      FALLBACK_INDICATOR_COLOR
    );
  });

  it('P12: auto-scale refs', () => {
    // Given / When
    const [spec] = resolvePaneSpecs(
      [entry({ type: 'macd' })],
      [PRICE, pane('pane:macd')],
      THEME
    );
    // Then
    expect(spec?.refs).toEqual([
      { id: 'macd', output: 2 },
      { id: 'macd', output: 0 },
      { id: 'macd', output: 1 },
    ]);
  });
});

describe('resolveIndicatorDrawSpec histograms', () => {
  const hist = (extra: object): IndicatorSeriesDescriptor => ({
    kind: 'histogram',
    name: 'H',
    output: 0,
    ...extra,
  });

  it('H1: missing default colors', () => {
    // Given
    const sign = entry({ type: 'atr' }, 'a', withSeries([hist({})]));
    const trend = entry(
      { type: 'atr' },
      'b',
      withSeries([hist({ colorMode: 'trend' })])
    );
    const one = entry(
      { type: 'atr' },
      'c',
      withSeries([hist({ defaultColor: '#ABC' })])
    );
    // When / Then
    expect(
      resolveIndicatorDrawSpec(sign, '#999', VOLUME).histograms[0]
    ).toMatchObject({
      mode: 'sign',
      colors: ['#999', '#999'],
    });
    expect(
      resolveIndicatorDrawSpec(trend, '#999', VOLUME).histograms[0]?.colors
    ).toEqual(['#999', '#999', '#999', '#999']);
    expect(
      resolveIndicatorDrawSpec(one, '#999', VOLUME).histograms[0]?.colors
    ).toEqual(['#ABC', '#ABC']);
  });

  it('H2: two default colors in sign mode', () => {
    // Given
    const e = entry(
      { type: 'atr' },
      'a',
      withSeries([hist({ defaultColors: ['#1', '#2'] })])
    );
    // When / Then
    expect(
      resolveIndicatorDrawSpec(e, '#999', VOLUME).histograms[0]?.colors
    ).toEqual(['#1', '#2']);
  });
});
