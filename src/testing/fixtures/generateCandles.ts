import type { Candle } from '../../data/Candle';
import { createSeededRandom } from './random';

export interface GenerateCandlesOptions {
  /** Number of candles, integer in `[0, MAX_GENERATED_CANDLES]`. */
  count: number;
  /** PRNG seed; same seed + options ⇒ identical output. Default `1`. */
  seed?: number;
  /** Open time of the first candle, Unix ms. Default 2024-01-01T00:00Z. */
  startTime?: number;
  /** Bar interval, positive integer ms. Default `60_000` (1m). */
  intervalMs?: number;
  /** First open price, `> 0`. Default `30_000`. */
  startPrice?: number;
  /** Per-bar log-return standard deviation, `>= 0`. Default `0.002`. */
  volatility?: number;
  /** Mean volume per bar, `>= 0`. Default `100`. */
  baseVolume?: number;
  /** Decimal places prices are rounded to, integer `0..8`. Default `2`. */
  precision?: number;
}

export const MAX_GENERATED_CANDLES = 10_000_000;

const DEFAULTS = {
  seed: 1,
  startTime: Date.UTC(2024, 0, 1),
  intervalMs: 60_000,
  startPrice: 30_000,
  volatility: 0.002,
  baseVolume: 100,
  precision: 2,
} as const;

function assertOption(condition: boolean, message: string): void {
  if (!condition) {
    throw new RangeError(`generateCandles: ${message}`);
  }
}

/**
 * Deterministic geometric random-walk OHLCV generator. Every produced
 * candle satisfies `isValidCandle`, times are strictly increasing and
 * prices stay positive. Generates 100k candles in well under a second.
 *
 * @throws {RangeError} when an option is out of range.
 */
export function generateCandles(options: GenerateCandlesOptions): Candle[] {
  const {
    count,
    seed = DEFAULTS.seed,
    startTime = DEFAULTS.startTime,
    intervalMs = DEFAULTS.intervalMs,
    startPrice = DEFAULTS.startPrice,
    volatility = DEFAULTS.volatility,
    baseVolume = DEFAULTS.baseVolume,
    precision = DEFAULTS.precision,
  } = options;

  assertOption(
    Number.isInteger(count) && count >= 0 && count <= MAX_GENERATED_CANDLES,
    `count must be an integer in [0, ${MAX_GENERATED_CANDLES}], got ${count}`
  );
  assertOption(Number.isFinite(seed), `seed must be finite, got ${seed}`);
  assertOption(
    Number.isSafeInteger(startTime) && startTime >= 0,
    `startTime must be a non-negative safe integer, got ${startTime}`
  );
  assertOption(
    Number.isSafeInteger(intervalMs) && intervalMs > 0,
    `intervalMs must be a positive integer, got ${intervalMs}`
  );
  assertOption(
    Number.isSafeInteger(startTime + (count - 1) * intervalMs),
    'last candle time exceeds Number.MAX_SAFE_INTEGER'
  );
  assertOption(
    Number.isFinite(startPrice) && startPrice > 0,
    `startPrice must be a finite number > 0, got ${startPrice}`
  );
  assertOption(
    Number.isFinite(volatility) && volatility >= 0 && volatility < 1,
    `volatility must be in [0, 1), got ${volatility}`
  );
  assertOption(
    Number.isFinite(baseVolume) && baseVolume >= 0,
    `baseVolume must be a finite number >= 0, got ${baseVolume}`
  );
  assertOption(
    Number.isInteger(precision) && precision >= 0 && precision <= 8,
    `precision must be an integer in [0, 8], got ${precision}`
  );

  const random = createSeededRandom(seed);
  const scale = 10 ** precision;
  const minPrice = 1 / scale;
  const round = (value: number) =>
    Math.max(minPrice, Math.round(value * scale) / scale);

  const candles: Candle[] = new Array<Candle>(count);
  let price = round(startPrice);

  for (let i = 0; i < count; i++) {
    // Box–Muller transform; `1 - random()` keeps the log argument in (0, 1].
    const gaussian =
      Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
    const open = price;
    const close = round(open * Math.exp(volatility * gaussian));
    const bodyHigh = open > close ? open : close;
    const bodyLow = open < close ? open : close;
    // Rounding is monotonic and the body is already on the price grid,
    // so high >= bodyHigh and low <= bodyLow hold after rounding.
    const high = round(bodyHigh * (1 + volatility * random()));
    const low = round(bodyLow * (1 - volatility * random()));
    const volume =
      Math.round(baseVolume * (0.2 + 1.6 * random()) * scale) / scale;

    candles[i] = {
      time: startTime + i * intervalMs,
      open,
      high,
      low,
      close,
      volume,
    };
    price = close;
  }
  return candles;
}
