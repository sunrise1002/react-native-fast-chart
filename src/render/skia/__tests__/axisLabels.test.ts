/**
 * Test perspective table — cached axis labels
 *
 * | Case | Input / Precondition                              | Perspective        | Expected                                    |
 * |------|---------------------------------------------------|--------------------|---------------------------------------------|
 * | AX01 | cachedPriceLabel miss then hit                    | Equivalence        | formatPrice text, width; 2nd call a hit     |
 * | AX02 | cachedPriceLabel NaN                              | Invalid            | '' width 0, not cached                      |
 * | AX03 | cachedPaneLabel compact / fixed, same value       | Equivalence        | '1.50K' / '1,500.00', separate entries       |
 * | AX04 | cachedTimeLabels: clock / seconds / day ticks     | Equivalence        | formatted texts + widths, cached per weight |
 * | AX05 | cachedTimeLabels: 0 ticks / NaN payload           | Boundary / invalid | buffer untouched / '' width 0               |
 * | AX06 | createLabelBuffer 3 / 0 / NaN                     | Boundary           | 3 / 0 / 0 entries                           |
 */
import { describe, expect, it } from '@jest/globals';
import { createLabelCache } from '../../../axes/LabelCache';
import { createGlyphWidthTable } from '../../../axes/TextMetrics';
import { TICK_WEIGHT_DAY, TICK_WEIGHT_TIME } from '../../../axes/TimeFormat';
import { createTimeTicks } from '../../../axes/TimeTicks';
import {
  cachedPaneLabel,
  cachedPriceLabel,
  cachedTimeLabels,
  createAxisLabelCaches,
  createLabelBuffer,
} from '../axisLabels';

// Every glyph 5 dp wide.
const GLYPHS = createGlyphWidthTable(new Array<number>(95).fill(5));

describe('cachedPriceLabel / cachedPaneLabel', () => {
  it('AX01: formats on a miss, then hits', () => {
    // Given
    const cache = createAxisLabelCaches().price;
    // When
    const first = cachedPriceLabel(cache, GLYPHS, 65432.1, 2, ',');
    const width = cache.lastWidth;
    const second = cachedPriceLabel(cache, GLYPHS, 65432.1, 2, ',');
    // Then
    expect(first).toBe('65,432.10');
    expect(width).toBe(45);
    expect(second).toBe(first);
    expect(cache.hits).toBe(1);
    expect(cache.misses).toBe(1);
  });

  it('AX02: NaN formats to an empty, uncached label', () => {
    // Given
    const cache = createLabelCache();
    // When
    const text = cachedPriceLabel(cache, GLYPHS, NaN, 2, ',');
    cachedPriceLabel(cache, GLYPHS, NaN, 2, ',');
    // Then
    expect(text).toBe('');
    expect(cache.lastWidth).toBe(0);
    expect(cache.hits).toBe(0);
  });

  it('AX03: compact and fixed labels of one value do not alias', () => {
    // Given
    const cache = createLabelCache();
    // When
    const compact = cachedPaneLabel(cache, GLYPHS, 1500, 2, true, ',');
    const fixed = cachedPaneLabel(cache, GLYPHS, 1500, 2, false, ',');
    const again = cachedPaneLabel(cache, GLYPHS, 1500, 2, true, ',');
    // Then
    expect(compact).toBe('1.50K');
    expect(fixed).toBe('1,500.00');
    expect(again).toBe('1.50K');
    expect(cache.hits).toBe(1);
  });
});

describe('cachedTimeLabels', () => {
  it('AX04: formats clock / seconds / day ticks with widths', () => {
    // Given: a clock tick and a day tick, then the same with seconds (twice)
    const ticks = createTimeTicks(4);
    const noon = Date.UTC(2024, 2, 15, 14, 30);
    ticks.payload.set([noon, Date.UTC(2024, 2, 16)]);
    ticks.weights.set([TICK_WEIGHT_TIME, TICK_WEIGHT_DAY]);
    ticks.count = 2;
    const cache = createLabelCache();
    const out = createLabelBuffer(4);
    // When
    cachedTimeLabels(cache, GLYPHS, ticks, false, out);
    const clock = out.texts.slice(0, 2);
    cachedTimeLabels(cache, GLYPHS, ticks, true, out);
    cachedTimeLabels(cache, GLYPHS, ticks, true, out);
    // Then
    expect(clock).toEqual(['14:30', '16']);
    expect(out.texts[0]).toBe('14:30:00');
    expect(Array.from(out.widths.subarray(0, 2))).toEqual([40, 10]);
    expect(cache.hits).toBe(2);
    expect(cache.misses).toBe(4);
  });

  it('AX05: no ticks leave the buffer; NaN payloads give empty labels', () => {
    // Given
    const ticks = createTimeTicks(2);
    const out = createLabelBuffer(2);
    out.texts[0] = 'stale';
    // When
    cachedTimeLabels(createLabelCache(), GLYPHS, ticks, false, out);
    const untouched = out.texts[0];
    ticks.payload[0] = NaN;
    ticks.count = 1;
    cachedTimeLabels(createLabelCache(), GLYPHS, ticks, false, out);
    // Then
    expect(untouched).toBe('stale');
    expect(out.texts[0]).toBe('');
    expect(out.widths[0]).toBe(0);
  });

  it.each([
    [3, 3],
    [0, 0],
    [NaN, 0],
  ])('AX06: createLabelBuffer(%p) has %p entries', (capacity, size) => {
    // Given / When
    const buffer = createLabelBuffer(capacity);
    // Then
    expect(buffer.texts).toHaveLength(size);
    expect(buffer.widths.length).toBe(size);
  });
});
