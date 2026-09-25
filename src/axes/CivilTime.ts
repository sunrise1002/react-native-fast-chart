/**
 * Calendar math without `Date` objects (worklet-compatible, allocation-
 * free): days since the Unix epoch ↔ proleptic Gregorian civil dates
 * (Howard Hinnant's `civil_from_days` / `days_from_civil` algorithms).
 */

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export interface CivilDate {
  year: number;
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
}

export function createCivilDate(): CivilDate {
  return { year: 1970, month: 1, day: 1 };
}

/** Writes the civil date of `days` (days since 1970-01-01) into `out`. */
export function civilFromDays(days: number, out: CivilDate): CivilDate {
  'worklet';
  const z = Math.floor(days) + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe -
      Math.floor(doe / 1460) +
      Math.floor(doe / 36524) -
      Math.floor(doe / 146096)) /
      365
  ); // [0, 399]
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11], March-based
  out.day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  out.month = mp < 10 ? mp + 3 : mp - 9;
  out.year = yoe + era * 400 + (out.month <= 2 ? 1 : 0);
  return out;
}

/** Days since 1970-01-01 of a civil date (month 1–12). */
export function daysFromCivil(
  year: number,
  month: number,
  day: number
): number {
  'worklet';
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Whole days since the epoch of a (local) timestamp in ms. */
export function daysOf(localMs: number): number {
  'worklet';
  return Math.floor(localMs / MS_PER_DAY);
}

/** Milliseconds since local midnight, `[0, MS_PER_DAY)`. */
export function msOfDay(localMs: number): number {
  'worklet';
  const r = localMs % MS_PER_DAY;
  return r < 0 ? r + MS_PER_DAY : r;
}
