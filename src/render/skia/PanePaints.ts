import type { SkPaint } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import type { HistogramColorMode } from '../../indicators/Indicator';
import type { IndicatorScaleSpec } from '../../indicators/IndicatorRegistry';
import type { UiOutputRef } from '../../indicators/UiIndicatorSet';
import type { PaneRenderSpec, PaneValueFormat } from '../panes/PaneRenderSpec';
import {
  colorPaint,
  createIndicatorDrawList,
  type IndicatorDrawList,
} from './IndicatorPaints';

/** A histogram with one paint per color bucket. */
export interface PaneHistogramItem {
  id: string;
  output: number;
  mode: HistogramColorMode;
  paints: SkPaint[];
}

/** Paint-resolved `PaneRenderSpec`, captured by the pane mappers. */
export interface PaneDrawItem {
  paneId: string;
  overlay: boolean;
  scale: IndicatorScaleSpec;
  format: PaneValueFormat;
  /** Strokes, band fills and legend rows. */
  list: IndicatorDrawList;
  histograms: PaneHistogramItem[];
  guideLevels: number[];
  guideBand: { upper: number; lower: number } | null;
  refs: UiOutputRef[];
}

/** Creates the pane paints once per spec change (JS thread). */
export function createPaneDrawList(
  specs: readonly PaneRenderSpec[]
): PaneDrawItem[] {
  return specs.map((spec) => ({
    paneId: spec.paneId,
    overlay: spec.overlay,
    scale: spec.scale,
    format: spec.format,
    list: createIndicatorDrawList(spec.indicators, spec.format),
    histograms: spec.indicators.flatMap((indicator) =>
      indicator.histograms.map((h) => ({
        id: indicator.id,
        output: h.output,
        mode: h.mode,
        paints: h.colors.map((color) => colorPaint(color, h.opacity)),
      }))
    ),
    guideLevels: spec.guides.levels,
    guideBand: spec.guides.band,
    refs: spec.refs,
  }));
}

export function usePaneDrawList(
  specs: readonly PaneRenderSpec[]
): PaneDrawItem[] {
  return useMemo(() => createPaneDrawList(specs), [specs]);
}
