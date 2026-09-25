# React Native Skia Trading Chart Engine
## Technical Specification & Implementation Plan

**Status:** Draft v1  
**Target stack:** React Native + TypeScript + React Native Skia + Reanimated + Gesture Handler  
**Primary goal:** Build a high-performance, production-grade candlestick chart engine for a trading application, with modular technical indicators, multiple panes, realtime updates, smooth pan/zoom, and an architecture that can evolve toward advanced trading-terminal features.

---

# 1. Executive Summary

This project will build a custom financial chart engine for React Native using **React Native Skia** as the rendering layer.

The main architectural principles are:

1. **Rendering is not business logic**
   - Market data, indicators, viewport calculation, scales, and rendering must be separated.
   - Rendering should consume a prepared `RenderModel` instead of raw market data.

2. **Keep interaction off the React render loop**
   - Pan, pinch zoom, crosshair movement, and cursor tracking should use Reanimated shared values and Skia-compatible values.
   - React state should not update every frame.

3. **Render only what is visible**
   - The engine must calculate visible candle ranges and avoid drawing the full dataset.

4. **Batch drawing operations**
   - Avoid one React/Skia component tree node per candle where possible.
   - Generate Skia paths/pictures/batched primitives for candle bodies, wicks, volume bars, grid lines, and indicator lines.

5. **Indicators are independent modules**
   - EMA, SMA, RSI, MACD, Bollinger Bands, etc. must be implemented as pure calculation modules.
   - The same indicator output should be renderable by different chart backends in the future.

6. **Reference architecture, not code copying**
   - SciTrader / financial chart SDKs may be studied for concepts such as panes, studies, axes, data flow, annotations, and viewport behavior.
   - Existing React Native Skia financial chart projects may be studied for rendering and gesture patterns.
   - Do not copy incompatible or proprietary implementation code.

---

# 2. Product Goals

The chart should eventually support a mobile trading experience comparable in interaction quality to modern crypto/stock trading apps.

## 2.1 Core Product Goals

The engine must support:

- Candlestick rendering
- Realtime OHLC updates
- Historical data loading
- Pan horizontally
- Pinch zoom
- Auto Y-axis scaling
- Manual vertical scaling later
- Crosshair
- Price/time labels
- Volume
- Overlay indicators
- Separate indicator panes
- Multiple active indicators
- Dynamic timeframe switching
- Dynamic symbol switching
- Dark/light themes
- Smooth 60 FPS target
- 120 Hz device compatibility where possible
- Large datasets without rendering all points
- Incremental indicator calculations
- Extensible renderer architecture
- Extensible study/indicator architecture

## 2.2 Initial Indicator Set

### Overlay indicators

- SMA
- EMA
- WMA
- Bollinger Bands

### Separate-pane indicators

- Volume
- RSI
- MACD
- ATR

## 2.3 Later Indicators

- VWAP
- Stochastic RSI
- Stochastic Oscillator
- OBV
- MFI
- CCI
- ADX
- Ichimoku Cloud
- Donchian Channels
- Keltner Channels
- Supertrend

---

# 3. Non-Goals for Initial Versions

The first iterations should NOT attempt to build a full TradingView replacement.

Not initially required:

- 50+ indicators
- Fibonacci tools
- Elliott Wave tools
- Complex chart pattern recognition
- User-defined scripting language
- Pine Script compatibility
- Multi-chart layouts
- Desktop-level keyboard/mouse functionality
- Full order book visualization
- DOM ladder
- Tick chart rendering
- Heikin-Ashi / Renko / Kagi
- Server-side indicator calculations
- Cloud-synchronized chart layouts

These features can be added after the core engine proves stable.

---

# 4. Performance Targets

Performance requirements should be treated as engineering constraints rather than optional optimization work.

## 4.1 Rendering Targets

Target devices:

- Mid-range Android device
- Recent iPhone
- 60 Hz display minimum
- 120 Hz display where available

Target behavior:

- Pan: visually smooth at 60 FPS
- Pinch zoom: visually smooth at 60 FPS
- Crosshair movement: 60 FPS
- Realtime candle updates: no visible chart freeze
- No React rerender on every gesture frame
- No full indicator recalculation on every incoming tick

## 4.2 Data Size Targets

Initial targets:

| Dataset | Expected behavior |
|---|---|
| 500 candles | trivial |
| 2,000 candles | fully smooth |
| 10,000 candles | smooth with visible-range rendering |
| 50,000 candles | usable with virtualization/downsampling |
| 100,000 candles | supported without rendering all points |

The engine should normally draw only approximately:

- 50–500 visible candles
- plus an overscan buffer

## 4.3 Performance Budget

Suggested target budgets:

- Gesture processing: < 4 ms/frame
- Visible-range calculation: < 2 ms/frame
- Render-model preparation: < 4 ms/frame
- Indicator incremental update: < 2 ms per realtime bar update where practical
- React JS thread should remain responsive during chart interaction

