import { estimateBarInterval } from '../axes/TimeTicks';
import { dragAnchors, dragLinePrice } from '../trading/DrawingDrag';
import { projectAnchors } from '../trading/DrawingGeometry';
import {
  HIT_NONE,
  hitTestDrawing,
  hitTestLineHandle,
} from '../trading/HitTest';
import type { SceneDrawing, SceneLine } from '../trading/OverlayScene';
import { yToPrice, type PriceScaleSnapshot } from '../viewport/PriceScale';
import { xToIndex } from '../viewport/TimeScale';
import { readTimeScale, type ChartSharedState } from './ChartSharedState';
import { DRAG_DRAWING, DRAG_LINE, DRAG_NONE } from './TradingState';

/*
 * Overlay interaction worklets (spec 22.3 / 22.5), run by the overlay
 * gestures on the UI thread: hit testing at touch-down, drag updates
 * (written to `tradingUi`, which the renderer applies as an override).
 * Taps live in `TradingTapActions`. JS is only told about results
 * (throttled by the callers).
 */

/** Width of the grab zone of a line without a label box, dp. */
export const LINE_HANDLE_WIDTH = 48;

/** What a touch-down grabbed. */
export interface OverlayDragStart {
  kind: number;
  /** Line key / drawing id. */
  key: string;
  /** Line target and source id (drag events). */
  target: SceneLine['target'] | '';
  id: string;
  /** Drawing part (`HIT_BODY` or anchor index). */
  part: number;
  startX: number;
  startY: number;
  startPrice: number;
  startAnchors: number[];
  /** Last snapped line price reported to JS. */
  lastPrice: number;
}

export function noDragStart(): OverlayDragStart {
  'worklet';
  return {
    kind: DRAG_NONE,
    key: '',
    target: '',
    id: '',
    part: HIT_NONE,
    startX: 0,
    startY: 0,
    startPrice: NaN,
    startAnchors: [],
    lastPrice: NaN,
  };
}

/** Linear scale of the price pane (overlays live on the price pane). */
export function pricePaneScale(state: ChartSharedState): PriceScaleSnapshot {
  'worklet';
  return {
    mode: 'linear',
    top: 0,
    height: state.plotHeight.value,
    min: state.priceMin.value,
    max: state.priceMax.value,
  };
}

function hitLine(
  state: ChartSharedState,
  x: number,
  y: number,
  slop: number
): number {
  'worklet';
  const scene = state.tradingScene.value;
  const hits = state.tradingHits.value;
  if (hits.version !== scene.version) {
    return -1;
  }
  const plotWidth = state.plotWidth.value;
  const axisRight = plotWidth + state.priceAxisWidth.value;
  for (let i = scene.lines.length - 1; i >= 0; i--) {
    const line = scene.lines[i] as SceneLine;
    if (
      line.draggable &&
      i < hits.count &&
      hitTestLineHandle(
        hits.lines[i * 3] as number,
        hits.lines[i * 3 + 1] as number,
        hits.lines[i * 3 + 2] as number,
        plotWidth,
        axisRight,
        LINE_HANDLE_WIDTH,
        x,
        y,
        slop
      )
    ) {
      return i;
    }
  }
  return -1;
}

/** Hit test of drawing `d` at `(x, y)` for the current frame. */
export function hitDrawing(
  state: ChartSharedState,
  d: SceneDrawing,
  x: number,
  y: number,
  slop: number,
  withAnchors: boolean
): number {
  'worklet';
  const series = state.series.value;
  const points: number[] = [];
  if (
    !projectAnchors(
      series,
      readTimeScale(state),
      pricePaneScale(state),
      estimateBarInterval(series),
      d.anchors,
      points
    )
  ) {
    return HIT_NONE;
  }
  return hitTestDrawing(
    d.type,
    points,
    state.plotWidth.value,
    x,
    y,
    slop,
    withAnchors
  );
}

/**
 * Touch-down: grabs a draggable line handle (topmost first), else the
 * selected, unlocked drawing (anchor handles first). `kind` is
 * `DRAG_NONE` when nothing was hit or a drawing tool is active.
 */
export function beginOverlayDrag(
  state: ChartSharedState,
  x: number,
  y: number,
  slop: number
): OverlayDragStart {
  'worklet';
  const start = noDragStart();
  const scene = state.tradingScene.value;
  if (scene.tool !== '' || !(y <= state.plotHeight.value)) {
    return start;
  }
  start.startX = x;
  start.startY = y;
  const li = hitLine(state, x, y, slop);
  if (li >= 0) {
    const line = scene.lines[li] as SceneLine;
    start.kind = DRAG_LINE;
    start.key = line.key;
    start.target = line.target;
    start.id = line.id;
    start.startPrice = line.price;
    return start;
  }
  const selected = state.tradingUi.value.selectedId;
  for (let i = 0; i < scene.drawings.length; i++) {
    const d = scene.drawings[i] as SceneDrawing;
    if (d.id === selected && !d.locked) {
      const part = hitDrawing(state, d, x, y, slop, true);
      if (part !== HIT_NONE) {
        start.kind = DRAG_DRAWING;
        start.key = d.id;
        start.id = d.id;
        start.part = part;
        start.startAnchors = d.anchors.slice();
      }
      break;
    }
  }
  return start;
}

/**
 * Moves the grabbed item to the finger (`tickSize` snaps prices).
 * Returns the snapped line price (`NaN` for drawings / failures).
 */
export function updateOverlayDrag(
  state: ChartSharedState,
  start: OverlayDragStart,
  x: number,
  y: number,
  tickSize: number
): number {
  'worklet';
  const price = pricePaneScale(state);
  const dPrice = yToPrice(price, y) - yToPrice(price, start.startY);
  const ui = state.tradingUi.value;
  if (start.kind === DRAG_LINE) {
    const next = dragLinePrice(start.startPrice, dPrice, tickSize);
    if (!Number.isFinite(next)) {
      return NaN;
    }
    state.tradingUi.value = {
      ...ui,
      dragKind: DRAG_LINE,
      dragPending: false,
      dragKey: start.key,
      dragPrice: next,
    };
    return next;
  }
  if (start.kind !== DRAG_DRAWING) {
    return NaN;
  }
  const time = readTimeScale(state);
  const series = state.series.value;
  const body = start.part < 0;
  const a = body
    ? xToIndex(time, x) - xToIndex(time, start.startX)
    : xToIndex(time, x);
  const b = body ? dPrice : yToPrice(price, y);
  const out: number[] = [];
  if (
    dragAnchors(
      series,
      estimateBarInterval(series),
      start.startAnchors,
      start.part,
      a,
      b,
      tickSize,
      out
    )
  ) {
    state.tradingUi.value = {
      ...ui,
      dragKind: DRAG_DRAWING,
      dragPending: false,
      dragKey: start.key,
      dragAnchors: out,
    };
  }
  return NaN;
}

/**
 * Release: keeps the override as pending (until the committed scene
 * arrives) when something moved, else clears it. Returns `true` when a
 * commit must be sent to JS.
 */
export function endOverlayDrag(
  state: ChartSharedState,
  start: OverlayDragStart
): boolean {
  'worklet';
  const ui = state.tradingUi.value;
  const moved =
    start.kind !== DRAG_NONE &&
    ui.dragKind === start.kind &&
    ui.dragKey === start.key;
  state.tradingUi.value = moved
    ? { ...ui, dragPending: true }
    : {
        ...ui,
        dragKind: DRAG_NONE,
        dragPending: false,
        dragKey: '',
        dragPrice: NaN,
        dragAnchors: [],
      };
  return moved;
}
