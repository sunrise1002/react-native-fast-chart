# Performance

How the chart stays at 60 fps and how to measure it (phase P8, spec §17.5,
§23.3, §28, Phases 17–18).

## 1. Measuring

There are three tools. They answer different questions.

| Tool                  | Command / location              | Measures                                                                            | Use it for                                                                  |
| --------------------- | ------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Node micro-benchmarks | `yarn bench`                    | Pure TS hot paths (geometry, ticks, labels, pyramids, conflation, indicators) on V8 | Regressions in the pure modules; before/after of an optimization            |
| CanvasKit benchmarks  | `yarn bench:skia`               | The same geometry drawn with real Skia (CanvasKit WASM, CPU raster)                 | Choosing between Skia strategies (dynamic paths vs cached paths vs Picture) |
| Benchmark screen      | example app → **Benchmark** tab | UI and JS frame intervals on a device                                               | The real target: frame budget, dropped frames, memory                       |

### Node micro-benchmarks (`benchmarks/`)

- `harness.ts`: `bench(name, ops, fn)` runs `fn` 9 times after 3 warm-up
  runs and reports the **median**.
  - Results are consumed into a sink so the JIT cannot drop the work.
  - Each file has sanity `check`s (e.g. "every bar drawn") so a
    benchmark cannot silently measure nothing.
- Files:
  - `data.bench.ts`, `viewport.bench.ts`, `render.bench.ts`,
    `indicators.bench.ts`: the P1–P7 baselines.
  - `perf.bench.ts`: P8 (100k bars fully zoomed out, pyramids, sparse
    ticks, label cache).
- Runs on plain Node with type stripping, not Jest (Jest's sandbox slows
  hot loops down about 8×).
- Numbers are V8 on a laptop. Hermes on a phone is several times slower,
  so read them as **ratios** and regression baselines.
- Run-to-run noise is about ±10%.

### CanvasKit benchmarks (`benchmarks/skia.bench.ts`)

- Uses `canvaskit-wasm` (the Skia build React Native Skia uses on the
  web) to draw into a 1200×900 CPU raster surface.
- There is no GPU, so rasterization dominates the absolute numbers. The
  **differences** between strategies are the signal.

### Benchmark screen (`example/src/screens/BenchmarkScreen.tsx`)

- **Run all** plays these scenes back to back, each on a freshly mounted
  chart:
  - §28 **A–D** (from `BENCHMARK_SCENARIOS`);
  - the §36 gate (10k bars, 200 visible, EMA 20 + 50, 20 updates/s);
  - a **100k** scene (all 100k bars visible, EMA 20 + volume, a pinch of
    7 octaves).
- A scene can also be run on its own.
- Every scene runs the same scripted timeline (`benchmark/scenes.ts`):
  1. 1 s settle, not measured;
  2. 4 s **pan**: a cosine sweep of `rightOffset` into history and back;
  3. 4 s **pinch**: `barSpacing` × 2^octaves and back;
  4. 4 s **crosshair**: a sweep across the visible bars with a moving Y.

  The motion is written to the chart's shared values from a UI-thread
  `useFrameCallback`, so runs are repeatable without touch input.

- The scene's realtime feed (D: 20 updates/s, §36: 20 updates/s) runs for
  the whole scene.
- Reported per scene:
  - **UI** frame intervals, from the same frame callback;
  - **JS** frame intervals, from a `requestAnimationFrame` loop;
  - for both: avg / p95 / max and **dropped frames**;
  - bar count and the Hermes JS heap.
- Statistics come from `FrameStats` (public API):
  - a constant-memory histogram with 0.25 ms buckets;
  - nearest-rank p95;
  - an interval of `k` frame budgets counts as `k − 1` dropped frames.
- Profiling stays off during the runs. Measure a **release** build.
  Debug builds run worklets and JS much slower.

> Device numbers are not recorded in this repository yet. The harness is
> ready, but no device run was part of the P8 session (see §9).

## 2. Results — Node (`yarn bench`, Node v24, per op = one frame)

