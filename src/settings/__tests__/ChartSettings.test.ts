/**
 * Test perspective table — ChartSettings (serializable settings model, spec §25)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                        |
 * |------|----------------------------------------------------------|--------------------|-------------------------------------------------|
 * | S1   | defaults                                                 | Boundary (empty)   | version 1, no indicators / panes                |
 * | S2   | createChartSettings from entries + panes + extras        | Equivalence        | plain data, price pane explicit                 |
 * | S3   | isExplicitPane omitted                                   | Boundary (NULL)    | non-price panes not explicit                    |
 * | S4   | serialize → deserialize round trip                       | Equivalence        | deep equal, no issues                           |
 * | S5   | parsed object input                                      | Equivalence        | accepted                                        |
 * | S6   | invalid JSON / '' / non-object / array / null            | Invalid format     | defaults + root issue                           |
 * | S7   | version missing / 0 / '1' / 2 (newer)                    | Boundary (±1)      | defaults + version issue                        |
 * | S8   | indicators not an array / missing lists                  | Invalid / empty    | issue / silently empty                          |
 * | S9   | indicator entry not object, bad/duplicate id, bad type   | Invalid            | dropped with path                               |
 * | S10  | unknown type via isKnownType                             | Abnormal           | dropped                                         |
 * | S11  | missing paneId                                           | Invalid            | dropped                                         |
 * | S12  | config with NaN / Infinity / object / null values        | Invalid type       | those keys dropped, others kept                 |
 * | S13  | config / style not objects                               | Invalid type       | empty + issue                                   |
 * | S14  | style: every field invalid                               | Invalid            | empty style, one issue per field                |
 * | S15  | style: boundary values opacity 0 / 1, lineWidth 0        | Boundary           | 0 / 1 kept, lineWidth 0 dropped                 |
 * | S15b | style {}                                                 | Boundary (empty)   | empty style, no issues                          |
 * | S16  | panes: bad entry / duplicate / ratio 0 / NaN / Infinity  | Invalid / boundary | dropped                                         |
 * | S17  | panes: minHeight negative / missing, explicit junk       | Boundary           | minHeight 0, explicit false (price true)        |
 * | S18  | theme / timeframe non-string / empty                     | Invalid            | issue, field omitted                            |
 * | S19  | settingsToIndicatorInputs                                | Equivalence        | copies (mutation-safe)                          |
 */
import { describe, expect, it } from '@jest/globals';
import type { IndicatorDefinition } from '../../indicators/Indicator';
import type { PaneDefinition } from '../../panes/Pane';
import {
  CHART_SETTINGS_VERSION,
  createChartSettings,
  defaultChartSettings,
  deserializeChartSettings,
  serializeChartSettings,
  settingsToIndicatorInputs,
  type ChartSettings,
} from '../ChartSettings';

const pane = (id: string, heightRatio = 1): PaneDefinition => ({
  id,
  type: id === 'price' ? 'price' : 'indicator',
  heightRatio,
  minHeight: 40,
  indicatorIds: [],
});

const definition = (
  id: string,
  type: string,
  paneId: string
): { definition: IndicatorDefinition } => ({
  definition: {
    id,
    type,
    paneId,
    config: { period: 14, source: 'close' },
    style: { visible: true, lineWidth: 2, colors: ['#fff'] },
  } as unknown as IndicatorDefinition,
});

const sample = (): ChartSettings =>
  createChartSettings({
    indicators: [
      definition('ema-1', 'ema', 'price'),
      definition('rsi-1', 'rsi', 'pane:rsi-1'),
    ],
    panes: [pane('price', 3), pane('pane:rsi-1'), pane('custom')],
    isExplicitPane: (id) => id === 'custom',
    theme: 'dark',
    timeframe: '1m',
  });

const withRaw = (patch: Record<string, unknown>) => ({
  version: CHART_SETTINGS_VERSION,
  ...patch,
});

describe('createChartSettings / serialize', () => {
  it('S1: defaults', () => {
    // Given / When / Then
    expect(defaultChartSettings()).toEqual({
      version: 1,
      indicators: [],
      panes: [],
    });
  });

  it('S2: snapshots plain data', () => {
    // Given / When
    const settings = sample();
    // Then
    expect(settings.indicators[1]).toEqual({
      id: 'rsi-1',
      type: 'rsi',
      paneId: 'pane:rsi-1',
      config: { period: 14, source: 'close' },
      style: { visible: true, lineWidth: 2, colors: ['#fff'] },
    });
    expect(settings.panes.map((p) => [p.id, p.explicit])).toEqual([
      ['price', true],
      ['pane:rsi-1', false],
      ['custom', true],
    ]);
    expect(settings.theme).toBe('dark');
    expect(settings.timeframe).toBe('1m');
  });

  it('S3: without isExplicitPane only the price pane is explicit', () => {
    // Given / When
    const settings = createChartSettings({
      indicators: [],
      panes: [pane('price'), pane('custom')],
    });
    // Then
    expect(settings.panes.map((p) => p.explicit)).toEqual([true, false]);
    expect('theme' in settings).toBe(false);
  });

  it('S4: round trip', () => {
    // Given
    const settings = sample();
    // When
    const { settings: back, issues } = deserializeChartSettings(
      serializeChartSettings(settings)
    );
    // Then
    expect(issues).toEqual([]);
    expect(back).toEqual(settings);
  });

  it('S5: accepts a parsed object', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(sample());
    // Then
    expect(issues).toEqual([]);
    expect(settings.indicators).toHaveLength(2);
  });
});

