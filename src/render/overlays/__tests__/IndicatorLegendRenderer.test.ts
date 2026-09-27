/**
 * Test perspective table — layoutIndicatorLegend
 *
 * Glyphs 1 dp each; x 8, y 20, line height 10, baseline offset 7, gap 2.
 *
 * | Case | Input / Precondition                            | Perspective       | Expected                                     |
 * |------|-------------------------------------------------|-------------------|----------------------------------------------|
 * | I1   | two items, aligned series, valid index          | Normal            | one row each: caption + colored values       |
 * | I2   | warm-up NaN value                               | Abnormal          | caption only                                 |
 * | I3   | unaligned / missing series                      | Abnormal          | caption only                                 |
 * | I4   | index −1 / = length / 1.5 / NaN                 | Invalid           | captions only                                |
 * | I5   | unknown output column                           | Invalid           | value skipped                                |
 * | I6   | narrow maxWidth                                 | Boundary          | values wrap to next line, row count grows    |
 * | I7   | no items                                        | Boundary (empty)  | 0 lines, nothing emitted                     |
 * | I8   | item decimals 0 / compact                       | Equivalence       | per-item format overrides layout decimals    |
 * | I9   | value offset +1 / −1 / out of range             | Boundary          | value of bar index − offset; omitted outside |
 * | V1   | formatIndicatorValue compact ±, fixed, fallback | Normal / Boundary | "1.50K" / "-1.50K" / "3.1" / layout decimals |
 * | V2   | formatIndicatorValue NaN / ∞ (both modes)       | Invalid           | ''                                           |
 */
import { describe, expect, it } from '@jest/globals';
import { createGlyphWidthTable } from '../../../axes/TextMetrics';
import { createUiCandleSeries } from '../../../data/UiCandleSeries';
import type { UiIndicatorSet } from '../../../indicators/UiIndicatorSet';
import { columns } from '../../__tests__/columns';
import {
  formatIndicatorValue,
  INDICATOR_LEGEND_STYLE_CAPTION,
  layoutIndicatorLegend,
  type IndicatorLegendItem,
  type IndicatorLegendLayout,
} from '../IndicatorLegendRenderer';

const LAYOUT: IndicatorLegendLayout = {
  x: 8,
  y: 20,
  lineHeight: 10,
  baselineOffset: 7,
  maxWidth: 1000,
  gap: 2,
  glyphs: createGlyphWidthTable(new Array<number>(95).fill(1)),
  decimals: 2,
  thousandsSeparator: ',',
};

const CANDLES = createUiCandleSeries(
  columns([
    [1, 2, 0, 1, 0],
    [1, 2, 0, 1, 0],
  ]),
  0,
  1
);
const T0 = CANDLES.time[0] as number;

function set(values: number[][], resetVersion = 1): UiIndicatorSet {
  return {
    series: {
      ema: {
        outputs: [Float64Array.from(values[0] ?? [])],
        length: 2,
        resetVersion,
        firstTime: T0,
      },
      bb: {
        outputs: values.slice(1).map((v) => Float64Array.from(v)),
        length: 2,
        resetVersion,
        firstTime: T0,
      },
    },
    revision: 0,
  };
}

const ITEMS: IndicatorLegendItem[] = [
  { id: 'ema', label: 'EMA 20', values: [{ output: 0, style: 1 }] },
  {
    id: 'bb',
    label: 'BB 20 2',
    values: [
      { output: 0, style: 2 },
      { output: 1, style: 3 },
    ],
  },
];

function run(
  s: UiIndicatorSet,
  index = 1,
  items = ITEMS,
  layout: Partial<IndicatorLegendLayout> = {}
) {
  const texts: { text: string; x: number; baseline: number; style: number }[] =
    [];
  const lines = layoutIndicatorLegend(
    items,
    s,
    CANDLES,
    index,
    { ...LAYOUT, ...layout },
    {
      text(text, x, baseline, style) {
        texts.push({ text, x, baseline, style });
      },
    }
  );
  return { lines, texts };
}