---

# 5. Technology Stack

## 5.1 Core

- React Native
- TypeScript
- `@shopify/react-native-skia`
- `react-native-reanimated`
- `react-native-gesture-handler`

## 5.2 Optional Utilities

- Zustand for non-frame-sensitive chart configuration
- D3 scale utilities only if they simplify scale logic without adding runtime overhead
- TypedArray structures for optimized numeric data where useful
- Jest/Vitest for math and indicator tests
- React Native performance profiling tools

## 5.3 Avoid for Core Rendering

Avoid using the following for high-frequency chart drawing:

- React Native `<View>` per candle
- SVG node per candle
- React state for gesture position
- React state for crosshair coordinates
- Full-array mapping on every frame
- Full indicator recalculation on every tick

---

# 6. High-Level Architecture

```text
                    ┌─────────────────────┐
                    │    Market Source    │
                    │ REST / WebSocket    │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     Data Engine     │
                    │ OHLC normalization  │
                    │ realtime updates    │
                    │ history merging     │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
   ┌───────────────────────┐        ┌──────────────────────┐
   │    Indicator Engine   │        │   Viewport Engine    │
   │ EMA / RSI / MACD ...  │        │ visible range       │
   │ incremental updates   │        │ zoom / pan          │
   └──────────┬────────────┘        │ X/Y transforms      │
              │                     └──────────┬───────────┘
              └────────────────┬───────────────┘
                               ▼
                    ┌─────────────────────┐
                    │    Render Model     │
                    │ screen-space data   │
                    │ pane layout         │
                    │ visible studies     │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │    Skia Renderer    │
                    │ candle batches      │
                    │ paths / labels      │
                    │ overlays / panes    │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ Interaction Layer   │
                    │ Gesture Handler     │
                    │ Reanimated values   │
                    │ crosshair           │
                    └─────────────────────┘
```

---

# 7. Project Module Structure

Suggested source structure:

```text
src/
  chart/
    core/
      ChartEngine.ts
      ChartConfig.ts
      ChartState.ts
      ChartTypes.ts

    data/
      Candle.ts
      CandleStore.ts
      CandleBuffer.ts
      MarketDataAdapter.ts
      RealtimeBarAggregator.ts
      HistoryLoader.ts

    viewport/
      ViewportState.ts
      VisibleRange.ts
      TimeScale.ts
      PriceScale.ts
      ScaleMath.ts
      AutoScale.ts

    indicators/
      Indicator.ts
      IndicatorRegistry.ts
      IndicatorEngine.ts
      utils/
      overlay/
        SMA.ts
        EMA.ts
        WMA.ts
        BollingerBands.ts
      pane/
        RSI.ts
        MACD.ts
        ATR.ts
        Volume.ts

    panes/
      Pane.ts
      PaneManager.ts
      PaneLayout.ts
      PricePane.ts
      IndicatorPane.ts

    render/
      RenderModel.ts
      RenderModelBuilder.ts

      candles/
        CandleRenderer.ts
        CandleGeometry.ts

      indicators/
        LineRenderer.ts
        HistogramRenderer.ts
        BandRenderer.ts

      axes/
        PriceAxisRenderer.ts
        TimeAxisRenderer.ts
        GridRenderer.ts

      overlays/
        CrosshairRenderer.ts
        LastPriceRenderer.ts
        OHLCHeaderRenderer.ts

      skia/
        SkiaChartCanvas.tsx
        SkiaPaths.ts
        SkiaPictureCache.ts

    interaction/
      GestureController.ts
      CrosshairController.ts
      PanController.ts
      ZoomController.ts

    theme/
      ChartTheme.ts
      defaultDarkTheme.ts
      defaultLightTheme.ts

    performance/
      ChartMetrics.ts
      RenderProfiler.ts
      BenchmarkScenarios.ts

    testing/
      fixtures/
      helpers/
```

---

# 8. Core Data Model

## 8.1 Candle

```ts
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
```

Prefer timestamps as numeric Unix milliseconds or seconds, but choose one representation and use it consistently throughout the engine.

## 8.2 CandleStore Responsibilities

The candle store must support:

- sorted candles
- binary search by timestamp
- append candle
- update last candle
- prepend historical data
- replace symbol dataset
- replace timeframe dataset
- deduplicate bars
- range queries
- nearest-candle lookup

Suggested API:

```ts
interface CandleStore {
  setData(data: Candle[]): void;
  append(candle: Candle): void;
  updateLast(candle: Candle): void;
  prepend(data: Candle[]): void;

  get(index: number): Candle | undefined;
  getRange(start: number, end: number): readonly Candle[];

  findIndexByTime(time: number): number;
  length: number;
}
```

---

# 9. Realtime Market Data Engine

