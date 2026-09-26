import type { UpsertBarResult } from '../core/ChartController';
import type { Candle } from './Candle';
import type { CandleStore } from './CandleStore';

/**
 * Kline-style upsert (e.g. exchange streams that resend closed bars):
 * appends a newer bar, updates the forming bar, or patches an existing
 * older bar with the same time. Anything else is rejected.
 */
export function upsertCandle(
  store: CandleStore,
  candle: Candle
): UpsertBarResult {
  if (candle === null || typeof candle !== 'object') {
    return 'rejected';
  }
  if (store.length === 0 || candle.time > store.lastTime) {
    return store.append(candle) ? 'appended' : 'rejected';
  }
  if (candle.time === store.lastTime) {
    return store.updateLast(candle) ? 'updated' : 'rejected';
  }
  const index = store.findIndexByTime(candle.time);
  return index >= 0 &&
    store.updateValuesAt(
      index,
      candle.open,
      candle.high,
      candle.low,
      candle.close,
      candle.volume
    )
    ? 'patched'
    : 'rejected';
}
