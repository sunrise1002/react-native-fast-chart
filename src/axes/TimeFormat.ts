import {
  civilFromDays,
  createCivilDate,
  daysOf,
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  MS_PER_SECOND,
  msOfDay,
} from './CivilTime';

/**
 * Time label formatting (Phase 5.3 / 6.4). Locale-neutral (English month
 * names, 24 h clock), worklet-compatible, no `Date` objects. Inputs are
 * *local* timestamps (UTC ms + zone offset); non-finite input → `''`.
 */

/** Tick importance, highest wins collisions and picks the label format. */
export const TICK_WEIGHT_TIME = 1;
export const TICK_WEIGHT_DAY = 2;
export const TICK_WEIGHT_MONTH = 3;
export const TICK_WEIGHT_YEAR = 4;

export const MONTH_NAMES: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function pad2(value: number): string {
  'worklet';
  return value < 10 ? '0' + value : '' + value;
}

/** `"HH:mm"` or `"HH:mm:ss"` of a local timestamp. */
export function formatClock(localMs: number, withSeconds: boolean): string {
  'worklet';
  if (!Number.isFinite(localMs)) {
    return '';
  }
  const ms = msOfDay(localMs);
  const text =
    pad2(Math.floor(ms / MS_PER_HOUR)) +
    ':' +
    pad2(Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE));
  return withSeconds
    ? text + ':' + pad2(Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND))
    : text;
}

/**
 * Axis label for a tick of `weight` (TradingView style): year → `"2024"`,
 * month → `"Mar"`, day → `"15"`, otherwise the clock (`"14:30"`).
 */
export function formatTimeTick(
  localMs: number,
  weight: number,
  withSeconds: boolean
): string {
  'worklet';
  if (!Number.isFinite(localMs)) {
    return '';
  }
  if (weight <= TICK_WEIGHT_TIME) {
    return formatClock(localMs, withSeconds);
  }
  const date = civilFromDays(daysOf(localMs), createCivilDate());
  if (weight >= TICK_WEIGHT_YEAR) {
    return '' + date.year;
  }
  if (weight === TICK_WEIGHT_MONTH) {
    return MONTH_NAMES[date.month - 1] as string;
  }
  return '' + date.day;
}

/**
 * Full timestamp for the crosshair time label: `"2024-03-15"` for daily
 * and longer bars, `"2024-03-15 14:30"` intraday, with seconds for
 * sub-minute bars.
 */
export function formatDateTime(localMs: number, barMs: number): string {
  'worklet';
  if (!Number.isFinite(localMs)) {
    return '';
  }
  const date = civilFromDays(daysOf(localMs), createCivilDate());
  const day = date.year + '-' + pad2(date.month) + '-' + pad2(date.day);
  if (barMs >= MS_PER_DAY) {
    return day;
  }
  return day + ' ' + formatClock(localMs, barMs > 0 && barMs < MS_PER_MINUTE);
}