### 100k bars, fully zoomed out (400 dp plot, pixel ratio 3)

| Work per frame                                |                 Before P8 |                   After P8 | Speed-up |
| --------------------------------------------- | ------------------------: | -------------------------: | -------: |
| Candle frame (range + geometry)               |   5 293 µs (100 000 bars) |    16.5 µs (≤ 600 buckets) |    ~320× |
| EMA line frame                                | 1 753 µs (100 000 points) | 11.9 µs (min/max envelope) |    ~150× |
| Time ticks over the visible bars              |      841 µs (linear scan) |            2.7 µs (sparse) |    ~310× |
| Visible price range (auto-scale, pane scales) |           101 µs (linear) |     1.7 µs (pyramid query) |     ~60× |

### Other P8 paths

| Benchmark                                             |  Before |                    After |
| ----------------------------------------------------- | ------: | -----------------------: |
| Price labels of a panning frame (format + measure)    | 0.98 µs | 0.21 µs (LabelCache hit) |
| Pyramid build, 100k bars (one-off, on data reset)     |       — |                  0.95 ms |
| Pyramid re-sync of the last bar (every realtime tick) |       — |                  0.48 µs |

### Baselines, unchanged paths (normal zoom)

| Benchmark                                 | Baseline (µs/op) | After P8 (µs/op) |
| ----------------------------------------- | ---------------: | ---------------: |
| Candle frame, 52 bars (8 dp)              |             2.09 |             2.17 |
| Candle frame, 802 bars (0.5 dp)           |             15.8 |             16.2 |
| Axes frame, 8 dp                          |             2.94 |             3.05 |
| Viewport frame, 540 bars                  |             0.68 |             0.75 |
| Sparse-table query                        |            0.023 |            0.024 |
| §36 tick (store + EMA 20/50 + pack/apply) |             0.91 |             0.89 |

At normal zoom P8 changes nothing measurable; the differences are within
the noise. Conflation only kicks in below 2 device px per bar. The
`render.bench.ts` axes frame calls the pure functions directly, so it
does not include the label cache.

## 3. Results — Skia strategies (`yarn bench:skia`)

Per frame, CanvasKit CPU raster at 1200×900:

| Strategy                                                    | 52 bars (8 dp) | 802 bars (0.5 dp) |
| ----------------------------------------------------------- | -------------: | ----------------: |
| Rebuild the 4 candle paths from data every frame (**kept**) |     210–280 µs |        460–530 µs |
| Build once, pan by `translate` + `drawPath`                 |     165–255 µs |        230–330 µs |
| Record a Picture once, replay translated                    |     167–255 µs |        235–333 µs |

**Zoomed-out 100k:** drawing every bar costs 45 400 µs per frame; the
conflated frame costs 380–425 µs (about 110× faster).

### Decision: no path cache (17.2), no candle Picture (17.3)

- The cached strategies only apply to a **pure horizontal pan with a
  fixed price range**. On this chart:
  - auto-scale re-fits the price range while panning;
  - bars enter at the edges;
  - pinch changes widths;
  - realtime ticks change the last bar.

  Every one of these invalidates the cache.

- A cache would also need an off-screen margin of bars. That means more
  rasterized geometry per frame and more memory.
- The possible saving is 20–45 µs at normal zoom and about 200 µs at
  0.5 dp, in WASM. The frame budget is 16 700 µs.
- At the widths where the cost grows (< 2 device px per bar),
  **conflation** already caps the geometry at about 2 rects per 2 px.
  That is the real cost bound.
- Cached paths and Pictures are equally fast: replaying a Picture is no
  better than drawing the same paths again.
- **Kept:** pictures where a layer is mostly text and is rebuilt only
  when its inputs change (axes, legend, indicators, crosshair). These
  were already Pictures before P8.

## 4. Allocation audit (17.1)

"Per frame" means per run of a UI mapper (`useDerivedValue`), i.e. per
frame while its inputs change.

