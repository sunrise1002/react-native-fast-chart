import { MS_PER_DAY, MS_PER_MINUTE } from '../../axes/CivilTime';
import { measureText } from '../../axes/TextMetrics';
import { formatTimeTick } from '../../axes/TimeFormat';
import {
  generateTimeTicks,
  selectTimeInterval,
  type TimeTicks,
} from '../../axes/TimeTicks';
import { createOffsetResolver, type ChartTimeZone } from '../../axes/TimeZone';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import type { TimeScaleState } from '../../viewport/TimeScale';
import { getVisibleRange } from '../../viewport/VisibleRange';
import type { ChartFont } from './SkiaResources';

/** Extra room between time labels, in font sizes. */
export const TIME_LABEL_GAP_EM = 1.5;

/** Minimum spacing between time labels for the widest possible label. */
export function timeLabelSpacing(
  font: ChartFont,
  withSeconds: boolean
): number {
  const samples = [withSeconds ? '00:00:00' : '00:00', '0000', 'May', '00'];
  let widest = 0;
  for (const text of samples) {
    widest = Math.max(widest, measureText(font.glyphs, text));
  }
  return widest + font.size * TIME_LABEL_GAP_EM;
}

/**
 * Fills `out` with the time-axis ticks of the visible bars (daily+ bars
 * use their UTC calendar date). Returns `true` when labels need seconds.
 * Worklet.
 */
export function computeTimeTicks(
  data: UiCandleSeries,
  time: TimeScaleState,
  barMs: number,
  spacing: { clock: number; seconds: number },
  timeZone: ChartTimeZone,
  out: TimeTicks
): boolean {
  'worklet';
  const withSeconds = barMs < MS_PER_MINUTE;
  const minSpacing = withSeconds ? spacing.seconds : spacing.clock;
  const k = selectTimeInterval(barMs, time.barSpacing, minSpacing);
  if (k >= 0) {
    const minBars = minSpacing / time.barSpacing;
    const range = getVisibleRange(time, Math.ceil(minBars) + 1);
    generateTimeTicks(
      data,
      range.startIndex,
      range.endIndex,
      k,
      createOffsetResolver(barMs >= MS_PER_DAY ? 'utc' : timeZone),
      minBars,
      out
    );
  }
  return withSeconds;
}

/** Label texts of `ticks`. Worklet. */
export function timeTickLabels(
  ticks: TimeTicks,
  withSeconds: boolean
): string[] {
  'worklet';
  const labels: string[] = [];
  for (let i = 0; i < ticks.count; i++) {
    labels.push(
      formatTimeTick(
        ticks.payload[i] as number,
        ticks.weights[i] as number,
        withSeconds
      )
    );
  }
  return labels;
}
