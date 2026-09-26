/**
 * Test perspective table — resolveOverlaySpecs / overlayAutoScaleRefs
 *
 * | Case | Input / Precondition                                 | Perspective      | Expected                                       |
 * |------|------------------------------------------------------|------------------|------------------------------------------------|
 * | O1   | EMA + BB on the price pane, default style            | Normal           | palette colors in order, band fill + 3 strokes |
 * | O2   | style colors / series default color                  | Equivalence      | precedence colors → default → palette          |
 * | O3   | hidden overlay                                       | Equivalence      | skipped but consumes its palette slot          |
 * | O4   | other pane                                           | Equivalence      | skipped, no slot consumed                      |
 * | O5   | lineWidth 0 / −1 / ∞ / 3                             | Boundary         | default / default / default / 3                |
 * | O6   | opacity −1 / 0 / 2 / fillOpacity                     | Boundary         | fallback / 0 / 1 / custom                      |
 * | O7   | fill false                                           | Equivalence      | no fill, strokes kept                          |
 * | O8   | empty palette / palette cycling                      | Boundary (empty) | fallback color / wraps                         |
 * | O9   | histogram series                                     | Equivalence      | skipped                                        |
 * | O11  | non-price-scaled indicator on the price pane         | Equivalence      | skipped, no slot consumed                      |
 * | O10  | empty entries                                        | Boundary (empty) | []                                             |
 * | R1   | auto-scale refs                                      | Normal           | one per stroke                                 |
 */
import { describe, expect, it } from '@jest/globals';
import { createIndicatorRegistry } from '../../../indicators/builtins';
import type { IndicatorInput } from '../../../indicators/Indicator';
import {
  createIndicatorEntry,
  type IndicatorEntry,
} from '../../../indicators/IndicatorDefinitions';
import type { IndicatorModule } from '../../../indicators/IndicatorRegistry';
import {
  DEFAULT_BAND_FILL_OPACITY,
  DEFAULT_INDICATOR_LINE_WIDTH,
  FALLBACK_INDICATOR_COLOR,
  overlayAutoScaleRefs,
  resolveOverlaySpecs,
} from '../OverlayRenderSpec';

const registry = createIndicatorRegistry();
const PALETTE = ['#111', '#222', '#333'];

function entry(
  input: IndicatorInput,
  id = input.type,
  module?: IndicatorModule
): IndicatorEntry {
  const m = module ?? registry.get(input.type);
  if (!m) throw new Error('unknown');
  return createIndicatorEntry(m, input, id).entry;
}

