import type {
  Candle,
  LoadMoreResult,
  RealtimeStatus,
} from 'react-native-fast-chart';

/*
 * Market data contract of the example app (EXAMPLE ONLY — not part of the
 * library). A source serves the latest page, older pages for pagination
 * and a websocket-like live stream of kline upserts.
 */

export type MarketTimeframe = '1m' | '5m' | '1h';

export const TIMEFRAMES: readonly MarketTimeframe[] = ['1m', '5m', '1h'];

export const TIMEFRAME_MS: Readonly<Record<MarketTimeframe, number>> = {
  '1m': 60_000,
  '5m': 300_000,
  '1h': 3_600_000,
};

export const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const;
export type MarketSymbol = (typeof SYMBOLS)[number];

/** Bars per REST page. */
export const PAGE_SIZE = 500;

export interface MarketStreamHandlers {
  /** New or updated bar (kline semantics: same time = update). */
  onBar: (candle: Candle) => void;
  onStatus: (status: RealtimeStatus) => void;
}

export interface MarketSource {
  readonly name: string;
  /** Most recent `PAGE_SIZE` bars, oldest first. */
  loadLatest(
    symbol: MarketSymbol,
    timeframe: MarketTimeframe
  ): Promise<Candle[]>;
  /** Up to `PAGE_SIZE` bars strictly older than `before`. */
  loadBefore(
    symbol: MarketSymbol,
    timeframe: MarketTimeframe,
    before: number
  ): Promise<LoadMoreResult>;
  /** Starts the live stream; returns the unsubscribe function. */
  subscribe(
    symbol: MarketSymbol,
    timeframe: MarketTimeframe,
    handlers: MarketStreamHandlers
  ): () => void;
}
