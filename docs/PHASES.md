# Implementation Phases

Source of truth: `react-native-skia-trading-chart-spec.md` (referred to as "the spec").
Each phase is implemented by one agent on its own branch/worktree, then merged into `main`.

| # | Phase | Spec sections | Status |
|---|-------|---------------|--------|
| P1 | Library foundation: package scaffold (builder-bob), TS strict, Jest, ESLint/Prettier, example app, module skeleton, Candle model + validation, perf instrumentation, themes | §5, §7, §8.1, §24, Phase 0 | done |
| P2 | Data + viewport engine (pure TS): CandleStore, history merge, RealtimeBarAggregator, TimeScale/X coords, visible range, pan/zoom math, PriceScale, AutoScale | §8–11, Phase 1–2 | pending |
| P3 | Skia rendering + gestures: candle geometry, batched paths, SkiaChartCanvas, grid, pan/pinch (Reanimated + RNGH), scroll-to-realtime, public `<CandlestickChart>` component | §16–18, §22, Phase 3–4 | pending |
| P4 | Axes + crosshair: price/time tick generators & axis renderers, last price marker, long-press crosshair, nearest candle, axis labels, OHLC header | §19, Phase 5–6 | pending |
| P5 | Indicator framework + overlays: interface, registry, result types, cache, scheduler, SMA/EMA/WMA/Bollinger, line & band renderers, benchmark gate (§36) | §13–15, Phase 7–8, §36 | pending |
| P6 | Pane system + pane indicators: pane model/layout, shared time scale, independent Y scales, add/remove, Volume, RSI, MACD, ATR, histogram renderer | §12, Phase 9–13 | pending |
| P7 | Config API + realtime + pagination: indicator config model, ChartController, realtime incremental updates, follow-realtime, history pagination w/o viewport jump, symbol/timeframe switching | §20–21, §23.2, Phase 14–16 | pending |
| P8 | Performance: allocation audit, path/picture cache, text audit, layer invalidation, pixel-bucket conflation, indicator downsampling, benchmark scenes A–D, 100k dataset | §17.5, §23.3, §28, Phase 17–18 | pending |
| P9 | Precision, hardening, API stabilization: price precision/tick size, timezone, session gaps, invalid numeric guards, error boundaries, telemetry hooks, public types, README/docs | §25–26, Phase 19–21 | pending |
| P10 | Advanced indicators: VWAP, Stoch RSI, Stochastic, OBV, MFI, CCI, ADX, Ichimoku, Donchian, Keltner, Supertrend | §2.3, Phase 23 | pending |
| P11 | Trading features: order markers, position overlay, TP/SL lines, annotations, basic drawing engine (trend line, horizontal line) | Phase 22 | pending |

## Global rules for every phase

- All code, comments, docs, commit messages in English.
- Follow §33 "Architectural Rules That Must Not Be Violated".
- Keep `yarn typecheck`, `yarn lint`, `yarn test` green before committing.
- Append a short implementation note for the phase to `docs/IMPLEMENTATION_NOTES.md`.
