import type { Candle, LoadMoreResult } from 'react-native-fast-chart';
import {
  PAGE_SIZE,
  type MarketSource,
  type MarketStreamHandlers,
  type MarketSymbol,
  type MarketTimeframe,
} from './types';

/*
 * Binance public market data (EXAMPLE ONLY, no API key): REST klines for
 * history and the kline websocket stream for realtime. Reconnects after
 * 2 s when the socket closes.
 */

const REST = 'https://api.binance.com/api/v3/klines';
const WS = 'wss://stream.binance.com:9443/ws';
const RECONNECT_MS = 2000;

type RestKline = [number, string, string, string, string, string, ...unknown[]];

function toCandle(k: RestKline): Candle {
  return {
    time: k[0],
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  };
}

async function klines(
  symbol: MarketSymbol,
  timeframe: MarketTimeframe,
  endTime?: number
): Promise<Candle[]> {
  const end = endTime === undefined ? '' : `&endTime=${endTime}`;
  const url = `${REST}?symbol=${symbol}&interval=${timeframe}&limit=${PAGE_SIZE}${end}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance REST ${response.status}`);
  }
  return ((await response.json()) as RestKline[]).map(toCandle);
}

function subscribe(
  symbol: MarketSymbol,
  timeframe: MarketTimeframe,
  { onBar, onStatus }: MarketStreamHandlers
): () => void {
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const connect = () => {
    socket = new WebSocket(`${WS}/${symbol.toLowerCase()}@kline_${timeframe}`);
    socket.onopen = () => onStatus('live');
    socket.onmessage = (event) => {
      const { k } = JSON.parse(String(event.data)) as {
        k: { t: number; o: string; h: string; l: string; c: string; v: string };
      };
      onBar(toCandle([k.t, k.o, k.h, k.l, k.c, k.v]));
    };
    socket.onclose = () => {
      if (!closed) {
        onStatus('reconnecting');
        retry = setTimeout(connect, RECONNECT_MS);
      }
    };
  };
  onStatus('reconnecting');
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    socket?.close();
    onStatus('offline');
  };
}

export const binanceMarket: MarketSource = {
  name: 'Binance',
  loadLatest: (symbol, timeframe) => klines(symbol, timeframe),
  loadBefore: async (symbol, timeframe, before): Promise<LoadMoreResult> => {
    const candles = await klines(symbol, timeframe, before - 1);
    return { candles, hasMore: candles.length === PAGE_SIZE };
  },
  subscribe,
};
