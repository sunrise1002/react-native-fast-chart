import type { GlyphWidthTable } from '../../axes/TextMetrics';
import { measureText } from '../../axes/TextMetrics';
import type { TimeTicks } from '../../axes/TimeTicks';
import { indexToX, type TimeScaleState } from '../../viewport/TimeScale';
import {
  centeredBaseline,
  type TextBoxMetrics,
  type TextSink,
} from '../RenderModel';

/**
 * Time axis label layout (Phase 5.4): each tick label is centered under
 * its bar; labels that would be clipped by the plot edges are skipped
 * (they reappear whole as the user pans). Overlaps were already removed by
 * `generateTimeTicks`' spacing pass. Pure, worklet-compatible.
 */

export const TIME_LABEL_STYLE = 1;

export interface TimeAxisLayout {
  /** Top of the time axis gutter and its height, dp. */
  top: number;
  height: number;
  metrics: TextBoxMetrics;
  glyphs: GlyphWidthTable;
}

/** Emits `labels[i]` for tick `i`; returns the number emitted. */
export function layoutTimeAxisLabels(
  ticks: TimeTicks,
  labels: readonly string[],
  time: TimeScaleState,
  layout: TimeAxisLayout,
  sink: TextSink
): number {
  'worklet';
  const baseline = centeredBaseline(
    layout.top + layout.height / 2,
    layout.metrics
  );
  let emitted = 0;
  for (let i = 0; i < ticks.count; i++) {
    const text = labels[i];
    const x = indexToX(time, ticks.positions[i] as number);
    if (text === undefined || text === '' || !Number.isFinite(x)) {
      continue;
    }
    const width = measureText(layout.glyphs, text);
    const left = x - width / 2;
    if (left < 0 || left + width > time.width) {
      continue;
    }
    sink.text(text, left, baseline, TIME_LABEL_STYLE);
    emitted++;
  }
  return emitted;
}
