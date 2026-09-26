import { MS_PER_DAY, MS_PER_MINUTE } from './CivilTime';

/**
 * IANA time zones (spec Phase 19.3). `Intl` is only used on the JS thread
 * to precompute a transition table; UI-thread lookups are a binary search
 * over two typed arrays (see `offsetAt`).
 *
 * Hermes caveats: `Intl.DateTimeFormat` with a `timeZone` option and
 * `formatToParts` are available on Hermes (RN ≥ 0.70, both platforms),
 * but may be missing on custom builds without Intl or return partial data
 * for rare zones. When the zone can't be resolved the chart falls back to
 * UTC (`isSupportedTimeZone` lets hosts check up front).
 */
export interface ZoneTable {
  /** UTC instants from which `offsets[i]` applies; `times[0] = -∞`. */
  times: Float64Array;
  /** Offsets, ms to add to UTC. */
  offsets: Float64Array;
}

/** Offset (ms to add to UTC) of a zone at an instant; `NaN` = unknown. */
export type OffsetProbe = (t: number) => number;

/** Sampling step when scanning for transitions (DST changes are months apart). */
export const ZONE_SCAN_STEP_MS = 14 * MS_PER_DAY;

/** First instant of the precomputed range (1990-01-01T00:00Z). */
export const ZONE_TABLE_START_MS = Date.UTC(1990, 0, 1);

/** The range extends this far past "now". */
export const ZONE_TABLE_LOOKAHEAD_MS = 400 * MS_PER_DAY;

interface IntlLike {
  DateTimeFormat?: new (
    locale: string,
    options: Record<string, unknown>
  ) => {
    formatToParts?: (date: Date) => { type: string; value: string }[];
  };
}

/**
 * Offset probe backed by `Intl.DateTimeFormat`, or `null` when `Intl` /
 * `formatToParts` is unavailable or the zone name is invalid.
 */
export function intlOffsetProbe(
  zone: string,
  intl: IntlLike | undefined = (globalThis as { Intl?: IntlLike }).Intl
): OffsetProbe | null {
  const Format = intl?.DateTimeFormat;
  if (Format === undefined || typeof zone !== 'string' || zone === '') {
    return null;
  }
  let format: InstanceType<typeof Format>;
  try {
    format = new Format('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
  const formatToParts = format.formatToParts?.bind(format);
  if (formatToParts === undefined) {
    return null;
  }
  const probe = (t: number): number => {
    const fields: Record<string, number> = {};
    for (const part of formatToParts(new Date(t))) {
      fields[part.type] = Number(part.value);
    }
    const { year, month, day, hour, minute, second } = fields;
    const wall = Date.UTC(
      year as number,
      (month as number) - 1,
      day as number,
      hour === 24 ? 0 : (hour as number),
      minute as number,
      second as number
    );
    return wall - Math.floor(t / 1000) * 1000;
  };
  try {
    return Number.isFinite(probe(0)) ? probe : null;
  } catch {
    return null;
  }
}

/**
 * Scans `[fromMs, toMs]` every `stepMs` and bisects each offset change to
 * the minute. Unknown (`NaN`) samples keep the previous offset. The first
 * offset also applies before `fromMs`, the last one after `toMs`.
 */
export function buildZoneTable(
  probe: OffsetProbe,
  fromMs: number,
  toMs: number,
  stepMs = ZONE_SCAN_STEP_MS
): ZoneTable {
  const times: number[] = [-Infinity];
  const first = probe(fromMs);
  const offsets: number[] = [Number.isFinite(first) ? first : 0];
  const step = stepMs >= MS_PER_MINUTE ? stepMs : MS_PER_MINUTE;
  let current = offsets[0] as number;
  for (let t = fromMs; t < toMs; t += step) {
    const next = Math.min(t + step, toMs);
    const offset = probe(next);
    if (!Number.isFinite(offset) || offset === current) {
      continue;
    }
    // First minute in (t, next] with the new offset.
    let lo = Math.floor(t / MS_PER_MINUTE);
    let hi = Math.ceil(next / MS_PER_MINUTE);
    while (hi - lo > 1) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (probe(mid * MS_PER_MINUTE) === current) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    times.push(hi * MS_PER_MINUTE);
    offsets.push(offset);
    current = offset;
  }
  return {
    times: Float64Array.from(times),
    offsets: Float64Array.from(offsets),
  };
}

/** Offset at `t` from a table (binary search). Worklet. */
export function zoneTableOffset(table: ZoneTable, t: number): number {
  'worklet';
  const times = table.times;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if ((times[mid] as number) <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return table.offsets[lo] as number;
}

/** UTC end of the transition window containing `t` (`∞` after the last). */
export function zoneTableWindowEnd(table: ZoneTable, t: number): number {
  'worklet';
  const times = table.times;
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((times[mid] as number) <= t) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo < times.length ? (times[lo] as number) : Infinity;
}

const tableCache = new Map<string, ZoneTable | null>();

/**
 * Cached transition table of an IANA zone for 1990 … now + ~13 months,
 * or `null` when the zone can't be resolved (see `intlOffsetProbe`).
 * Built once per zone name (a few thousand `Intl` calls).
 */
export function getZoneTable(zone: string, now = Date.now()): ZoneTable | null {
  const cached = tableCache.get(zone);
  if (cached !== undefined) {
    return cached;
  }
  const probe = intlOffsetProbe(zone);
  const table =
    probe === null
      ? null
      : buildZoneTable(
          probe,
          ZONE_TABLE_START_MS,
          now + ZONE_TABLE_LOOKAHEAD_MS
        );
  tableCache.set(zone, table);
  return table;
}

/** `true` when `zone` is an IANA name the runtime's `Intl` resolves. */
export function isSupportedTimeZone(zone: string): boolean {
  return getZoneTable(zone) !== null;
}

/** Drops cached tables (tests / long-running apps crossing the lookahead). */
export function clearZoneTableCache(): void {
  tableCache.clear();
}
