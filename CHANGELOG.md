# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Versioning policy

The package follows [Semantic Versioning](https://semver.org/).

**Public API.** It covers:

- everything exported from `react-native-fast-chart` and
  `react-native-fast-chart/testing`, as listed in [docs/API.md](docs/API.md);
- `TradingChart` props;
- `ChartConfig` keys and their defaults;
- the `ChartErrorEvent` sources;
- the worklet contract of the formatters.

Anything reachable only through deep imports is internal, and the `exports`
map blocks deep imports. Rendered pixels (exact label positions, colors of
unthemed elements) are not part of the API.

**Before 1.0 (0.x)**

- A **minor** bump (0.2.0) may contain breaking changes. Each one is listed
  under **Breaking** with migration notes.
- A **patch** bump (0.1.1) never breaks the public API.
- A deprecated API keeps working for at least one minor release, and is
  marked `@deprecated` in TSDoc with its replacement.

**From 1.0**

- Breaking changes only happen in major releases.
- Deprecations last at least one minor release before removal.

**Peer dependencies.** Raising the minimum version of a peer dependency is a
breaking change.

## [Unreleased]

### Added

- **Advanced indicators** — overlays `vwap` (session / week / month anchor
  in the chart zone, std-dev bands), `donchian`, `keltner`, `supertrend`,
  `ichimoku` (shifted spans, future cloud) and `parabolicSar` (dots); panes
  `stochastic`, `stochRsi`, `obv`, `mfi`, `cci` and `adx` (DMI). New
  exports: `DEFAULT_INDICATOR_CONTEXT`, `resolveChoiceParam` and the types
  `IndicatorContext` and `ChoiceParam`.

- **Symbol precision** — `config.symbol`:
  - `pricePrecision`, `tickSize`, `quantityStep`, `volumePrecision`;
  - price-axis steps snap to `tickSize`;
  - helpers `resolveSymbolPrecision` and `snapToTickSize`.
- **Formatter hooks** — the `priceFormatter` and `timeFormatter` props follow
  a worklet contract with fallback on error (see
  [docs/API.md](docs/API.md#formatter-contract)). `TIME_LABEL_CROSSHAIR` is a
  new export.
- **IANA time zones** — `axes.timeZone` accepts names such as
  `'America/New_York'` (DST-aware, precomputed through `Intl`). There is a new
  `isSupportedTimeZone` helper.
- **Zone-aware daily bars** — `axes.dailyBarsTimeZone: 'utc' | 'chart'`, plus
  `timeZone` on `RealtimeBarAggregator` and a new `createBucketAligner` for
  daily, weekly and monthly buckets aligned to a zone's midnight.
- **Hardening:**
  - `TradingChart` renders inside a new `ChartErrorBoundary`, with the new
    `errorFallback` prop;
  - config values are sanitized: invalid values fall back to their defaults;
  - NaN, ±∞ and absurd coordinates are dropped before they reach Skia.
- **Telemetry:**
  - new `onError` prop and `controller.subscribeErrors`, with sources
    `render`, `data`, `indicator`, `history`, `config` and `telemetry`;
  - new `onPerformanceSample` prop, with `config.telemetry.performanceSampleMs`.
- **Testing entry** — `BENCHMARK_SCENARIOS`, `GESTURE_TEST_IDS`,
  `CROSSHAIR_TEST_IDS`, `PANE_RESIZE_TEST_ID` and
  `CHART_ERROR_FALLBACK_TEST_ID` are now exported from
  `react-native-fast-chart/testing`.
- **Docs and packaging:**
  - [docs/API.md](docs/API.md), a README overhaul, and a manual profiling guide
    in [docs/PERFORMANCE.md](docs/PERFORMANCE.md);
  - `"sideEffects": false` in `package.json`.

### Changed

- **Render errors no longer crash the host screen.** A render error inside
  `TradingChart` now shows the fallback and is reported through `onError`
  (`fatal: true`) instead of propagating to the host's error boundary.
- **Indicator errors no longer throw from data calls.** An indicator that
  throws while computing is still dropped, but `setData`, `upsertBar` and the
  other data mutators no longer rethrow its error. It is reported through
  `onError` / `subscribeErrors` (`indicator`) instead.
- **Daily-bucket DST fix.** Daily buckets in DST-observing zones now start at
  the zone's midnight on DST-change days. They used to be off by the DST
  delta.

### Deprecated

- `config.axes.pricePrecision` — use `config.symbol.pricePrecision`, which
  takes precedence. It will be removed in 1.0.

### Breaking

- **Pruned root exports.** Renderer, geometry, tick-generation, viewport-math,
  pane-layout and gesture internals are no longer exported from the root.
  Among them:
  - `buildCandleGeometry`, `createPriceTicks`, `createTimeTicks`;
  - `indexToX`, `priceToY`, `createPriceScale`;
  - `computeCrosshair`, `composeChartGestures`;
  - `createOffsetResolver`, `applyChartSettings`, `mergeCandles`.
- **Test helpers moved** — test IDs and `BENCHMARK_SCENARIOS` are now only in
  `react-native-fast-chart/testing`.
- **`ChartTimeZone` widened** — it now includes arbitrary strings (IANA names).
  Exhaustive `switch` statements over it need a default branch.

### Migration

```diff
- import { GESTURE_TEST_IDS, BENCHMARK_SCENARIOS } from 'react-native-fast-chart';
+ import { GESTURE_TEST_IDS, BENCHMARK_SCENARIOS } from 'react-native-fast-chart/testing';
```

```diff
  <TradingChart
-   config={{ axes: { pricePrecision: 2 } }}
+   config={{ symbol: { pricePrecision: 2, tickSize: 0.01 } }}
  />
```

- **Viewport math.** If you relied on the internal viewport or geometry math
  (for example `indexToX` for custom overlays), read the UI-thread state from
  `handle.state` (`ChartSharedState`) instead, or open an issue describing
  your use case so a supported API can be added.
- **Render-error tests.** Tests that expected `TradingChart` render errors to
  throw should now assert the fallback (`CHART_ERROR_FALLBACK_TEST_ID`) or the
  `onError` call.

## [0.1.0]

- **Initial development (phases P1–P8).** Covers:
  - the data and viewport engine;
  - Skia rendering and gestures;
  - axes and crosshair;
  - indicator framework;
  - panes;
  - controller API, realtime updates and history pagination;
  - performance work.
- Not published.
