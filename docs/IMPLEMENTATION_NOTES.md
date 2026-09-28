# Implementation Notes

Each phase appends a section below. Keep entries short and factual.

---

## Repository layout & commands (contributor guide)

```text
.                         library package `react-native-fast-chart` (Yarn 4 workspace root)
├── src/                  library source (TypeScript, consumed directly by the example)
│   ├── index.ts          public entry
│   ├── components/       React components (TradingChart)
│   ├── core/             ChartTypes, ChartConfig, ChartController (interfaces)
│   ├── data/             Candle model, validation, CandleStore, merge, aggregator, UiCandleSeries (pure TS)
│   ├── viewport/         TimeScale, VisibleRange, PriceScale, AutoScale(Target) (pure TS, worklet-safe)
│   ├── engine/           shared values, viewport/gesture worklets, store → UI sync, controller
│   ├── render/           RenderModel, candle/grid geometry (pure TS), skia/ hooks + canvas
│   ├── interaction/      RNGH gesture composition
│   ├── indicators/       indicator contracts & result types (pure TS)
│   ├── panes/            pane definitions (pure TS)
│   ├── theme/            ChartTheme, default dark/light themes, mergeTheme
│   ├── performance/      RenderProfiler, ChartMetrics, BenchmarkScenarios
│   ├── testing/          fixtures (seeded OHLCV generator); public subpath `react-native-fast-chart/testing`
│   └── utils/            small shared helpers (deepMerge)
├── example/              Expo SDK 57 app (workspace `react-native-fast-chart-example`)
├── benchmarks/           plain-Node micro-benchmarks (`yarn bench`)
├── jest/                 setup (RNGH + Reanimated test setup) and mocks/ (Skia stand-in)
├── docs/                 PHASES.md, IMPLEMENTATION_NOTES.md
└── react-native-skia-trading-chart-spec.md
```

The spec's `src/chart/*` tree is flattened into `src/*`.
Tests live next to the code in `__tests__/` folders (`*.test.ts[x]`).

| Command                  | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `yarn`                   | install all workspaces (lockfile committed, Yarn 4.11 vendored) |
| `yarn typecheck`         | `tsc --noEmit` for the library, then for `example/`             |
| `yarn lint` / `lint:fix` | ESLint (`@react-native` config) + Prettier                      |
| `yarn test`              | Jest (`@react-native/jest-preset`)                              |
| `yarn test:coverage`     | Jest + coverage (text summary + lcov in `coverage/`)            |
| `yarn bench`             | micro-benchmarks, plain Node ≥ 22.18 (built-in TS), not Jest    |
| `yarn prepare`           | bob build → `lib/module` (ESM) + `lib/typescript` (d.ts)        |
| `yarn example start`     | Expo dev server for the example app                             |

---

## P1 — Library foundation

### What was built

- **Scaffold** generated with `create-react-native-library@0.63.1`
  (`--type library --languages js --example expo --tools eslint jest`) and
  adapted: Yarn 4 workspaces, builder-bob (ESM + d.ts), TS strict with
  `noUncheckedIndexedAccess`, source-condition exports
  (`react-native-fast-chart-source`) so Metro, Jest and `tsc` consume `src/`
  directly. Unused native-build bits (turbo, native CI jobs, web target) were
  removed.
- **Versions** pinned to the Expo SDK 57 set (`npx expo install --check` passes):
  RN 0.86.3, React 19.2.3, Skia 2.6.2, Reanimated 4.5.1, Worklets 0.10.1,
  Gesture Handler 2.32. TypeScript 6.0, Jest 29, ESLint 9, Prettier 3.
- **Core types**: `Candle`, `UnixMs`, `Timeframe`, `Rect`, `Size`,
  `LogicalRange`, `TimeRange`, `PriceRange`; `ChartConfig` (+ defaults and
  `resolveChartConfig`); `TradingChartController` (spec §21 signatures);
  `Indicator`, `IndicatorDefinition`, result point types (§13);
  `PaneDefinition`, `PRICE_PANE_ID` (§12).
- **Candle validation** (`data/CandleValidation.ts`): `getCandleIssue`,
  `isValidCandle`, `validateCandles` (non-mutating report incl.
  `DUPLICATE_TIME` / `OUT_OF_ORDER`), `normalizeCandles`.
- **Fixtures** (`testing/fixtures`): Mulberry32 PRNG + geometric random-walk
  `generateCandles` (100k candles + full validation ≈ 0.2 s in Jest; test gate < 1 s).
- **Theme**: `ChartTheme`, `defaultDarkTheme` (Binance: `#0B0E11` / `#161A1E`,
  `#0ECB81` / `#F6465D`), `defaultLightTheme`, `mergeTheme`.
- **Performance**: `createRenderProfiler` (Float64Array ring buffer,
  begin/end/record, avg/p95/min/max/last), `createChartMetrics` (channels
  `frame | render | indicator | visibleRange | data`, `markFrame` → fps),
  `BENCHMARK_SCENARIOS` A–D (spec §28), `debug.overlay` / `debug.profiling`
  config flags.
- **`<TradingChart>`**: Skia `<Canvas>` with a `<Fill>` in the theme background;
  props `theme`, `themeOverride`, `style`, `testID`.
- **Example app**: `example/src/screens/PlaygroundScreen.tsx` — theme toggle,
  100k-candle generate + normalize timings, the chart canvas.

### Key design decisions

- **Timestamp policy**: `time` = bar **open** time in **Unix ms (UTC)**,
  non-negative safe integer. Seconds are converted only at the boundary
  (`normalizeCandles(..., { timeUnit: 's' })`); the engine never guesses units.
- **Validation rules**: all prices finite (negative prices allowed — some
  futures trade negative), `volume` finite and `>= 0`,
  `high >= max(open, close)`, `low <= min(open, close)`. `isValidCandle` is
  strict (volume required); `normalizeCandles` tolerates missing/null volume
  (→ `0`, spec §26).
- **Normalization**: O(n) when already sorted, stable sort otherwise;
  duplicates resolved "last occurrence in input order wins" (latest market
  update). Output rows are fresh, monomorphic `{time, open, high, low, close,
volume}` objects; extra fields are dropped; input is never mutated. Every
  dropped row is reported as `{ index, reason }` sorted by index.
- **Theme vs overrides**: `theme` is a full `ChartTheme`, `themeOverride` a
  `DeepPartial` merged with `mergeTheme`. Arrays (palette, dash patterns) are
  replaced, not merged. `deepMerge` ignores `__proto__`/`constructor`/`prototype`.
- **Profiler zero cost**: disabled profilers are the shared frozen
  `NOOP_PROFILER`; recording never allocates; stats sort a preallocated
  scratch buffer and are meant for occasional reads (overlay refresh,
  benchmarks). Nearest-rank p95. Invalid durations (NaN/negative/∞) ignored.
- **Fixtures as a subpath export** (`react-native-fast-chart/testing`) to keep
  them out of the main entry; still usable by the example app and benchmarks.