Realtime tick handling should not directly trigger chart rendering logic.

Flow:

```text
WebSocket trade/ticker
        │
        ▼
RealtimeBarAggregator
        │
        ├── update current OHLC candle
        │
        └── create next candle on timeframe boundary
        │
        ▼
CandleStore
        │
        ▼
IndicatorEngine incremental update
        │
        ▼
Render invalidation
```

## 9.1 Required Behaviors

- merge out-of-order updates safely
- detect timeframe rollover
- update current candle without reallocating entire arrays
- minimize object creation
- prevent duplicate candles
- handle reconnect snapshots
- handle history + realtime merge race conditions

---

# 10. Viewport Engine

The viewport engine controls which part of the dataset is visible.

## 10.1 State

```ts
interface ViewportState {
  firstVisibleIndex: number;
  visibleCount: number;
  candleWidth: number;
  spacing: number;
  translateX: number;
}
```

Alternative internal representations are acceptable if they produce equivalent behavior.

## 10.2 Responsibilities

- pan horizontally
- pinch zoom
- calculate visible candle range
- clamp or overscroll boundaries
- preserve zoom focal point
- calculate X coordinate from candle index
- calculate index from X coordinate
- trigger history loading near left edge
- maintain right-side realtime padding

## 10.3 Visible Range

The render system should request:

```ts
getVisibleRange(viewport): {
  startIndex: number;
  endIndex: number;
}
```

Use overscan:

```text
visible range
+ 10–30 candles before
+ 10–30 candles after
```

This prevents visible popping during fast gestures.

---

# 11. Price Scale

Each pane may have an independent Y scale.

## 11.1 Price Pane Auto Scale

For the currently visible candles:

```text
minVisible = min(low)
maxVisible = max(high)
```

Then add padding:

```text
range = maxVisible - minVisible

displayMin = minVisible - range * paddingRatio
displayMax = maxVisible + range * paddingRatio
```

## 11.2 Indicator Scale

Examples:

RSI:

```text
default bounds: 0–100
guide lines: 30 / 50 / 70
```

MACD:

```text
dynamic min/max around zero
```

Volume:

```text
min = 0
max = max visible volume
```

## 11.3 Future Modes

Later add:

- manual price scale
- log scale
- percentage scale
- indexed scale
- fixed-range pane scale

---

# 12. Pane Architecture

The chart must support multiple vertically stacked panes.

Example:

```text
┌────────────────────────────┐
│ Price                      │
│ Candles + EMA + Bollinger  │
│                            │
├────────────────────────────┤
│ Volume                     │
├────────────────────────────┤
│ MACD                       │
├────────────────────────────┤
│ RSI                        │
└────────────────────────────┘
```

## 12.1 Pane Interface

```ts
interface PaneDefinition {
  id: string;
  type: 'price' | 'indicator';
  heightRatio: number;
  minHeight: number;
  indicatorIds: string[];
}
```

## 12.2 Pane Manager Responsibilities

- add pane
- remove pane
- reorder pane
- resize pane
- share common time axis
- separate Y axes
- calculate pane rectangles
- assign indicators to panes

---

# 13. Indicator Engine

Indicators must be independent of React and Skia.

## 13.1 Base Interface

```ts
export interface Indicator<TConfig, TResult> {
  id: string;
  type: string;

  calculate(
    candles: readonly Candle[],
    config: TConfig
  ): TResult;

  update?(
    previous: TResult,
    candles: readonly Candle[],
    changedIndex: number,
    config: TConfig
  ): TResult;
}
```

## 13.2 Indicator Definition

```ts
interface IndicatorDefinition {
  id: string;
  type: string;
  paneId: string;

  config: Record<string, unknown>;

  style: {
    visible: boolean;
    lineWidth?: number;
    opacity?: number;
  };
}
```

## 13.3 Result Types

### Line

```ts
type LinePoint = {
  time: number;
  value: number | null;
};
```

### Multi-line

```ts
type MultiLineResult = {
  lines: Record<string, LinePoint[]>;
};
```

### Histogram

```ts
type HistogramPoint = {
  time: number;
  value: number;
  polarity?: 'positive' | 'negative' | 'neutral';
};
```

### Band

```ts
type BandPoint = {
  time: number;
  upper: number;
  middle?: number;
  lower: number;
};
```

---

# 14. Initial Indicator Specifications

## 14.1 SMA

Config:

```ts
{
  period: number;
  source: 'open' | 'high' | 'low' | 'close';
}
```

## 14.2 EMA

Must support incremental update.

Formula:

```text
alpha = 2 / (period + 1)

EMA_t =
price_t * alpha
+ EMA_(t-1) * (1 - alpha)
```

## 14.3 WMA

Weighted moving average.

## 14.4 Bollinger Bands

Config:

```ts
{
  period: number;
  stdDev: number;
  source: 'close';
}
```

