/**
 * Test perspective table — ZoneTable (IANA zones via Intl)
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                   |
 * |------|--------------------------------------------------------|--------------------|--------------------------------------------|
 * | ZP1  | real Intl, 'America/New_York' winter / summer          | Equivalence        | -5 h / -4 h                                |
 * | ZP2  | intl without DateTimeFormat                            | External dep. fail | null                                       |
 * | ZP3  | invalid zone name (constructor throws) / ''            | Invalid            | null                                       |
 * | ZP4  | formatter without formatToParts                        | External dep. fail | null                                       |
 * | ZP5  | formatToParts throws / returns garbage (NaN)           | External dep. fail | null                                       |
 * | ZP6  | fake Intl reporting hour "24"                          | Boundary           | treated as 00                              |
 * | ZB1  | constant probe                                         | Equivalence        | single entry, times[0] = -∞                |
 * | ZB2  | probe with one transition                              | Equivalence        | transition bisected to the exact minute    |
 * | ZB3  | probe NaN at the start / in the middle                 | Invalid (dep.)     | start 0 / NaN samples skipped              |
 * | ZB4  | step below one minute                                  | Boundary (min)     | clamped to one minute                      |
 * | ZB5  | from == to                                             | Boundary (empty)   | single entry                               |
 * | ZL1  | zoneTableOffset before / at / after a transition       | Boundary (±1)      | old / new / new                            |
 * | ZL2  | zoneTableWindowEnd inside / after the last transition  | Equivalence        | next transition / ∞                        |
 * | ZC1  | getZoneTable caches (same object), null cached too     | Equivalence        | identity / null                            |
 * | ZC2  | isSupportedTimeZone valid / invalid                    | Equivalence        | true / false                               |
 * | ZC3  | clearZoneTableCache                                    | Equivalence        | new table object                           |
 */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  buildZoneTable,
  clearZoneTableCache,
  getZoneTable,
  intlOffsetProbe,
  isSupportedTimeZone,
  zoneTableOffset,
  zoneTableWindowEnd,
} from '../ZoneTable';

const JAN = Date.UTC(2024, 0, 15);
const JUL = Date.UTC(2024, 6, 15);
/** 2024-03-10 07:00Z: New York switches to EDT. */
const NY_DST = Date.UTC(2024, 2, 10, 7);

type Parts = { type: string; value: string }[];

function fakeIntl(parts: (d: Date) => Parts) {
  return {
    DateTimeFormat: class {
      formatToParts(date: Date) {
        return parts(date);
      }
    },
  };
}

beforeEach(() => {
  clearZoneTableCache();
});

describe('intlOffsetProbe', () => {
  it('ZP1: resolves New York standard and daylight time', () => {
    // Given
    const probe = intlOffsetProbe('America/New_York');
    // When / Then
    expect(probe).not.toBeNull();
    expect(probe?.(JAN)).toBe(-5 * MS_PER_HOUR);
    expect(probe?.(JUL)).toBe(-4 * MS_PER_HOUR);
  });

  it.each([[{}], [{ DateTimeFormat: undefined }]])(
    'ZP2: intl %p → null',
    (intl) => {
      // Given / When / Then
      expect(intlOffsetProbe('Europe/Paris', intl)).toBeNull();
    }
  );

  it.each([['Mars/Olympus'], ['']])('ZP3: zone %p → null', (zone) => {
    // Given / When / Then
    expect(intlOffsetProbe(zone)).toBeNull();
  });

  it('ZP4: no formatToParts → null', () => {
    // Given
    const intl = { DateTimeFormat: class {} };
    // When / Then
    expect(intlOffsetProbe('Europe/Paris', intl)).toBeNull();
  });

  it.each<[string, () => Parts]>([
    [
      'throws',
      () => {
        throw new RangeError('no data');
      },
    ],
    ['garbage', () => [{ type: 'year', value: 'x' }]],
  ])('ZP5: formatToParts %s → null', (_name, parts) => {
    // Given / When / Then
    expect(intlOffsetProbe('Europe/Paris', fakeIntl(parts))).toBeNull();
  });

  it('ZP6: hour "24" is midnight', () => {
    // Given: a runtime printing midnight as 24:00 of the same day
    const intl = fakeIntl(() => [
      { type: 'year', value: '1970' },
      { type: 'month', value: '1' },
      { type: 'day', value: '1' },
      { type: 'hour', value: '24' },
      { type: 'minute', value: '0' },
      { type: 'second', value: '0' },
    ]);
    // When
    const probe = intlOffsetProbe('Etc/Test', intl);
    // Then
    expect(probe?.(0)).toBe(0);
  });
});

