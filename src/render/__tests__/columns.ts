import type { CandleColumns } from '../../data/CandleBuffer';

/** Test columns from `[open, high, low, close, volume]` rows, 1 min apart. */
export function columns(
  rows: readonly (readonly number[])[],
  t0 = Date.UTC(2024, 0, 1),
  offset = 0
): CandleColumns {
  const n = rows.length + offset;
  const col = (k: number) => {
    const out = new Float64Array(n);
    rows.forEach((r, i) => {
      out[offset + i] = r[k] ?? NaN;
    });
    return out;
  };
  const time = new Float64Array(n);
  rows.forEach((_, i) => {
    time[offset + i] = t0 + i * 60_000;
  });
  return {
    time,
    open: col(0),
    high: col(1),
    low: col(2),
    close: col(3),
    volume: col(4),
    offset,
    length: rows.length,
  };
}