- **Jest**: `@react-native/jest-preset`; `@shopify/react-native-skia` mapped to
  `jest/mocks/react-native-skia.tsx` (host elements, props inspectable).
  Component tests use `@testing-library/react-native` 13 +
  `react-test-renderer` 19.2.3 (TLRN 14's `test-renderer` needs React 19.3).

### Public API added (main entry)

Runtime: `TradingChart`, `DEFAULT_CHART_CONFIG`, `resolveChartConfig`,
`PRICE_PANE_ID`, `getCandleIssue`, `isValidCandle`, `validateCandles`,
`normalizeCandles`, `defaultDarkTheme`, `defaultLightTheme`, `mergeTheme`,
`createRenderProfiler`, `NOOP_PROFILER`, `defaultClock`, `createChartMetrics`,
`METRIC_CHANNELS`, `BENCHMARK_SCENARIOS`.
Types: `Candle`, `UnixMs`, `TimeUnit`, `Timeframe`, `Rect`, `Size`,
`LogicalRange`, `TimeRange`, `PriceRange`, `ChartConfig` (+ sub-configs),
`TradingChartController`, `Indicator`, `IndicatorDefinition`, `IndicatorStyle`,
`LinePoint`, `MultiLineResult`, `HistogramPoint`, `HistogramPolarity`,
`BandPoint`, `PaneDefinition`, `PaneType`, candle issue/result types,
`ChartTheme`, `ColorValue`, `ChartThemeOverride`, profiler/metrics types,
benchmark types, `DeepPartial`.
Subpath `react-native-fast-chart/testing`: `generateCandles`,
`MAX_GENERATED_CANDLES`, `createSeededRandom`.

### Tests

160 Jest tests in 9 suites; each file header holds its test perspective table
(Given/When/Then in every case). Coverage: 99.5 % statements, 99.4 % branches.
The only uncovered branch is the `Date.now()` fallback of `defaultClock`
(taken only on runtimes without `performance.now`, chosen at module load).

### Known limitations / follow-ups

- `<TradingChart>` does not accept data yet; `candles`/controller wiring,
  viewport, rendering and gestures arrive in P2–P3/P7. `ChartEngine`/`ChartState`
  files from spec §7 are intentionally not stubbed.
- `ChartConfig` fields other than `debug` are not consumed yet; later phases
  may extend/rename them (values are defaults only).
- `debug.overlay` has no renderer yet (P3/P8 should draw it from
  `ChartMetrics.snapshot()`), and profiling is JS-thread only — UI-thread
  (worklet) timing needs a worklet-safe variant in P3/P8.
- The Skia Jest mock only covers `Canvas` and `Fill`; extend it as rendering
  lands (or switch to Skia's CanvasKit Jest env for pixel tests).
- The example needs a development build if Expo Go lacks the pinned Skia
  version; web target was removed (Skia web needs CanvasKit loading).
- Yarn reports a harmless peer warning: `@react-native/eslint-config` pulls
  `eslint-plugin-ft-flow`, which declares `eslint@^8` (template default).

---

## P2 — Data engine + viewport/coordinate engine

### What was built

All pure TypeScript, zero Skia/React imports (`src/data/`, `src/viewport/`).

- **`CandleBuffer`** — struct-of-arrays storage: six `Float64Array` columns
  (`time/open/high/low/close/volume`), bars at `[offset, offset + length)`
  with free slots on **both** sides. Geometric growth: append and prepend
  are amortized O(1) per bar (1000 single-bar prepends ⇒ ≤ 6 reallocations).
- **`CandleStore`** (spec §8.2) — `setData` (one-pass fast path for clean
  input, else `normalizeCandles`), `append`/`appendValues`/`appendMany`,
  `updateLast`/`updateLastValues`, `updateValuesAt`, `prepend`, `splice`,
  `clear`; reads `get`, `getRange` (end-exclusive), `timeAt`,
  `firstTime`/`lastTime`, `findIndexByTime`, `findNearestIndex`,
  `lowerBound`/`upperBound`, raw `columns`. Change tracking: `version` (every
  mutation), `resetVersion`, `prependedSinceReset`, `lastChange`, and
  `subscribe(listener)` (plain callbacks, not React) with change kinds
  `reset | append | updateLast | prepend | patch` + `count`/`fromIndex`.
- **`TimeSearch`** — allocation-free `lowerBound`/`upperBound`/
  `findExactIndex`/`findNearest` over a column + offset (worklet-safe).
- **`mergeCandles`** (Phase 1.2, §9.1) — normalizes any batch (dedupe,
  sort, drop invalid), splits it into older | overlap | newer, rebuilds the
  overlap with a single `splice`, then appends / prepends. Policies:
  `'history'` (default), `'replace'`, `'keep'`.
- **`Timeframe`** — `parseTimeframe`, `timeframeToMs`, `getBucketStart`,
  `getNextBucketStart`; units `s m h d w M`, UTC alignment, weeks start
  Monday 00:00 UTC, calendar months (multi-month counted from Jan 1970).
- **`RealtimeBarAggregator`** (Phase 1.3) — `addTrade(price, qty, time)`
  (allocation-free on the `updated` path), `upsertBar(kline)` (Binance
  `{t,o,h,l,c,v,isClosed}`, numeric strings accepted), `applySnapshot(bars,
'merge' | 'replace')`, `reset()`. Returns
  `created | updated | patched | ignored | rejected`.
- **`TimeScale`** (Phase 2.1–2.4) — `indexToX`, `xToIndex`,
  `xToNearestIndex`, `rightEdgeIndex`, `visibleBarCount`, `candleBodyWidth`,
  `clampBarSpacing`, `min/maxRightOffset`, `panRightOffset`,
  `clampRightOffset`, `elasticRightOffset` (rubber band), `zoomRightOffset`
  (focal point), `barSpacingForRange`/`rightOffsetForRange`,
  `isLastBarVisible`.
- **`VisibleRange`** — `getVisibleRange(state, overscan, out?)` (inclusive,
  clamped, `{0,-1}` when empty) and `getVisibleLogicalRange`.
- **`PriceScale`** (Phase 2.5) — `normalizePriceRange`, `createPriceScale`
  (spec §11.1 padding), `priceToY` / `yToPrice` (inverted Y).
- **`AutoScale`** (Phase 2.6) — `candleRangeMinMax(columns, start, end,
out)` and generic `rangeMinMax(values, start, end, out, offset?,
length?)` skipping `null`/`undefined`/`NaN`/±∞.
- `CandleValidation.getBarValuesIssue` — numeric fast path used by all
  store mutations.
- `ChartViewportConfig` gained `bodyRatio` (0.8), `overscanBars` (20),
  `maxRightOffsetBars` (50), `leftMarginBars` (10), `minVisibleBars` (2);
  it structurally satisfies `TimeScaleOptions`, so `config.viewport` can be
  passed directly.
- Example: `example/src/components/EngineDemo.tsx` — 100k bars in a
  `CandleStore` (bound via `useSyncExternalStore`), pan/zoom/live buttons,
  1000-trade bursts through the aggregator, prints render range, autoscale
  and axis range.

### Key design decisions

- **Store API never throws on the hot path**: invalid or out-of-order input
  returns `false` (no mutation, no event). Only `setData` and
  `mergeCandles` are tolerant (they normalize and report issues).
  `prepend`/`appendMany`/`splice` are all-or-nothing.
- **Change object is reused** (no per-tick allocation); listeners must copy
  fields. Listener errors are isolated: all listeners run, the first error
  is rethrown to the mutator after the mutation has been applied.
  Pollers (e.g. a per-frame reader) compare `resetVersion` and use the
  delta of `prependedSinceReset` as the index shift for cached indices.
- **Conflict policy (`'history'`)**: incoming history wins for **closed**
  bars (REST is authoritative); for the store's **last (live)** bar the two
  are combined: `open` from history (realtime may have joined mid-bar),
  `high = max`, `low = min`, `close` from realtime (fresher),
  `volume = max`. `'replace'` (reconnect snapshots) always takes incoming,
  `'keep'` only fills gaps. Race "realtime bars exist before the initial
  history arrives" is handled by using `mergeCandles` (not `setData`) for
  the initial load. Merge emits at most `patch → append → prepend`.
- **Aggregator semantics**: bars are opened at the UTC bucket start; gaps
  are never fabricated unless `fillGaps` (flat bars at previous close,
  volume 0, capped by `maxGapFillBars`, default 10 000 — longer gaps are not
  filled at all). Out-of-order trades: inside the live bar they update
  high/low/volume but only a trade at least as new as the latest seen one
  sets `close`; trades for older bars update the stored bar's high/low/volume
  (`lateTicks: 'apply'`, default) or are dropped (`'ignore'`); trades for
  bars missing from the store are always ignored. `isClosed` klines mark the
  bucket final (later trades for it are ignored). A kline for the bucket
  resets the trade-ordering state. The aggregator detects store resets
  (symbol/timeframe switch) via `resetVersion`. `applySnapshot('replace')`
  drops every stored bar from the snapshot's first time on (removes
  unconfirmed / gap-filled bars).
- **X coordinates anchored at the right edge** (TradingView model): logical
  index `i` = bar center, right edge at `R = barCount - 0.5 + rightOffset`,
  `x(i) = width - (R - i) * barSpacing`. Consequences: prepending history
  never moves the viewport (tested); appending scrolls by one bar =
  "follow realtime" for free; to hold still while scrolled back, P7 adds the
  appended count to `rightOffset`.
- **Pan bounds**: `rightOffset ∈ [min, max]`, `max = maxRightOffsetBars`,
  `min` = left edge at most `leftMarginBars` before bar 0; both margins are
  capped so ≥ `minVisibleBars` stay on screen. When the data is shorter than
  the viewport the bounds swap, so the short series can slide between left-
  and right-aligned. `elasticRightOffset` compresses overshoot (iOS rubber
  band, coefficient 0.55) for use during a gesture; spring to
  `clampRightOffset` on release.
- **Zoom**: `zoomRightOffset(state, nextSpacing, focalX)` keeps the logical
  index under `focalX` fixed (verified on 1000 random states to 1e-9
  relative). Clamp the spacing first (`clampBarSpacing`); clamping the
  offset afterwards may move the focal point at the pan bounds (intended).
- **Worklet contract** (P3): every viewport function and `TimeSearch` is a
  plain function over numbers / plain objects with a `'worklet'` directive,
  no closures over classes, no allocation unless `out` is omitted (then one
  small object). They are transformed by the consumer's Babel worklets
  plugin (Metro transforms `node_modules`). Functions that "change" the
  scale return scalars; the caller writes shared values. `createPriceScale`
  and `normalizePriceRange` are **not** worklets (they allocate a snapshot;
  call them on the JS thread or wrap as needed in P3).
- **NaN/∞ guards**: `priceToY`/`yToPrice` return `NaN` for non-finite input
  (renderers must skip — spec §33.8); scales are always finite: degenerate
  ranges become `v ± 1 %` (`±1` around 0), prices clamped to ±1e300, padding
  ratios clamped to `[0, 10]`, invalid rect → 0. Degenerate time scales
  (spacing ≤ 0, NaN) yield empty visible ranges and unchanged offsets.
- **Index conventions**: viewport ranges (`VisibleRange`, AutoScale) are
  **inclusive**; `CandleStore.getRange` is end-exclusive like `slice`.
- **AutoScale strategy decided by benchmark**: linear scan over the typed
  columns (≈0.65 µs per 500-bar query on V8). A sparse table answers in
  ≈0.02 µs but costs ≈2 ms + 17 levels of memory to build per 100k bars and
  must be rebuilt/updated on every tick and prepend — not worth it.
- **Benchmarks run in plain Node**, not Jest: Jest's vm sandbox + RN Babel
  preset made the same binary search ~8× slower, which would misreport.
  `benchmarks/register.mjs` resolves extensionless imports to `.ts`.

### Benchmarks (`yarn bench`, Node 24.19, Apple Silicon dev machine, V8)

| Benchmark                                    |          median run |   per op |
| -------------------------------------------- | ------------------: | -------: |
| setData 100k (clean input, fast path)        |             1.12 ms | 0.011 µs |
| setData 100k (reversed input → normalize)    |             7.46 ms | 0.075 µs |
| append 10k onto 100k                         |             0.21 ms | 0.021 µs |
| updateLastValues 10k                         |             0.11 ms | 0.011 µs |
| aggregator.addTrade 10k (100 trades per bar) |             0.45 ms | 0.045 µs |
| prepend 99 pages × 1000 bars                 |             2.27 ms | 0.023 µs |
| mergeCandles 1001-bar page, 1 bar overlap    |             0.05 ms | 0.052 µs |
| findIndexByTime ×100k in 100k                |             25.4 ms | 0.254 µs |
| frame: pan+range+autoscale+scale, 540 bars   |   7.0 ms/10k frames |  0.70 µs |
| frame: pan+range+autoscale+scale, 1640 bars  |  18.6 ms/10k frames |  1.86 µs |
| sparse table build (max only, 100k)          |             2.13 ms |        — |
| sparse table query vs linear, 500 bars       | 0.017 µs vs 0.65 µs |        — |

Hermes on devices will be several times slower; the per-frame cost still
sits orders of magnitude below the 16.6 ms budget. Jest also has generous
perf gates (100k binary searches, 1000 × 100-bar prepends, 10k autoscale
frames).

### Public API added (main entry)

Runtime: `CandleStore`, `mergeCandles`, `parseTimeframe`, `timeframeToMs`,
`getBucketStart`, `getNextBucketStart`, `RealtimeBarAggregator`,
`getBarValuesIssue`, TimeScale functions (`indexToX`, `xToIndex`,
`xToNearestIndex`, `rightEdgeIndex`, `visibleBarCount`, `candleBodyWidth`,
`clampBarSpacing`, `minRightOffset`, `maxRightOffset`, `panRightOffset`,
`clampRightOffset`, `elasticRightOffset`, `zoomRightOffset`,
`barSpacingForRange`, `rightOffsetForRange`, `isLastBarVisible`),
`getVisibleRange`, `getVisibleLogicalRange`, `DEFAULT_OVERSCAN_BARS`,
`createPriceScale`, `normalizePriceRange`, `priceToY`, `yToPrice`,
`DEFAULT_PRICE_PADDING`, `DEGENERATE_RANGE_RATIO`, `FALLBACK_PRICE_RANGE`,
`MAX_ABS_PRICE`, `candleRangeMinMax`, `rangeMinMax`.
Types: `CandleStoreChange`, `CandleStoreChangeKind`, `CandleStoreListener`,
`CandleColumns`, `MergeConflictPolicy`, `MergeOptions`, `MergeResult`,
`TimeframeSpec`, `TimeframeUnit`, `AggregateResult`, `KlineUpdate`,
`RealtimeBarAggregatorOptions`, `SnapshotMode`, `TimeScaleState`,
`TimeScaleOptions`, `VisibleRange`, `PriceScaleMode`, `PriceScaleOptions`,
`PriceScaleSnapshot`.
Internal (import by path): `TimeSearch`, `ScaleMath` (`clamp`,
`rubberBand`, `areFinite`), `CandleBuffer`.

### Tests

443 Jest tests in 21 suites (P2 added 12 suites, ~280 tests; each file
header holds its perspective table, Given/When/Then in every case,
failure/edge cases ≥ happy paths). Coverage: 99.87 % statements, 99.81 %
branches; **every P2 module is at 100 % statements/branches/functions**.
Property-style tests: x↔index round trip and zoom focal preservation on
1000 seeded random states (1e-9), visible-range size bound on 2000 random
states, prepend invariance of x coordinates.

### Known limitations / follow-ups

- **UI-thread data access (P3)**: columns are `Float64Array`s on the JS
  thread. Worklets cannot read them by reference; P3 must copy the visible
  slice (or geometry) into shared values / Skia paths per data change, not
  per frame. The worklet math itself is ready.
- `mergeCandles` normalizes via `normalizeCandles` (allocates one object
  per bar); fine for history pages, not meant for per-tick use.
  Mid-range inserts/replacements shift the tail (`splice`, O(n − from)).
- `'patch'` events carry only `fromIndex` + length delta; indicator caches
  (P5) should recompute from `fromIndex`. Mid-range inserts do not update
  `prependedSinceReset`; viewport consumers should anchor by time after a
  `patch` with `count !== 0` before `fromIndex`.
- Aggregator does not track per-bar last-trade time for older bars (late
  trades never change a closed bar's close). Month timeframes use the
  nominal 30-day `ms` only for display purposes; alignment is exact.
- `KlineUpdate.t` is used as-is (must be the bar open time); no
  cross-timeframe validation of stored bars.
- Only the `'linear'` price scale mode exists (log/percentage in P9+).
- `indexToTime` for whitespace bars (future time labels) is left to P4.
- `yarn bench` requires Node ≥ 22.18 (built-in TypeScript + `registerHooks`).

---

## P3 — Skia candle rendering + gesture layer

### What was built

- **Render model** (`src/render/RenderModel.ts`) — renderer-agnostic types
  (no Skia): `RectList` (packed `Float32Array` x/y/w/h), `CandleGeometryBatch`
  (4 rect lists + `mode 'candles' | 'wicks'` + `skipped`), and the line /
  histogram / band / grid / axis-label / crosshair / pane models later
  phases fill in. `createRectList`, `pushRect` (amortized growth).
- **Candle geometry** (`render/candles/CandleGeometry.ts`, pure, worklet)
  - `computeCandleMetrics` sizes bars in whole device pixels. The body is
    `floor(barSpacing × bodyRatio × pr)`, at least 1 px. The wick is
    `round(wickWidth × pr)`, at least 1 px. The body is trimmed by 1 px when
    `body − wick` is odd, so the wick is exactly centered.
  - Wick-only mode when `body < wick + 2 px` (≈ bars narrower than 2 px).
  - `buildCandleGeometry` streams the bars in `[start, end]` into a sink
    `{ body(bullish, x, y, w, h), wick(...) }`. The sink avoids an
    intermediate buffer; the Skia path calls `addRect` straight from it.
  - Bullish = `close >= open` (doji counts as bullish). Every edge is
    snapped to the device pixel grid. Bodies and wicks are at least 1 px
    tall.
  - A bar is skipped when any price or projected coordinate is NaN or ±∞
    (§33.8). The whole build returns 0 for a degenerate scale.
  - `CandleGeometryBatch.fillCandleGeometryBatch` collects into a reusable
    batch (tests, alternative renderers, P8 picture caches).
- **Grid** (`render/grid/`) — `niceStep` (1/2/5 × 10ᵏ), `nicePriceStep`,
  `niceBarStep` (whole bars, so lines stick to bars while panning), and
  `buildGridGeometry(time, price, options, sink, priceStep?, barStep?)`.
  The two step functions are the pluggable hook: P4 passes its axis tick
  generators so grid and labels agree. Lines are pixel-snapped and capped
  by `maxLines`.
- **UI-thread data** (`data/UiCandleSeries.ts`) — see the design
  decisions below. `createUiCandleSeries` (snapshot with headroom),
  `writeUiBar`, `packBars` / `applyPackedBars` (6 values per bar).
- **Engine** (`src/engine/`)
  - `ChartSharedState`: Reanimated shared values `series`, `barSpacing`,
    `rightOffset`, `rawOffset`, `activeGestures`, `plotWidth/Height`,
    `priceMin/Max`, `isAtRealtime`.
  - `ViewportActions` (worklets): `releaseViewport` (fling / spring-back),
    `scrollToRealtime`, `resetViewport`, `showLogicalRange`, `resizePlot`,
    `stopViewportAnimations`.
  - `GestureActions` (worklets): `begin/endViewportGesture`,
    `panViewport`, `zoomViewport`, `panVelocityToBars`.
  - `StoreSync.connectStoreToUi`: `CandleStore` → `series`.
  - `useChartReactions`: animated auto Y-scale plus the `isAtRealtime`
    flag.
  - `ChartControllerImpl`: `createTradingChartController` /
    `useTradingChartController`.
- **Skia layer** (`render/skia/`)
  - `useCandlePaths`: exactly 4 paths (bull/bear bodies, bull/bear wicks)
    built in one `useDerivedValue`.
  - `useGridPath`: 1 path.
  - `useFrameProfiler`: P1 metrics hooked into `useFrameCallback`.
  - `SkiaChartCanvas`: background `Fill`, then a clip group holding grid,
    wicks and bodies, then hairline separators for the price-axis gutter
    (right, `layout.priceAxisWidth`) and the time-axis gutter (bottom,
    `layout.timeAxisHeight`).
  - `computePlotSize`.
- **Gestures** (`interaction/useChartGestures.ts`, RNGH v2 + Reanimated)
  - Structure: `Race(crosshair?, Simultaneous(pan, pinch, doubleTap))`.
    P4 plugs the long-press crosshair in through the `crosshairGesture`
    prop without touching the viewport gestures.
  - **Pan**: `activeOffsetX ±8` / `failOffsetY ±8` (horizontal-only, so a
    parent vertical `ScrollView` keeps scrolling); 1:1 drag.
    - Touch-down stops a running fling.
    - Rubber band while dragging past either edge (up to 15 % of the plot
      width).
    - Release runs `withDecay` (deceleration 0.997) with
      `clamp + rubberBandEffect`, so a fling glides and bounces back inside
      the bounds.
  - **Pinch**: focal-point zoom with clamped bar spacing, simultaneous with
    pan.
  - **Double tap**: animated reset (initial spacing + realtime offset,
    280 ms ease-out).
- **`TradingChart`** (component name kept from P1; the phase table's
  `<CandlestickChart>`)
  - Props: `candles`, `controller`, `ref`, `theme`, `themeOverride`,
    `config` (deep-partial, compared by value), `crosshairGesture`, `style`,
    `testID`.
  - Candle data is never React state.
  - Renders happen only for prop, theme or config changes and for the first
    layout / real size changes.
- **Example Playground**
  - 10 000 fixture candles (`react-native-fast-chart/testing`).
  - Dark/light toggle.
  - A "Jump to latest" pill driven by `isAtRealtime` through
    `useAnimatedReaction` + `scheduleOnRN`; it re-renders only when the
    flag flips.
  - Debug toggle: enables `debug.profiling` and an overlay (FPS, frame
    avg/p95, path-build avg/p95, React render count) polled every 500 ms.
  - The P2 `EngineDemo` panel was removed; the real chart replaces it.
- **Benchmark** — `benchmarks/render.bench.ts` (`yarn bench`, V8): one
  frame of candle geometry takes ≈ 2 µs for 52 bars (8 dp) and ≈ 15 µs for
  802 bars (0.5 dp). A grid frame takes ≈ 0.2 µs. The Skia `addRect` JSI
  cost comes on top (≈ 1 call per rect).

### Key design decisions

- **UI-thread data access (the P2 follow-up)**
  - Worklets cannot read JS-thread typed arrays by reference; they are
    cloned when crossing runtimes. The chart therefore keeps one UI copy
    (`UiCandleSeries`) in a shared value.
  - `reset` / `prepend` / large or shrinking `patch`: a full snapshot copy
    (O(n), on data loads only).
  - `append` / `updateLast` / tail `patch` ≤ 512 bars: a packed
    `Float64Array` of the changed bars, written in place on the UI thread
    through `series.modify(fn, forceUpdate)`. O(changed bars), no snapshot.
  - Trade-off: the UI copy doubles memory (≈ 48 B/bar, 4.8 MB for 100k
    bars) in exchange for zero per-frame copies and O(1) realtime ticks.
  - The copy happens per data change, never per frame.
  - Appends while scrolled into history add the appended count to
    `rightOffset` / `rawOffset`, so the view holds still (the P2 note
    planned this for P7). At realtime the chart follows the new bar.
- **Path reuse / allocation strategy**
  - Four `SkPathBuilder`s are created once. Every rebuild runs `reset`,
    then `addRect` per bar with one reused plain rect object (1 JSI call
    instead of 5 for move/line/close), then `detach()` (hands the storage
    over).
  - New `SkPath` objects per frame are unavoidable: a shared value only
    notifies Skia on identity change, and Skia may still reference the
    previous frame.
  - Per frame, allocation is a constant handful of small objects (scales,
    metrics, sink); nothing is allocated per bar.
  - Geometry for invisible bars is never built: visible range + 1 bar of
    overscan per side.
- **Mapper hygiene**
  - A `useDerivedValue` / `useAnimatedReaction` treats every shared value
    captured in its closure as an input. The hooks therefore destructure
    and capture individual shared values (`frameTimeScale(plotWidth,
barSpacing, …)`), never the state object.
  - They never write to their own inputs, which would retrigger the mapper
    every frame.
  - The four path shared values are thin derived values of one frame
    object, so all four paths are built in a single pass.
- **Rubber band model**: gestures track the unclamped `rawOffset`; the
  displayed `rightOffset = elasticRightOffset(raw)`. Pan and pinch share
  it, and the last gesture to end calls `releaseViewport`, so simultaneous
  pan + pinch compose cleanly.
- **Auto Y-scale** (`useChartReactions` + `AutoScaleTarget`)
  - The target is the padded low/high of the bars actually on screen
    (overscan 0).
  - Snap on the first frame, on a dataset reset (`resetVersion`), or when
    the ranges don't overlap.
  - Otherwise retarget a 160 ms ease-out `withTiming`. Retargeting every
    frame acts as a low-pass filter, so bars entering the view don't make
    it jitter.
  - Changes below 1e-6 of the span are ignored.
- **No React render per frame**
  - All per-frame values are shared values.
  - In `__DEV__`, `TradingChart` counts its renders with
    `metrics.countRender()` (`snapshot().renderCount`). The gesture test
    GS2 asserts the count does not change across a pan + fling.
  - `onLayout` only sets state when the size really changes (TC12).
- **Profiler** (disabled by default, `config.debug.profiling`)
  - A `useFrameCallback` (inactive unless enabled) buffers `[timestamp,
pathBuildMs]` pairs on the UI thread and flushes them to
    `ChartMetrics` every 30 frames with one `scheduleOnRN`, never one JS
    call per frame.
  - The metrics instance is resolved at flush time, because toggling
    profiling swaps it (TC13).
- `createPriceScale`, `normalizePriceRange`, `clampPrice` and
  `sanitizeRatio` are now worklets (the P2 note said otherwise).
  `createPriceScale` still allocates one small snapshot object.
- **Peer dependencies raised**
  - `@shopify/react-native-skia >= 2.6.0`, for `Skia.PathBuilder` and
    `detach`.
  - `react-native-worklets >= 0.5.0`, for `scheduleOnUI` / `scheduleOnRN`.
  - Verified against 2.6.2 / 0.10.1; the exact minimums were taken from the
    upstream APIs, not tested.

### Public API added (main entry)

- Controller: `createTradingChartController`,
  `useTradingChartController`, type `TradingChartHandle`.
  - Properties: `store`, `state`, `isAtRealtime`, `metrics`.
  - Data methods: `setData`, `appendBar`, `updateLastBar`, `prependBars`.
  - Viewport methods: `scrollToRealtime(animated = true)`,
    `resetZoom(animated = true)`,
    `setVisibleRange(start, end, animated = true)`.
- `TradingChartProps` additions: `candles`, `controller`, `ref`, `config`,
  `crosshairGesture`.
- Gestures: `composeChartGestures`, `GESTURE_TEST_IDS`,
  `PAN_ACTIVATION_DP`, `DOUBLE_TAP_MAX_DELAY_MS`.
- Geometry and model: the `RenderModel` types, `createRectList`,
  `pushRect`, `computeCandleMetrics`, `createCandleMetrics`,
  `buildCandleGeometry`, `createCandleGeometryBatch`,
  `fillCandleGeometryBatch`, `niceStep`, `nicePriceStep`, `niceBarStep`,
  `buildGridGeometry`, `DEFAULT_GRID_OPTIONS`, `snapToPixel`,
  `lineWidthPx`, `sanitizePixelRatio`.
- Auto-scale: `computeAutoScaleTarget`, `shouldSnapPriceRange`,
  `priceRangeChanged`.
- Metrics: `ChartMetrics.countRender()` and
  `ChartMetricsSnapshot.renderCount`.

### Tests

- **Totals**: 773 Jest tests in 37 suites. P3 added 16 suites, ≈ 330
  tests. Each file header holds its perspective table and every case uses
  Given/When/Then.
- **Pure modules** (PixelSnap, RenderModel, CandleGeometry, CandleMetrics,
  CandleGeometryBatch, NiceStep, GridGeometry, UiCandleSeries,
  AutoScaleTarget) are at 100 % statements / branches / functions.
- **Geometry fuzz**: 2000 random bars × 20 random zoom / pixel-ratio
  states check that output is finite, pixel-snapped, has positive size,
  wicks are centered on bodies, and counts are complete.
- **Engine, hooks, component and gesture tests** run **real Reanimated +
  RNGH** in Jest:
  - `jest/setup.js`: the RNGH `jestSetup` plus `setUpTests()`.
  - The worklets Jest resolver, and `transformIgnorePatterns` covering the
    RN packages.
  - The worklets Babel plugin, enabled **only for `NODE_ENV=test`** in
    `babel.config.js`. Mapper inputs come from worklet closures, as in the
    app build; the published library still ships plain `'worklet'`
    directives.
  - A `setupFilesAfterEnv` hook that flushes Reanimated's frame-callback
    registry setup before a suite fakes timers.
  - Fake timers drive `scheduleOnUI`, animations and frame callbacks.
- **Gestures** are fired with `react-native-gesture-handler/jest-utils`
  (pan, fling, rubber band, pinch clamp, double tap, disabled gestures,
  crosshair composition).
- **Skia** is mocked (`jest/mocks/react-native-skia.tsx`): path builders
  record their rects.
- **Coverage**: 99.92 % statements, 99.65 % branches, 99.61 % functions.
  Uncovered:
  - the `__DEV__ === false` render-counter branch in `TradingChart`
    (Jest always runs with `__DEV__`);
  - the P1 `RenderProfiler` `Date.now` fallback.

### Manual gesture verification (device / simulator, example Playground)

1. **Pan**: drag slowly; the candle under the finger stays under the
   finger (1:1). Vertical swipes don't pan (horizontal-only activation).
2. **Fling**: flick left or right; the chart glides and decelerates.
   Touching during the glide stops it immediately.
3. **Edges**: drag past the newest bar (or the oldest bar plus the margin).
   Resistance grows (rubber band). On release it springs back; a fling into
   the edge bounces back inside.
4. **Pinch**: pinch around a candle; that candle stays under the fingers.
   The zoom stops at the min/max bar width. Pinching while moving the
   fingers also pans.
5. **Wick-only**: zoom out until bars are narrower than about 2 px; bodies
   disappear and single-pixel wicks remain, with no gaps or blur.
6. **Double tap**: after zooming and scrolling away, double-tap; zoom and
   scroll animate back to the default at the latest bar.
7. **Jump to latest**: scroll back; the pill appears. Tap it; it animates
   to realtime and the pill disappears.
8. **Auto Y-scale**: pan through history; the price range follows the
   visible bars smoothly (no jumps, no jitter).
9. **No re-render**: enable Debug; "React renders" stays constant while
   panning, pinching or flinging. FPS should read about 60 (or 120 on
   ProMotion) and "paths avg" should stay well under 1 ms at the default
   zoom.
10. **Theme**: toggle light/dark; colors switch without losing the scroll
    position.
11. **Nested scroll**: wrap the chart in a vertical `ScrollView`; vertical
    swipes on the chart scroll the page.

### Known limitations / follow-ups

- `theme.candle.neutral` is unused; a doji is drawn bullish, per the phase
  spec.
- `config.viewport.overscanBars` is reserved for P8 caches. The renderer
  uses 1 bar of overscan because paths are rebuilt every frame.
- Realtime ticks are not coalesced: each `appendBar` / `updateLastBar`
  makes one `scheduleOnUI` call with a tiny payload. Very high tick rates
  should throttle upstream or wait for P8 pixel-bucket conflation.
- Candle paths are rebuilt on every viewport change, which costs O(visible
  bars) per frame. Picture caching and layer invalidation belong to P8.
- `useChartGestures` stores its pan/pinch bookkeeping in `makeMutable`
  values created inside `useMemo`; they are recreated when options change
  mid-gesture (harmless: the gesture objects are recreated too).
- Axes, labels, crosshair and the last-price marker are P4. The gutters
  are reserved but empty.
- The frame profiler measures path build time (`render` channel) and frame
  intervals (`frame`). Skia's own draw time isn't visible from JS.

## P4 — Axes, last price marker, crosshair and OHLC header

### What was built

- **`src/axes/` — pure tick / format modules** (no Skia or React imports;
  every function is a worklet except the buffer / table factories):
  - `PriceFormat`: `formatPrice` (fixed decimals, thousands separator,
    never `-0.00`, exponent notation from 1e21, `''` for non-finite input),
    `formatSignedPrice`, `formatPercent`, `formatVolume` (compact
    K / M / B / T), `stepDecimals`, `autoPriceDecimals` (2 decimals from 1
    upwards, otherwise 4 significant digits, e.g. `0.00001234` → 8),
    `displayDecimals`. No `Intl` / `toLocaleString` / regex (unreliable
    or slow on the UI runtime).
  - `PriceTicks`: nice steps `1 / 2 / 2.5 / 5 × 10^n`. The target tick
    count is `floor(paneHeight / max(3.5 em, 24 dp))`. `pricePrecision`
    floors the step at `10^-p` and fixes the label decimals; otherwise the
    decimals come from the step. Ticks are exact multiples of the step,
    written into a preallocated `Float64Array`.
  - `TimeTicks`: a 34-entry interval ladder (1 s … 12 h, 1 / 2 / 3 / 5 /
    10 / 15 days, 1 / 2 / 3 / 6 months, 1 … 100 years).
    - `selectTimeInterval` depends only on bar duration and zoom (never
      on the pan position), so labels don't flicker. Sub-day intervals must
      be whole multiples of the bar (4 h bars skip 6 h); day intervals only
      apply to bars of up to a day.
    - `generateTimeTicks` marks each bar that crosses a boundary relative
      to the previous bar, so ticks sit on real bars and follow session
      gaps. The weight is the largest calendar boundary crossed
      (year 4 > month 3 > day 2 > time 1).
    - `thinTicksBySpacing` (greedy, a strictly heavier tick replaces the
      previous one) removes overlaps.
    - `estimateBarInterval` takes the minimum positive gap of the last 64
      bars.
  - `TimeFormat`: TradingView-style tick labels (`2024` / `Mar` / `15` /
    `14:30[:05]`) and the crosshair `YYYY-MM-DD[ HH:mm[:ss]]`.
    `CivilTime` does the calendar math without `Date` (Hinnant's
    algorithms).
  - `TimeZone`: `'local'` (default), `'utc'` or a fixed offset in minutes.
    The local offset is resolved by `offsetAt`, which probes
    `getTimezoneOffset` at `t` and `t + 7 d` and binary-searches a DST
    transition to the millisecond. Ascending lookups cost about 2 probes
    per week of data.
  - `LabelCollision` (`rangesOverlap`, `clampSpan`, `thinTicksBySpacing`),
    `TextMetrics` (glyph-width table for printable ASCII, used for
    allocation-free label measuring in worklets) and `AxisWidth`
    (`requiredAxisWidth` quantized to 4 dp, grow-only `nextAxisWidth`).
- **Layout renderers** (`src/render/axes`, `src/render/overlays`; pure and
  sink-based like the P3 geometry):
  - `layoutPriceAxisLabels`: skips labels leaving the pane or overlapping
    the last-price badge.
  - `layoutTimeAxisLabels`: centered under the bar; labels clipped by the
    plot edges are skipped.
  - `computeLastPriceMarker`: bull / bear by the last bar. When the close
    is off-screen the line is hidden and the badge is pinned to the
    top / bottom edge. The badge height is a parameter, which is the
    countdown slot.
  - `nearestBarIndex` (O(1), clamped to the data), `computeCrosshair`
    (x snapped to the bar center, y follows the finger and is clamped;
    both on device-pixel centers).
  - `layoutOhlcHeader`: `O H L C ±Δ (±%) V`, colored by bar direction;
    groups wrap instead of overflowing.
- **Grid**: `buildGridGeometry` now takes the price / time ticks, so grid
  lines always match the labels. `NiceStep` and `useGridPath` were
  removed.
- **Skia layer** (`src/render/skia`):
  - `SkiaResources`: one `matchFont` font per theme font and its glyph
    table / metrics; paints created once per theme (dashed strokes via
    `PathEffect.MakeDash`).
  - `useAxesLayer`: one mapper builds the grid path and one `SkPicture`
    (price labels, time labels, last-price line + badge) per viewport /
    price / data change, and reports the widest label.
  - `useOverlayLayer`: the crosshair picture (dashed lines + price / time
    label boxes; a cached empty picture while hidden) and the legend
    picture (crosshair bar, otherwise the last bar).
  - `usePriceAxisWidth`: auto-sizes the right gutter on the UI thread.
    It is grow-only while the dataset is unchanged and may shrink after
    a reset. It is clamped to `[layout.priceAxisWidth, 40 % of the
    canvas]`.
  - `SkiaChartCanvas` is now sized entirely from shared values
    (`canvasWidth/Height`, `priceAxisWidth`). Node count is constant:
    5 paths + 3 pictures.
- **Crosshair interaction**:
  - `CrosshairActions` (`showCrosshair`, `moveCrosshair`, `hideCrosshair`
    with a delayed fade, `isCrosshairShown`); state lives in shared
    values `crosshairIndex`, `crosshairY` and `crosshairOpacity`.
  - `useCrosshairGesture`: `Gesture.Pan().activateAfterLongPress(250)`.
    `'hold'` mode fades out `holdMs` after release. `'sticky'` mode keeps
    it; a manual-activation drag (after a 4 dp slop) moves it and a tap
    hides it. It is raced against pan / pinch / double tap, so the chart
    doesn't pan while the crosshair is active.
  - `useCrosshairCallback`: `onCrosshairChange` goes through
    `useAnimatedReaction` + `scheduleOnRN`, only when the bar changes and
    with `null` on hide.
- **Layout**: `LayoutActions` (`resizeCanvas`, `setPriceAxisWidth`,
  `plotSizeFor`). `TradingChart` no longer keeps a size in React state:
  `onLayout` schedules `resizeCanvas` on the UI thread.
- **Example**: the Playground gets Hold/Sticky and Local/UTC toggles and a
  status line fed by `onCrosshairChange`.

### Key design decisions

- **Pictures instead of `<Text>` nodes.** Labels change with every pan
  frame; a React `<Text>` per label would mean React state per frame
  (spec §33). Each layer records a single `SkPicture` in a mapper, so the
  scene has a fixed node count and label drawing is batched.
- **Measuring without JSI.** `font.measureText` per label per frame is a
  JSI call. Glyph widths are read once on the JS thread and label widths
  are sums of table entries (label glyphs are tabular digits; kerning is
  ignored).
- **Grid from ticks.** Grid and labels come from one tick set, so they
  cannot disagree. Vertical lines sit on bars, not on round timestamps, so
  session gaps keep lines on candles.
- **Stable axis width.** Label widths change while panning; a width that
  followed them would shift every bar. The width is quantized to 4 dp and
  only grows, except on a dataset reset.
- **Time interval from zoom only.** Choosing the interval from the visible
  range would make labels jump while panning. Boundary crossings plus a
  weight-ordered, stable thinning keep a label on the same bar as it
  scrolls.
- **Daily and longer bars use UTC dates.** Exchanges stamp daily bars at
  00:00 UTC; in a negative-offset zone a local date would be the previous
  day.
- **Crosshair is a race participant, not a separate layer.** The long
  press wins the race only after the delay, so a quick horizontal drag
  still pans (TradingView feel). The sticky drag fails at touch-down when
  the crosshair is hidden, so it costs nothing in normal use.
- **Mapper scratch objects.** Worklet-captured objects may be frozen in
  development builds, so tick buffers and label arrays are allocated per
  mapper run (a few hundred bytes). Reusing them belongs to the P8
  allocation audit.

### Public API added (main entry)

- Props: `onCrosshairChange` (types `CrosshairChange`,
  `CrosshairChangeHandler`). `crosshairGesture` now also accepts a
  `ComposedGesture` and replaces the built-in crosshair.
- Config:
  - `axes: { pricePrecision: null, thousandsSeparator: ',', timeZone: 'local' }`
    (`ChartAxesConfig`, `ChartTimeZone`);
  - `crosshair: { mode: 'hold', longPressMs: 250, holdMs: 1200 }`
    (`ChartCrosshairConfig`, `CrosshairMode`);
  - `overlays: { lastPrice: true, legend: true, legendVolume: true }`.
  - `layout.priceAxisWidth` is now the minimum width.
- Axes: the functions and constants of `PriceFormat`, `PriceTicks`,
  `TimeTicks` (incl. type `TimeColumn`), `TimeFormat`, `TimeZone`,
  `LabelCollision` and `AxisWidth`.
- Renderers: `layoutPriceAxisLabels`, `layoutTimeAxisLabels`,
  `computeLastPriceMarker`, `nearestBarIndex`, `computeCrosshair`,
  `layoutOhlcHeader`, `centeredBaseline`, plus their constants and types.
- Gestures: `CROSSHAIR_TEST_IDS`, `STICKY_DRAG_SLOP_DP`.
- Removed (pre-1.0): `niceStep`, `nicePriceStep`, `niceBarStep` and the
  step-function grid options.

### Tests

- **Totals**: 1124 Jest tests in 55 suites, all passing. P4 added 19
  suites and removed `NiceStep`. Each file header holds its perspective
  table and every case uses Given/When/Then.
- **Pure modules**: all `src/axes`, `src/render/axes`,
  `src/render/overlays`, `GridGeometry`, `LayoutActions` and
  `CrosshairActions` are at 100 % statements / branches / functions.
  Failure / boundary cases outnumber happy paths: NaN / ±∞ / 0 / negative
  inputs, exact edges, capacity caps, DST transitions to 1 ms, physical
  buffer offsets.
- **Hooks**: `useAxesLayer`, `useOverlayLayer` and `usePriceAxisWidth`
  run against real Reanimated. The Skia mock now records pictures
  (`drawText` / `drawLine` / `drawRRect`) and provides a fake font
  (0.6 em per glyph), paints and path effects.
- **Gestures**: long press show / move / hold-fade / sticky, disabled and
  custom crosshair, `onCrosshairChange` dispatch (one call per bar,
  `null` on hide, latest handler), and the sticky-drag touch handlers
  unit-tested against a fake state manager.
- **Coverage** (`yarn test:coverage`): 99.80 % statements, 99.78 %
  branches, 98.88 % functions. Uncovered:
  - the four one-line `onTouches*` wrappers of the sticky drag, because
    RNGH's jest utils cannot fire touch events (the functions they call
    are tested directly);
  - the pre-existing `__DEV__` / `Date.now` branches from P1 / P3.
- **Benchmarks** (`yarn bench`): a full axes frame (price ticks + labels,
  time ticks + labels, grid) takes ≈ 2.9 µs at 8 dp and ≈ 8.6 µs at
  0.5 dp on the dev machine.

### Manual verification (example Playground)

1. **Axes**: price labels on the right, never overlapping the last-price
   badge; time labels under bars, with day / month / year boundaries
   shown as `15` / `Mar` / `2024` when zoomed out.
2. **Axis width**: pan through history; the right gutter never shrinks
   while panning (it may grow once).
3. **Last price**: a dashed line in the bar color, with a badge on the
   axis. Scroll the price off-screen (zoom into history); the badge pins
   to the top / bottom edge.
4. **Crosshair (Hold)**: long-press, then drag; the vertical line jumps
   bar-to-bar, the horizontal line follows the finger, the axis labels
   follow, and the chart doesn't pan. Release; it fades after about
   1.2 s. The status line updates once per bar.
5. **Crosshair (Sticky)**: after release it stays. Drag moves it
   immediately; tap hides it; pinch still zooms.
6. **Legend**: top-left O/H/L/C/Δ/V of the last bar, or of the crosshair
   bar while shown, green / red by direction.
7. **Local / UTC**: time labels shift by the device offset for intraday
   data.

### Known limitations / follow-ups

- Daily and longer bars always use UTC dates. Named IANA zones and
  exchange sessions are P9.
- Bar duration is estimated from the data (no timeframe prop yet).
- The countdown is only a slot (badge height); the timer itself is later.
- After a dataset reset, a frame computed with a stale price range may
  leave the axis slightly wider than needed until the next reset
  (grow-only).
- The crosshair clamps to the data range; it cannot inspect the empty
  space right of the last bar.
- The legend change is `close − open` of the bar, not versus the previous
  close.
- Per-frame scratch allocations in the mappers (see design decisions)
  belong to the P8 audit.
- Labels are left-aligned in the price axis; right-alignment and
  non-ASCII fonts (the fallback width is the widest ASCII glyph) are not
  handled.

## P5 — Indicator framework + overlay indicators

### What was built

- **Contracts** (`indicators/Indicator.ts`): `Indicator<TConfig, TResult>`
  with `calculate` plus optional incremental `update` and `prepend`.
  - `IndicatorResult` holds one `Float64Array` column per output. `NaN`
    marks warm-up and missing values. It also tracks `length`,
    `committed`, `changedFrom` and the opaque recursion `state`.
  - Other types: `PriceSource` (`open` … `ohlc4`), `IndicatorDefinition`,
    `IndicatorStyle` and the loose `IndicatorInput` (public API).
- **Step kernels** (`StepIndicator.ts`): a recursive indicator is written
  as one `step` per bar and gets exact incremental updates for free (see
  the design decisions).
- **Series helpers**: `readSource`, amortized column growth and
  `isFiniteValue` (`IndicatorSeries.ts`). `WindowSums` provides O(1)
  rolling sum, sum of squares and weighted sum for SMA, WMA and BB.
- **Built-ins** (`indicators/builtins/`):
  - SMA, WMA.
  - EMA: SMA-seeded over the first `period` finite values, then
    `α = 2/(p+1)`, matching TradingView `ta.ema`.
  - Bollinger Bands: population σ like `ta.stdev`. Outputs are
    upper / middle / lower.
  - All have configurable source and period (1…5000). BB also has a
    `stdDev` from 0.001 to 50.
- **Param schema and registry**:
  - `IndicatorConfig.ts` resolves configs tolerantly (defaults, clamping,
    integer rounding; never throws) and formats labels (`EMA 20`,
    `BB 20 2`, `SMA 50 hl2`).
  - `IndicatorRegistry` stores an `IndicatorModule` per type: `meta`
    (name, short name, placement, params, default config, outputs,
    series descriptors of kind line / histogram / band), the indicator,
    `resolveConfig` and `formatLabel`.
  - `createIndicatorRegistry()` registers the built-ins.
- **Engine** (`IndicatorEngine.ts`), one per chart and bound to its
  `CandleStore`:
  - API: `add` / `remove` / `update` / `setIndicators` (declarative,
    matched by id), `getEntries` (a stable snapshot for
    `useSyncExternalStore`), `getResult`, `subscribeEntries`,
    `subscribeResults`, `snapshotUpdates`, `flush`, `dispose`.
  - Supporting modules:
    - `IndicatorCache`: keyed by id, validated by dataset version and
      config version.
    - `IndicatorScheduler`: coalesces store changes into one flush per
      frame via `requestAnimationFrame`.
    - `IndicatorCompute`: the backend seam, with the synchronous v1
      backend that picks incremental vs full per indicator and isolates
      failures.
    - `IndicatorDefinitions`: normalization and entries.
- **Adapters** (`IndicatorAdapters.ts`) convert columns to the spec's
  `LinePoint[]`, `MultiLineResult`, `BandPoint[]` and `HistogramPoint[]`
  for API consumers. They allocate per bar, so they stay off hot paths.
- **UI sync**:
  - `UiIndicatorSet.ts` + `engine/IndicatorSync.ts` mirror results into
    `state.indicators` (a shared value). Each flush makes one
    `scheduleOnUI` call carrying either a full snapshot or a packed tail
    of ≤ 512 bars.
  - `isSeriesAligned` guards against results from a previous dataset.
- **Rendering**:
  - `render/indicators/LineGeometry.ts` (pure worklets):
    `buildLineGeometry` draws one polyline per series; `NaN` / ±∞ break
    the line and |y| is clamped to 1e6. `buildBandFill` draws one closed
    polygon per finite run.
  - `OverlayRenderSpec.ts` resolves strokes, fills and legend values.
    Colors come from the style, then the series default, then the theme
    `indicatorPalette` (cycled), then a fallback. It also resolves width,
    opacity and fill opacity.
  - `render/skia/IndicatorPaints.ts` creates the paints once per spec
    change.
  - `useIndicatorLayer` records all overlays into a single `SkPicture`
    on the UI thread: every band fill first, then every line, with one
    reused `SkPathBuilder`. The node count stays constant however many
    indicators are active.
- **Legend**: `render/overlays/IndicatorLegendRenderer.ts` draws one row
  per overlay under the OHLC header (`EMA 20  65,432.10`). Values come
  from the crosshair bar (or the last bar) and use the series colors.
  Rows are drawn in the existing legend picture.
- **Auto-scale**: `computeAutoScaleTarget` accepts a `PriceRangeExtender`.
  `useChartReactions` widens the visible range with the aligned overlay
  values (TradingView-like), so bands never leave the pane.
- **Wiring**:
  - `TradingChart` has a new `indicators` prop (compared by value).
  - `TradingChartHandle` gained `indicators`, `addIndicator`,
    `removeIndicator`, `updateIndicator`, `setIndicators` and
    `getIndicators`.
  - The `indicator` metrics channel times each publishing flush. The
    `render` channel now sums the candle path and indicator picture
    build times.
- **Example**:
  - The Playground has an "Ind" toggle (EMA 20, EMA 50, BB 20 2).
  - A new **Benchmark** screen runs the §36 gate with a synthetic feed
    (see below).
  - `DebugOverlay` shows indicator timings and extra feed lines.
  - A bottom switch selects the screen.

### Key design decisions

- **Peek / commit = exact incremental updates.** After every compute,
  bars `[0, n−1)` are folded into `state` (committed). The still-forming
  last bar is only *peeked* (`step(..., commit=false)` leaves `state`
  untouched).
  - An update from `changedIndex >= committed` (updateLast, append, tail
    patch) commits the newly closed bars and peeks the new last bar:
    O(changed bars), usually O(1).
  - Because the full calculation runs the identical step sequence,
    incremental results are **bit-identical** to a full recalculation.
    The property tests assert this (≤ 1e-9; in practice 0).
  - Earlier changes, shrinking input and prepends fall back to
    `calculate` (spec §15.3).
- **Deterministic resync.** `WindowSums` recomputes the window exactly
  whenever `i % 256 === 0` (by bar index, so full and incremental runs
  resync at the same bars). This bounds drift and refreshes `shift`.
  Sums are relative to `shift` (a recent value), which avoids
  catastrophic cancellation in `sumSq/p − mean²` at large price levels.
  Bollinger zeroes variances below `1e-10 × meanSq` (rounding residue).
  Otherwise a flat window would get a √noise width, which a golden test
  caught.
- **NaN semantics (TradingView `na`).** Non-finite inputs are counted,
  not summed. SMA, WMA and BB are `NaN` while a bad value is inside the
  window. EMA skips the bar (`NaN` output, recursion unchanged). Seeding
  collects finite values only.
- **Scheduling.** Store listeners only accumulate `{full, fromIndex}`.
  Append / patch keep the minimum index, updateLast uses the last bar,
  reset / prepend force a full recalculation. One flush runs per
  animation frame, so a burst of ticks costs one incremental step per
  indicator. `flush()` forces it (tests, reads). A config change bumps
  `configVersion` and marks the task dirty (full recalc). A style-only
  change re-renders without recomputing.
- **Backend seam.** `IndicatorBackend.compute(dataset, tasks, work,
  cache, updates)` is the only compute entry point. A worker or native
  backend can replace the synchronous one without touching the store
  wiring, the UI sync or the renderers.
- **Failure isolation.** If a (custom) indicator throws, its cache entry
  is dropped and a `removed` update is published. The others still
  compute, and the first error is rethrown after publishing, so it
  surfaces in dev. Unknown types throw from `add` / `setIndicators`;
  `setIndicators` validates every type before changing anything.
- **≤ 1 frame lag, never misaligned.** Candles reach the UI immediately
  (StoreSync) while indicators arrive at the next flush. Each UI series
  carries `resetVersion` + `firstTime`. Renderers, the legend and the
  auto-scale skip series that don't match the displayed candles, so
  after a reset or prepend nothing shifted is drawn for that frame.
- **Transfer cost.** A realtime tick ships `outputs × changed bars`
  values (typically 1–2 per output) in one packed `Float64Array`. The UI
  columns keep 256 slots of headroom and grow ×2.
- **Rendering.**
  - A single picture for all overlays avoids React nodes per indicator
    (§33: batch drawing; no React state per frame).
  - Only the visible slice (plus overscan) is walked.
  - Paints are created on the JS thread once per spec change.
  - The picture is rebuilt only when its inputs change (viewport, price
    range, candles, indicator revision).
- **Pure TS core.** Nothing under `src/indicators/` imports Skia or
  React (§33.1). The worklet helpers (`UiIndicatorSet`, `LineGeometry`,
  the legend layout) are plain functions tested in Node.

### §36 benchmark gate (10k candles, ~200 visible, EMA 20 + EMA 50, 10–20 updates/s)

The gate has two parts:

1. **Node micro-benchmarks** (`yarn bench`, Node 24.19, Apple Silicon,
   V8), in `benchmarks/indicators.bench.ts`:

   | Benchmark | median run (ms) | per op (µs) |
   | --- | ---: | ---: |
   | full calculate EMA 20, 10k bars | 0.094 | 94 |
   | full calculate BB 20 2, 10k bars | 0.202 | 202 |
   | full calculate SMA / WMA / EMA / BB, 100k bars | 0.85–1.95 | 850–1950 |
   | **§36 tick**: store update + EMA20/EMA50 flush + pack + apply | 1.752 / 2000 ticks | **0.88** |
   | tick: store + BB20 flush + pack + apply | 1.312 / 2000 ticks | 0.66 |
   | **§36 frame**: one EMA line, 200 visible bars (×2 for both EMAs) | 5.387 / 2000 frames | **2.7** |
   | frame: BB fill + 3 lines, 200 visible bars | 28.700 / 2000 frames | 14.4 |

   At 20 updates/s the JS thread spends about 18 µs/s on indicators, and
   the UI thread about 5.4 µs per frame on EMA geometry. Even assuming
   Hermes is 10–20× slower than V8, that is < 0.5 ms per tick and
   < 0.1 ms per frame, far inside the 16.7 ms frame budget. The gate
   **passes** on these measurements, so no further optimization was
   needed in P5.
2. **Device check (manual, pending on hardware)**:
   1. Open the example app and switch to **Benchmark** (bottom switch).
   2. The screen loads 10k candles, sets the bar spacing so about 200
      bars are visible, adds EMA 20 + EMA 50, turns profiling on and
      starts a synthetic feed. The feed moves the last bar at 10 or
      20 Hz and opens a new bar every 60 ticks.
   3. Read FPS, frame avg/p95, "paths" (candles + indicator picture
      build) and "indicators" (JS flush) from the overlay while the feed
      runs, and while panning and zooming.
   4. Suggested pass criteria: ≥ 58 FPS, frame p95 ≤ 20 ms, indicator flush p95
      ≤ 1 ms.

   This environment has no device or simulator, so the on-device numbers
   still have to be recorded by the tech lead / QA.

### Public API added (main entry)

- **Contracts**: `PRICE_SOURCES`, `IndicatorInput`, `IndicatorResult`,
  `PriceSource`, `IndicatorRegistry`, `IndicatorMeta` / `IndicatorModule`
  / `IndicatorOutput` / `IndicatorPlacement` / `IndicatorSeriesDescriptor`.
- **Custom-indicator helpers**:
  - `createStepIndicator` + `StepKernel`.
  - Config: `periodParam`, `sourceParam`, `resolveNumberParam`,
    `resolveSourceParam`, `paramDefaults`, `formatIndicatorLabel`,
    `MAX_INDICATOR_PERIOD`.
  - Series: `readSource`, `isFiniteValue`, `createIndicatorResult`,
    `ensureResultCapacity`.
- **Built-ins**: `smaModule`, `emaModule`, `wmaModule`,
  `bollingerModule`, `BOLLINGER_UPPER` / `_MIDDLE` / `_LOWER`,
  `DEFAULT_MA_PERIOD`, `createIndicatorRegistry`,
  `registerBuiltInIndicators`.
- **Engine**: `IndicatorEngine` (+ options, `IndicatorPatch`,
  `IndicatorUpdate`, listener types), `IndicatorEntry`.
- **Adapters**: `toLinePoints`, `toMultiLine`, `toBandPoints`,
  `toHistogramPoints`, `histogramPolarity`.
- **Geometry**: `buildLineGeometry`, `buildBandFill`,
  `resolveOverlaySpecs`, `layoutIndicatorLegend` (+ style constants),
  `UiIndicatorSet` types.
- **Component and handle**: `TradingChart` `indicators` prop;
  `TradingChartHandle` indicator methods.

### Tests

- Every new test file starts with a perspective table and uses
  Given / When / Then. Failure and boundary cases outnumber happy paths.
- **Golden tests**:
  - Hand-computed SMA / WMA / EMA / BB.
  - 2000 generated bars compared against naive O(n·p) references at
    periods 1 / 7 / 20 / 200 / 300 and every price source.
- **Property tests**: random append / updateLast sequences, the 256-bar
  resync boundary, NaN / ±∞ ticks and growth from empty. After every
  tick, incremental results must equal the full recalculation for every
  built-in.
- **Edge cases**:
  - Period 1, period = length ± 1, period > length.
  - Empty input, single bar, physical buffer offsets.
  - NaN inside the window and at the resync bar.
  - 1e12 prices, 1e300 values (y clamp).
- **Engine**: coalescing, reset / prepend, config vs style vs type
  changes (a type change keeps the display position), `setIndicators`
  cache reuse and atomic validation, duplicate / unknown ids, faulty
  indicators, indicators without `update`, profiler, dispose.
- **UI and render**: pack / apply (512 / 513 boundary, growth, shrink,
  inapplicable tails), alignment, auto-scale extension, the Skia layer
  (fills before strokes, empty / unaligned / all-NaN), paints, legend
  rows, `TradingChart` `indicators` prop (by-value comparison, unknown
  type), controller methods.
- The Skia mock records `moveTo` / `lineTo` / `close` path commands and
  `drawPath`.
- **Counts**: 1309 tests in 69 suites (P4: 1124). Coverage 99.85 %
  statements, 99.71 % branches; all new indicator / render modules are
  at 100 % statements. Remaining uncovered: the `TradingChart` `__DEV__`
  false branch and the defensive `?? paints.axisText` fallback in
  `useOverlayLayer`.

### Known limitations / follow-ups

- Pane-placement indicators (`placement: 'pane'`, histograms) are
  computed and exposed but not rendered until the P6 pane system.
- `prepend` is not implemented incrementally by the built-ins; history
  pagination triggers a full recalculation (≈ 0.1–0.2 ms per indicator at
  10k bars in Node). P7 can add a real `prepend` for long histories.
- A mid-range `patch` that inserts bars without changing bar 0 keeps the
  alignment keys, so it can show shifted values for one frame until the
  flush.
- Compute runs on the JS thread (synchronous backend). The backend seam
  is ready for a worker / native implementation if P8 profiling asks for
  it.
- The legend shows raw values with the chart's price precision; per-
  indicator precision and value formatting are P7 / P9 settings.
- The band fill walks the visible slice twice per run (drawability
  scan). It measures 14 µs / frame for BB in Node; P8 may merge the
  passes.
- On-device §36 numbers still have to be recorded (see above).

## P6 — Pane system + Volume, RSI, MACD, ATR

### What was built

- **Pane model** (`panes/Pane.ts`): `PaneDefinition` holds `id`,
  `type` (`price` / `indicator`), `heightRatio`, `minHeight` and
  `indicatorIds`.
  - `PaneInput` is the loose `addPane` input.
  - Defaults: price 3 : indicator 1, minimum heights 80 / 40 dp.
  - Ratios are clamped to `[1e-3, 1e3]`.
- **PaneManager** (`panes/PaneManager.ts`): an ordered pane list with the
  price pane always first. It provides `add`, `remove`, `move`,
  `setHeightRatio`, `resize` (all ratios, used by the drag commit),
  `subscribe` and `getPanes` (a stable snapshot).
  - `sync(entries)` assigns indicators to panes by `definition.paneId`.
    Unknown ids get an automatic pane (`pane:<indicatorId>` by default).
  - An automatic pane is dropped with its last indicator. Explicit panes
    (`addPane`) stay until removed.
- **Layout engine** (`panes/PaneLayout.ts`, pure worklets):
  - `computePaneLayout(spec, total)` splits the stack by weight, honours
    the minimum heights and snaps to whole dp. The last pane absorbs the
    rounding.
  - `paneIndexAt` finds the pane under a y position. `hitTestSeparator`
    finds the nearest separator within the slop.
  - `dragSeparator` moves height between the two adjacent panes only,
    clamped by their minimums; every other pane keeps its size.
- **Pane scales** (`panes/PaneScale.ts`): `computePaneRange` over the
  visible slice.
  - `fixed` (RSI 0–100 + 5 % padding).
  - `volume` (0 → max + 10 % headroom).
  - `zeroCentered` (MACD: always includes 0).
  - `auto` (ATR: data range + 10 % padding).
  - Nothing drawable returns NaN, and the pane then draws nothing.
- **Indicators** (committed in `bf3e244`), all incremental (O(1) per
  tick) through step kernels:
  - Volume: output 0 is the volume, output 1 an optional SMA
    (`maPeriod`, 0 = off). It is colored by candle direction.
  - RSI: Wilder RMA seeded with an SMA, like TradingView `ta.rsi`.
    Guides are 30 / 50 / 70, with a filled overbought/oversold band.
  - MACD: seeded EMAs, with outputs MACD, signal and histogram.
  - ATR: RMA of the true range.
  - `SeededAverage` is the shared EMA/RMA recursion.
- **Generic histogram renderer**
  (`render/indicators/HistogramGeometry.ts`):
  - It emits bars from a zero baseline into a sink, with one color
    bucket per bar:
    - `sign`: 2 colors;
    - `trend`: 4 colors, TradingView MACD;
    - `candle`: bull/bear, used for volume.
  - `usePaneLayer` adds each bucket to its own `SkPathBuilder` and draws
    at most 4 paths per histogram. No React node or draw call is made
    per bar.
- **Render specs** (`render/panes/PaneRenderSpec.ts`):
  `resolvePaneSpecs(entries, panes, theme)` returns one spec per pane,
  in pane order. A spec holds the pane's indicators (strokes, fills,
  histograms with resolved colors), value format, merged guides and
  auto-scale refs.
  - The price pane gets a spec only when it hosts non-price-scale
    indicators (the volume overlay).
  - MACD defaults to `trend` coloring; `style.histogramColorMode:
    'sign'` switches to 2 colors.