Output:

- upper
- middle
- lower

## 14.5 RSI

Config:

```ts
{
  period: number;
}
```

Output:

- RSI line
- optional guide values: 30, 50, 70

## 14.6 MACD

Config:

```ts
{
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
}
```

Output:

- MACD line
- signal line
- histogram

## 14.7 ATR

Config:

```ts
{
  period: number;
}
```

## 14.8 Volume

No calculation beyond mapping candle volume unless volume transformations are added later.

---

# 15. Indicator Calculation Optimization

Do not recalculate every indicator for the entire dataset on every realtime update.

## 15.1 Historical Load

Full calculation allowed:

```text
candles
  ↓
full indicator calculation
```

## 15.2 Current Candle Update

Incremental:

```text
last candle changes
      ↓
recompute only affected indicator tail
```

Examples:

- EMA: O(1)
- SMA: O(1) with rolling sum
- RSI: incremental Wilder smoothing
- ATR: incremental Wilder smoothing
- MACD: incremental EMA values

## 15.3 History Prepend

When older history is inserted:

- safest first implementation: recalculate affected indicators
- later optimize with cache checkpoints

---

# 16. Render Model

The renderer should not consume raw domain data directly.

Example:

```ts
interface ChartRenderModel {
  panes: PaneRenderModel[];
  timeAxis: TimeAxisRenderModel;
  crosshair?: CrosshairRenderModel;
}

interface PaneRenderModel {
  frame: Rect;
  yScale: ScaleSnapshot;

  candles?: CandleGeometryBatch[];
  lines: LineGeometry[];
  histograms: HistogramGeometry[];
  bands: BandGeometry[];

  gridLines: GridLineGeometry[];
  labels: AxisLabelGeometry[];
}
```

The render model should contain screen-space or near-screen-space geometry.

---

# 17. Skia Rendering Strategy

## 17.1 Key Principle

Avoid:

```tsx
candles.map(candle => (
  <Group>
    <Rect />
    <Line />
  </Group>
))
```

for large visible ranges.

Prefer grouped geometry:

```text
bull body path
bear body path
bull wick path
bear wick path
```

Then draw a small number of paths.

## 17.2 Candle Geometry Batching

For each frame:

```text
visible candles
      ↓
screen coordinates
      ↓
split bullish / bearish
      ↓
build body paths
      ↓
build wick paths
      ↓
Skia draw
```

Result:

- 1 bullish body path
- 1 bearish body path
- 1 bullish wick path
- 1 bearish wick path

instead of hundreds of nodes.

## 17.3 Indicator Paths

EMA/SMA/etc.:

```text
indicator values
      ↓
visible slice
      ↓
Skia Path
```

Cache paths where possible.

## 17.4 Histograms

MACD and volume should also use batched paths or optimized rectangular geometry.

## 17.5 Picture Caching

Consider `Skia.Picture` for relatively static layers:

- historical candle geometry
- grid
- axis-independent drawing

Do not cache dynamic layers unnecessarily.

Potential layers:

```text
Layer 1: grid
Layer 2: candles
Layer 3: indicators
Layer 4: annotations
Layer 5: crosshair
Layer 6: labels
```

Crosshair should remain cheap and independent.

---

# 18. Gesture Architecture

Use:

- Gesture Handler
- Reanimated shared values
- Skia-supported animated values

Avoid:

```ts
onGesture => setState(...)
```

## 18.1 Pan

Pan updates:

```text
translateX SharedValue
```

This should update visible position without a React render.

## 18.2 Pinch Zoom

Pinch must preserve the candle under the gesture focal point.

Required logic:

```text
gesture focalX
     ↓
resolve candle index before zoom
     ↓
change candle width / scale
     ↓
adjust translation
     ↓
same candle remains under focalX
```

## 18.3 Crosshair

Long press or drag:

```text
touch X
  ↓
nearest candle index
  ↓
touch Y
  ↓
price value
```

Display:

- vertical line
- horizontal line
- time label
- price label
- OHLC summary

Crosshair values should be shared values, not React state.

---

# 19. Axes and Grid

## 19.1 Time Axis

Responsibilities:

- derive label interval from zoom level
- avoid overlapping labels
- support intraday and daily formats
- align labels to candles
- reuse shared time scale for all panes

## 19.2 Price Axis

Responsibilities:

- choose sensible tick step
- format decimals based on asset precision
- avoid overlapping labels
- show last price label
- optional percentage mode later

## 19.3 Grid

Grid must derive from axis ticks rather than using arbitrary pixel intervals.

---

# 20. Chart Configuration API

Proposed component:

```tsx
<TradingChart
  candles={candles}
  theme={theme}
  timeframe="1m"
  indicators={indicators}
  panes={panes}
  onLoadMore={loadMore}
  onCrosshairChange={onCrosshairChange}
/>
```

