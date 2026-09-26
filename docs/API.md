# Public API reference

`react-native-fast-chart` has exactly two entry points:

| Import path                       | Contents                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| `react-native-fast-chart`         | Everything listed on this page. Covered by the [semver policy](../CHANGELOG.md#versioning-policy). |
| `react-native-fast-chart/testing` | Fixtures (`generateCandles`, `createSeededRandom`), `BENCHMARK_SCENARIOS`, test IDs.               |

Deep imports (`react-native-fast-chart/src/...`, `.../lib/...`) are blocked by
the `exports` map. Renderer, geometry, tick-generation, viewport-math and
gesture modules are internal. `src/__tests__/index.test.ts` pins the exact
runtime export list, so any change to the surface shows up in review.

Conventions:

- **Time** is Unix epoch **milliseconds** (bar open time, UTC).
- **Threads.** Functions marked _worklet_ may run on the UI thread. Every
  callback prop runs on the JS thread and is never called per frame, except
  the formatters (see below).
- **Stable references.** Pass memoized values for `theme`, `themeOverride`,
  formatters, `crosshairGesture` and the telemetry handlers. `config` and
  `indicators` are compared by value.

---

## 1. Components

### `<TradingChart />`

| Prop                      | Type                                        | Notes                                                                                                     |
| ------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `candles`                 | `readonly Candle[]`                         | Props mode. Diffed against the previous array: append, update-last and prepend are applied incrementally. |
| `controller`              | `TradingChartHandle`                        | Controller mode (see §2). Created internally if omitted.                                                  |
| `ref`                     | `Ref<TradingChartHandle>`                   | The same handle as `controller`.                                                                          |
| `config`                  | `DeepPartial<ChartConfig>`                  | Merged over `DEFAULT_CHART_CONFIG`, then sanitized (see §3).                                              |
| `theme` / `themeOverride` | `ChartTheme` / `ChartThemeOverride`         | The default theme is `defaultDarkTheme`.                                                                  |
| `indicators`              | `readonly IndicatorInput[]`                 | Declarative indicator set. Omit it to manage indicators through the controller.                           |
| `onCrosshairChange`       | `(change: CrosshairChange \| null) => void` | Fires when the crosshair moves to another bar or hides.                                                   |
| `crosshairGesture`        | RNGH gesture                                | Replaces the built-in long-press gesture.                                                                 |
| `onLoadMore`              | `LoadMoreHandler`                           | History pagination (§6).                                                                                  |
| `historyLoadingIndicator` | `ReactNode`                                 | Shown at the left edge while a page is loading.                                                           |
| `realtimeStatus`          | `RealtimeStatus`                            | Mirrors `controller.setRealtimeStatus`.                                                                   |
| `priceFormatter`          | `PriceFormatter`                            | Worklet (§4).                                                                                             |
| `timeFormatter`           | `TimeFormatter`                             | Worklet (§4).                                                                                             |
| `onError`                 | `ChartErrorHandler`                         | Error telemetry (§5).                                                                                     |
| `errorFallback`           | `ReactNode \| (error, retry) => ReactNode`  | Rendered after a render error. The default is an empty view. Changing `controller` also resets the error. |
| `onPerformanceSample`     | `ChartPerformanceSampleHandler`             | Performance telemetry (§5). Frame timing is only collected while this prop is set.                        |
| `style`, `testID`         |                                             |                                                                                                           |

`TradingChart` is always wrapped in a `ChartErrorBoundary`.

### `ChartErrorBoundary`

This is the boundary `TradingChart` uses internally. Wrap your own chart
chrome (toolbars, legends) in it when you want the same behavior.

Props:

- `onError`
- `fallback`
- `resetKey` — any change clears the error;
- `testID` — the default fallback view uses `` `${testID}-error` `` or
  `CHART_ERROR_FALLBACK_TEST_ID`.

Errors thrown inside UI-thread worklets are not React errors, so this boundary
does not catch them. The renderers guard their own inputs instead.

---

## 2. Controller (`TradingChartHandle`)

```ts
const chart = useTradingChartController(config?); // stable across renders
const chart = createTradingChartController(config?); // outside React
```

`config` only seeds the initial viewport. The `config` prop of the chart
component stays authoritative.

### Data

| Method                                                            | Returns           | Notes                                                                                                    |
| ----------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `setData(candles, { viewport?: 'reset' \| 'keepZoom' })`          | `CandleIssue[]`   | Replaces the dataset. Rows are normalized; dropped rows are returned and reported to `onError` (`data`). |
| `appendBar(c)` / `updateLastBar(c)`                               | `boolean`         | O(1). Indicators update incrementally.                                                                   |
| `upsertBar(c)`                                                    | `UpsertBarResult` | Kline semantics: `appended`, `updated`, `patched` or `rejected`. A rejected bar is reported as `data`.   |
| `prependBars(c[])`                                                | `MergeResult`     | Prepends older history without moving the view.                                                          |
| `getBarCount()`, `getBar(i)`, `getLastBar()`, `getVisibleRange()` |                   |                                                                                                          |

### Indicators and panes

- `addIndicator(input)` returns the new id.
- `removeIndicator(id)`, `updateIndicator(id, patch)`,
  `setIndicators(inputs)`, `getIndicators()`.
- `addPane(input?)`, `removePane(id)`, `movePane(id, index)`,
  `setPaneHeightRatio(id, ratio)`, `resizePanes(ratios)`, `getPanes()`.

### Viewport

- `scrollToRealtime(animated?)`
- `setVisibleRange(start, end, animated?)` (logical bar indices)
- `resetZoom(animated?)`
- The handle's `isAtRealtime` shared value can drive a "jump to latest"
  button.

### Settings, status, history, errors

- `getSettings(extras?)`, `applySettings(settings)`. Pair them with
  `serializeChartSettings` and `deserializeChartSettings`.
- `setRealtimeStatus`, `getRealtimeStatus`, `subscribeRealtimeStatus`.
- `loadMoreHistory()`, `setHasMoreHistory(b)`, `getHistoryState()`,
  `subscribeHistoryState(cb)`.
- `subscribeErrors(handler)` receives non-fatal events (§5), even when no
  chart is mounted. It returns an unsubscribe function.
- `dispose()`.

### Engine parts (advanced)

- `store` — a `CandleStore`: JS-thread columns. It is the target of
  `RealtimeBarAggregator`.
- `state` — `ChartSharedState` (read-only for hosts).
- `metrics` — `ChartMetrics`.
- `indicators` — `IndicatorEngine`. Use `indicators.registry` to register
  custom indicators, and `getComputeStats()` for compute counts.
- `panes` — `PaneManager`.
- `history` — `HistoryLoader`.
- `realtimeStatus` — `RealtimeStatusStore`.

---

## 3. Configuration (`ChartConfig`)

`resolveChartConfig(partial)` returns the effective config, and
`DEFAULT_CHART_CONFIG` holds the defaults.

Any invalid value falls back to its default:

- wrong type, `NaN` or `±∞`;
- a negative size, or a ratio above 1;
- an unknown enum value;
- `minBarSpacing > maxBarSpacing`.

Invalid values never reach the engine.

| Section       | Keys (default)                                                                                                                                                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbol`      | `pricePrecision` (null), `tickSize` (null), `quantityStep` (null), `volumePrecision` (null) — see §4                                                                                   |
| `layout`      | `priceAxisWidth` 64, `timeAxisHeight` 24, `rightOffsetBars` 5, `overlayScaleHeightRatio` 0.2, `paneSeparatorHitSlop` 12                                                                |
| `viewport`    | `initialBarSpacing` 8, `minBarSpacing` 0.5, `maxBarSpacing` 64, `bodyRatio` 0.8, `overscanBars` 20, `maxRightOffsetBars` 50, `leftMarginBars` 10, `minVisibleBars` 2, `conflationPx` 2 |
| `interaction` | `panEnabled`, `pinchEnabled`, `crosshairEnabled`, `paneResizeEnabled` (all true)                                                                                                       |
| `axes`        | `timeZone` `'local'`, `dailyBarsTimeZone` `'utc'`, `thousandsSeparator` `','`, `pricePrecision` (**deprecated**, use `symbol.pricePrecision`)                                          |
| `crosshair`   | `mode` `'hold' \| 'sticky'`, `longPressMs` 250, `holdMs` 1200                                                                                                                          |
| `overlays`    | `lastPrice`, `legend`, `legendVolume` (all true)                                                                                                                                       |
| `realtime`    | `followRealtime` true, `lastPricePulse` false, `pulseDurationMs` 700                                                                                                                   |
| `history`     | `loadMoreThresholdBars` 50, `retryDelayMs` 2000                                                                                                                                        |
| `telemetry`   | `performanceSampleMs` 5000 (minimum `MIN_PERFORMANCE_SAMPLE_MS` = 1000)                                                                                                                |
| `debug`       | `overlay`, `profiling` (false)                                                                                                                                                         |

---

## 4. Precision, formatting and time zones

### Symbol precision (`ChartSymbolConfig`)

| Field             | Effect                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pricePrecision`  | Fixed decimals for every price label.                                                                                                                                        |
| `tickSize`        | Price-axis steps are multiples of it, and it sets the decimals when `pricePrecision` is null (`0.00001` gives 5). Crypto micro-prices, forex pips and equity cents all work. |
| `quantityStep`    | Sets `volumePrecision` when that is null.                                                                                                                                    |
| `volumePrecision` | Decimals of unscaled legend volumes. Compact volumes (`1.23K`, `4.5M`, `2.1B`) always use 2 decimals.                                                                        |

When everything is null, decimals are derived from the price magnitude:
4 significant digits below 1, otherwise 2 decimals.

Helpers:

- `resolveSymbolPrecision(symbol, legacyPricePrecision?)`;
- `snapToTickSize(price, tickSize)` (worklet);
- `formatPrice`, `formatVolume`, `formatPercent`, `formatSignedPrice`,
  `autoPriceDecimals`.

### Formatter contract

```ts
type PriceFormatter = (price: number, decimals: number) => string;
type TimeFormatter = (
  localTime: number,
  weight: number,
  barMs: number
) => string;
```

- **Must be worklets.** Put the `'worklet'` directive first. Formatters run on
  the UI thread inside the axis, crosshair and legend layers, and must only
  capture serializable values. Do not use `Intl`, `toLocaleString` or React
  state; plain string operations are fine.
- **Must be pure and fast.** They are called for every visible label on
  every layer rebuild. Labels are cached by value.
- **Fail-safe.** A formatter that throws, or returns a non-string, falls back
  to the built-in format for that label. A non-worklet function throws on the
  UI thread, so it always falls back.
- **`TimeFormatter` arguments:**
  - `localTime` is the bar time already shifted into the chart zone. Read it
    with the UTC getters (`new Date(localTime).getUTCHours()`).
  - `weight` is `TIME_LABEL_CROSSHAIR` (0) for the crosshair label, otherwise
    `TICK_WEIGHT_TIME` (1), `TICK_WEIGHT_DAY`, `TICK_WEIGHT_MONTH` or
    `TICK_WEIGHT_YEAR` (4).
  - `barMs` is the estimated bar duration.
- Keep the reference stable (a module constant or `useCallback`). A new
  function forces a relayout.

### Time zones (`ChartTimeZone`)

| Value                            | Meaning                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `'local'` (default)              | Device zone, DST-aware (`Date#getTimezoneOffset`).                         |
| `'utc'` / `'UTC'`                | UTC.                                                                       |
| number                           | Fixed offset in minutes east of UTC (`330` = UTC+05:30), clamped to ±14 h. |
| IANA name (`'America/New_York'`) | DST-aware, resolved through `Intl`.                                        |

One resolver drives the time axis, the crosshair label, `TimeFormatter` and
(with `dailyBarsTimeZone: 'chart'`) the dates of daily and longer bars.

`RealtimeBarAggregator({ timeZone })` and `createBucketAligner(spec, zone)`
align d/w/M buckets to the zone's midnight. They are DST-safe: the offset used
is the one at the bucket's own midnight. Sub-day buckets are always
epoch-aligned.

**IANA zones and Hermes**

- **How lookups work.** The zone's transition table (1990 to about 13 months
  ahead) is built once per zone on the JS thread using
  `Intl.DateTimeFormat#formatToParts`, then cached. UI-thread lookups are a
  binary search, with no `Intl` calls per frame.