describe('buildZoneTable', () => {
  const step = (at: number, before: number, after: number) => (t: number) =>
    t < at ? before : after;

  it('ZB1: a constant zone has one entry', () => {
    // Given / When
    const table = buildZoneTable(() => 3_600_000, 0, 100 * MS_PER_HOUR * 24);
    // Then
    expect(Array.from(table.times)).toEqual([-Infinity]);
    expect(Array.from(table.offsets)).toEqual([3_600_000]);
  });

  it('ZB2: bisects a transition to the minute', () => {
    // Given
    const at = NY_DST + 17 * MS_PER_MINUTE;
    // When
    const table = buildZoneTable(step(at, 1, 2), JAN, JUL);
    // Then
    expect(Array.from(table.times)).toEqual([-Infinity, at]);
    expect(Array.from(table.offsets)).toEqual([1, 2]);
  });

  it('ZB3: NaN samples are skipped, a NaN start becomes 0', () => {
    // Given
    const probe = (t: number) =>
      t === JAN || t > JUL - 10 * 86_400_000 ? NaN : 7;
    // When
    const table = buildZoneTable(probe, JAN, JUL);
    // Then
    expect(Array.from(table.offsets)).toEqual([0, 7]);
    expect(table.times.length).toBe(2);
  });

  it('ZB4: a sub-minute step is clamped to one minute', () => {
    // Given
    let calls = 0;
    const probe = () => {
      calls++;
      return 0;
    };
    // When
    buildZoneTable(probe, 0, 10 * MS_PER_MINUTE, 1);
    // Then: 1 initial probe + 10 minute samples
    expect(calls).toBe(11);
  });

  it('ZB5: an empty range has one entry', () => {
    // Given / When
    const table = buildZoneTable(step(0, 1, 2), JAN, JAN);
    // Then
    expect(table.times.length).toBe(1);
  });
});

describe('table lookup', () => {
  const table = buildZoneTable((t) => (t < NY_DST ? 1 : 2), JAN, JUL);

  it.each([
    [NY_DST - 1, 1],
    [NY_DST, 2],
    [JUL * 2, 2],
    [-Infinity, 1],
  ])('ZL1: offset at %p → %p', (t, expected) => {
    // Given / When / Then
    expect(zoneTableOffset(table, t)).toBe(expected);
  });

  it('ZL2: window end is the next transition, ∞ after the last', () => {
    // Given / When / Then
    expect(zoneTableWindowEnd(table, JAN)).toBe(NY_DST);
    expect(zoneTableWindowEnd(table, NY_DST)).toBe(Infinity);
  });
});

describe('zone cache', () => {
  it('ZC1: caches tables and failures', () => {
    // Given / When
    const a = getZoneTable('Asia/Tokyo', JUL);
    const b = getZoneTable('Asia/Tokyo');
    // Then
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(getZoneTable('Nope/Nope')).toBeNull();
    expect(getZoneTable('Nope/Nope')).toBeNull();
    expect(a && zoneTableOffset(a, JUL)).toBe(9 * MS_PER_HOUR);
  });

  it('ZC2: isSupportedTimeZone', () => {
    // Given / When / Then
    expect(isSupportedTimeZone('Europe/London')).toBe(true);
    expect(isSupportedTimeZone('Europe/Atlantis')).toBe(false);
  });

  it('ZC3: clearing rebuilds the table', () => {
    // Given
    const a = getZoneTable('Asia/Tokyo', JUL);
    // When
    clearZoneTableCache();
    // Then
    expect(getZoneTable('Asia/Tokyo', JUL)).not.toBe(a);
  });
});