However, frequent realtime data updates should eventually avoid pushing full arrays through React props.

Long-term API:

```ts
const chart = useTradingChartController();

chart.setData(data);
chart.appendBar(bar);
chart.updateLastBar(bar);

chart.addIndicator(...);
chart.removeIndicator(...);

chart.scrollToRealtime();
chart.setVisibleRange(...);
```

---

# 21. Chart Controller

Suggested API:

```ts
interface TradingChartController {
  setData(candles: Candle[]): void;

  appendBar(candle: Candle): void;
  updateLastBar(candle: Candle): void;
  prependBars(candles: Candle[]): void;

  addIndicator(definition: IndicatorDefinition): string;
  removeIndicator(id: string): void;
  updateIndicator(id: string, patch: Partial<IndicatorDefinition>): void;

  addPane(definition: PaneDefinition): string;
  removePane(id: string): void;

  scrollToRealtime(): void;
  setVisibleRange(start: number, end: number): void;
  resetZoom(): void;
}
```

---

# 22. State Management Rules

## React State

Use for:

- selected timeframe
- selected symbol
- indicator settings modal
- chart theme
- pane configuration
- persistent user preferences

## Shared Values / Engine State

Use for:

- pan position
- pinch scale
- candle width
- crosshair X/Y
- active visible range
- realtime animation state

## Internal Mutable Engine Data

Use for:

- candle arrays/buffers
- indicator caches
- render geometry caches
- binary-search indices

---

# 23. Large Dataset Strategy

## 23.1 Visible-Range Rendering

Mandatory.

## 23.2 Progressive History Loading

When approaching left boundary:

```text
visible start < threshold
       ↓
request older history
```

Do not load unlimited historical data at startup.

## 23.3 Downsampling / Conflation

At extreme zoom-out:

If multiple candles map to less than approximately one screen pixel, aggregate visual representation.

Possible strategy:

```text
screen pixel bucket
    ↓
open  = first open
high  = max high
low   = min low
close = last close
volume = sum volume
```

This is rendering aggregation only.

Original source candles must remain unchanged.

---

# 24. Theme System

```ts
interface ChartTheme {
  background: string;

  grid: {
    color: string;
    width: number;
  };

  candle: {
    bullish: string;
    bearish: string;
    wickBullish: string;
    wickBearish: string;
  };

  axis: {
    textColor: string;
    fontSize: number;
  };

  crosshair: {
    color: string;
  };

  lastPrice: {
    lineColor: string;
  };
}
```

Indicator styling should be separate from theme where appropriate.

---

# 25. Persistence

Persist user settings:

- indicator list
- indicator parameters
- pane order
- pane heights
- theme
- chart type later
- last selected timeframe

Do not persist large candle history through chart settings.

---

# 26. Error Handling

The chart must gracefully handle:

- empty data
- one candle
- malformed candle
- NaN indicator output
- duplicate timestamps
- out-of-order candles
- missing volume
- zero price range
- network reconnect
- insufficient indicator warm-up data

Do not allow invalid numbers to reach Skia geometry.

---

# 27. Testing Strategy

## 27.1 Unit Tests

Must cover:

- candle store
- binary search
- visible range
- X scale
- Y scale
- auto scale
- SMA
- EMA
- RSI
- MACD
- ATR
- Bollinger Bands
- realtime bar aggregation

## 27.2 Golden Indicator Tests

Compare known datasets against trusted reference outputs.

Use deterministic fixtures.

## 27.3 Interaction Tests

Validate:

- pan boundaries
- zoom focal preservation
- crosshair nearest index
- left-history loading trigger
- scroll-to-realtime

## 27.4 Visual Regression

Generate deterministic chart fixtures and compare screenshots where practical.

---

# 28. Benchmarking

Create explicit benchmark scenes.

## Scene A

- 500 candles
- candles only

## Scene B

- 5,000 stored candles
- 150 visible
- EMA20
- EMA50

## Scene C

- 20,000 stored candles
- Bollinger
- Volume
- MACD
- RSI

## Scene D

Realtime stress:

- update active candle 20 times/sec
- chart panning
- multiple indicators

Track:

- JS FPS
- UI FPS
- render time
- memory
- GC frequency
- indicator calculation duration
- visible-range calculation duration

---

# 29. Development Phases

The implementation should be divided so that each subtask can usually be completed in one focused coding-agent session.

---

# Phase 0 — Project Foundation

## 0.1 Create Chart Module Skeleton

Tasks:

- create chart directory structure
- add core TypeScript interfaces
- add linting rules
- add test structure
- create sample chart playground screen

Deliverable:

```text
TradingChart playground renders an empty Skia canvas
```

## 0.2 Define Candle Model and Validation

Tasks:

- define Candle
- timestamp policy
- validation helpers
- fixture dataset

## 0.3 Add Performance Instrumentation

