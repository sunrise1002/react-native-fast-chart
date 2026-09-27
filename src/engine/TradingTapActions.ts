import { snapToTickSize } from '../axes/SymbolPrecision';
import { estimateBarInterval } from '../axes/TimeTicks';
import { DRAWING_ANCHOR_COUNT } from '../trading/DrawingModel';
import { HIT_NONE } from '../trading/HitTest';
import type { SceneDrawing } from '../trading/OverlayScene';
import { snapIndexToTime } from '../trading/TimeAnchor';
import { yToPrice } from '../viewport/PriceScale';
import { xToIndex } from '../viewport/TimeScale';
import { readTimeScale, type ChartSharedState } from './ChartSharedState';
import { hitDrawing, pricePaneScale } from './TradingActions';

/*
 * Overlay tap worklet (spec 22.5), run by the overlay tap gesture on the
 * UI thread: tap-tap drawing creation and drawing selection.
 */

/** Result of `tapOverlays`. */
export interface OverlayTapResult {
  /** A drawing tool is active (the tap placed an anchor). */
  draft: boolean;
  /** The draft has all its anchors (send `anchors` to JS). */
  complete: boolean;
  anchors: number[];
  /** Selection after the tap (non-draft taps). */
  selectedId: string;
  selectionChanged: boolean;
}

/**
 * Single tap: with a drawing tool, places the next anchor (snapped to a
 * bar slot / the tick size); otherwise selects the topmost drawing under
 * the finger (or clears the selection).
 */
export function tapOverlays(
  state: ChartSharedState,
  x: number,
  y: number,
  slop: number,
  tickSize: number
): OverlayTapResult {
  'worklet';
  const scene = state.tradingScene.value;
  const ui = state.tradingUi.value;
  const result: OverlayTapResult = {
    draft: false,
    complete: false,
    anchors: [],
    selectedId: ui.selectedId,
    selectionChanged: false,
  };
  const tool = scene.tool;
  if (tool !== '') {
    result.draft = true;
    const series = state.series.value;
    const time = snapIndexToTime(
      series,
      xToIndex(readTimeScale(state), x),
      estimateBarInterval(series)
    );
    const price = snapToTickSize(yToPrice(pricePaneScale(state), y), tickSize);
    if (ui.draftPending || !Number.isFinite(time) || !Number.isFinite(price)) {
      return result;
    }
    const anchors = ui.draftAnchors.concat([time, price]);
    result.complete = anchors.length >= DRAWING_ANCHOR_COUNT[tool] * 2;
    result.anchors = anchors;
    state.tradingUi.value = {
      ...ui,
      draftAnchors: anchors,
      draftPending: result.complete,
    };
    return result;
  }
  let hit = '';
  for (let i = scene.drawings.length - 1; i >= 0; i--) {
    const d = scene.drawings[i] as SceneDrawing;
    if (hitDrawing(state, d, x, y, slop, false) !== HIT_NONE) {
      hit = d.id;
      break;
    }
  }
  result.selectedId = hit;
  result.selectionChanged = hit !== ui.selectedId;
  if (result.selectionChanged) {
    state.tradingUi.value = { ...ui, selectedId: hit };
  }
  return result;
}