- **Where Intl is available.** Hermes ships `Intl` with `timeZone` support on
  both platforms (RN ≥ 0.70). Custom builds without Intl, or JSC without ICU
  data on older Android, cannot resolve IANA names. In that case the chart
  falls back to **UTC** and reports a `config` error to `onError`. Call
  `isSupportedTimeZone(name)` up front and offer a fixed offset instead.
- **Offsets beyond the lookahead** reuse the last known offset. This only
  matters for apps that stay open for more than a year, or for far-future
  timestamps.

### Session gaps

The X axis is **index-based**: each bar takes one slot, whatever its time
gap. Market closures (overnight, weekends, holidays) therefore collapse
instead of leaving empty space, just as on TradingView. Time ticks are picked
from the bars' actual times, so the first bar after a weekend gets a day
label. `RealtimeBarAggregator` never fabricates bars for closed sessions
unless you pass `fillGaps: true`. For 24/7 markets, index and time are
proportional. The behavior is covered by `src/axes/__tests__/SessionGaps.test.ts`.

---

## 5. Errors and telemetry

```ts
interface ChartErrorEvent {
  source: 'render' | 'data' | 'indicator' | 'history' | 'config' | 'telemetry';
  error: Error;
  fatal: boolean; // true only for render errors (the fallback is shown)
  componentStack?: string;
  details?: Readonly<Record<string, unknown>>; // e.g. { dropped, issues } or { indicatorId, type }
}
```

