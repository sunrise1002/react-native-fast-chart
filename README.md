# react-native-fast-chart

High-performance candlestick trading chart for React Native, built on
[`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/),
[`react-native-reanimated`](https://docs.swmansion.com/react-native-reanimated/) and
[`react-native-gesture-handler`](https://docs.swmansion.com/react-native-gesture-handler/).
It aims for TradingView / Binance-app UX at 60–120 fps with 100k+ candles.

<!-- GIF placeholders: replace with recordings from the example app -->

| Pan, pinch and crosshair                 | Indicators and panes           | Realtime feed                        |
| ---------------------------------------- | ------------------------------ | ------------------------------------ |
| ![pan and zoom](docs/media/pan-zoom.gif) | ![panes](docs/media/panes.gif) | ![realtime](docs/media/realtime.gif) |

## Features

- **Smooth interaction**
  - Pan, pinch-zoom, fling and elastic edges.
  - Long-press crosshair with `hold` or `sticky` mode.
  - Double-tap resets the zoom.
  - Draggable pane separators.
  - All gesture math runs on the UI thread; React never re-renders per frame.
- **Large datasets.** Only visible bars are drawn, and Skia draws them in
  batches. Pixel-bucket conflation keeps a fully zoomed-out view of 100k bars
  within the frame budget (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)).
- **Indicators**
  - Overlays: SMA, EMA, WMA, Bollinger Bands.
  - Panes: Volume, RSI, MACD, ATR.
  - Incremental O(1) updates per tick.
  - Custom indicators through a registry.
- **Realtime**
  - `upsertBar` with kline semantics.
  - Trade → bar aggregation (`RealtimeBarAggregator`).
  - Follows the latest bar, with an optional last-price pulse.
  - Feed status.
- **History pagination.** `onLoadMore` prepends older bars without moving the
  view.
- **Trading details**
  - Per-symbol precision and tick size.
  - Compact volumes (K/M/B).
  - Local, UTC, fixed-offset or IANA time zones.
  - Session gaps collapse, because the X axis is index-based.
- **Production hardening**
  - Error boundary with a fallback.
  - Sanitized input: NaN and ∞ never reach Skia.
  - `onError` and `onPerformanceSample` telemetry hooks.
- **Theming.** Dark and light themes with deep-partial overrides. Settings
  (indicators and panes) can be persisted.

## Installation

```sh
yarn add react-native-fast-chart
yarn add @shopify/react-native-skia react-native-reanimated react-native-worklets react-native-gesture-handler
```

With Expo, run `npx expo install` for the peer dependencies so you get
SDK-compatible versions. Skia requires a development build, so Expo Go is not
supported.

| Peer dependency                | Tested | Required |
| ------------------------------ | ------ | -------- |
| `react`                        | 19.2.3 | >= 19    |
| `react-native`                 | 0.86.3 | >= 0.79  |
| `@shopify/react-native-skia`   | 2.6.2  | >= 2.6   |
| `react-native-reanimated`      | 4.5.1  | >= 4.0   |
| `react-native-worklets`        | 0.10.1 | >= 0.5   |
| `react-native-gesture-handler` | 2.32.0 | >= 2.20  |

Reanimated 4 requires the **New Architecture** and the worklets Babel plugin.
The plugin must be **last** in the list. `babel-preset-expo` already includes
it.

```js
// babel.config.js (bare React Native)
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['react-native-worklets/plugin'],
};
```

Wrap your app in `GestureHandlerRootView`:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* … */}
    </GestureHandlerRootView>
  );
}
```

## Quick start

### Props mode (simple)

```tsx
import { TradingChart, normalizeCandles } from 'react-native-fast-chart';

// Untrusted rows → sorted, de-duplicated, validated candles (time in ms).
const { candles } = normalizeCandles(rowsFromApi, { timeUnit: 's' });

export function Chart() {
  return (
    <TradingChart
      candles={candles}
      indicators={[{ type: 'ema', config: { period: 21 } }, { type: 'volume' }]}
      config={{ symbol: { tickSize: 0.01 }, axes: { timeZone: 'UTC' } }}
      style={{ flex: 1 }}
    />
  );
}
```

