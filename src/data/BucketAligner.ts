import {
  createOffsetResolver,
  offsetAt,
  type ChartTimeZone,
  type OffsetResolver,
} from '../axes/TimeZone';
import {
  getBucketStart,
  getNextBucketStart,
  isCalendarUnit,
  type TimeframeSpec,
} from './Timeframe';

const HALF_DAY_MS = 43_200_000;

/** Bucket alignment of one timeframe in one zone. */
export interface BucketAligner {
  /** Open time of the bucket containing `time` (`NaN` for non-finite). */
  bucketOf(time: number): number;
  /** Open time of the bucket after the one starting at `start`. */
  nextBucket(start: number): number;
}

/**
 * Aligns calendar buckets (`d`, `w`, `M`) to the midnight of `timeZone`
 * (DST-aware for `'local'` and IANA names); sub-day timeframes and UTC use
 * the plain epoch / UTC alignment of `getBucketStart`.
 *
 * A bucket is aligned with the offset in force at its own midnight (not
 * at the trade time). Across a DST change a day is 23 or 25 h long: the next bucket is found
 * by stepping one nominal interval, moving to noon and re-aligning, which
 * is exact for any shift below 12 h.
 */
export function createBucketAligner(
  spec: TimeframeSpec,
  timeZone: ChartTimeZone = 'utc'
): BucketAligner {
  const zone: OffsetResolver | null =
    isCalendarUnit(spec.unit) && timeZone !== 'utc' && timeZone !== 'UTC'
      ? createOffsetResolver(timeZone)
      : null;
  if (zone === null) {
    return {
      bucketOf: (time) => getBucketStart(time, spec),
      nextBucket: (start) => getNextBucketStart(start, spec),
    };
  }
  const bucketOf = (time: number) => {
    const offset = offsetAt(zone, time);
    const start = getBucketStart(time, spec, offset);
    // On a DST day the offset at midnight differs from the one at `time`.
    const atStart = offsetAt(zone, start);
    return atStart === offset ? start : getBucketStart(time, spec, atStart);
  };
  return {
    bucketOf,
    nextBucket: (start) =>
      bucketOf(
        getNextBucketStart(start, spec, offsetAt(zone, start)) + HALF_DAY_MS
      ),
  };
}