| Layer                            | Before P8 (allocated every frame)                                                                                                                                                                                                                          | After P8                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Candles (`useCandlePaths`)       | time/price scale objects, visible range, candle metrics, rect                                                                                                                                                                                              | none: scratch in `renderCache.frame`. The only allocation is the returned frame object                                                                                                                   |
| Indicators (`useIndicatorLayer`) | time/price scale objects, visible range                                                                                                                                                                                                                    | shared scratch; one small context object per frame                                                                                                                                                       |
| Pane layer (`usePaneLayer`)      | scales, metrics, range                                                                                                                                                                                                                                     | scratch; histogram metrics reused                                                                                                                                                                        |
| Pane scales (`usePaneScales`)    | scales, range, per-pane range closure                                                                                                                                                                                                                      | scratch; the output `scales` array (it is the frame value)                                                                                                                                               |
| Auto-scale reaction              | closure extender, time scale                                                                                                                                                                                                                               | scratch; pyramid-backed range                                                                                                                                                                            |
| Axes (`useAxesLayer`)            | price/time tick buffers (a 256-slot `Float64Array` ×3, 64-slot ×1), last-price marker, offset resolver, visible range, rect, stack scale, grid options, a label `string[]` ×2–3, **one `formatPrice` / `formatTimeTick` string + `measureText` per label** | all buffers in `createAxesResources` (reused). Label text/width come from `LabelCache`, so a label is formatted once. What remains: the grid/text sink closures (2 small objects) and the returned frame |
| Pane axes (`paneAxes`)           | label array, a string + measure per label                                                                                                                                                                                                                  | reused label array, `LabelCache`                                                                                                                                                                         |
| Crosshair (`useOverlayLayer`)    | crosshair frame, time/price scale, offset resolver                                                                                                                                                                                                         | reused; the 2 label strings are inherent (the values change with the finger)                                                                                                                             |

Remaining per-frame allocations are O(1) small objects. The returned
frame objects are needed: a new identity is what tells the next mapper
that something changed.

Skia objects (`PathBuilder.detach()` paths and recorded Pictures) are
produced by the frame itself. They are not garbage in the JS sense.

## 5. Text audit (17.4)

- **Tick counts are capped** by the fixed buffers: 64 price ticks and
  256 time ticks. Tick generation also spaces labels by font size.
- **Fonts:** one `SkFont` per chart (`useChartFont`), created on the JS
  thread.
- **Measuring:**
  - glyph advance widths are read once into a table (`TextMetrics`);
  - `measureText` in worklets is arithmetic, never a JSI call;
  - with `LabelCache`, even that runs only on a cache miss.
- **Label cache** (`axes/LabelCache.ts`, helpers in
  `render/skia/axisLabels.ts`):
  - a direct-mapped table (512 slots per axis kind) keyed by
    `(value, format key)`:
    - price: decimals;
    - pane: decimals or compact;
    - time: tick weight × seconds.
  - It stores the text and its width. A collision overwrites the slot,
    so memory is bounded.
  - Caches are per axes layer and are recreated when the glyph table or
    the separator changes.
  - A pan with an unchanged price range formats **no** price labels
    (test LI02). Panning back formats no time labels (LI03).

## 6. Layer invalidation (17.5)

Each layer is a mapper that captures only the shared values it reads:

| Layer                    | Rebuilt by                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Candles                  | series, bar spacing, right offset, plot size, price range                                          |
| Indicators               | the above + indicator set                                                                          |
| Pane scales / pane layer | series, indicators, bar spacing, right offset, plot width, pane layout                             |
| Axes + grid              | series, bar spacing, right offset, plot size, price range, stack height, bar interval, pane scales |
| Crosshair                | crosshair index / Y / opacity (+ viewport while visible)                                           |
| Legend                   | crosshair index / opacity, indicators                                                              |

- Moving the crosshair re-runs **only** the crosshair and legend layers.
  Test LI01 asserts that the candle, axes, indicator and pane-scale
  frames keep their identity.