- **Rendering** (`render/skia/`):
  - `usePaneScales`: pane Y scales on the UI thread.
  - `usePaneLayer`: two pictures.
    - The **underlay** holds price-pane overlays: volume in the bottom
      `layout.overlayScaleHeightRatio` (20 %) of the price pane, drawn
      below the candles.
    - The **panes** picture holds every indicator pane, each clipped to
      its rect. The order is guide band, dashed guides, histograms, band
      fills, then lines.
  - `paneAxes.ts`: each pane gets its own right-axis labels and
    horizontal grid rows.
  - `useLegendLayer`: each pane gets a legend at its top-left. Volume
    overlay rows continue the price legend.
  - Separators are one path.
- **Shared time scale**:
  - There is one time axis, at the bottom of the stack.
  - Vertical grid lines and the crosshair's vertical line span all panes.
  - The crosshair's horizontal line and value label belong to the pane
    under the finger, on that pane's scale and value format. In a pane
    without a valid scale, only the vertical line is drawn.
- **Layout wiring**:
  - `ChartSharedState` gained `stackHeight`, `paneSpec` and `paneLayout`.
  - `resizeCanvas` / `setPaneSpec` → `applyPaneLayout` compute the frame
    and resize the price viewport to the price pane's height. The
    existing candle, price-axis and gesture code therefore works
    unchanged in the top pane.
  - `engine/PaneSync.ts` mirrors the pane list to the UI thread with one
    `scheduleOnUI` per pane change.
