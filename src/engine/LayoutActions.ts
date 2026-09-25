import type { ChartSharedState, ViewportOptions } from './ChartSharedState';
import { resizePlot } from './ViewportActions';

/**
 * Canvas / gutter layout commands (UI thread). The plot is the canvas
 * minus the (auto-sized) price axis on the right and the time axis at the
 * bottom; every change is funneled through `resizePlot`.
 */

/** Plot size for a canvas and its gutters (0 when it doesn't fit). */
export function plotSizeFor(canvas: number, gutter: number): number {
  'worklet';
  const size = canvas - (gutter > 0 ? gutter : 0);
  return size > 0 && size < Infinity ? size : 0;
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
  resizePlot(
    state,
    options,
    plotSizeFor(state.canvasWidth.value, state.priceAxisWidth.value),
    plotSizeFor(state.canvasHeight.value, timeAxisHeight)
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