Passing a new array to `candles` is cheap. Appended bars, an updated last bar
and prepended history are detected and applied incrementally. Always update
the array immutably.

### Controller mode (realtime)

For high-frequency feeds, push data through the controller. React then
re-renders only when your own UI changes, never per tick.

```tsx
import { useEffect } from 'react';
import {
  TradingChart,
  useTradingChartController,
  type Candle,
  type LoadMoreHandler,
} from 'react-native-fast-chart';

const toCandle = (k: BinanceKline): Candle => ({
  time: k.t,
  open: +k.o,
  high: +k.h,
  low: +k.l,
  close: +k.c,
  volume: +k.v,
});

export function LiveChart({ symbol }: { symbol: string }) {
  const chart = useTradingChartController();

  useEffect(() => {
    let ws: WebSocket | undefined;
    let cancelled = false;
    chart.setRealtimeStatus('reconnecting');
    fetchKlines(symbol, '1m').then((rows) => {
      if (cancelled) return;
      chart.setData(rows.map(toCandle), { viewport: 'keepZoom' });
      ws = new WebSocket(
        `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_1m`
      );
      ws.onopen = () => chart.setRealtimeStatus('live');
      ws.onmessage = (e) => chart.upsertBar(toCandle(JSON.parse(e.data).k));
      ws.onclose = () => chart.setRealtimeStatus('offline');
    });
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [chart, symbol]);

  const onLoadMore: LoadMoreHandler = async ({ before }) => {
    const older = await fetchKlines(symbol, '1m', { endTime: before - 1 });
    return { candles: older.map(toCandle), hasMore: older.length > 0 };
  };

  return (
    <TradingChart
      controller={chart}
      onLoadMore={onLoadMore}
      style={{ flex: 1 }}
    />
  );
}
```

If your feed sends raw trades instead of klines, aggregate them into the
chart's store:

```ts
import { RealtimeBarAggregator } from 'react-native-fast-chart';

const aggregator = new RealtimeBarAggregator(chart.store, { timeframe: '1m' });
ws.onmessage = (e) => {
  const t = JSON.parse(e.data);
  aggregator.addTrade(+t.p, +t.q, t.T);
};
```

The controller also offers:

- indicators: `addIndicator`, `updateIndicator`, `removeIndicator`;
- panes: `addPane`, `movePane`, `setPaneHeightRatio`;
- viewport: `scrollToRealtime`, `setVisibleRange`, `resetZoom`;
- settings persistence: `getSettings` / `applySettings`, together with
  `serializeChartSettings`.

See [docs/API.md](docs/API.md) for the full list.

## Theming

```tsx
import { defaultLightTheme } from 'react-native-fast-chart';

const override = { candle: { bullish: '#26A69A', bearish: '#EF5350' } }; // stable reference

<TradingChart theme={defaultLightTheme} themeOverride={override} />;
```

`ChartTheme` covers:

- the background and surface;
- grid, candles and axis text;
- crosshair and last-price badge;
- volume and panes;
- the indicator palette.

## Indicators and panes

```tsx
const indicators = [
  { type: 'sma', config: { period: 50, source: 'close' } },
  { type: 'bollinger', config: { period: 20, stdDev: 2 } },
  { type: 'rsi', config: { period: 14 } }, // own pane
  { type: 'volume', paneId: 'price' }, // volume overlay on the price pane
];
```

- Overlays (`sma`, `ema`, `wma`, `bollinger`) draw on the price pane.
- Pane indicators (`volume`, `rsi`, `macd`, `atr`) get their own pane.
  Indicators that share a `paneId` share a pane.
