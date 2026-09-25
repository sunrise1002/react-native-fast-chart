# react-native-fast-chart

High-performance candlestick trading chart for React Native, built on
[`@shopify/react-native-skia`](https://shopify.github.io/react-native-skia/),
[`react-native-reanimated`](https://docs.swmansion.com/react-native-reanimated/) and
[`react-native-gesture-handler`](https://docs.swmansion.com/react-native-gesture-handler/).
The goal is TradingView / Binance-app quality UX: smooth pan & pinch, crosshair,
overlay and pane indicators, realtime updates and 100k+ candle datasets.

> **Status: early development.** Phase P1 (foundation) is done: types, candle
> validation, themes and profiling utilities. `<TradingChart>` currently renders
> an empty themed canvas. See [`docs/PHASES.md`](docs/PHASES.md) for the roadmap.

## Installation

```sh
yarn add react-native-fast-chart
yarn add @shopify/react-native-skia react-native-reanimated react-native-worklets react-native-gesture-handler
```

With Expo, install the peer dependencies with `npx expo install` so SDK-compatible
versions are picked.

### Peer dependencies

| Package                        | Tested version | Required |
| ------------------------------ | -------------- | -------- |
| `react`                        | 19.2.3         | >= 19    |
| `react-native`                 | 0.86.3         | >= 0.79  |
| `@shopify/react-native-skia`   | 2.6.2          | >= 2.0   |
| `react-native-reanimated`      | 4.5.1          | >= 4.0   |
| `react-native-worklets`        | 0.10.1         | >= 0.4   |
| `react-native-gesture-handler` | 2.32.0         | >= 2.20  |

Reanimated 4 needs the New Architecture and the `react-native-worklets/plugin`
Babel plugin (already included in `babel-preset-expo`).

## Usage

```tsx
import {
  TradingChart,
  defaultDarkTheme,
  normalizeCandles,
} from 'react-native-fast-chart';

// Untrusted input -> sorted, deduplicated, validated candles (time in Unix ms).
const { candles, issues } = normalizeCandles(rawRowsFromApi, { timeUnit: 'ms' });

export function Screen() {
  return (
    <TradingChart
      theme={defaultDarkTheme}
      themeOverride={{ candle: { bullish: '#26A69A' } }}
      style={{ flex: 1 }}
    />
  );
}
```

### Timestamps

All `time` values are **Unix epoch milliseconds** (bar open time, UTC). Convert
second-based sources with `normalizeCandles(rows, { timeUnit: 's' })`.

### Test fixtures

A deterministic OHLCV generator is available from a separate entry point, so it
never ends up in production bundles unless imported:

```ts
import { generateCandles } from 'react-native-fast-chart/testing';

const candles = generateCandles({ count: 100_000, seed: 42 });
```

## Development

```sh
yarn                 # install (Yarn 4 workspaces; npm is not supported)
yarn typecheck       # tsc for the library and the example app
yarn lint            # ESLint + Prettier
yarn test            # Jest
yarn test:coverage   # Jest with coverage report
yarn prepare         # build lib/ with react-native-builder-bob
yarn example start   # start the Expo example (dev build needed for Skia)
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/IMPLEMENTATION_NOTES.md`](docs/IMPLEMENTATION_NOTES.md) for the repository
layout and architecture notes.

## License

MIT