| Source      | When                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| `render`    | A React render or lifecycle error. `TradingChart` shows `errorFallback`.               |
| `data`      | `setData` or the `candles` prop dropped malformed rows, or `upsertBar` rejected a bar. |
| `indicator` | An indicator threw. Its result is dropped and the other indicators keep running.       |
| `history`   | `onLoadMore` threw or rejected. The request is retried after `history.retryDelayMs`.   |
| `config`    | An unusable option, such as an unresolvable IANA zone.                                 |
| `telemetry` | `onPerformanceSample` threw.                                                           |

Handlers are guarded, so a throwing handler never breaks the chart.

`onPerformanceSample(sample: ChartPerformanceSample)` is called once per
`telemetry.performanceSampleMs`. A sample contains:

- `startedAt`, `durationMs`, `fps`, `bars`;
- `frame` — a `FrameStatsSummary`: avg / p95 / max ms, dropped frames;
- `build` — `{ count, avgMs, maxMs }`, the time spent building Skia layers.

Samples are batched on the UI thread and posted to JS every 30 frames.

Also exported:

- the `FrameStats` helpers (`createFrameStats`, `recordFrameInterval`,
  `summarizeFrameStats`, `resetFrameStats`) for custom JS-side meters;
- `ChartMetrics` (`handle.metrics`) for detailed timings when
  `debug.profiling` is on.