- `renderCache` is a shared value that is mutated in place and never
  reassigned, so reading it does not subscribe a mapper to anything.

## 7. Extreme zoom-out (Phase 18)

- **Overdraw detection**
  - `frameGroupSize(barSpacing, conflationPx, wickWidth, pixelRatio)`
    returns the number of bars per bucket.
  - It is 1 until a bar slot is narrower than `viewport.conflationPx`
    device px (default 2) or narrower than the wick. After that, it is
    the smallest power of two that makes a bucket wide enough.
- **Pixel-bucket conflation** (rendering only; the store is untouched)
  - Buckets are anchored at bar 0 (`floor(index / g)`), so a pan never
    re-buckets bars.
  - A bucket is drawn as one candle:
    - open = first open, close = last close;
    - high / low = bucket extremes from the **min/max pyramid** (O(1)
      per bucket).
  - Buckets use a derived time scale (`barSpacing·g`, centered on the
    group), so the regular geometry builders draw them unchanged.
- **Indicator downsampling**
  - Lines draw a **min/max envelope**: up to 2 points per bucket, in time
    order. Spikes are never lost, unlike every-n-th sampling.
  - Bands fill between `upper.max` and `lower.min`.
  - Histograms (volume, MACD) draw the bucket's largest-magnitude value.
    Volume uses max, not sum, so bar heights stay comparable with the
    pane scale.
  - The value pyramid of each drawn output is built lazily. It is kept in
    sync incrementally: an indicator revision re-syncs only the patched
    tail (≤ `MAX_INDICATOR_PATCH_BARS`, 512 bars) and its ancestors.
- **Visible range scales**
  - Auto-scale and pane scales query the pyramid (O(log n)) when the
    range spans ≥ 2048 bars. Below that, the linear scan is faster.
- **Sparse time ticks**
  - With ≥ 16 bars per label slot, time ticks jump between calendar
    boundaries with a binary search: O(ticks · log n) instead of O(n).
  - Equal to the linear scan for every fixed zone (a property test in
    `SparseTimeTicks.test.ts`).
- **Smooth mode transition**
  - The group size depends only on zoom and is a power of two.
  - Stepping from `g` to `2g` merges exactly two neighbouring buckets, so
    the envelope (highs/lows) is identical across the switch. Only the
    open/close ticks move.
  - The switch happens at ≤ 2 px per slot, where one bar is at most one
    device pixel wide. This makes the transition visually continuous.
  - Anchoring at bar 0 means panning never shimmers.

## 8. 100k dataset and memory

- The 100k scene zooms out to all 100k bars (`minBarSpacing` ≈ 0.002
  dp).
- The frame cost is bounded by the plot width, not the bar count (§2).
- Memory for 100k bars, measured on the Node build of the same code:

| Buffer                                        |                   Size | Notes                                                                                                     |
| --------------------------------------------- | ---------------------: | --------------------------------------------------------------------------------------------------------- |
| `CandleStore` columns (JS thread)             |                 6.3 MB | 6 × `Float64Array` + growth headroom                                                                      |
| `UiCandleSeries` (UI thread copy)             |                 4.6 MB | 6 columns + realtime headroom                                                                             |
| Candle min/max pyramid (UI)                   |                 2.0 MB | 2 × `Float64Array(capacity)`, capacity = next power of two ≥ bars → ≈ 16 B × capacity, ≈ 21 B/bar at 100k |
| Pyramid per drawn indicator output (UI, lazy) |          ≤ 2.0 MB each | only outputs drawn while their range needs it                                                             |
| Conflation buffers                            |                 ~50 KB | grow to the bucket count (≈ plot px / 2)                                                                  |
| Label caches                                  | ~40 KB + label strings | 3 × 512 slots                                                                                             |

- Pyramids are rebuilt on data resets (0.95 ms for 100k bars). Prepends
  cause a full rebuild; appends and ticks re-sync only the tail.

## 9. Known limitations

