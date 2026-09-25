/**
 * Test perspective table — OHLCHeaderRenderer
 *
 * Glyphs 1 dp each; x 8, y 8, line height 10, baseline offset 7,
 * caption gap 1, group gap 2, 2 decimals.
 *
 * | Case | Input / Precondition                             | Perspective        | Expected                                         |
 * |------|--------------------------------------------------|--------------------|--------------------------------------------------|
 * | OH1  | up bar, wide layout, volume on                   | Equivalence        | O H L C change V on one line, up style           |
 * | OH2  | down bar                                         | Equivalence        | down style, negative change                      |
 * | OH3  | narrow maxWidth                                  | Boundary           | groups wrap, first group never wraps alone       |
 * | OH4  | showVolume false                                 | Equivalence        | no V group                                       |
 * | OH5  | open 0 (percent undefined)                       | Boundary (0)       | change without percent                           |
 * | OH6  | NaN values                                       | Invalid            | groups with empty values skipped                 |
 * | OH7  | index -1 / = length / 1.5 / NaN                  | Invalid            | 0 lines, nothing emitted                         |
 */
import { describe, expect, it } from '@jest/globals';
import { createGlyphWidthTable } from '../../../axes/TextMetrics';
import type { CandleColumns } from '../../../data/CandleBuffer';
import { columns } from '../../__tests__/columns';
import {
  layoutOhlcHeader,
  OHLC_STYLE_CAPTION,
  OHLC_STYLE_DOWN,
  OHLC_STYLE_UP,
  type OhlcHeaderLayout,
} from '../OHLCHeaderRenderer';

const LAYOUT: OhlcHeaderLayout = {
  x: 8,
  y: 8,
  lineHeight: 10,
  baselineOffset: 7,
  maxWidth: 1000,
  captionGap: 1,
  groupGap: 2,
  glyphs: createGlyphWidthTable(new Array<number>(95).fill(1)),
  decimals: 2,
  thousandsSeparator: ',',
  showVolume: true,
};

function run(
  series: CandleColumns,
  index = 0,
  layout: Partial<OhlcHeaderLayout> = {}
) {
  const texts: { text: string; x: number; baseline: number; style: number }[] =
    [];
  const lines = layoutOhlcHeader(
    series,
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

describe('layoutOhlcHeader', () => {
  it('OH1: lays out an up bar on one line', () => {
    // Given
    const series = columns([[100, 110, 95, 105, 1234]]);
    // When
    const { lines, texts } = run(series);
    // Then
    expect(lines).toBe(1);
    expect(texts.map((t) => t.text)).toEqual([
      'O',
      '100.00',
      'H',
      '110.00',
      'L',
      '95.00',
      'C',
      '105.00',
      '+5.00 (+5.00%)',
      'V',
      '1.23K',
    ]);
    expect(texts[0]).toEqual({
      text: 'O',
      x: 8,
      baseline: 15,
      style: OHLC_STYLE_CAPTION,
    });
    expect(texts[1]).toEqual({
      text: '100.00',
      x: 10,
      baseline: 15,
      style: OHLC_STYLE_UP,
    });
    // Next group: 8 + (1 + 1 + 6) + 2
    expect(texts[2]?.x).toBe(18);
  });

  it('OH2: styles a down bar', () => {
    // Given
    const series = columns([[105, 110, 95, 100, 1]]);
    // When
    const { texts } = run(series);
    // Then
    expect(texts[1]?.style).toBe(OHLC_STYLE_DOWN);
    expect(texts.map((t) => t.text)).toContain('-5.00 (-4.76%)');
  });

  it('OH3: wraps groups that exceed maxWidth', () => {
    // Given
    const series = columns([[100, 110, 95, 105, 1234]]);
    // When: room for ~2 groups per line
    const { lines, texts } = run(series, 0, { maxWidth: 30 });
    // Then
    expect(lines).toBeGreaterThan(2);
    const first = texts.filter((t) => t.baseline === 15);
    expect(first[0]?.text).toBe('O');
    expect(texts.every((t) => t.x >= 8)).toBe(true);
    // A single group wider than maxWidth still starts the line
    expect(run(series, 0, { maxWidth: 1 }).texts[0]?.x).toBe(8);
  });

  it('OH4: omits volume when disabled', () => {
    // Given / When
    const { texts } = run(columns([[1, 2, 0, 1, 5]]), 0, { showVolume: false });
    // Then
    expect(texts.map((t) => t.text)).not.toContain('V');
  });

  it('OH5: omits the percent when open is 0', () => {
    // Given / When
    const { texts } = run(columns([[0, 2, 0, 1, 5]]));
    // Then
    expect(texts.map((t) => t.text)).toContain('+1.00');
  });

  it('OH6: skips groups with non-finite values', () => {
    // Given / When
    const { texts } = run(columns([[NaN, NaN, NaN, NaN, NaN]]));
    // Then
    expect(texts).toEqual([]);
  });

  it.each([[-1], [1], [0.5], [NaN]])('OH7: index %p → nothing', (index) => {
    // Given / When
    const { lines, texts } = run(columns([[1, 2, 0, 1, 5]]), index);
    // Then
    expect(lines).toBe(0);
    expect(texts).toEqual([]);
  });
});