---

## 6. Data, history and realtime

- **Validation:**
  - `normalizeCandles(rows, { timeUnit?: 'ms' | 's' })` sorts, deduplicates
    and drops invalid rows, and returns `{ candles, issues }`;
  - `validateCandles`, `isValidCandle`, `getCandleIssue`.
- **Timeframes:** `parseTimeframe('15m')`, `timeframeToMs`,
  `getBucketStart`, `getNextBucketStart`, `createBucketAligner`.
- **`RealtimeBarAggregator(store, options)`:**
  - `addTrade(price, qty, time)`;
  - `upsertBar(kline)`, using Binance `k` field names;
  - `applySnapshot(candles, mode)`, `reset()`.
  - Use `handle.store` as the store. The aggregator detects dataset resets
    (symbol or timeframe switch) automatically.
- **`LoadMoreHandler`** receives `({ before, barCount })` and returns
  `Candle[] | { candles?, hasMore? } | void`, or a promise of one of those.
- **`RealtimeStatus`** is one of `REALTIME_STATUSES`, checked with
  `isRealtimeStatus`.

---

## 7. Indicators

**Built-in types**

- Overlays: `sma`, `ema`, `wma`, `bollinger`.
- Panes: `volume`, `rsi`, `macd`, `atr`.

```ts
interface IndicatorInput {
  id?: string; // default `${type}-${index}` in props mode
  type: string;
  paneId?: string; // 'price' puts a pane indicator on the price pane
  config?: Readonly<Record<string, unknown>>; // validated by the module
  style?: Partial<IndicatorStyle>;
}
```

- **Catalog helpers (for building settings UIs):** `createIndicatorInput`,
  `allowedPlacements`, `placementOf`, `parseParamValue`,
  `formatIndicatorLabel`, `paramDefaults`.
- **Custom indicators.** Implement an `IndicatorModule`:
  - `meta` — an `IndicatorMeta`: params, outputs, series, scale;
  - `indicator` — an `Indicator`: `calculate` and `update`. The easiest way to
    build one is `createStepIndicator(kernel)`, which gives exact O(1)
    incremental updates;
  - `resolveConfig`, `formatLabel`, and optionally `guides`.

  Register the module with `handle.indicators.registry.register(module)`,
  then add it like a built-in. Useful building blocks:
  `createIndicatorResult`, `ensureResultCapacity`, `readSource`,
  `isFiniteValue`, `periodParam`, `sourceParam`, `resolveNumberParam`,
  `resolveSourceParam`. Use `NaN` for warm-up values; non-finite points are
  never drawn.

- **Adapters:** `toLinePoints`, `toBandPoints`, `toHistogramPoints`,
  `toMultiLine`, `histogramPolarity`. They turn results into plain point
  arrays (for tests and exports).
- **Standalone registry:** `createIndicatorRegistry()` returns a registry
  with the built-ins registered.

## 8. Panes, settings, theme

- **Panes:**
  - `PaneInput` is `{ id?, heightRatio?, minHeight?, index? }`;
  - `PRICE_PANE_ID` is `'price'`;
  - height ratios are clamped to `[MIN_PANE_RATIO, MAX_PANE_RATIO]`.
- **Settings:**
  - `ChartSettings` has version `CHART_SETTINGS_VERSION`;
  - `createChartSettings`, `defaultChartSettings`;
  - `serializeChartSettings` returns JSON;
  - `deserializeChartSettings(json, isKnownType)` returns
    `{ settings, issues }`. It is tolerant: an unknown indicator type becomes
    an issue, never an exception;
  - `settingsToIndicatorInputs`.
- **Theme:**
  - `ChartTheme`;
  - `defaultDarkTheme`, `defaultLightTheme`;
  - `mergeTheme(base, override)` with `ChartThemeOverride`.
