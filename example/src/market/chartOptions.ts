import {
  isSupportedTimeZone,
  type ChartSymbolConfig,
  type ChartTimeZone,
  type PriceFormatter,
} from 'react-native-fast-chart';
import type { MarketSymbol } from './types';

/*
 * P9 demo options of the Market screen (EXAMPLE ONLY): exchange symbol
 * metadata, a time-zone cycle and a worklet price formatter.
 */

/** Exchange filters (Binance `PRICE_FILTER.tickSize` / `LOT_SIZE.stepSize`). */
export const SYMBOL_META: Readonly<
  Record<MarketSymbol, Partial<ChartSymbolConfig>>
> = {
  BTCUSDT: { tickSize: 0.01, quantityStep: 0.00001 },
  ETHUSDT: { tickSize: 0.01, quantityStep: 0.0001 },
  SOLUSDT: { tickSize: 0.001, quantityStep: 0.001 },
};

export interface ZoneOption {
  label: string;
  zone: ChartTimeZone;
}

/** `'local'`, UTC, an IANA zone (when the runtime's Intl supports it), +05:30. */
export const ZONE_OPTIONS: readonly ZoneOption[] = [
  { label: 'Local', zone: 'local' },
  { label: 'UTC', zone: 'UTC' },
  ...(isSupportedTimeZone('America/New_York')
    ? [{ label: 'New York', zone: 'America/New_York' }]
    : []),
  { label: '+05:30', zone: 330 },
];

/**
 * Thousands separators on price labels. Runs on the UI thread, so it is
 * a worklet and only uses plain string operations (no `Intl`).
 */
export const groupedPrice: PriceFormatter = (price, decimals) => {
  'worklet';
  const [int = '', frac] = price.toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === undefined ? grouped : `${grouped}.${frac}`;
};