- **No device numbers yet.** The Benchmark screen produces them. Run it
  on a mid-range Android phone and an iPhone in a release build, and
  record the results here.
- The UI frame intervals come from `useFrameCallback`. They measure
  when the UI thread got to run, not GPU completion.
- The JS heap figure only works on Hermes, and it excludes native
  `ArrayBuffer` storage. Use platform tools (Xcode Instruments / Android
  Studio profiler) for total memory.
- The conflation constants (2 px slot, power-of-two groups) are tuned
  for readability. `viewport.conflationPx: 0` disables conflation.
- The CanvasKit numbers are WASM + CPU raster. The Skia GPU backend on
  devices changes the absolute costs, but not the conclusion that
  geometry size, not cache strategy, dominates.

## 10. Manual profiling on devices

Use this procedure before a release and after any change to the render
path. Always measure a **release** build on a physical device. Simulators
and emulators don't have a representative GPU or refresh rate.

### Common steps

1. Build a release build of the example app:
   - iOS: `npx expo run:ios --configuration Release --device`;
   - Android: `npx expo run:android --variant release`.
2. Open **Benchmark → Run all** and note the per-scene UI/JS avg, p95,
   max and dropped frames (§1). Repeat 3 times, keep the median, and run
   with the device plugged in with a stable battery / thermal state.
3. For a realistic session, open **Market** (mock feed). Pan, pinch and
   use the crosshair for 30 s with EMA + volume enabled. The
   `onPerformanceSample` line on that screen reports fps and layer-build
   time every 5 s. Production apps can collect the same numbers through
   the prop.
4. Check memory:
   - load 100k bars (Playground → 100k);
   - pan for 60 s;
   - switch symbols 10 times on Market.
     The native and JS heap must return to a plateau. After a symbol switch,
     the old dataset must be freed (P9 memory-release tests cover the JS
     side).

### iOS (Instruments)

- Use Xcode → Open Developer Tool → Instruments:
  - **Animation Hitches** for hitch ratio and frame lifetimes;
  - **Time Profiler** for the UI thread (Skia / worklets);
  - the `com.facebook.react.JavaScript` thread (Hermes);
  - **Allocations** for memory growth.
- Target: hitch ratio < 5 ms/s during pan / pinch.

### Android

- **Profile HWUI rendering** (Developer options → _Profile HWUI
  rendering_ → _On screen as bars_) gives a quick visual. Skia's surface
  draws on the UI thread, so bars above the green line are over budget.
- For precise frame timing and thread activity (`mqt_js`, the UI thread,
  `RenderThread`), use Android Studio → **Profiler → CPU → System Trace**,
  or `adb shell perfetto` with the `gfx`, `view` and `sched` categories.
- `adb shell dumpsys gfxinfo <package> framestats` gives janky-frame
  percentiles for a scripted run.
- Test on a mid-range device (for example, a Snapdragon 6-series phone),
  not only on flagships.

### 120 Hz (ProMotion and high-refresh Android)

- **iOS.** ProMotion needs
  `CADisableMinimumFrameDurationOnPhone = true` in `Info.plist` (the
  example sets it through `app.json`). Without it, iOS caps third-party
  apps at 60 Hz. Check the effective rate on the Benchmark screen: UI
  avg ≈ 8.3 ms at 120 Hz. `FrameStats` uses the measured interval, so
  dropped frames are counted against the real budget.
- **Android.** Pick the high refresh rate in display settings. Some
  devices lower the rate for apps that don't request it, so confirm the
  UI avg interval rather than trusting the setting.
- ProMotion lowers the refresh rate when content is idle. Measure only
  during interaction (the scripted timelines keep the display busy).
  Idle frames are expected to be skipped.
- Budget at 120 Hz: layer build (`build.avgMs` in the performance sample)
  should stay under about 3 ms, leaving headroom for Skia raster and
  compositing within 8.3 ms.

### Recording results

Add a row per device to §2 with the device, OS, refresh rate, build
(commit) and the Benchmark numbers. Record regressions above 10 % p95 in
the PR description.
