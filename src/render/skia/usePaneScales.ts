import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import type { PaneLayoutFrame } from '../../panes/PaneLayout';
import { cachedPaneRange } from '../conflation/ConflatedLayers';
import type { PriceScaleSnapshot } from '../../viewport/PriceScale';
import {
  getViewIndexRange,
  getVisibleRange,
} from '../../viewport/VisibleRange';
import { frameTimeScale } from './frameScales';
import type { PaneDrawItem } from './PanePaints';

/**
 * Y scales of the pane draw items for the current frame, index-aligned
 * with the draw list. A scale with `NaN` min / max (nothing to show) or
 * zero height draws nothing.
 */
export interface PaneScaleFrame {
  scales: PriceScaleSnapshot[];
}

/**
 * Rect of a pane item: its pane's rect, or the bottom `overlayRatio` of
 * the price pane for price-pane overlays (volume). Zero height when the
 * pane is not laid out.
 */
export function paneItemRect(
  frame: PaneLayoutFrame,
  paneId: string,
  overlay: boolean,
  overlayRatio: number,
  out: { top: number; height: number }
): void {
  'worklet';
  const index = frame.ids.indexOf(paneId);
  const top = index >= 0 ? (frame.tops[index] as number) : 0;
  const height = index >= 0 ? (frame.heights[index] as number) : 0;
  if (overlay) {
    const ratio = overlayRatio > 0 && overlayRatio < 1 ? overlayRatio : 1;
    out.top = top + height * (1 - ratio);
    out.height = height * ratio;
  } else {
    out.top = top;
    out.height = height;
  }
}

/**
 * Recomputes the pane scales on the UI thread whenever the viewport, the
 * layout, the data or the indicator values change. Ranges are not
 * animated (unlike the price pane). Long visible ranges are answered by
 * the render cache's pyramids (O(log n) per output).
 */
export function usePaneScales(
  state: ChartSharedState,
  items: readonly PaneDrawItem[],
  overlayRatio: number
): SharedValue<PaneScaleFrame> {
  const { series, indicators, barSpacing, rightOffset, plotWidth } = state;
  const { paneLayout, renderCache } = state;
  return useDerivedValue<PaneScaleFrame>(() => {
    const data = series.value;
    const set = indicators.value;
    const layout = paneLayout.value;
    const cache = renderCache.value;
    const scratch = cache.frame;
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      data.length,
      scratch.time
    );
    const range = getVisibleRange(time, 0, scratch.range);
    const view = getViewIndexRange(time, scratch.view);
    const scales: PriceScaleSnapshot[] = [];
    const out = scratch.price;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as PaneDrawItem;
      const rect = { top: 0, height: 0 };
      paneItemRect(layout, item.paneId, item.overlay, overlayRatio, rect);
      out.min = NaN;
      out.max = NaN;
      if (data.length > 0) {
        // Leaves `out` NaN when nothing is drawable.
        cachedPaneRange(
          cache,
          item.scale,
          set,
          data,
          item.refs,
          range.startIndex,
          range.endIndex,
          out,
          view.startIndex,
          view.endIndex
        );
      }
      scales.push({
        mode: 'linear',
        top: rect.top,
        height: rect.height,
        min: out.min,
        max: out.max,
      });
    }
    return { scales };
  });
}