Tasks:

- lightweight profiler utility
- frame/render timing hooks
- debug overlay configuration

---

# Phase 1 — Data Engine

## 1.1 CandleStore

Implement:

- set
- append
- update last
- prepend
- range lookup
- binary timestamp search

Tests required.

## 1.2 Historical Merge

Implement:

- deduplication
- ordering
- history prepend
- conflict resolution

## 1.3 RealtimeBarAggregator

Implement tick/trade aggregation into OHLC candles.

Tests:

- same interval
- timeframe rollover
- missing ticks
- out-of-order tick handling

---

# Phase 2 — Coordinate and Viewport Engine

## 2.1 X Coordinate System

Implement:

```text
index ↔ X coordinate
```

with candle width + spacing.

## 2.2 Visible Range

Implement:

- viewport width
- translation
- visible start/end
- overscan

## 2.3 Horizontal Pan Math

Implement without UI first.

## 2.4 Zoom Math

Implement:

- min/max candle width
- focal point preservation
- zoom clamping

## 2.5 Price Scale

Implement:

```text
price ↔ Y coordinate
```

## 2.6 Auto Scale

Visible candles determine current price range.

---

# Phase 3 — Basic Candlestick Renderer

## 3.1 Candle Geometry Builder

Convert visible candles to geometry.

Output:

- body bounds
- wick points
- bullish/bearish classification

## 3.2 Batched Candle Paths

Build:

- bullish bodies
- bearish bodies
- bullish wicks
- bearish wicks

## 3.3 Skia Candle Renderer

Render paths on Canvas.

Acceptance:

- 500 visible candles remain smooth
- no React node per candle

## 3.4 Basic Grid

Add horizontal and vertical grid rendering.

---

# Phase 4 — Gesture Layer

## 4.1 Pan Gesture

Gesture Handler + Reanimated.

Acceptance:

- no React render per pan frame

## 4.2 Pinch Zoom

Add focal-preserving zoom.

## 4.3 Gesture Coordination

Resolve:

- pinch vs pan
- long press vs pan
- parent scroll conflicts

## 4.4 Scroll-to-Realtime

Add controller action and optional floating button state.

---

# Phase 5 — Axes

## 5.1 Price Tick Generator

Implement sensible step generation.

## 5.2 Price Axis Renderer

Render labels and ticks.

## 5.3 Time Tick Generator

Implement zoom-aware time intervals.

## 5.4 Time Axis Renderer

Avoid label collisions.

## 5.5 Last Price Marker

Render horizontal line + price badge.

---

# Phase 6 — Crosshair and OHLC Inspection

## 6.1 Long Press Activation

Activate crosshair.

## 6.2 Nearest Candle Lookup

Map touch X to candle index.

## 6.3 Crosshair Drawing

Render:

- vertical line
- horizontal line

## 6.4 Axis Labels

Show:

- candle time
- price at cursor

## 6.5 OHLC Header

Display selected candle:

- O
- H
- L
- C
- change
- percentage change

---

# Phase 7 — Indicator Framework

## 7.1 Indicator Interface

Implement base contracts.

## 7.2 Registry

Implement indicator registry.

## 7.3 Result Types

Implement:

- line
- multi-line
- histogram
- band

## 7.4 Indicator Cache

Cache by:

```text
indicator id
dataset version
config version
```

## 7.5 Indicator Scheduler

Initial synchronous version.

Later allow background/worker/native calculation if needed.

---

# Phase 8 — Overlay Indicators

## 8.1 SMA

Implementation + tests.

## 8.2 EMA

Implementation + incremental update + tests.

## 8.3 WMA

Implementation + tests.

## 8.4 Bollinger Bands

Implementation + tests.

## 8.5 Line Renderer

Generic line-path renderer.

## 8.6 Band Renderer

Render Bollinger upper/middle/lower and optional fill.

---

# Phase 9 — Pane System

## 9.1 Pane Model

Implement pane definitions.

## 9.2 Pane Layout Engine

Calculate vertical frames.

## 9.3 Shared Time Scale

All panes aligned horizontally.

## 9.4 Independent Y Scales

Each pane controls its own Y range.

## 9.5 Pane Add/Remove

Dynamic pane management.

---

# Phase 10 — Volume

## 10.1 Volume Pane

Add default volume pane.

## 10.2 Volume Geometry

Map volume values to pane coordinates.

## 10.3 Batched Histogram Rendering

Separate positive/negative volume bars if desired.

## 10.4 Volume Scale

Auto max from visible range.

---

# Phase 11 — RSI

## 11.1 RSI Calculation

Implement Wilder RSI.

## 11.2 Incremental RSI

Optimize latest-bar update.

## 11.3 RSI Pane Renderer

Render RSI line.

## 11.4 Guide Levels

30 / 50 / 70.

---

# Phase 12 — MACD