- Users can drag the pane separators.
- For custom indicators, register an `IndicatorModule` with
  `chart.indicators.registry.register(module)` (see
  [docs/API.md §7](docs/API.md#7-indicators)).

## Precision, formatting and time zones

```tsx
<TradingChart
  config={{
    symbol: { tickSize: 0.00001, quantityStep: 0.1 }, // 5 price decimals, 1 volume decimal
    axes: { timeZone: 'America/New_York' }, // 'local' | 'UTC' | minutes offset | IANA
  }}
  priceFormatter={(price, decimals) => {
    'worklet'; // formatters run on the UI thread
    return `$${price.toFixed(decimals)}`;
  }}
/>
```

- **IANA zones** go through `Intl` and are resolved once per zone on the JS
  thread. Runtimes without `Intl` time-zone data fall back to UTC and report a
  `config` error. Check support with `isSupportedTimeZone`.
- **Session gaps.** The X axis is index-based, so weekends and overnight
  closures take no space.

## Error handling and telemetry

```tsx
<TradingChart
  controller={chart}
  onError={(e) =>
    Sentry.captureException(e.error, {
      extra: { source: e.source, ...e.details },
    })
  }
  errorFallback={(error, retry) => (
    <Text onPress={retry}>Chart unavailable — tap to retry</Text>
  )}
  onPerformanceSample={(s) =>
    analytics.track('chart_perf', { fps: s.fps, p95: s.frame.p95Ms })
  }
/>
```

Where errors come from:

- **Render errors** show the fallback instead of unmounting your screen.
- **Non-fatal issues** are reported but never thrown: malformed rows, failing
  indicators, `onLoadMore` failures, unknown zones.
- **Performance samples** arrive every `config.telemetry.performanceSampleMs`
  (5 s by default).

## Performance tips

- **Controller mode.** Use it for feeds faster than about 1 Hz, and call
  `upsertBar` directly from the socket handler.
- **Stable references.** Keep `theme`, `themeOverride`, the formatters and the
  telemetry handlers stable (a module constant, `useMemo` or `useCallback`).
- **Formatters.** Keep them cheap, and don't call `Intl` or
  `toLocaleString` inside them.
- **Release builds.** Profile release builds only. Dev builds are several
  times slower. See [docs/PERFORMANCE.md](docs/PERFORMANCE.md#10-manual-profiling-on-devices)
  for the Android / iOS and 120 Hz ProMotion procedure.
- **Buffer size.** Keep the dataset bounded. Memory costs about 130 B per bar
  across the JS and UI-thread columns (about 13 MB per 100k bars), so page
  history in with `onLoadMore` instead of loading everything.

## FAQ

**Timestamps: seconds or milliseconds?**
Milliseconds, as the bar open time in UTC. Convert second-based data with
`normalizeCandles(rows, { timeUnit: 's' })`.

**Why doesn't my `priceFormatter` apply?**
It must be a worklet. Put `'worklet';` as the first statement. A plain
function throws on the UI thread, and the chart falls back to the built-in
format.

**Daily bars show the previous day.**
Your exchange stamps daily bars at local midnight east of UTC. Set
`axes.dailyBarsTimeZone: 'chart'` together with the exchange's `timeZone`.

**How do I test screens that contain the chart?**
Use the fixtures and test IDs from `react-native-fast-chart/testing`
(`generateCandles`, `GESTURE_TEST_IDS`, `CHART_ERROR_FALLBACK_TEST_ID`). This
repository's Jest setup (`jest/`) shows how to mock Skia.

**Is the Old Architecture supported?**
No. Reanimated 4 requires the New Architecture.

## Documentation

- [docs/API.md](docs/API.md) — the public API reference.
- [CHANGELOG.md](CHANGELOG.md) — releases, the semver policy and migration
  notes.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md) — benchmarks and profiling.
- [docs/IMPLEMENTATION_NOTES.md](docs/IMPLEMENTATION_NOTES.md) — architecture
  notes for each phase.

## Development

```sh
yarn                 # install (Yarn 4 workspaces)
yarn typecheck       # tsc for the library and the example app
yarn lint            # ESLint + Prettier
yarn test            # Jest; yarn test:coverage for coverage
yarn bench           # Node micro-benchmarks
yarn prepare         # build lib/ with react-native-builder-bob
yarn example ios     # or: yarn example android (development build)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