- **Separator drag** (`interaction/usePaneResizeGesture.ts`):
  - It is a manual-activation Pan raced against the chart gestures.
  - A touch within `layout.paneSeparatorHitSlop` (12 dp) of a separator
    activates it. Anything else fails immediately, so pan, pinch and the
    crosshair keep working.
  - While dragging, the layout is updated on the UI thread
    (`setPaneSpec`). On release the ratios are committed once to the
    `PaneManager` (`resizePanes`) through `scheduleOnRN`.
  - Disable it with `interaction.paneResizeEnabled: false`.
- **Controller**: `addPane(input?)`, `removePane(id)` (also removes the
  pane's indicators; `false` for the price pane or unknown ids),
  `movePane`, `setPaneHeightRatio`, `resizePanes` and `getPanes`. The
  handle exposes `panes` (PaneManager).
- **Example**:
  - The Playground has a pane selector (`example/src/components/PaneSelector.tsx`).
    Volume cycles off → overlay → pane, and RSI, MACD and ATR can be
    toggled.
  - The selector drives the declarative `indicators` prop, alongside the
    existing overlay toggle.

### Key design decisions

- **The price pane stays "the plot".** Pane layout only changes
  `plotHeight` for the price viewport. Candles, auto-scale, the
  last-price marker and the pan/pinch/crosshair gestures needed no
  per-pane logic; only the time axis and the crosshair were made
  stack-aware.
- **Two pictures for all panes.** The node count is constant however
  many panes or indicators are active: underlay, panes, separators. Each
  pane is `save` / `clipRect` / `restore` inside one picture.
  Histograms batch by color bucket.
- **Guide levels label fixed-scale panes.** A 60–75 dp RSI pane is too
  short for the generic tick step (one tick at 0, clipped at the edge).
  Panes with guides are therefore labelled at their guide levels (30 /
  50 / 70), as TradingView does.
- **Commit on release only.** The drag never touches React state or the
  JS pane list per frame. The UI-thread `paneSpec` is the live value and
  the manager receives one `resize` at the end. The next JS sync pushes
  the same ratios back, so nothing jumps.
- **First visible indicator decides a pane's scale and format.** A pane
  with MACD + ATR uses MACD's zero-centered scale. Palette slots are
  consumed in order of appearance, including hidden indicators, so
  colors don't shift when an indicator is toggled.

### Public API added (main entry)

- **Panes**:
  - `PaneManager`, `PaneInput`, `PaneIndicatorRef`.
  - `DEFAULT_*_PANE_*`, `MIN_PANE_RATIO` / `MAX_PANE_RATIO`.
  - Layout: `computePaneLayout`, `paneIndexAt`, `hitTestSeparator`,
    `dragSeparator`, `PaneLayoutSpec` / `PaneLayoutFrame`.
  - Scale: `computePaneRange` and its padding constants.
  - Render specs: `resolvePaneSpecs`, `PaneRenderSpec`,
    `PaneValueFormat`, `PaneGuideSpec`, `DEFAULT_PANE_FORMAT`.
  - `PANE_RESIZE_TEST_ID`.
- **Indicators**:
  - Modules: `volumeModule`, `rsiModule`, `macdModule`, `atrModule`.
  - Output indices and constants: `VOLUME_*`, `MACD_*`,
    `MACD_HISTOGRAM_COLORS`.
  - Helpers: `rsiFromAverages`, `trueRange`.
  - Scale types: `indicatorScale`, `IndicatorScaleSpec`,
    `IndicatorGuides`, `HistogramColorMode`.
- **Geometry**:
  - `buildHistogramGeometry`, `histogramBucket`, `histogramBucketCount`.
  - `resolveIndicatorDrawSpec`, `HistogramSpec`, `IndicatorDrawSpec`.
  - `formatIndicatorValue`.
- **Config**: `layout.overlayScaleHeightRatio`,
  `layout.paneSeparatorHitSlop`, `interaction.paneResizeEnabled`.
- **Theme**: `pane.guideColor`, `pane.guideDash`, `pane.guideBandColor`.

### Tests

- Every new test file has a perspective table and uses Given / When /
  Then. Failure and boundary cases outnumber happy paths.
- **Golden tests** (`indicators/__tests__/PaneIndicators.test.ts`):
  - Hand-computed RSI, MACD, ATR and Volume values.
  - Naive references over 2000 bars.
  - NaN / ±∞ inputs and warm-up boundaries.
- **Incremental tests** (`IncrementalProperty.test.ts`): random append /
  updateLast sequences must equal a full recalculation for all four
  indicators.
- **Layout and model**:
  - `PaneManager` covers sync, explicit vs automatic panes, move, resize
    and invalid input.
  - `PaneLayout` covers minimum heights, rounding, zero / negative /
    NaN totals, hit test at slop ±1, and drag clamping.
  - `PaneScale` covers every scale kind, empty or unaligned data and
    degenerate ranges.
  - `LayoutActions` covers the pane layout driving the plot height.
- **Render**:
  - Histogram geometry: every color mode, clamping, zero / non-finite
    values, degenerate scales.
  - Pane render specs.
  - Pane layer (`render/skia/__tests__/paneLayer.test.tsx`): scales,
    clipping, underlay, guides, collapsed panes, unaligned results, pane
    axes, legends, crosshair per pane.
  - `TradingChart` pane layout, including the volume overlay and
    removal.
- **Interaction**: `paneResizeGesture.test.tsx` covers a hit within the
  slop, a miss at slop + 1, multi-touch, no separator, live layout,
  commit on release, the min-height clamp and the disabled flag.
  RNGH's jest utils don't emit touch events, so the callbacks are
  invoked directly.
- **Controller / sync**: `PaneSync.test.ts` covers the pane API, the
  automatic pane lifecycle and the UI sync until unsubscribed.
- **Counts**: 1497 tests in 78 suites (P5: 1309).
  - Coverage: 99.88 % statements, 99.53 % branches.
  - All pure P6 modules (`panes/`, `HistogramGeometry`,
    `PaneRenderSpec`, the pane indicators) are at 100 %.
- **Remaining uncovered branches** are defensive fallbacks:
  - `paints[...] ?? axisText` in legend rows;
  - `stackHeight` 0 before layout in the crosshair;
  - a guide-level count above the tick capacity;
  - auto-tick panes with chart decimals (no built-in uses them);
  - a finite upper band bound with a non-finite lower one.

### Known limitations / follow-ups

- Pane Y ranges are not animated (the price pane's range is). They
  follow the visible slice on every viewport change.
- The legend color of a histogram uses bucket 0 (for example, MACD's
  rising-positive color).
- The volume overlay has no axis labels; its scale is only used to size
  the bars.
- Pane ratios live in the `PaneManager`. They are not persisted (P9 /
  serialization).
- There is no per-pane price-scale interaction (drag to rescale, log
  mode). Panes are always auto-scaled.
- The separator hit area overlaps the top of the lower pane, so a
  crosshair started within 12 dp of a separator resizes instead.
- `src/index.ts` is a pure export barrel and is now about 500 lines,
  above the ~300-line guideline.
- On-device verification of the drag feel and frame times still has to
  be done on hardware.

## P7 — Controller API, realtime, history pagination, settings

### What was built

- **Controller** (`core/ChartController.ts`, `engine/ChartControllerImpl.ts`)
  - The full spec §21 `TradingChartController`. `TradingChartHandle`
    extends it with the engine parts (`store`, `state`, `indicators`,
    `panes`, `history`, `realtimeStatus`, `metrics`).
  - Data: `setData(candles, { viewport: 'reset' | 'keepZoom' })`,
    `appendBar`, `updateLastBar`, `upsertBar` (append / update / patch an
    older bar, kline semantics), `prependBars`.
  - Getters: `getBarCount`, `getBar`, `getLastBar`, `getVisibleRange`.
  - Indicators and panes: `removeIndicator` also removes the pane it
    leaves empty, including explicit panes. `removePane` removes its
    indicators.
  - Settings, realtime status and history methods (below).
  - None of these calls re-render React (TR4 asserts zero commits over
    100 ticks).
- **`candles` prop diffing** (`data/CandleDiff.ts`)
  - `diffCandles` is one binary search for the old first bar, then a
    reference scan of the overlap. The last bar is always compared by
    value.
  - `applyCandleDiff` uses the cheapest store operations: `prepend`,
    `updateLast`, `appendMany` or a tail `splice`. Anything else falls
    back to `setData`.
  - The simple prop path no longer resets the chart per tick.
- **Follow mode** (`viewport/ViewportShift.ts`, `engine/StoreSync.ts`)
  - Appends auto-scroll only when the last bar was on screen and
    `realtime.followRealtime` is on. Otherwise the view holds still.
  - The existing "Jump to latest" pill covers the jump back.
- **Realtime status** (`realtime/RealtimeStatus.ts`)
  - `'live' | 'reconnecting' | 'delayed' | 'offline'`, set by the host
    through the controller or the `realtimeStatus` prop.
- **Incremental indicator instrumentation** (`indicators/IndicatorStats.ts`)
  - `engine.getComputeStats()` counts full vs incremental computations
    per indicator id.
  - Tests prove that 100 ticks, including rollovers, cause zero full
    recalculations, and that a param edit recalculates only that
    indicator.
- **Last-price pulse** (optional, `realtime.lastPricePulse`)
  - One animated circle at the last close, at most one pulse per
    `pulseDurationMs`.
  - It is only mounted when enabled.
- **History pagination** (`history/HistoryLoader.ts`,
  `engine/useHistoryTrigger.ts`, `components/useHistoryPagination.ts`)
  - A UI-thread `useAnimatedReaction` detects the left edge
    (`history.loadMoreThresholdBars`, default 50) and calls
    `scheduleOnRN` into a single-flight loader.
  - `onLoadMore({ before, barCount })` returns bars, a
    `{ candles, hasMore }` result, or nothing.
  - An empty page or `hasMore: false` means "no more history".
  - Failures move to `error`; a retry is allowed after
    `history.retryDelayMs`.
  - Responses arriving after a dataset reset are dropped.
  - A `historyLoadingIndicator` slot is shown while loading.
- **Settings** (`settings/`)
  - The versioned `ChartSettings` (v1) holds indicators (type, pane,
    config, style), panes (order, ratio, minHeight, explicit), theme and
    timeframe.
  - `serializeChartSettings` / `deserializeChartSettings`. Deserializing
    never throws; it drops invalid entries and reports issues with a
    path.
  - `applyChartSettings`, plus the controller's `getSettings` /
    `applySettings`.
  - No storage dependency.
- **Headless indicator UI helpers** (`settings/IndicatorCatalog.ts`):
  `allowedPlacements`, `placementOf`, `createIndicatorInput` (overlay →
  price pane, pane type → automatic pane) and `parseParamValue`.
- **Example app, new "Market" tab**
  - `market/MockMarket.ts`: EXAMPLE ONLY, a seeded 15 ticks/s feed with
    rollovers every ~3 s and periodic reconnects, plus paginated history
    with 300–900 ms latency. The history is finite, so "no more
    history" can be reached.
  - `market/BinanceMarket.ts`: an optional public REST/WS toggle.
  - Symbol and timeframe selectors, status badge, and an Indicators sheet
    (add with a placement choice, edit params, remove).
  - Save / Restore of the settings (serialized in memory), and a live
    counter of full vs incremental indicator computations.

### Key design decisions

- **Prepend keeps pixels by construction.**
  - The X model is right-anchored:
    `x(i) = width - (barCount - 0.5 + rightOffset - i) * spacing`.
  - Prepending `k` bars shifts every index by `k` and grows `barCount`
    by `k`, so the terms cancel and `rightOffset` is left untouched.
  - Only stored indices move: the crosshair index is shifted with
    `shiftIndexForPrepend`.
  - The math is unit-tested for any offset or spacing and for 1…10⁶
    bars (ViewportShift P5, StoreSyncRealtime RS3, TradingChartRealtime
    TR6).
- **Hold-still sign fix.**
  - The P3 note ("add the appended count to `rightOffset`") and SS5
    had the sign wrong. Adding `k` scrolls the content by 2k bars.
  - Holding still requires `rightOffset -= k`. This is now
    `appendOffsetShift` and is pixel-tested (F6).
- **The trigger key** is `resetVersion · 2³² + length` while near the
  start, and `-1` otherwise.
  - It fires on entering the zone, and again after each page while the
    view is still inside it.
  - Panning inside the zone never re-fires.
  - Duplicate or overlapping requests are absorbed by the loader.
- **Loader state lives in JS.** It is exposed through
  `useSyncExternalStore`, so React renders only when `loading` flips.
- **Reset policy.** `setData(…, { viewport })` stores the policy that
  the store's `reset` handler reads.
  - `keepZoom` keeps the bar spacing and scrolls to realtime.
  - A prop-driven reset always uses `reset`.
  - A reset hides the crosshair.
- **`useTradingChartController` never disposes the handle.** Disposing
  would break StrictMode's mount → unmount → mount; the chart
  component releases all of its own subscriptions. `dispose()` is
  available for handles created outside React.
- **Settings restore order:**
  1. drop stale panes;
  2. create explicit panes;
  3. `setIndicators` (unknown types skipped; unchanged indicators keep
     their cache);
  4. apply the pane order and ratios.

### Public API added (main entry)

- Types: `TradingChartController`, `SetDataOptions`,
  `ViewportResetPolicy`, `UpsertBarResult`, `ChartSettingsExtras`,
  `ChartRealtimeConfig`, `ChartHistoryConfig`.
- Config: `realtime { followRealtime = true, lastPricePulse = false,
pulseDurationMs = 700 }` and
  `history { loadMoreThresholdBars = 50, retryDelayMs = 2000 }`.
- Props: `onLoadMore`, `historyLoadingIndicator`, `realtimeStatus`. The
  `candles` prop is now diffed.
- Data: `diffCandles`, `applyCandleDiff`, `appendOffsetShift`,
  `shiftIndexForPrepend`, `barsBeforeView`, `isNearHistoryStart`.
- History: `HistoryLoader` (+ `LoadMoreHandler`, `LoadMoreRequest`,
  `LoadMoreResult`, `HistoryLoadState`).
- Realtime: `RealtimeStatusStore`, `isRealtimeStatus`,
  `REALTIME_STATUSES`.
- Settings: `CHART_SETTINGS_VERSION`, `createChartSettings`,
  `defaultChartSettings`, `serializeChartSettings`,
  `deserializeChartSettings`, `settingsToIndicatorInputs`,
  `applyChartSettings`.
- Catalog: `allowedPlacements`, `placementOf`, `createIndicatorInput`,
  `parseParamValue`.
- Stats and pulse: `IndicatorComputeStats`, `pulseRadius`,
  `pulseOpacity`, and the `PULSE_*` constants.

### Tests

- New suites, each with a perspective table and Given / When / Then:
  CandleDiff, ViewportShift, HistoryLoader, RealtimeStatus,
  IndicatorStats, LastPricePulse, IndicatorCatalog, ChartSettings,
  StoreSyncRealtime, ChartControllerP7 and TradingChartRealtime.
- **Counts**: 1725 tests in 89 suites (P6: 1497).
  - Coverage: 99.9 % statements, 99.53 % branches.
  - Every new pure module is at 100 %.
- **Remaining uncovered branches:**
  - `TradingChart.tsx` line 75: the `config` default.
  - `LastPricePulseNode` line 58: the theme color fallback.

### Manual test — prepend without a jump (device)

1. Open **Market** (Mock). Pinch to a mid zoom and long-press a candle
   so the crosshair is pinned on a recognizable bar.
2. Pan slowly left until the loading spinner appears at the left edge.
3. When the page lands (300–900 ms), the pinned candle and every visible
   candle must not move by even a pixel. The crosshair must stay on the
   same candle, and panning continues seamlessly.
4. Keep panning to the start of the mock history (~6000 bars). Requests
   stop ("no more history") and the rubber band stops at bar 0.
5. While scrolled back, watch the live feed. New bars must not move the
   view. Tap **Jump to latest**; at the right edge the chart follows
   rollovers.
6. Switch symbol and timeframe. The zoom is kept (`keepZoom`), the view
   jumps to realtime, no stale page is merged, and the status badge
   cycles `offline → live`.

### Known limitations / follow-ups

- A fling's decay clamp still uses the left bound from before a
  prepend. A fling that is running when a page lands can stop a few
  bars early. It is harmless: the user can pan again.
- Interior bars mutated in place (same object reference) are not
  detected by the prop diff. Update immutably or use the controller.
- After a pagination error, the edge trigger re-fires only when the
  series changes. `loadMoreHistory()` retries manually.
- Automatic panes do not restore `minHeight` from settings; they use
  the default.
- The Binance source is best effort: there is no backoff beyond a
  2 s reconnect and no rate-limit handling.
- On-device verification of the manual test above is still pending.
- `ChartControllerImpl.ts` is ~317 lines, slightly above the guideline;
  it is mostly one-line delegations.

## P8 — Rendering and large-dataset performance

Measurement methods, before/after numbers, the allocation audit and the
Skia strategy experiments are in [`PERFORMANCE.md`](./PERFORMANCE.md).

### What was built

- **Min/max pyramid** (`data/MinMaxPyramid.ts`)
  - Power-of-two levels of bucket minima / maxima over a pair of columns.
  - `syncPyramid(..., from)` re-syncs only a tail: one leaf plus its
    ancestors on a realtime tick.
  - `pyramidRangeMinMax` is an O(log n) range query.
  - NaN bounds are treated as an empty range.
- **Render cache** (`render/conflation/RenderCache.ts`,
  `ChartSharedState.renderCache`)
  - A UI-thread shared value that is mutated in place and never
    reassigned. It holds:
    - the candle pyramid, synced from `series.revision`;
    - lazily built pyramids per drawn indicator output, synced from the
      indicator set revision;
    - conflation buffers;
    - `frame` scratch (time / price scale, range, metrics, rect), shared
      by the mappers, which run sequentially.
  - `cachedCandleRange` uses the pyramid for ranges of ≥ 2048 bars
    (`PYRAMID_QUERY_MIN_BARS`) and the linear scan below that.
- **Pixel-bucket conflation** (`render/conflation/Conflation.ts`,
  `ValueConflation.ts`, `ConflatedLayers.ts`)
  - `frameGroupSize` chooses a power-of-two group once slots drop below
    `viewport.conflationPx` device px (default 2) or below the wick
    width.
  - Candles merge into OHLC buckets anchored at bar 0.
  - Lines draw as a min/max envelope (`buildEnvelopeLine`, ≤ 2 points per
    bucket). Bands use `upper.max` / `lower.min`. Histograms use the
    largest-magnitude value.
  - Wired into the candle, indicator and pane layers. Histogram metrics
    use the bucket spacing.
  - Auto-scale and pane scales use `cachedAutoScaleTarget` /
    `cachedPaneRange` (pyramid-backed). `paneRangeFromValues` and
    `padPriceRange` were extracted so both paths share the padding
    logic.
- **Sparse time ticks** (`axes/SparseTimeTicks.ts`, `TimeTickRules.ts`)
  - With ≥ 16 bars per label slot, ticks jump between calendar
    boundaries with a binary search.
  - The rules shared with the linear scan moved to `TimeTickRules`.
- **Text audit** (`axes/LabelCache.ts`, `render/skia/axisLabels.ts`,
  `axesResources.ts`)
  - A direct-mapped `(value, format key) → text + width` cache per axis
    kind.
  - Every tick / label buffer, the last-price marker, offset resolvers
    and scale scratch are reused across frames.
  - `layoutTimeAxisLabels` accepts pre-measured widths.
  - The crosshair overlay reuses its frame, scales and resolvers.
- **Layer invalidation**
  - Verified by tests: crosshair moves rebuild no static layer, and pans
    with an unchanged price range reformat no price label.
- **FrameStats** (`performance/FrameStats.ts`)
  - A constant-memory histogram accumulator: avg / p95 / max / dropped
    frames.
  - Worklet-safe, so it can record inside a UI frame callback.
- **Benchmarks**
  - `benchmarks/perf.bench.ts` (added to `yarn bench`): 100k full
    zoom-out before/after, pyramid, sparse ticks, label cache.
  - `benchmarks/skia.bench.ts` (`yarn bench:skia`): CanvasKit comparison
    of dynamic paths vs cached paths vs Picture replay, and of conflated
    vs unconflated 100k frames.
- **Example Benchmark screen**
  - Scenes §28 A–D, the §36 gate and a 100k all-visible scene.
  - Each scene runs on a fresh chart with a scripted pan → pinch →
    crosshair timeline, driven from `useFrameCallback`, plus its realtime
    feed.
  - Reports UI / JS frame avg / p95 / max, dropped frames, bars and the
    Hermes heap.

### Key design decisions

- **Conflation is rendering-only.**
  - The store, indicators and the crosshair still see every bar.
  - The group size depends on zoom only, and buckets are anchored at
    bar 0. Pans therefore never re-bucket, and a `g → 2g` step merges
    bucket pairs, so highs and lows are continuous across the switch.
- **Envelope, not decimation**, for lines: every-n-th sampling drops
  spikes; min/max keeps them.
- **Histograms use max, not sum.** Summing volume would push bars above
  the pane scale, which is computed per bar.
- **No path cache, no candle Picture** (17.2 / 17.3).
  - CanvasKit shows at most a 20–45 µs gain at normal zoom, and only for
    pure translate pans.
  - Auto-scale, edge bars, pinch and ticks all invalidate such a cache.
  - Conflation already bounds geometry by plot width. Details in
    `PERFORMANCE.md` §3.
- **The render cache is a mutable shared value**, not a React ref:
  - it lives on the UI runtime;
  - reading it subscribes a mapper to nothing;
  - in-place mutation keeps allocations out of frames.
- **Helpers used by worklets are defined before their callers.** Worklet
  closures capture at definition time, as Jest's worklet transform
  showed.

### Public API added (main entry)

- Config: `viewport.conflationPx` (default `2`; `0` disables
  conflation).
- Performance: `createFrameStats`, `recordFrameInterval`,
  `summarizeFrameStats`, `resetFrameStats`, `droppedFrames`,
  `DEFAULT_FRAME_TARGET_MS`, `FrameStatsAccumulator`,
  `FrameStatsSummary`.
- Engine state (via `TradingChartHandle.state`): `renderCache`, which is
  internal but visible on the handle.

### Tests

- New suites, each with a perspective table and Given / When / Then:
  - MinMaxPyramid (MP01–11), Conflation (CF01–11), ValueConflation
    (VC/VE), RenderCache (RC01–12), ConflatedLayers (CL01–08);
  - TimeTickRules (TR01–09), SparseTimeTicks (ST01–09, including a
    property test sparse == linear over the whole tick ladder for 3
    zones and a DST switch);
  - LabelCache (LC01–08), axisLabels (AX01–06), FrameStats (FS01–10);
  - layerInvalidation (LI01–04).
- Extended suites: layer hooks (H6–H8 conflation group / off / boundary;
  L6–L7 conflated indicators; PL7 conflated histograms).
- **Counts**: 1862 tests in 100 suites (P7: 1725 in 89).
  - Coverage: 99.91 % statements, 99.54 % branches.
  - Every new P8 module is at 100 %.
- **Remaining uncovered branches** are unchanged from P7, plus earlier
  ones:
  - `TradingChart.tsx` 75, `SkiaChartCanvas.tsx` 84–86 (prop defaults);
  - `paneAxes.ts` 102;
  - `useLegendLayer`, `useFrameProfiler`, `CandleGeometryBatch`,
    `RenderProfiler` defensive fallbacks.

### Known limitations / follow-ups

- **Device benchmark numbers are not recorded yet.** Run the Benchmark
  screen in a release build on iOS and Android, then fill in
  `PERFORMANCE.md` §9.
- A prepend (history page) rebuilds the candle pyramid in full: about
  1 ms per 100k bars.
- Residual per-frame allocations are O(1) small objects: sink closures,
  the returned frame objects, the pane-scale output array, and one
  context object in the indicator and pane layers.
- The label caches do not know about the font. They are recreated with
  the axes resources when the glyph table or separator changes.
- `src/index.ts` and some test suites exceed 300 lines. They are export
  lists and case tables, and splitting them would not help readability.

## P9 — Precision, hardening, API stabilization

The public surface is documented in [`API.md`](./API.md). Breaking changes
and migration notes are in [`CHANGELOG.md`](../CHANGELOG.md).

### What was built

- **Symbol precision** (`axes/SymbolPrecision.ts`)
  - `config.symbol`: `pricePrecision`, `tickSize`, `quantityStep`,
    `volumePrecision`.
  - `resolveSymbolPrecision` turns these into price, tick and volume
    decimals. `NaN` means automatic.
  - `axes.pricePrecision` still works as a deprecated fallback.
  - `createPriceTicks` rounds steps up to a multiple of `tickSize`.
  - `snapToTickSize` removes float noise (`toFixed` at the step's own
    decimals).
  - Legend volumes use `volumeDecimals` when unscaled. Compact K/M/B
    volumes keep 2 decimals.
- **Formatter hooks** (`axes/Formatters.ts`)
  - `priceFormatter(price, decimals)` and
    `timeFormatter(localTime, weight, barMs)` are worklets, called from
    the axes, overlay and legend layers.
  - `safePriceLabel` / `safeTimeLabel` fall back to the built-in format
    when a formatter throws or returns a non-string.
  - The label caches key on the formatter, so a formatter change
    invalidates them.
  - Formatters are props, not config, because config is compared with
    `JSON.stringify`, which drops functions.
- **IANA time zones** (`axes/ZoneTable.ts`, `TimeZone.ts`)
  - `intlOffsetProbe` reads zone offsets through
    `Intl.DateTimeFormat#formatToParts` on the JS thread.
  - `buildZoneTable` samples every 14 days from 1990 to now + 400 d, and
    bisects each change to the minute.
  - The result is two `Float64Array`s, cached per zone.
  - `OffsetResolver` holds the table and looks it up by binary search on
    the UI thread. Its validity window runs to the next transition, so a
    pan usually hits the cache.
  - `createOffsetResolver` now runs on the JS thread (it builds the
    table). Callers already created resolvers in `useMemo`.
  - A zone that can't be resolved falls back to UTC, and
    `useChartTelemetry` reports it (`config`).
- **Zone-aware buckets** (`data/BucketAligner.ts`)
  - Aligns d/w/M buckets to a zone's midnight, using the offset at the
    bucket start.
  - On DST days the offset at the trade time differs from the offset at
    midnight. The aligner re-aligns with the midnight offset.
  - `nextBucket` steps one interval plus 12 h, then re-aligns.
  - Used by `RealtimeBarAggregator({ timeZone })`.
  - `axes.dailyBarsTimeZone: 'chart'` makes day labels read dates in the
    chart zone, so labels and buckets match.
- **Session gaps**
  - The X axis stays index-based, so closed sessions collapse.
  - `SessionGaps.test.ts` pins the behavior:
    - equities, 30 m bars, Mon–Fri 14:30–20:30Z;
    - no fabricated weekend bars;
    - the weekend gap takes one slot;
    - the Monday tick is labelled as a day boundary;
    - 24/7 data for contrast.
- **Sanitizing** (`utils/Sanitize.ts`, `core/ConfigSanitize.ts`)
  - Allocation-free worklet guards: `isFiniteNumber`, `finiteOr`,
    `clampCoordinate` (±1e6), `clampFinite`, `sanitizeLength`,
    `sanitizeRect`.
  - Used by the candle, line and header geometry.
  - `resolveChartConfig` sanitizes the merged config:
    - positive and unit-interval fields;
    - enums;
    - nullable fields;
    - the time-zone type;
    - non-object sections;
    - min > max spacing resets both limits;
    - `initialBarSpacing` is clamped to [min, max].
- **Errors** (`core/ChartErrors.ts`, `engine/ChartErrorChannel.ts`,
  `components/ChartErrorBoundary.tsx`)
  - `ChartErrorEvent` sources: `render`, `data`, `indicator`, `history`,
    `config`, `telemetry`.
  - The channel fans out non-fatal issues through
    `controller.subscribeErrors`:
    - rows dropped by `setData` and the `candles` diff;
    - bars rejected by `upsertBar`;
    - indicator failures, via the new `IndicatorEngine` `onError`
      option, so the store mutator no longer rethrows;
    - history errors.
  - `TradingChart` is now an outer wrapper: `ChartErrorBoundary` (with
    `resetKey = controller`) around `TradingChartInner`.
  - Handlers are guarded by `reportChartError`.
- **Performance telemetry** (`performance/PerformanceSampler.ts`,
  `render/skia/useFrameProfiler.ts`)
  - While `onPerformanceSample` is set, the UI frame callback batches
    `[timestamp, buildMs]` pairs and posts them every 30 frames through
    `scheduleOnRN`.
  - `PerformanceSampler` aggregates them into one
    `ChartPerformanceSample` per `telemetry.performanceSampleMs`
    (≥ 1000 ms).
  - A backwards clock restarts the window.
- **Controller split**
  - `engine/ChartDataFeed.ts` is the data half: `setData`, the diff,
    realtime and history.
  - `engine/createTradingChartController.ts` holds the factory and the
    hook, so `ChartControllerImpl` stays under 300 lines.
- **API stabilization**
  - `src/index.ts` was curated from about 450 exports down to the
    documented surface. `index.test.ts` pins the exact runtime list and
    asserts that internals stay hidden.
  - Test IDs and `BENCHMARK_SCENARIOS` moved to `/testing`.
  - Every public export has TSDoc.
  - New docs: `docs/API.md` and `CHANGELOG.md` (with the semver policy),
    a README rewrite, and a manual device-profiling section in
    `PERFORMANCE.md` §10.
- **Package**
  - `"sideEffects": false`.
  - `yarn prepare` (bob: ESM + d.ts) is green.
  - `npm pack --dry-run` contains 775 files, 514 kB: only `lib/`, `src/`,
    LICENSE, README and package.json.
  - The exports map resolves `.`, `./testing` and `./package.json` under
    both the default and the `react-native-fast-chart-source`
    conditions. Deep imports fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- **Example**
  - The Market screen shows per-symbol tick sizes and a local / UTC /
    New York / +05:30 zone cycle.
  - It uses a worklet `groupedPrice` formatter.
  - It shows the `onError` note, an `onPerformanceSample` line and a
    retryable `errorFallback`.
  - `app.json` enables ProMotion.

### Tests

- New suites:
  - SymbolPrecision, Formatters, ZoneTable, SessionGaps;
  - BucketAligner (New York DST), ConfigSanitize, ChartErrors, Sanitize;
  - ChartErrorChannel, PerformanceSampler;
  - ChartErrorBoundary, TradingChartTelemetry;
  - MemoryRelease (ML1–6). Subscriptions on the store, indicators,
    panes, history and errors return to baseline after:
    - mount / unmount cycles;
    - 10 symbol and timeframe switches (only the new data is kept);
    - 20 add / remove indicator cycles;
    - `dispose`;
    - an unmount after a render error;
  - `axesLayerP9` / `overlayLayerP9` (formatters, precision,
    `dailyBarsTimeZone`).
- Extended suites: TimeZone (IANA), PriceTicks (tickSize), PriceFormat
  (volume precision), IndicatorEngineLifecycle (`onError`), TradingChart
  (TC17 now asserts the fallback), index (E1–E6).
- **Counts**: 2177 tests in 115 suites (P8: 1862 in 100).
  - Coverage: 99.91 % statements, 99.58 % branches, 99.55 % functions,
    99.91 % lines.
  - Every new P9 module is at 100 %.
- **Remaining uncovered branches** all predate P9:
  - the `__DEV__` render counter in `TradingChart.tsx`;
  - `SkiaChartCanvas` prop defaults;
  - `paneAxes.ts` 102;
  - the defensive fallbacks in `useLegendLayer`, `useFrameProfiler`,
    `CandleGeometryBatch` and `RenderProfiler`.

### Known limitations / follow-ups

- **Zone table range.** It covers 1990 to now + 400 days. Later instants
  reuse the last offset, and older ones reuse the first. Apps running
  for more than a year should call `clearZoneTableCache` (internal)
  after the lookahead; a public refresh hook could be added in the
  future.
- **Worklet errors.** Errors thrown inside UI-thread worklets bypass the
  error boundary, because they are not React errors. The renderers rely
  on input guards instead.
- **Formatters are not validated at runtime.** A non-worklet formatter
  silently falls back to the built-in format on device; in Jest it runs
  as a normal function.
- **No device numbers yet.** The P8 benchmark and the §10 profiling
  procedure still need to be run on hardware.
- **README GIFs are placeholders** (`docs/media/*.gif`). Record them from
  the example app.
- `src/index.ts` is 304 lines, which is the curated export list.

## P10 — Advanced indicators

### What was built

- **Ten new built-ins** (`indicators/builtins/`). Each is a
  `createStepIndicator` kernel with TradingView defaults and the formula
  in TSDoc. Updates are incremental: O(1) per tick, except CCI.
  - Overlays:
    - `vwap`: session / week / month anchor in the chart zone, with up to
      three std-dev band pairs;
    - `donchian` and `keltner`: bands;
    - `supertrend`: up / down lines plus fills to the candle body middle;
    - `ichimoku`: five lines plus a bull / bear cloud;
    - `parabolicSar`: dots.
  - Panes:
    - `stochastic` and `stochRsi` (80 / 50 / 20 guides, 20–80 zone);
    - `obv`;
    - `mfi` (80 / 20);
    - `cci` (±100);
    - `adx` (+DI, −DI, ADX).
- **Rolling helpers**:
  - `RollingExtremes`: monotonic-deque highest / lowest with a
    peek / commit split;
  - `RollingWindow`: ring sum, resynced every 256 commits to bound float
    drift.
  - Both follow Pine `na`: a window that contains a non-finite value gives
    NaN.
- **Indicator context** (`IndicatorContext { timeZone }`)
  - `calculate` and `update` take an optional context. The default is
    `DEFAULT_INDICATOR_CONTEXT` (UTC).
  - The controller passes `axes.timeZone` at creation and on `configure`.
  - `IndicatorEngine.setContext` recomputes only modules with
    `meta.usesContext` (VWAP).
- **Choice params.** `ChoiceParam` (`kind: 'choice'`) with
  `resolveChoiceParam`. `parseParamValue` and the example editor handle
  choice params like `source`.
- **Shifted outputs.** `IndicatorModule.outputOffsets(config)` becomes
  `IndicatorEntry.offsets` and `UiOutputRef.offset`.
  - Ichimoku's lagging span is drawn at −(displacement − 1) and its
    leading spans at +(displacement − 1), as TradingView plots them.
  - Drawing uses a shifted time scale (`rightOffset − offset`).
  - Auto-scale reads the values under the unclamped view edges
    (`getViewIndexRange`), so the future cloud counts.
  - The legend reads `output[index − offset]`.
- **New render primitives:**
  - cloud (`CloudGeometry.buildCloudFill`): a band with `downColor` is
    drawn in two passes, sign +1 with the up paint and −1 with the down
    paint. Each pass fills only the segments where that side is on top,
    with crossings split at the exact intersection;
  - dots (`buildPointGeometry`): a series of kind `points` adds one
    `addCircle` per finite value to a single path, filled with one paint.
    The radius is `max(1.5, lineWidth)`;
  - Supertrend fills are bands with `edges: false` between the body middle
    and the active line, so the NaN side breaks the fill at trend flips.
- **Conflated views.** Clouds use the per-bucket last value of each edge.
  Dots use the bucket's last value.
- **Example app.** The indicator sheet lists every registry type, grouped
  into "Add overlay" and "Add pane". Choice params render as toggles.
- **Docs.** The README has a built-in indicator table. API.md §7 and the
  CHANGELOG are updated.

### Design decisions

- **Time zone as context, not config.** VWAP needs the chart zone to find
  session starts. Putting the zone in each indicator's config would leak
  it into persisted settings, and a zone change would rewrite every
  definition. The context is engine state instead. Only `usesContext`
  modules recompute when it changes.
- **VWAP shifted sums.** Σ(x − s)·v and Σ(x − s)²·v, with `s` set to the
  first price of the period, avoid the cancellation of `Σx²v/Σv − vwap²`
  at large prices (W8: 1e9 ± 1 stays exact).
- **Offsets are a display concern.** The kernels write unshifted values,
  so incremental updates and the property tests are unchanged. Only the
  time scale, the auto-scale window and the legend index are shifted.
- **Pine fidelity checked by reference ports.** `advancedRefs.ts` holds
  naive O(n·p) references, written straight from the Pine definitions:
  literal ports of `ta.sar` and `supertrend()`, and DMI with `fixnan`.
  Golden tests compare the kernels against them on random data.

### Public API added

- `DEFAULT_INDICATOR_CONTEXT`, `resolveChoiceParam`; the types
  `IndicatorContext` and `ChoiceParam`.
- `IndicatorMeta.usesContext`; `IndicatorModule.outputOffsets`.
- The series descriptor kind `points`, and `downColor` / `edges` on
  `band`.
- The built-in types `vwap`, `donchian`, `keltner`, `supertrend`,
  `ichimoku`, `parabolicSar`, `stochastic`, `stochRsi`, `obv`, `mfi`,
  `cci` and `adx`.

### Tests

- New suites:
  - Oscillators, OverlayIndicators, Vwap, RollingHelpers,
    IndicatorContext;
  - CloudGeometry, OverlayRenderSpecP10, `indicatorLayerP10` (future
    cloud, lagging span, PSAR dots, conflation).
- Extended suites:
  - IncrementalProperty: every P10 type, in the New York zone, on
    3-hour bars with randomized OHLC. Incremental updates equal a full
    recalculation;
  - UiIndicatorSet, RenderCache (RC13, shifted refs),
    IndicatorLegendRenderer, ChartControllerImpl (CC16, the zone reaches
    the engine), IndicatorRegistry and index.
- **Counts**: 2399 tests in 123 suites (P9: 2177 in 115).
  - Coverage: 99.92 % statements, 99.62 % branches, 99.6 % functions,
    99.92 % lines.
  - Every new or changed P10 module is at 100 %.
  - The remaining uncovered branches are in files P10 did not touch
    (defensive fallbacks in the Skia layers, `paneAxes`, `AutoScaleTarget`,
    `RenderProfiler`, `CandleGeometryBatch`).

### Known limitations / follow-ups

- **CCI is O(period) per tick.** The mean deviation needs the whole
  window again after each mean change. With the default period of 20 this
  is negligible.
- **Stochastic RSI warm-up.** A window that contains a warm-up (NaN)
  RSI has no value, so the first %K is at bar
  `rsiPeriod + stochPeriod + kSmoothing − 2`. TradingView may show a few
  earlier values if its highest / lowest skip `na`. Only the warm-up is
  affected; steady-state values match.
- **Supertrend.** The band ratchet is skipped while ATR warms up. This
  matches Pine for positive prices, where Pine compares against a zero
  previous band.
- **MFI with zero money flow.** A window with no negative flow gives 100,
  and one with no positive flow gives 0 (TradingView convention).
- **Conflated clouds** use each bucket's last value, so a crossing inside
  a bucket can be drawn at the bucket edge when fully zoomed out.
- **File size.** `IndicatorEngine.ts` (372 lines, 341 before P10) and
  `render/skia/indicatorDrawing.ts` (313) are above the 300-line
  guideline. Splitting the engine's context and scheduling code out is a
  candidate follow-up.

## P11 — Trading features

### What was built

- **Pure model** (`src/trading/`, no Skia or React imports, spec §33):
  - `TradingTypes`: price line, order, fill, position and annotation
    inputs, and `OverlayDragEvent`;
  - `OverlayValidation`: finite prices, known sides and styles; bad list
    entries are dropped;
  - `DrawingModel` / `DrawingCollection`: five tools (`trendLine`,
    `horizontalLine`, `horizontalRay`, `rectangle`, `fibRetracement`),
    data-space anchors `{ time, price }`, selection, the active tool and
    the tap-tap draft;
  - `TimeAnchor`: time ↔ bar index, with extrapolation by the bar interval
    before the first / after the last bar;
  - `PositionMath`: unrealized PnL and PnL %;
  - `DrawingGeometry`, `MarkerGeometry`, `HitTest`, `DrawingDrag`:
    projection, segment clipping, Fibonacci levels, marker placement,
    distance / handle hit tests, move and anchor-edit math;
  - `SceneCompiler` / `OverlayScene`: compiles every collection into one
    immutable `OverlayScene` (lines, markers sorted by time, vertical
    lines, notes, drawings, position, palette);
  - `TradingOverlayStore`: the JS-thread source of truth (versioned scene,
    drag / drawing listeners).
- **Engine / UI thread:**
  - `TradingState`: `tradingScene`, `tradingUi` (drag override, selection,
    draft) and `tradingHits` (label boxes drawn this frame) shared values;
    `connectTradingToUi` pushes each new scene with `scheduleOnUI`;
  - `TradingActions` (touch-down hit test, drag update / end) and
    `TradingTapActions` (tap-tap creation, selection) — worklets.
- **Rendering:** `useTradingLayer` records one Skia picture per frame:
  - PnL area, drawings, vertical lines, notes;
  - levels with label boxes and axis badges;
  - markers of the visible bars only, one path per palette color.
  - The picture sits right above the axes layer.
- **Gestures:** `useTradingGestures` adds:
  - an overlay drag Pan with manual activation — touch-down hit test,
    otherwise `fail()`, so pan, pinch and crosshair keep working;
  - an overlay Tap.
  - Composition: `Race(overlayDrag, paneResize, Race(crosshair,
    Simultaneous(pan, pinch, drawingMode ? tap : Exclusive(doubleTap,
    tap))))`.
- **Controller:** `ChartTradingMethods` (the base class of
  `ChartController`) implements `TradingOverlayController`. Other wiring:
  - `configure` sets the order quantity decimals and `keepDrawingTool`;
  - `getSettings` / `applySettings` carry drawings;
  - `dispose` releases the listeners.
- **Settings:** `ChartSettings.drawings` (optional, version still 1).
  `readDrawingSettings` validates it item by item, with path-based issues.
- **Config and theme:**
  - `config.trading`: `dragEnabled`, `hitSlop`, `keepDrawingTool`;
  - `theme.trading` (`ChartTradingTheme`), completed by
    `defaultTradingTheme`;
  - `interactionTickSize(precision)` gives the drag / draft snap step.
- **Example:** a "Trading" tab with:
  - mock orders, fills, a position, annotations and a draggable alert;
  - live TP / SL values;
  - a drawing toolbar (tools, delete, save / restore).

### Design decisions

- **Compile on change, draw per frame.** Overlay changes are rare, so the
  JS thread compiles a flat scene, with colors as palette indices and
  `@key` references into `theme.trading`. The UI worklet only walks
  arrays: no React state, no per-item allocations, and one picture node
  whatever the item count.
- **Drag without a JS round trip.** A drag writes `dragKey` / `dragPrice`
  (or `dragAnchors`) into `tradingUi`, which the renderer applies as an
  override. JS hears about it through `scheduleOnRN` only when the snapped
  price changes (`change`), and once on release (`commit`). On commit the
  store writes the price first, so the scene never flashes back to the
  old value.
- **Hit map written by the renderer.** Label boxes depend on text width
  and clamping. The renderer stores each line's `y` and box span in
  `tradingHits` (tagged with the scene version), so hit tests match what
  is on screen.
- **Grab handles, not whole lines.** Lines are grabbed only on the label
  box or the axis badge, so a full-width TP line never blocks panning.
  Drawings are movable only once selected.
- **Data-space anchors.** Drawings, fills and annotations use times, not
  indices, so history prepends do not shift them. Persisted drawings are
  plain JSON.
- **Errors.** List setters drop invalid entries and return the accepted
  count; single-item methods throw (`RangeError` for a non-finite price
  line price, `Error` for an invalid drawing), in line with P9's policy
  for programmer errors. `clearOverlays` keeps the user's drawings.

### Public API added

- **Controller:**
  - price lines: `addPriceLine`, `updatePriceLine`, `removePriceLine`,
    `getPriceLines`;
  - `setOrders` / `getOrders`, `setFills` / `getFills`, `setPosition` /
    `getPosition`, `setAnnotations` / `getAnnotations`;
  - `clearOverlays`, `subscribeOverlayDrag`;
  - drawing tool: `setDrawingTool`, `getDrawingTool`;
  - drawings: `addDrawing`, `updateDrawing`, `removeDrawing`,
    `setDrawings`, `getDrawings`, `selectDrawing`,
    `getSelectedDrawingId`, `subscribeDrawings`.
- **Components, config, settings:** the `onOverlayDrag` prop,
  `config.trading`, `theme.trading` and `ChartSettings.drawings`.
- **Runtime exports:**
  - main entry: `defaultTradingTheme`, `DRAWING_TYPES`,
    `DRAWING_ANCHOR_COUNT`, `FIB_LEVELS`;
  - testing entry: `TRADING_GESTURE_TEST_IDS`.
- **Types:** the input / event types above, `PriceLinePatch`,
  `Drawing*`, `ChartTradingConfig`, `ChartTradingTheme` and
  `TradingOverlayController`.

### Tests

- **Pure layer:** TimeAnchor, PositionMath, DrawingDrag, MarkerGeometry,
  DrawingGeometry, HitTest, DrawingModel, OverlayValidation,
  SceneCompiler, DrawingCollection, TradingOverlayStore, TradingTheme.
- **Engine:** TradingActions, TradingState, ChartControllerTrading.
- **Render:** `tradingLayer` (Skia mock ops).
- **Interaction:** `tradingGestures`. Handlers are called directly with a
  fake state manager, covering:
  - drag activate / fail, snapped `change` and one `commit`;
  - drawing select and move, tap-tap creation;
  - `dragEnabled: false` and the composition.
- **Settings:** DrawingSettings (round trip, issues).
- **Extended suites:** ConfigSanitize (CS16), SymbolPrecision, index,
  TradingChart.
- **Counts:** 2776 tests in 141 suites (P10: 2399 in 123).
  - Coverage: 99.85 % statements, 99.14 % branches, 99.66 % functions,
    99.84 % lines.
  - `src/trading`: 100 % statements / lines, 99.3 % branches.
  - Engine, gesture and settings modules: 100 %.
  - Uncovered branches in the Skia layer (`tradingLevels`,
    `tradingDrawing`, about 85 % branches) are defensive guards:
    non-finite projected coordinates or PnL, a marker time with no bar,
    and anchors that fail to project.

### Known limitations / follow-ups

- **Price pane only.** Overlays are drawn on the price pane with the
  linear price scale, which is the only scale mode today.
- **No undo / redo** and no drawing styles editor UI. Styles are set
  through `updateDrawing`.
- **One hit slop.** `hitSlop` is shared by lines and drawings. Very
  dense order books can make neighbouring labels overlap; the topmost
  line wins.
- **Fill markers** show no quantity text; use annotations of type
  `marker` for custom labels.
- **File size.** `SceneCompiler.ts` (317 lines) and
  `render/skia/tradingDrawing.ts` (302) are slightly above the 300-line
  guideline.
