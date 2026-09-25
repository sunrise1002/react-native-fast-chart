/**
 * Allocation-free text measuring for axis labels. The advance widths of
 * printable ASCII are read from the (single, cached) Skia font once, on
 * the JS thread; worklets then measure labels with plain arithmetic
 * instead of a JSI call per label per frame. Kerning is ignored — label
 * glyphs (digits, separators) are tabular in system fonts.
 */

/** First / last measured character code (printable ASCII). */
export const FIRST_MEASURED_CHAR = 32;
export const LAST_MEASURED_CHAR = 126;

export interface GlyphWidthTable {
  /** Advance width by character code, `[0, LAST_MEASURED_CHAR]`. */
  widths: Float64Array;
  /** Width used for unmeasured characters (the widest measured glyph). */
  fallback: number;
}

/** The characters to measure, in code order (`' '` … `'~'`). */
export function measuredCharacters(): string {
  let text = '';
  for (let c = FIRST_MEASURED_CHAR; c <= LAST_MEASURED_CHAR; c++) {
    text += String.fromCharCode(c);
  }
  return text;
}

/**
 * Builds a table from the widths of `measuredCharacters()` (same order).
 * Missing / invalid widths count as 0; the fallback is the widest glyph.
 */
export function createGlyphWidthTable(
  widths: ArrayLike<number>
): GlyphWidthTable {
  const table = new Float64Array(LAST_MEASURED_CHAR + 1);
  let widest = 0;
  for (let c = FIRST_MEASURED_CHAR; c <= LAST_MEASURED_CHAR; c++) {
    const w = widths[c - FIRST_MEASURED_CHAR];
    const safe = w !== undefined && w > 0 && w < Infinity ? w : 0;
    table[c] = safe;
    widest = safe > widest ? safe : widest;
  }
  return { widths: table, fallback: widest };
}

/** Sum of the advance widths of `text`, dp. */
export function measureText(table: GlyphWidthTable, text: string): number {
  'worklet';
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    width +=
      c >= FIRST_MEASURED_CHAR && c <= LAST_MEASURED_CHAR
        ? (table.widths[c] as number)
        : table.fallback;
  }
  return width;
}
