import { MS_PER_DAY, MS_PER_MINUTE } from '../../axes/CivilTime';
import { measureText } from '../../axes/TextMetrics';
import {
  generateTimeTicks,
  selectTimeInterval,
  type TimeTicks,
} from '../../axes/TimeTicks';
import type { OffsetResolver } from '../../axes/TimeZone';
import type { UiCandleSeries } from '../../data/UiCandleSeries';
import type { TimeScaleState } from '../../viewport/TimeScale';
import {
  getVisibleRange,
  type VisibleRange,
} from '../../viewport/VisibleRange';
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
 * Reused per-layer state of the time-axis pass: offset resolvers of the
 * chart zone and of UTC (daily+ bars are calendar days) keep their
 * validity windows across frames, and the visible-range scratch.
 */
export interface TimeAxisScratch {
  zone: OffsetResolver;
  utc: OffsetResolver;
  range: VisibleRange;
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
  scratch: TimeAxisScratch,
  out: TimeTicks
): boolean {
  'worklet';
  out.count = 0;
  const withSeconds = barMs < MS_PER_MINUTE;
  const minSpacing = withSeconds ? spacing.seconds : spacing.clock;
  const k = selectTimeInterval(barMs, time.barSpacing, minSpacing);
  if (k >= 0) {
    const minBars = minSpacing / time.barSpacing;
    const range = getVisibleRange(time, Math.ceil(minBars) + 1, scratch.range);
    generateTimeTicks(
      data,
      range.startIndex,
      range.endIndex,
      k,
      barMs >= MS_PER_DAY ? scratch.utc : scratch.zone,
      minBars,
      out
    );
  }
  return withSeconds;
}
