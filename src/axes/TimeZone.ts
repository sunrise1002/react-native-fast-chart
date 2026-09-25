import { MS_PER_DAY, MS_PER_MINUTE } from './CivilTime';

/**
 * Chart time zone (spec Phase 19.3; the full policy lands in P9):
 * - `'local'` — the device zone, DST-aware (default);
 * - `'utc'`;
 * - a number — fixed UTC offset in minutes east of UTC (`+540` = UTC+9).
 */
export type ChartTimeZone = 'local' | 'utc' | number;

/** Largest valid fixed offset (UTC−14:00 … UTC+14:00). */
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;

/**
 * DST transitions are months apart, so an offset probed at both ends of a
 * window this long is assumed constant inside it.
 */
export const OFFSET_PROBE_WINDOW_MS = 7 * MS_PER_DAY;

/**
 * Mutable, per-chart offset cache. `offsetMs` is valid for UTC instants in
 * `[validFrom, validTo)`; fixed zones are valid everywhere.
 */
export interface OffsetResolver {
  local: boolean;
  offsetMs: number;
  validFrom: number;
  validTo: number;
  /** Offset probes performed (diagnostics / tests). */
  probes: number;
}

/** Device-zone offset (ms to add to UTC) at instant `t`. */
export function deviceOffsetMs(t: number): number {
  'worklet';
  return -new Date(t).getTimezoneOffset() * MS_PER_MINUTE;
}

/**
 * Fixed offset in ms for a zone setting, `NaN` for `'local'`. Invalid
 * numbers fall back to UTC; out-of-range offsets are clamped.
 */
export function fixedOffsetMs(zone: ChartTimeZone): number {
  'worklet';
  if (zone === 'local') {
    return NaN;
  }
  if (typeof zone !== 'number' || !Number.isFinite(zone)) {
    return 0;
  }
  const clamped =
    zone > MAX_UTC_OFFSET_MINUTES
      ? MAX_UTC_OFFSET_MINUTES
      : zone < -MAX_UTC_OFFSET_MINUTES
        ? -MAX_UTC_OFFSET_MINUTES
        : zone;
  return Math.round(clamped) * MS_PER_MINUTE;
}

export function createOffsetResolver(zone: ChartTimeZone): OffsetResolver {
  'worklet';
  const fixed = fixedOffsetMs(zone);
  const local = Number.isNaN(fixed);
  return {
    local,
    offsetMs: local ? 0 : fixed,
    validFrom: local ? 0 : -Infinity,
    validTo: local ? 0 : Infinity,
    probes: 0,
  };
}

/**
 * Offset (ms to add to UTC) at instant `t`. Local zones probe the device
 * offset at `t` and `t + OFFSET_PROBE_WINDOW_MS`; when they differ, a binary
 * search (1 ms precision, ~30 probes) finds the exact transition. Consecutive lookups over
 * ascending bars therefore cost ~1 probe per week of data. Non-finite `t`
 * returns the cached offset. `probe` is injectable for tests.
 */
export function offsetAt(
  resolver: OffsetResolver,
  t: number,
  probe: (t: number) => number = deviceOffsetMs
): number {
  'worklet';
  if (
    (t >= resolver.validFrom && t < resolver.validTo) ||
    !Number.isFinite(t)
  ) {
    return resolver.offsetMs;
  }
  const at = probe(t);
  const end = t + OFFSET_PROBE_WINDOW_MS;
  const atEnd = probe(end);
  resolver.probes += 2;
  let validTo = end;
  if (atEnd !== at) {
    // Transition in (t, end]: first instant where the offset changes.
    let lo = t;
    let hi = end;
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      resolver.probes++;
      if (probe(mid) === at) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    validTo = hi;
  }
  const offset = Number.isFinite(at) ? at : 0;
  resolver.offsetMs = offset;
  resolver.validFrom = t;
  resolver.validTo = validTo;
  return offset;
}
