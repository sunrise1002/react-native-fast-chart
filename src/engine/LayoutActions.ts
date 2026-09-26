import { computePaneLayout, type PaneLayoutSpec } from '../panes/PaneLayout';
import type { ChartSharedState, ViewportOptions } from './ChartSharedState';
import { resizePlot } from './ViewportActions';

/**
 * Canvas / gutter layout commands (UI thread). The pane stack is the
 * canvas minus the (auto-sized) price axis on the right and the time axis
 * at the bottom; panes split the stack height (`computePaneLayout`) and
 * the price pane becomes the plot. Every change is funneled through
 * `resizePlot`.
 */

/** Plot size for a canvas and its gutters (0 when it doesn't fit). */
export function plotSizeFor(canvas: number, gutter: number): number {
  'worklet';
  const size = canvas - (gutter > 0 ? gutter : 0);
  return size > 0 && size < Infinity ? size : 0;
}

/** Re-lays out the panes in the stack; the price pane sizes the plot. */
export function applyPaneLayout(
  state: ChartSharedState,
  options: ViewportOptions,
  plotWidth: number = state.plotWidth.value
): void {
  'worklet';
  const frame = computePaneLayout(
    state.paneSpec.value,
    state.stackHeight.value
  );
  state.paneLayout.value = frame;
  resizePlot(state, options, plotWidth, frame.heights[0] ?? 0);
}

/**
 * Replaces the pane spec (pane list change from the `PaneManager`, or a
 * live separator drag) and re-lays out.
 */
export function setPaneSpec(
  state: ChartSharedState,
  options: ViewportOptions,
  spec: PaneLayoutSpec
): void {
  'worklet';
  state.paneSpec.value = spec;
  applyPaneLayout(state, options);
}

/** New canvas size from layout (keeps the current price-axis width). */
export function resizeCanvas(
  state: ChartSharedState,
  options: ViewportOptions,
  width: number,
  height: number,
  timeAxisHeight: number
): void {
  'worklet';
  state.canvasWidth.value = width > 0 && width < Infinity ? width : 0;
  state.canvasHeight.value = height > 0 && height < Infinity ? height : 0;
  state.stackHeight.value = plotSizeFor(
    state.canvasHeight.value,
    timeAxisHeight
  );
  applyPaneLayout(
    state,
    options,
    plotSizeFor(state.canvasWidth.value, state.priceAxisWidth.value)
  );
}

/** Applies a new price-axis width (no-op when unchanged or invalid). */
export function setPriceAxisWidth(
  state: ChartSharedState,
  options: ViewportOptions,
  width: number,
  timeAxisHeight: number
): void {
  'worklet';
  if (
    !(width >= 0 && width < Infinity) ||
    width === state.priceAxisWidth.value
  ) {
    return;
  }
  state.priceAxisWidth.value = width;
  resizeCanvas(
    state,
    options,
    state.canvasWidth.value,
    state.canvasHeight.value,
    timeAxisHeight
  );
}
