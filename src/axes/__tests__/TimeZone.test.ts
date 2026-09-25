/**
 * Test perspective table — TimeZone
 *
 * | Case | Input / Precondition                                  | Perspective        | Expected                                  |
 * |------|-------------------------------------------------------|--------------------|-------------------------------------------|
 * | TZ1  | fixedOffsetMs 'utc' / 540 / -300 / 90.4               | Equivalence        | 0 / 9 h / -5 h / 90 min                   |
 * | TZ2  | fixedOffsetMs 'local'                                 | Equivalence        | NaN                                       |
 * | TZ3  | fixedOffsetMs 841 / -841 / ±840                       | Boundary (±1)      | clamped to ±14 h / kept                   |
 * | TZ4  | fixedOffsetMs NaN / ∞ / non-number                    | Invalid            | 0 (UTC)                                   |
 * | TZ5  | resolver for fixed zone                               | Equivalence        | never probes                              |
 * | TZ6  | local resolver, constant probe, ascending lookups     | Equivalence        | 2 probes per 7-day window (cached)        |
 * | TZ7  | local resolver, transition inside the window          | Equivalence        | exact 1 ms boundary: before / at          |
 * | TZ8  | non-finite t                                          | Invalid            | cached offset, no probe                   |
 * | TZ9  | probe returns NaN                                     | Invalid (dep.)     | offset 0                                  |
 * | TZ10 | lookup before the cached window                       | Boundary           | re-probes                                 |
 * | TZ11 | deviceOffsetMs                                        | Equivalence        | -getTimezoneOffset in ms                  |
 */
import { describe, expect, it, jest } from '@jest/globals';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from '../CivilTime';
import {
  createOffsetResolver,
  deviceOffsetMs,
  fixedOffsetMs,
  MAX_UTC_OFFSET_MINUTES,
  offsetAt,
  OFFSET_PROBE_WINDOW_MS,
  type ChartTimeZone,
} from '../TimeZone';

describe('fixedOffsetMs', () => {
  it.each<[ChartTimeZone, number]>([
    ['utc', 0],
    [540, 9 * MS_PER_HOUR],
    [-300, -5 * MS_PER_HOUR],
    [90.4, 90 * MS_PER_MINUTE],
  ])('TZ1: %p → %p', (zone, expected) => {
    // Given / When / Then
    expect(fixedOffsetMs(zone)).toBe(expected);
  });

  it('TZ2: local → NaN', () => {
    // Given / When / Then
    expect(fixedOffsetMs('local')).toBeNaN();
  });

  it.each([
    [841, MAX_UTC_OFFSET_MINUTES],
    [840, MAX_UTC_OFFSET_MINUTES],
    [-840, -MAX_UTC_OFFSET_MINUTES],
    [-841, -MAX_UTC_OFFSET_MINUTES],
  ])('TZ3: %p min → clamped %p min', (zone, minutes) => {
    // Given / When / Then
    expect(fixedOffsetMs(zone)).toBe(minutes * MS_PER_MINUTE);
  });

  it.each([[NaN], [Infinity], ['Europe/Paris' as unknown as number]])(
    'TZ4: %p → UTC',
    (zone) => {
      // Given / When / Then
      expect(fixedOffsetMs(zone)).toBe(0);
    }
  );
});

describe('offsetAt', () => {
  it('TZ5: fixed zones never probe', () => {
    // Given
    const resolver = createOffsetResolver(60);
    const probe = jest.fn((_t: number) => 0);
    // When
    const offset = offsetAt(resolver, 1e12, probe);
    // Then
    expect(offset).toBe(MS_PER_HOUR);
    expect(probe).not.toHaveBeenCalled();
    expect(resolver.local).toBe(false);
  });

  it('TZ6: caches a constant offset for the probe window', () => {
    // Given
    const resolver = createOffsetResolver('local');
    const probe = jest.fn((_t: number) => 2 * MS_PER_HOUR);
    // When: 14 days of hourly bars
    for (let t = 0; t < 14 * MS_PER_DAY; t += MS_PER_HOUR) {
      expect(offsetAt(resolver, t, probe)).toBe(2 * MS_PER_HOUR);
    }
    // Then: one window per week
    expect(resolver.probes).toBe(4);
    expect(resolver.local).toBe(true);
  });

  it('TZ7: finds a transition to the millisecond', () => {
    // Given: offset changes from +1 h to +2 h at T
    const T = 3 * MS_PER_DAY + 12_345;
    const probe = (t: number) => (t < T ? MS_PER_HOUR : 2 * MS_PER_HOUR);
    const resolver = createOffsetResolver('local');
    // When
    const before = offsetAt(resolver, T - 1, probe);
    const validTo = resolver.validTo;
    const at = offsetAt(resolver, T, probe);
    // Then
    expect(before).toBe(MS_PER_HOUR);
    expect(validTo).toBe(T);
    expect(at).toBe(2 * MS_PER_HOUR);
  });

  it('TZ7: finds a transition in the middle of the window', () => {
    // Given: transition 3 days after the lookup
    const T = 3 * MS_PER_DAY + 777;
    const probe = (t: number) => (t < T ? 0 : MS_PER_HOUR);
    const resolver = createOffsetResolver('local');
    // When
    const first = offsetAt(resolver, 0, probe);
    // Then
    expect(first).toBe(0);
    expect(resolver.validTo).toBe(T);
    expect(offsetAt(resolver, T - 1, probe)).toBe(0);
    expect(offsetAt(resolver, T, probe)).toBe(MS_PER_HOUR);
  });

  it.each([[NaN], [Infinity]])('TZ8: t %p → cached, no probe', (t) => {
    // Given
    const resolver = createOffsetResolver('local');
    const probe = jest.fn((_t: number) => MS_PER_HOUR);
    // When
    const offset = offsetAt(resolver, t, probe);
    // Then
    expect(offset).toBe(0);
    expect(probe).not.toHaveBeenCalled();
  });

  it('TZ9: a NaN probe result falls back to UTC', () => {
    // Given
    const resolver = createOffsetResolver('local');
    // When / Then
    expect(offsetAt(resolver, 0, () => NaN)).toBe(0);
  });

  it('TZ10: re-probes before the cached window', () => {
    // Given
    const resolver = createOffsetResolver('local');
    const probe = jest.fn((_t: number) => 0);
    offsetAt(resolver, OFFSET_PROBE_WINDOW_MS, probe);
    // When
    offsetAt(resolver, 0, probe);
    // Then
    expect(resolver.probes).toBe(4);
  });

  it('TZ11: device offset is the inverted getTimezoneOffset', () => {
    // Given
    const t = Date.UTC(2024, 5, 1);
    // When / Then
    expect(deviceOffsetMs(t)).toBe(
      -new Date(t).getTimezoneOffset() * MS_PER_MINUTE
    );
    expect(offsetAt(createOffsetResolver('local'), t)).toBe(deviceOffsetMs(t));
  });
});