describe('deserializeChartSettings: rejected payloads', () => {
  it.each([
    ['{oops', 'invalid JSON'],
    ['', 'invalid JSON'],
    ['42', 'not an object'],
    ['[]', 'not an object'],
    ['null', 'not an object'],
  ])('S6: %p → defaults (%s)', (input, reason) => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(input);
    // Then
    expect(settings).toEqual(defaultChartSettings());
    expect(issues).toEqual([{ path: '', reason }]);
  });

  it.each([
    [undefined, 'missing or invalid version'],
    [0, 'missing or invalid version'],
    ['1', 'missing or invalid version'],
    [2, 'unsupported version 2'],
  ])('S7: version %p → defaults', (version, reason) => {
    // Given / When
    const { settings, issues } = deserializeChartSettings({
      version,
      indicators: sample().indicators,
    });
    // Then
    expect(settings.indicators).toEqual([]);
    expect(issues).toEqual([{ path: 'version', reason }]);
  });
});

describe('deserializeChartSettings: entry validation', () => {
  it('S8: lists must be arrays; missing lists are empty', () => {
    // Given / When
    const bad = deserializeChartSettings(withRaw({ indicators: {}, panes: 1 }));
    const missing = deserializeChartSettings(withRaw({}));
    // Then
    expect(bad.issues).toEqual([
      { path: 'indicators', reason: 'not an array' },
      { path: 'panes', reason: 'not an array' },
    ]);
    expect(missing.issues).toEqual([]);
    expect(missing.settings).toEqual(defaultChartSettings());
  });

  it('S9: drops malformed indicators with their path', () => {
    // Given
    const ok = { id: 'a', type: 'ema', paneId: 'price' };
    // When
    const { settings, issues } = deserializeChartSettings(
      withRaw({
        indicators: [
          ok,
          'x',
          { ...ok, id: '' },
          { ...ok },
          { ...ok, id: 'b', type: 7 },
        ],
      })
    );
    // Then
    expect(settings.indicators.map((i) => i.id)).toEqual(['a']);
    expect(issues).toEqual([
      { path: 'indicators[1]', reason: 'not an object' },
      { path: 'indicators[2].id', reason: 'missing or duplicate id' },
      { path: 'indicators[3].id', reason: 'missing or duplicate id' },
      { path: 'indicators[4].type', reason: 'unknown indicator type' },
    ]);
  });

  it('S10: drops unknown types', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      sample(),
      (type) => type === 'ema'
    );
    // Then
    expect(settings.indicators.map((i) => i.type)).toEqual(['ema']);
    expect(issues).toEqual([
      { path: 'indicators[1].type', reason: 'unknown indicator type' },
    ]);
  });

  it('S11: drops indicators without a pane', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      withRaw({ indicators: [{ id: 'a', type: 'ema', paneId: '' }] })
    );
    // Then
    expect(settings.indicators).toEqual([]);
    expect(issues).toEqual([
      { path: 'indicators[0].paneId', reason: 'missing pane id' },
    ]);
  });

  it('S12: drops unsupported config values only', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      withRaw({
        indicators: [
          {
            id: 'a',
            type: 'ema',
            paneId: 'price',
            config: { period: 20, source: 'hl2', on: false, bad: null },
          },
        ],
      })
    );
    // Then
    expect(settings.indicators[0]?.config).toEqual({
      period: 20,
      source: 'hl2',
      on: false,
    });
    expect(issues).toEqual([
      { path: 'indicators[0].config.bad', reason: 'unsupported value' },
    ]);
  });

  it('S12b: non-finite numbers and objects in config are dropped', () => {
    // Given
    const raw = withRaw({
      indicators: [
        {
          id: 'a',
          type: 'ema',
          paneId: 'price',
          config: { a: NaN, b: Infinity, c: { x: 1 } },
        },
      ],
    });
    // When
    const { settings, issues } = deserializeChartSettings(raw);
    // Then
    expect(settings.indicators[0]?.config).toEqual({});
    expect(issues).toHaveLength(3);
  });

  it('S13: config and style must be objects', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      withRaw({
        indicators: [
          { id: 'a', type: 'ema', paneId: 'price', config: 5, style: [] },
        ],
      })
    );
    // Then
    expect(settings.indicators[0]).toMatchObject({ config: {}, style: {} });
    expect(issues).toEqual([
      { path: 'indicators[0].config', reason: 'not an object' },
      { path: 'indicators[0].style', reason: 'not an object' },
    ]);
  });

  it('S14: every invalid style field is reported and dropped', () => {
    // Given
    const style = {
      visible: 'yes',
      lineWidth: -1,
      opacity: 2,
      fill: 1,
      fillOpacity: NaN,
      colors: ['#fff', 3],
      histogramColorMode: 'rainbow',
    };
    // When
    const { settings, issues } = deserializeChartSettings(
      withRaw({ indicators: [{ id: 'a', type: 'ema', paneId: 'p', style }] })
    );
    // Then
    expect(settings.indicators[0]?.style).toEqual({});
    expect(issues.map((i) => i.path.split('.').pop())).toEqual([
      'visible',
      'lineWidth',
      'opacity',
      'fill',
      'fillOpacity',
      'colors',
      'histogramColorMode',
    ]);
  });

  it('S15: style boundary values', () => {
    // Given
    const style = {
      visible: false,
      lineWidth: 0,
      opacity: 0,
      fill: true,
      fillOpacity: 1,
      colors: [],
      histogramColorMode: 'trend',
    };
    // When
    const { settings, issues } = deserializeChartSettings(
      withRaw({ indicators: [{ id: 'a', type: 'ema', paneId: 'p', style }] })
    );
    // Then
    expect(settings.indicators[0]?.style).toEqual({
      visible: false,
      opacity: 0,
      fill: true,
      fillOpacity: 1,
      colors: [],
      histogramColorMode: 'trend',
    });
    expect(issues).toEqual([
      { path: 'indicators[0].style.lineWidth', reason: 'invalid value' },
    ]);
  });

  it('S15b: an empty style is valid', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      withRaw({
        indicators: [{ id: 'a', type: 'ema', paneId: 'p', style: {} }],
      })
    );
    // Then
    expect(settings.indicators[0]?.style).toEqual({});
    expect(issues).toEqual([]);
  });

  it('S16: drops invalid panes', () => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(
      withRaw({
        panes: [
          { id: 'price', heightRatio: 3 },
          null,
          { id: 'price', heightRatio: 1 },
          { id: 'a', heightRatio: 0 },
          { id: 'b', heightRatio: NaN },
          { id: 'c', heightRatio: Infinity },
          { id: '', heightRatio: 1 },
        ],
      })
    );
    // Then
    expect(settings.panes.map((p) => p.id)).toEqual(['price']);
    expect(issues.map((i) => i.path)).toEqual([
      'panes[1]',
      'panes[2]',
      'panes[3].heightRatio',
      'panes[4].heightRatio',
      'panes[5].heightRatio',
      'panes[6]',
    ]);
  });

  it('S17: sanitizes minHeight and explicit', () => {
    // Given / When
    const { settings } = deserializeChartSettings(
      withRaw({
        panes: [
          { id: 'price', heightRatio: 3, explicit: false },
          { id: 'a', heightRatio: 1, minHeight: -5, explicit: 'yes' },
          { id: 'b', heightRatio: 1, minHeight: 0, explicit: true },
          { id: 'c', heightRatio: 1, minHeight: Infinity },
        ],
      })
    );
    // Then
    expect(settings.panes.map((p) => [p.id, p.minHeight, p.explicit])).toEqual([
      ['price', 0, true],
      ['a', 0, false],
      ['b', 0, true],
      ['c', 0, false],
    ]);
  });

  it.each([
    [{ theme: 3 }, 'theme'],
    [{ timeframe: '' }, 'timeframe'],
    [{ theme: null }, 'theme'],
  ])('S18: %p is reported', (patch, key) => {
    // Given / When
    const { settings, issues } = deserializeChartSettings(withRaw(patch));
    // Then
    expect(key in settings).toBe(false);
    expect(issues).toEqual([{ path: key, reason: 'not a string' }]);
  });
});

describe('settingsToIndicatorInputs', () => {
  it('S19: returns mutation-safe copies', () => {
    // Given
    const settings = sample();
    // When
    const inputs = settingsToIndicatorInputs(settings);
    (inputs[0]?.config as Record<string, unknown>).period = 99;
    // Then
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      id: 'ema-1',
      type: 'ema',
      paneId: 'price',
    });
    expect(settings.indicators[0]?.config.period).toBe(14);
  });
});