## 12.1 MACD Engine

Implement fast/slow EMA.

## 12.2 Signal Line

Implement signal EMA.

## 12.3 Histogram

Implement MACD histogram.

## 12.4 MACD Pane Renderer

Render:

- MACD
- signal
- positive histogram
- negative histogram

---

# Phase 13 — ATR

## 13.1 True Range

Implement tested TR.

## 13.2 ATR Calculation

Wilder smoothing.

## 13.3 ATR Pane

Generic line pane.

---

# Phase 14 — Indicator Settings

## 14.1 Indicator Configuration Model

Editable parameters.

## 14.2 Add Indicator UI

Modal or bottom sheet.

## 14.3 Edit Indicator

Update parameters without reconstructing entire chart.

## 14.4 Remove Indicator

Clean cache + pane references.

## 14.5 Overlay vs Separate Pane Selection

Support appropriate defaults.

---

# Phase 15 — Realtime Integration

## 15.1 Realtime Candle Update

Update active candle.

## 15.2 Incremental Indicator Update

Update only required indicator tail.

## 15.3 New Candle Insertion

Handle interval rollover.

## 15.4 Follow Realtime Mode

If user is at chart right edge:

```text
new bars auto-follow
```

If user has panned away:

```text
do not force scroll
```

## 15.5 Realtime Status

Optional:

- live
- reconnecting
- delayed

---

# Phase 16 — Historical Pagination

## 16.1 Left Edge Threshold

Detect history-loading condition.

## 16.2 Async Load More

Call `onLoadMore`.

## 16.3 Preserve View Position

When prepending 500 candles, visible candles must not jump.

Critical acceptance requirement.

## 16.4 Loading State

Prevent duplicate concurrent requests.

---

# Phase 17 — Rendering Optimization

## 17.1 Geometry Allocation Audit

Reduce temporary arrays and objects.

## 17.2 Path Cache

Cache unchanged historical path segments.

## 17.3 Skia Picture Experiments

Benchmark `Picture` against dynamic path drawing.

Do not assume faster; measure.

## 17.4 Text Rendering Audit

Axis text can be expensive.

Optimize:

- tick count
- font reuse
- layout calculation

## 17.5 Layer Invalidations

Avoid rebuilding:

- grid
- axes
- indicators

when only crosshair changes.

---

# Phase 18 — Extreme Zoom-Out Optimization

## 18.1 Detect Overdraw

Determine when candle width becomes too small.

## 18.2 Pixel-Bucket Conflation

Aggregate visual candles per pixel bucket.

## 18.3 Indicator Downsampling

For visual rendering only.

Do not alter actual indicator calculations unless explicitly designed.

## 18.4 Benchmark 100k Dataset

Validate memory and frame behavior.

---

# Phase 19 — Precision and Trading Details

## 19.1 Price Precision

Support:

- crypto micro prices
- forex
- equities

## 19.2 Tick Size

Optional asset metadata:

```ts
{
  tickSize: number;
  quantityStep: number;
}
```

## 19.3 Timezone

Define chart timezone policy.

## 19.4 Session Gaps

Support later for equities/futures.

---

# Phase 20 — Production Hardening

## 20.1 Error Boundaries

Protect parent app.

## 20.2 Invalid Numeric Guards

Never send NaN/Infinity to renderer.

## 20.3 Memory Profiling

Test:

- symbol switching
- timeframe switching
- repeated indicator add/remove

## 20.4 Android Device Testing

Test low/mid-range devices.

## 20.5 iOS Testing

Test 60 Hz and ProMotion devices.

---

# Phase 21 — API Stabilization

## 21.1 Public Types

Review exported API.

## 21.2 Internal/External Boundary

Hide renderer implementation details.

## 21.3 Controller API

Stabilize imperative actions.

## 21.4 Migration Strategy

Prepare versioning for future chart features.

---

# Phase 22 — Optional Advanced Trading Features

Only start after performance targets are met.

## 22.1 Order Markers

Render:

- buy order
- sell order
- filled order

## 22.2 Position Overlay

Render:

- average entry
- PnL area
- liquidation line

## 22.3 Take Profit / Stop Loss

Interactive draggable levels.

## 22.4 Annotations

Generic horizontal/vertical lines.

## 22.5 Drawing Engine

Start with:

- trend line
- horizontal ray
- rectangle

Then later:

- Fibonacci retracement
- channels

---

# Phase 23 — Optional Advanced Indicators

Implement one per session with:

1. formula
2. unit tests
3. incremental strategy
4. rendering strategy
5. settings schema

Candidates:

- VWAP
- Stochastic
- Stochastic RSI
- OBV
- MFI
- CCI
- ADX
- Donchian
- Keltner
- Supertrend
- Ichimoku

---

# 30. Agent Session Template

For each coding-agent session, use this structure:

