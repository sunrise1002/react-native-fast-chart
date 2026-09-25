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
│   ├── data/             Candle model, validation/normalization (pure TS)
│   ├── indicators/       indicator contracts & result types (pure TS)
│   ├── panes/            pane definitions (pure TS)
│   ├── theme/            ChartTheme, default dark/light themes, mergeTheme
│   ├── performance/      RenderProfiler, ChartMetrics, BenchmarkScenarios
│   ├── testing/          fixtures (seeded OHLCV generator); public subpath `react-native-fast-chart/testing`
│   └── utils/            small shared helpers (deepMerge)
├── example/              Expo SDK 57 app (workspace `react-native-fast-chart-example`)
├── jest/mocks/           Jest stand-ins for native modules (Skia)
├── docs/                 PHASES.md, IMPLEMENTATION_NOTES.md
└── react-native-skia-trading-chart-spec.md
```

The spec's `src/chart/*` tree is flattened into `src/*`. Directories for later
phases (`viewport/`, `render/`, `interaction/`) are created by those phases.
Tests live next to the code in `__tests__/` folders (`*.test.ts[x]`).

| Command                  | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `yarn`                   | install all workspaces (lockfile committed, Yarn 4.11 vendored) |
| `yarn typecheck`         | `tsc --noEmit` for the library, then for `example/`             |
| `yarn lint` / `lint:fix` | ESLint (`@react-native` config) + Prettier                      |
| `yarn test`              | Jest (`@react-native/jest-preset`)                              |
| `yarn test:coverage`     | Jest + coverage (text summary + lcov in `coverage/`)            |
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
