/**
 * Test perspective table — BucketAligner / zone-aligned Timeframe buckets
 * (real Intl: America/New_York, Asia/Tokyo)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                  |
 * |------|----------------------------------------------------------|--------------------|-------------------------------------------|
 * | TO1  | getBucketStart 1d with +9 h offset                       | Equivalence        | KRX/JST midnight (15:00Z previous day)    |
 * | TO2  | getBucketStart 1w / 1M with +9 h offset                  | Equivalence        | Monday / 1st 00:00 JST                    |
 * | TO3  | offset on a sub-day unit (1h)                            | Equivalence        | ignored (epoch-aligned)                   |
 * | TO4  | offset NaN / ∞                                           | Invalid            | treated as 0                              |
 * | TO5  | getNextBucketStart 1M with offset, Dec → Jan             | Boundary           | next month in the zone                    |
 * | TO6  | offset exactly at the zone's midnight / -1 ms            | Boundary (±1)      | same day / previous day                   |
 * | BA1  | default zone / 'UTC' / sub-day in New York               | Equivalence        | plain UTC / epoch alignment               |
 * | BA2  | 1d New York, spring-forward day                          | Boundary (DST)     | bucket 05:00Z, next 04:00Z (23 h day)     |
 * | BA3  | 1d New York, fall-back day                               | Boundary (DST)     | bucket 04:00Z, next 05:00Z (25 h day)     |
 * | BA4  | 1w / 1M Tokyo                                            | Equivalence        | zone Monday / 1st                         |
 * | BA5  | 1d fixed offset -300                                     | Equivalence        | 05:00Z buckets                            |
 * | BA6  | bucketOf NaN                                             | Invalid            | NaN                                       |
 * | BA7  | unknown IANA zone                                        | Invalid            | UTC alignment                             |
 * | AG1  | aggregator 1d Asia/Tokyo trades around JST midnight      | Equivalence        | two bars at 15:00Z                        |
 * | AG2  | aggregator 1d New York gap fill across DST               | Boundary (DST)     | filled bars at local midnights            |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleStore } from '../CandleStore';
import { createBucketAligner } from '../BucketAligner';
import { RealtimeBarAggregator } from '../RealtimeBarAggregator';
import {
  getBucketStart,
  getNextBucketStart,
  parseTimeframe,
  type TimeframeSpec,
} from '../Timeframe';

const H = 3_600_000;
const JST = 9 * H;
const spec = (tf: string) => parseTimeframe(tf) as TimeframeSpec;

describe('Timeframe with a zone offset', () => {
  it('TO1: daily buckets start at the zone midnight', () => {
    // Given: 2024-01-16 01:00 JST
    const t = Date.UTC(2024, 0, 15, 16);
    // When / Then
    expect(getBucketStart(t, spec('1d'), JST)).toBe(Date.UTC(2024, 0, 15, 15));
    expect(getBucketStart(t, spec('1d'))).toBe(Date.UTC(2024, 0, 15));
  });

  it('TO2: weekly / monthly buckets in the zone', () => {
    // Given: Monday 2024-01-15 01:00 JST = Sunday 16:00Z
    const t = Date.UTC(2024, 0, 14, 16);
    // When / Then
    expect(getBucketStart(t, spec('1w'), JST)).toBe(Date.UTC(2024, 0, 14, 15));
    expect(getBucketStart(t, spec('1M'), JST)).toBe(Date.UTC(2023, 11, 31, 15));
  });

  it('TO3: sub-day units ignore the offset', () => {
    // Given
    const t = Date.UTC(2024, 0, 15, 16, 30);
    // When / Then
    expect(getBucketStart(t, spec('1h'), JST)).toBe(Date.UTC(2024, 0, 15, 16));
    expect(getNextBucketStart(t, spec('1h'), JST)).toBe(t + H);
  });

  it.each([[NaN], [Infinity]])('TO4: offset %p is ignored', (offset) => {
    // Given
    const t = Date.UTC(2024, 0, 15, 16);
    // When / Then
    expect(getBucketStart(t, spec('1d'), offset)).toBe(Date.UTC(2024, 0, 15));
    expect(getNextBucketStart(Date.UTC(2024, 0, 1), spec('1M'), offset)).toBe(
      Date.UTC(2024, 1, 1)
    );
  });

  it('TO5: next monthly bucket across the year end', () => {
    // Given: 2024-12-01 00:00 JST
    const start = Date.UTC(2024, 10, 30, 15);
    // When / Then
    expect(getNextBucketStart(start, spec('1M'), JST)).toBe(
      Date.UTC(2024, 11, 31, 15)
    );
  });

  it('TO6: exact zone midnight and 1 ms before', () => {
    // Given
    const midnight = Date.UTC(2024, 0, 15, 15);
    // When / Then
    expect(getBucketStart(midnight, spec('1d'), JST)).toBe(midnight);
    expect(getBucketStart(midnight - 1, spec('1d'), JST)).toBe(
      midnight - 24 * H
    );
  });
});

describe('createBucketAligner', () => {
  it('BA1: UTC and sub-day timeframes use plain alignment', () => {
    // Given
    const t = Date.UTC(2024, 2, 10, 12, 30);
    // When
    const aligners = [
      createBucketAligner(spec('1d')),
      createBucketAligner(spec('1d'), 'UTC'),
      createBucketAligner(spec('1d'), 'utc'),
    ];
    const hourly = createBucketAligner(spec('1h'), 'America/New_York');
    // Then
    for (const a of aligners) {
      expect(a.bucketOf(t)).toBe(Date.UTC(2024, 2, 10));
      expect(a.nextBucket(Date.UTC(2024, 2, 10))).toBe(Date.UTC(2024, 2, 11));
    }
    expect(hourly.bucketOf(t)).toBe(Date.UTC(2024, 2, 10, 12));
    expect(hourly.nextBucket(Date.UTC(2024, 2, 10, 12))).toBe(
      Date.UTC(2024, 2, 10, 13)
    );
  });

  it('BA2: spring forward (23 h day) in New York', () => {
    // Given
    const a = createBucketAligner(spec('1d'), 'America/New_York');
    // When
    const start = a.bucketOf(Date.UTC(2024, 2, 10, 12));
    // Then
    expect(start).toBe(Date.UTC(2024, 2, 10, 5));
    expect(a.nextBucket(start)).toBe(Date.UTC(2024, 2, 11, 4));
  });

  it('BA3: fall back (25 h day) in New York', () => {
    // Given
    const a = createBucketAligner(spec('1d'), 'America/New_York');
    // When
    const start = a.bucketOf(Date.UTC(2024, 10, 3, 12));
    // Then
    expect(start).toBe(Date.UTC(2024, 10, 3, 4));
    expect(a.nextBucket(start)).toBe(Date.UTC(2024, 10, 4, 5));
  });

  it('BA4: weekly and monthly in Tokyo', () => {
    // Given
    const weekly = createBucketAligner(spec('1w'), 'Asia/Tokyo');
    const monthly = createBucketAligner(spec('1M'), 'Asia/Tokyo');
    const t = Date.UTC(2024, 0, 14, 16);
    // When / Then
    expect(weekly.bucketOf(t)).toBe(Date.UTC(2024, 0, 14, 15));
    expect(weekly.nextBucket(Date.UTC(2024, 0, 14, 15))).toBe(
      Date.UTC(2024, 0, 21, 15)
    );
    expect(monthly.bucketOf(t)).toBe(Date.UTC(2023, 11, 31, 15));
    expect(monthly.nextBucket(Date.UTC(2023, 11, 31, 15))).toBe(
      Date.UTC(2024, 0, 31, 15)
    );
  });

  it('BA5: fixed offset in minutes', () => {
    // Given
    const a = createBucketAligner(spec('1d'), -300);
    // When / Then
    expect(a.bucketOf(Date.UTC(2024, 0, 15, 3))).toBe(Date.UTC(2024, 0, 14, 5));
  });

  it('BA6: non-finite times → NaN', () => {
    // Given
    const a = createBucketAligner(spec('1d'), 'Asia/Tokyo');
    // When / Then
    expect(a.bucketOf(NaN)).toBeNaN();
  });

  it('BA7: an unknown IANA zone aligns like UTC', () => {
    // Given
    const a = createBucketAligner(spec('1d'), 'Atlantis/Capital');
    // When / Then
    expect(a.bucketOf(Date.UTC(2024, 0, 15, 16))).toBe(Date.UTC(2024, 0, 15));
  });
});

describe('RealtimeBarAggregator timeZone', () => {
  it('AG1: daily bars follow Tokyo midnight', () => {
    // Given
    const store = new CandleStore();
    const agg = new RealtimeBarAggregator(store, {
      timeframe: '1d',
      timeZone: 'Asia/Tokyo',
    });
    // When
    agg.addTrade(100, 1, Date.UTC(2024, 0, 15, 14, 59));
    agg.addTrade(101, 1, Date.UTC(2024, 0, 15, 15));
    // Then
    expect(store.length).toBe(2);
    expect(store.get(0)?.time).toBe(Date.UTC(2024, 0, 14, 15));
    expect(store.get(1)?.time).toBe(Date.UTC(2024, 0, 15, 15));
  });

  it('AG2: gap fill across a DST change lands on local midnights', () => {
    // Given
    const store = new CandleStore();
    const agg = new RealtimeBarAggregator(store, {
      timeframe: '1d',
      timeZone: 'America/New_York',
      fillGaps: true,
    });
    agg.addTrade(100, 1, Date.UTC(2024, 2, 9, 12));
    // When
    agg.addTrade(101, 1, Date.UTC(2024, 2, 12, 12));
    // Then
    const times = Array.from(
      { length: store.length },
      (_, i) => store.get(i)?.time
    );
    expect(times).toEqual([
      Date.UTC(2024, 2, 9, 5),
      Date.UTC(2024, 2, 10, 5),
      Date.UTC(2024, 2, 11, 4),
      Date.UTC(2024, 2, 12, 4),
    ]);
  });
});
