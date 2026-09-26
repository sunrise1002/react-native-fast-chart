import { formatPrice } from './PriceFormat';
import { formatDateTime, formatTimeTick } from './TimeFormat';

/**
 * Custom label formatters (spec Phase 19.1 / 19.3).
 *
 * **Worklet contract.** Labels are formatted on the UI thread inside
 * Reanimated mappers, so a formatter must be a worklet (first statement
 * `'worklet';`), be synchronous and pure, only capture serializable values
 * (numbers, strings, plain objects, other worklets) and return a string.
 * `Intl` / `toLocaleString` are not guaranteed on the UI runtime.
 * Keep the function reference stable (module constant / `useCallback`):
 * a new reference clears the label caches.
 *
 * A formatter that throws or returns a non-string falls back to the
 * built-in format for that label, so a faulty formatter never takes the
 * chart down. A non-worklet function throws when called on the UI thread
 * and therefore always falls back.
 */

/**
 * Formats a price-scale value (axis ticks, last-price badge, crosshair
 * price label and OHLC legend). `decimals` is the precision the chart
 * would use (symbol precision, or derived from the tick step / price).
 */
export type PriceFormatter = (price: number, decimals: number) => string;

/**
 * Formats a time label. `localTime` is the bar time shifted into the chart
 * zone: read it with the **UTC** getters (`new Date(localTime).getUTCHours()`)
 * or plain arithmetic. `weight` is `TIME_LABEL_CROSSHAIR` (0) for the
 * crosshair label, otherwise the tick weight (`TICK_WEIGHT_TIME` 1 …
 * `TICK_WEIGHT_YEAR` 4: which calendar boundary the tick marks).
 * `barMs` is the estimated bar duration (daily bars: `>= 86_400_000`).
 */
export type TimeFormatter = (
  localTime: number,
  weight: number,
  barMs: number
) => string;

/** `weight` passed to a `TimeFormatter` for the crosshair time label. */
export const TIME_LABEL_CROSSHAIR = 0;

/** Price label via `formatter`, falling back to `formatPrice`. Worklet. */
export function applyPriceFormatter(
  formatter: PriceFormatter | undefined,
  value: number,
  decimals: number,
  thousandsSeparator: string
): string {
  'worklet';
  if (formatter !== undefined && Number.isFinite(value)) {
    try {
      const text = formatter(value, decimals);
      if (typeof text === 'string') {
        return text;
      }
    } catch {
      // Fall through to the built-in format.
    }
  }
  return formatPrice(value, decimals, thousandsSeparator);
}

/**
 * Time label via `formatter`, falling back to the built-in tick format
 * (`weight >= 1`) or the crosshair format (`weight === 0`). Worklet.
 */
export function applyTimeFormatter(
  formatter: TimeFormatter | undefined,
  localTime: number,
  weight: number,
  barMs: number,
  withSeconds: boolean
): string {
  'worklet';
  if (formatter !== undefined && Number.isFinite(localTime)) {
    try {
      const text = formatter(localTime, weight, barMs);
      if (typeof text === 'string') {
        return text;
      }
    } catch {
      // Fall through to the built-in format.
    }
  }
  return weight === TIME_LABEL_CROSSHAIR
    ? formatDateTime(localTime, barMs)
    : formatTimeTick(localTime, weight, withSeconds);
}
