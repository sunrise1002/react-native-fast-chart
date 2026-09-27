import type {
  AnnotationInput,
  Candle,
  FillInput,
  OrderInput,
  PositionInput,
} from 'react-native-fast-chart';

/*
 * Demo trading state of the Trading screen (EXAMPLE ONLY): orders, fills,
 * a position and annotations placed around the loaded bars. A real app
 * would take these from its broker / exchange account stream.
 */

export interface DemoTradingState {
  orders: OrderInput[];
  fills: FillInput[];
  position: PositionInput;
  annotations: AnnotationInput[];
}

const round = (value: number) => Math.round(value * 100) / 100;

export function demoTradingState(bars: readonly Candle[]): DemoTradingState {
  const last = bars[bars.length - 1]!;
  const price = last.close;
  const fills: FillInput[] = [];
  for (let i = bars.length - 120; i < bars.length - 5; i += 17) {
    const bar = bars[i];
    if (bar === undefined) continue;
    fills.push({
      id: `fill-${i}`,
      side: i % 2 === 0 ? 'buy' : 'sell',
      price: bar.close,
      time: bar.time,
    });
  }
  const entryBar = bars[bars.length - 60] ?? last;
  const event = bars[bars.length - 90] ?? last;
  return {
    orders: [
      { id: 'o1', side: 'buy', price: round(price * 0.995), quantity: 0.25 },
      { id: 'o2', side: 'sell', price: round(price * 1.006), quantity: 0.1 },
      {
        id: 'o3',
        side: 'sell',
        type: 'Stop',
        price: round(price * 0.99),
        quantity: 0.1,
        draggable: true,
      },
    ],
    fills,
    position: {
      side: 'long',
      size: 0.5,
      entryPrice: round(entryBar.close),
      liquidationPrice: round(entryBar.close * 0.9),
      takeProfit: round(price * 1.01),
      stopLoss: round(price * 0.985),
    },
    annotations: [
      {
        id: 'news',
        type: 'verticalLine',
        time: event.time,
        label: 'CPI',
      },
      {
        id: 'earn',
        type: 'marker',
        time: event.time,
        position: 'above',
        shape: 'circle',
        icon: 'E',
        text: 'Event',
      },
      {
        id: 'note',
        type: 'note',
        time: entryBar.time,
        price: entryBar.high,
        text: 'Entry idea',
      },
    ],
  };
}
