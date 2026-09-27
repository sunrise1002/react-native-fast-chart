import type { CandleColumns } from '../../data/CandleBuffer';

export const T0 = Date.UTC(2024, 0, 1);
export const MIN = 60_000;

/** Columns with bars at `times` (close 100 + i, high +1, low −1). */
export function columns(times: readonly number[], offset = 0): CandleColumns {
  const size = offset + times.length;
  const col = () => new Float64Array(Math.max(size, 1));
  const out = {
    time: col(),
    open: col(),
    high: col(),
    low: col(),
    close: col(),
    volume: col(),
    offset,
    length: times.length,
  };
  times.forEach((t, i) => {
    const c = 100 + i;
    out.time[offset + i] = t;
    out.open[offset + i] = c;
    out.high[offset + i] = c + 1;
    out.low[offset + i] = c - 1;
    out.close[offset + i] = c;
    out.volume[offset + i] = 1;
  });
  return out;
}

/** `n` one-minute bars from `T0`. */
export function minuteBars(n: number, offset = 0): CandleColumns {
  return columns(
    Array.from({ length: n }, (_, i) => T0 + i * MIN),
    offset
  );
}