describe('resolveOverlaySpecs', () => {
  it('O1: defaults', () => {
    // Given
    const entries = [entry({ type: 'ema' }), entry({ type: 'bollinger' })];
    // When
    const [ema, bb] = resolveOverlaySpecs(entries, PALETTE);
    // Then
    expect(ema).toEqual({
      id: 'ema',
      label: 'EMA 9',
      fills: [],
      strokes: [
        {
          output: 0,
          color: '#111',
          width: DEFAULT_INDICATOR_LINE_WIDTH,
          opacity: 1,
          offset: 0,
          dots: false,
        },
      ],
      legend: [{ output: 0, color: '#111', offset: 0 }],
    });
    expect(bb?.fills).toEqual([
      {
        upper: 0,
        lower: 2,
        color: '#222',
        opacity: DEFAULT_BAND_FILL_OPACITY,
        offset: 0,
      },
    ]);
    expect(bb?.strokes.map((s) => s.output)).toEqual([1, 0, 2]);
    expect(bb?.legend.map((l) => l.output)).toEqual([1, 0, 2]);
  });

  it('O2: color precedence', () => {
    // Given
    const base = registry.get('bollinger') as IndicatorModule;
    const custom: IndicatorModule = {
      ...base,
      meta: {
        ...base.meta,
        series: [
          { kind: 'line', name: 'Basis', output: 1, defaultColor: '#def' },
          { kind: 'band', name: 'Bands', upper: 0, lower: 2 },
        ],
      },
    };
    // When
    const [a] = resolveOverlaySpecs(
      [entry({ type: 'bollinger' }, 'a', custom)],
      PALETTE
    );
    const [b] = resolveOverlaySpecs(
      [entry({ type: 'bollinger', style: { colors: ['#abc'] } }, 'b', custom)],
      PALETTE
    );
    // Then
    expect(a?.strokes.map((s) => s.color)).toEqual(['#def', '#111', '#111']);
    expect(b?.strokes.map((s) => s.color)).toEqual(['#abc', '#111', '#111']);
  });

  it('O3 / O4: hidden and foreign-pane overlays', () => {
    // Given
    const entries = [
      entry({ type: 'sma', paneId: 'other' }, 'x'),
      entry({ type: 'ema', style: { visible: false } }, 'hidden'),
      entry({ type: 'wma' }, 'shown'),
    ];
    // When
    const specs = resolveOverlaySpecs(entries, PALETTE);
    // Then
    expect(specs.map((s) => s.id)).toEqual(['shown']);
    expect(specs[0]?.strokes[0]?.color).toBe('#222');
  });

  it.each([
    [0, DEFAULT_INDICATOR_LINE_WIDTH],
    [-1, DEFAULT_INDICATOR_LINE_WIDTH],
    [Infinity, DEFAULT_INDICATOR_LINE_WIDTH],
    [3, 3],
  ])('O5: lineWidth %p → %p', (lineWidth, expected) => {
    // Given / When
    const [s] = resolveOverlaySpecs(
      [entry({ type: 'ema', style: { lineWidth } })],
      PALETTE
    );
    // Then
    expect(s?.strokes[0]?.width).toBe(expected);
  });

  it('O6: opacities', () => {
    // Given / When
    const opacity = (o: number) =>
      resolveOverlaySpecs(
        [entry({ type: 'ema', style: { opacity: o } })],
        PALETTE
      )[0]?.strokes[0]?.opacity;
    const [bb] = resolveOverlaySpecs(
      [entry({ type: 'bollinger', style: { fillOpacity: 0.3 } })],
      PALETTE
    );
    // Then
    expect(opacity(-1)).toBe(1);
    expect(opacity(0)).toBe(0);
    expect(opacity(2)).toBe(1);
    expect(bb?.fills[0]?.opacity).toBe(0.3);
  });

  it('O7: fill disabled', () => {
    // Given / When
    const [bb] = resolveOverlaySpecs(
      [entry({ type: 'bollinger', style: { fill: false } })],
      PALETTE
    );
    // Then
    expect(bb?.fills).toEqual([]);
    expect(bb?.strokes).toHaveLength(3);
  });

  it('O8: empty palette and cycling', () => {
    // Given
    const four = ['a', 'b', 'c', 'd'].map((id) => entry({ type: 'ema' }, id));
    // When
    const none = resolveOverlaySpecs(four.slice(0, 1), []);
    const cyc = resolveOverlaySpecs(four, PALETTE);
    // Then
    expect(none[0]?.strokes[0]?.color).toBe(FALLBACK_INDICATOR_COLOR);
    expect(cyc.map((s) => s.strokes[0]?.color)).toEqual([
      '#111',
      '#222',
      '#333',
      '#111',
    ]);
  });

  it('O9: histograms are skipped', () => {
    // Given
    const base = registry.get('ema') as IndicatorModule;
    const hist: IndicatorModule = {
      ...base,
      meta: {
        ...base.meta,
        series: [{ kind: 'histogram', name: 'H', output: 0 }],
      },
    };
    // When
    const [s] = resolveOverlaySpecs(
      [entry({ type: 'ema' }, 'h', hist)],
      PALETTE
    );
    // Then
    expect(s?.strokes).toEqual([]);
    expect(s?.legend).toEqual([]);
  });

  it('O10 / R1: empty entries and auto-scale refs', () => {
    // Given / When / Then
    expect(resolveOverlaySpecs([], PALETTE)).toEqual([]);
    expect(overlayAutoScaleRefs([])).toEqual([]);
    const specs = resolveOverlaySpecs(
      [entry({ type: 'ema' }), entry({ type: 'bollinger' })],
      PALETTE
    );
    expect(overlayAutoScaleRefs(specs)).toEqual([
      { id: 'ema', output: 0, offset: 0 },
      { id: 'bollinger', output: 1, offset: 0 },
      { id: 'bollinger', output: 0, offset: 0 },
      { id: 'bollinger', output: 2, offset: 0 },
    ]);
  });

  it('O11: non-price-scaled indicators on the price pane are skipped', () => {
    // Given: volume overlay on the price pane, then an EMA
    const entries = [
      entry({ type: 'volume', paneId: 'price' }),
      entry({ type: 'ema' }),
    ];
    // When
    const specs = resolveOverlaySpecs(entries, PALETTE);
    // Then
    expect(specs.map((s) => s.id)).toEqual(['ema']);
    expect(specs[0]?.strokes[0]?.color).toBe('#111');
  });
});