describe('layoutIndicatorLegend', () => {
  it('I9: shifted values read bar index − offset', () => {
    // Given
    const items: IndicatorLegendItem[] = [
      {
        id: 'bb',
        label: 'S',
        values: [
          { output: 0, style: 1, offset: 1 },
          { output: 0, style: 2, offset: -1 },
          { output: 0, style: 3, offset: 0 },
        ],
      },
    ];
    const s = set([[0], [5, 7]]);
    // When
    const at1 = run(s, 1, items).texts.map((t) => t.text);
    const at0 = run(s, 0, items).texts.map((t) => t.text);
    // Then: at bar 1: [0] = 5, [2] missing, [1] = 7; at bar 0: missing, 7, 5
    expect(at1).toEqual(['S', '5.00', '7.00']);
    expect(at0).toEqual(['S', '7.00', '5.00']);
  });

  it('I1: rows with values', () => {
    // Given / When
    const { lines, texts } = run(
      set([
        [0, 1234.5],
        [0, 12],
        [0, 10],
      ])
    );
    // Then
    expect(lines).toBe(2);
    expect(texts).toEqual([
      {
        text: 'EMA 20',
        x: 8,
        baseline: 27,
        style: INDICATOR_LEGEND_STYLE_CAPTION,
      },
      { text: '1,234.50', x: 16, baseline: 27, style: 1 },
      { text: 'BB 20 2', x: 8, baseline: 37, style: 0 },
      { text: '12.00', x: 17, baseline: 37, style: 2 },
      { text: '10.00', x: 24, baseline: 37, style: 3 },
    ]);
  });

  it('I2: warm-up values are omitted', () => {
    // Given / When
    const { texts } = run(
      set([
        [1, NaN],
        [1, NaN],
        [1, NaN],
      ])
    );
    // Then
    expect(texts.map((t) => t.text)).toEqual(['EMA 20', 'BB 20 2']);
  });

  it('I3: unaligned or missing series', () => {
    // Given / When
    const stale = run(
      set(
        [
          [1, 1],
          [1, 1],
          [1, 1],
        ],
        7
      )
    );
    const missing = run({ series: {}, revision: 0 });
    // Then
    expect(stale.texts.map((t) => t.text)).toEqual(['EMA 20', 'BB 20 2']);
    expect(missing.lines).toBe(2);
    expect(missing.texts).toHaveLength(2);
  });

  it.each([-1, 2, 1.5, NaN])('I4: invalid index %p', (index) => {
    // Given / When
    const { texts } = run(
      set([
        [1, 1],
        [1, 1],
        [1, 1],
      ]),
      index
    );
    // Then
    expect(texts).toHaveLength(2);
  });

  it('I5: unknown output column', () => {
    // Given
    const items: IndicatorLegendItem[] = [
      {
        id: 'ema',
        label: 'E',
        values: [
          { output: 5, style: 1 },
          { output: 0, style: 1 },
        ],
      },
    ];
    // When
    const { texts } = run(set([[1, 3]]), 1, items);
    // Then
    expect(texts.map((t) => t.text)).toEqual(['E', '3.00']);
  });

  it('I6: wraps values beyond maxWidth', () => {
    // Given / When
    const { lines, texts } = run(
      set([
        [0, 1],
        [0, 12],
        [0, 10],
      ]),
      1,
      ITEMS,
      { maxWidth: 22 }
    );
    // Then
    expect(lines).toBe(3);
    const last = texts[texts.length - 1];
    expect(last).toEqual({ text: '10.00', x: 8, baseline: 47, style: 3 });
  });

  it('I7: no items', () => {
    // Given / When
    const { lines, texts } = run(set([[1, 1]]), 1, []);
    // Then
    expect(lines).toBe(0);
    expect(texts).toEqual([]);
  });

  it('I8: per-item decimals and compact format', () => {
    // Given
    const items: IndicatorLegendItem[] = [
      { id: 'ema', label: 'E', values: [{ output: 0, style: 1 }], decimals: 0 },
      {
        id: 'bb',
        label: 'V',
        values: [{ output: 0, style: 2 }],
        compact: true,
        decimals: -1,
      },
    ];
    // When
    const { texts } = run(
      set([
        [0, 12.6],
        [0, 1500],
      ]),
      1,
      items
    );
    // Then
    expect(texts.map((t) => t.text)).toEqual(['E', '13', 'V', '1.50K']);
  });
});

describe('formatIndicatorValue', () => {
  it('V1: compact and fixed formats', () => {
    // Given / When / Then
    expect(formatIndicatorValue(1500, -1, true, 2, ',')).toBe('1.50K');
    expect(formatIndicatorValue(-1500, -1, true, 2, ',')).toBe('-1.50K');
    expect(formatIndicatorValue(3.14159, 1, false, 4, ',')).toBe('3.1');
    expect(formatIndicatorValue(1234.5, -1, false, 2, ',')).toBe('1,234.50');
  });

  it.each([NaN, Infinity, -Infinity])('V2: %p formats as empty', (v) => {
    // Given / When / Then
    expect(formatIndicatorValue(v, 2, false, 2, ',')).toBe('');
    expect(formatIndicatorValue(v, 2, true, 2, ',')).toBe('');
  });
});