```text
Goal
- one concrete feature

Inputs
- relevant architecture files
- existing interfaces

Tasks
1.
2.
3.

Constraints
- no React state in frame-sensitive path
- no per-candle React component nodes
- add tests for calculation logic
- preserve current public API where possible

Acceptance Criteria
- feature works
- tests pass
- no regression in benchmark scenario
- TypeScript passes

Deliverables
- code
- tests
- short implementation note
```

---

# 31. Definition of Done for Core MVP

The chart engine can be considered Core MVP-ready when it supports:

- candlestick chart
- 10k+ stored candles
- visible-range rendering
- smooth pan
- smooth pinch zoom
- price axis
- time axis
- crosshair
- realtime candle update
- history pagination
- volume pane
- EMA
- SMA
- Bollinger Bands
- RSI
- MACD
- dark/light theme
- indicator configuration
- 60 FPS target on representative devices

---

# 32. Definition of Done for Production V1

Production V1 additionally requires:

- robust reconnect behavior
- symbol switching
- timeframe switching
- no viewport jump during prepend
- memory leak tests
- 50k+ candle benchmark
- 100k zoom-out test
- incremental calculations
- path batching
- invalid-data protection
- comprehensive unit tests
- production error telemetry hooks
- stable public API

---

# 33. Architectural Rules That Must Not Be Violated

1. **Do not couple indicators to Skia.**
2. **Do not couple market data ingestion to React components.**
3. **Do not use React state for every pan/zoom/crosshair frame.**
4. **Do not render every stored candle.**
5. **Do not create one React component per candle in the performance path.**
6. **Do not fully recalculate all indicators on every realtime tick.**
7. **Do not mix pane layout logic with indicator math.**
8. **Do not silently accept NaN/Infinity rendering coordinates.**
9. **Do not optimize based only on assumptions; benchmark.**
10. **Do not copy proprietary chart source code. Use external libraries as architectural references only unless their licenses explicitly permit reuse.**

---

# 34. Recommended Implementation Order

For the shortest route to a usable trading chart:

```text
Data Store
   ↓
Viewport Math
   ↓
Candles
   ↓
Pan
   ↓
Zoom
   ↓
Axes
   ↓
Crosshair
   ↓
EMA/SMA
   ↓
Pane System
   ↓
Volume
   ↓
RSI
   ↓
MACD
   ↓
Realtime
   ↓
History Pagination
   ↓
Performance Optimization
```

Do not start with a large indicator catalog before viewport/rendering architecture is proven.

---

# 35. Suggested First 10 Coding-Agent Sessions

## Session 1
Create project architecture, chart types, empty Skia canvas, fixture screen.

## Session 2
Implement CandleStore + tests.

## Session 3
Implement X coordinate system + visible-range calculation.

## Session 4
Implement price scale + visible auto-scale.

## Session 5
Implement candle geometry builder + batched Skia candle renderer.

## Session 6
Implement Reanimated/Gesture Handler horizontal pan.

## Session 7
Implement pinch zoom with focal-point preservation.

## Session 8
Implement price/time grid and basic axes.

## Session 9
Implement crosshair + nearest-candle lookup.

## Session 10
Implement generic indicator framework + EMA20 overlay.

At the end of Session 10, benchmark before adding more features.

---

# 36. Benchmark Gate Before Continuing

Before starting pane-heavy work, the engine should pass:

### Dataset

```text
10,000 stored candles
200 visible
EMA20
EMA50
```

### Interaction

- continuous pan for 10 seconds
- pinch zoom repeatedly
- crosshair drag

### Realtime

- 10–20 updates/sec on active candle

### Acceptance

- no obvious jank
- no excessive allocations
- no React rerender per gesture frame
- no full-data geometry creation per frame

If this gate fails, optimize before implementing additional indicators.

---

# 37. Long-Term Extensibility

The architecture should eventually allow alternative rendering backends.

For example:

```text
Indicator Engine
      │
      ▼
Render Model
      │
 ┌────┴───────────┐
 ▼                ▼
Skia Renderer   Future Renderer
                e.g. SciChart/native
```

This is why business logic must never depend on Skia-specific types.

A future migration or partial use of a commercial engine should not require rewriting:

- indicator formulas
- market data aggregation
- candle store
- user indicator configuration
- pane definitions
- timeframe logic

---

# 38. Final Recommended Strategy

Build the chart as a small specialized graphics engine rather than a React component collection.

The highest-priority technical principles are:

```text
visible-range rendering
+
batched Skia paths
+
Reanimated gesture state
+
independent indicator engine
+
incremental calculations
+
multi-pane render model
+
benchmark-driven optimization
```

The first objective is not to maximize feature count.

The first objective is to prove that the core engine can remain smooth with realistic trading workloads. Once this foundation is stable, additional indicators, annotations, trading overlays, and drawing tools can be added without compromising architecture or performance.
