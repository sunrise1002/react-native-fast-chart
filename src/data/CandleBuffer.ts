/**
 * Struct-of-arrays OHLCV storage with amortized O(1) growth at **both** ends.
 *
 * Bars live in `[offset, offset + length)` of six parallel `Float64Array`
 * columns. Free slots are kept before `offset` (head room, for history
 * prepends) and after the last bar (tail room, for realtime appends). When
 * one side runs out the columns are reallocated with geometric growth, so a
 * long sequence of `prepend`/`append` calls costs O(total bars) overall.
 *
 * Pure TypeScript, no Skia/React. Readers must re-read `columns` fields after
 * every mutation: the arrays are replaced when the buffer grows.
 */

/** Read-only view of the raw columns. Bar `i` is at `column[offset + i]`. */
export interface CandleColumns {
  readonly time: Float64Array;
  readonly open: Float64Array;
  readonly high: Float64Array;
  readonly low: Float64Array;
  readonly close: Float64Array;
  readonly volume: Float64Array;
  /** Physical index of bar 0. */
  readonly offset: number;
  /** Number of stored bars. */
  readonly length: number;
}

interface MutableColumns {
  time: Float64Array;
  open: Float64Array;
  high: Float64Array;
  low: Float64Array;
  close: Float64Array;
  volume: Float64Array;
  offset: number;
  length: number;
}

const MIN_CAPACITY = 64;

function createColumns(capacity: number, offset: number): MutableColumns {
  return {
    time: new Float64Array(capacity),
    open: new Float64Array(capacity),
    high: new Float64Array(capacity),
    low: new Float64Array(capacity),
    close: new Float64Array(capacity),
    volume: new Float64Array(capacity),
    offset,
    length: 0,
  };
}

const COLUMN_KEYS = ['time', 'open', 'high', 'low', 'close', 'volume'] as const;

export class CandleBuffer {
  private cols: MutableColumns = createColumns(MIN_CAPACITY, 0);

  /** Stable object; its fields are updated in place on every mutation. */
  get columns(): CandleColumns {
    return this.cols;
  }

  get length(): number {
    return this.cols.length;
  }

  get capacity(): number {
    return this.cols.time.length;
  }

  /** Free slots before the first bar. */
  get headRoom(): number {
    return this.cols.offset;
  }

  /** Free slots after the last bar. */
  get tailRoom(): number {
    return this.cols.time.length - this.cols.offset - this.cols.length;
  }

  /** Drops all bars and sizes the buffer for `expected` bars. */
  reset(expected: number): void {
    const headRoom = Math.max(MIN_CAPACITY, Math.floor(expected / 8));
    const tailRoom = Math.max(MIN_CAPACITY, Math.floor(expected / 4));
    const capacity = headRoom + expected + tailRoom;
    if (capacity > this.capacity || capacity * 4 < this.capacity) {
      this.replaceColumns(createColumns(capacity, headRoom));
    } else {
      this.cols.offset = headRoom;
      this.cols.length = 0;
    }
  }

  /** Ensures `count` free slots after the last bar. */
  reserveBack(count: number): void {
    if (this.tailRoom >= count) {
      return;
    }
    const { offset, length } = this.cols;
    const needed = offset + length + count;
    this.reallocate(Math.max(needed, this.capacity * 2), offset);
  }

  /** Ensures `count` free slots before the first bar. */
  reserveFront(count: number): void {
    if (this.headRoom >= count) {
      return;
    }
    const { length } = this.cols;
    const tailRoom = this.tailRoom;
    // Keep head room proportional to the data size so that repeated history
    // pages are amortized O(1) per bar.
    const headRoom = Math.max(count, length, MIN_CAPACITY);
    this.reallocate(headRoom + length + tailRoom, headRoom);
  }

  /** Writes bar values at logical index `i` (`0 <= i < length`). */
  write(
    i: number,
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): void {
    const c = this.cols;
    const p = c.offset + i;
    c.time[p] = time;
    c.open[p] = open;
    c.high[p] = high;
    c.low[p] = low;
    c.close[p] = close;
    c.volume[p] = volume;
  }

  /** Grows the logical range by `count` slots at the end (reserve first). */
  growBack(count: number): void {
    this.cols.length += count;
  }

  /** Grows the logical range by `count` slots at the front (reserve first). */
  growFront(count: number): void {
    this.cols.offset -= count;
    this.cols.length += count;
  }

  /**
   * Replaces bars `[from, from + deleteCount)` with `insertCount` new slots
   * (contents undefined until written). Shifts the tail; O(length - from).
   */
  splice(from: number, deleteCount: number, insertCount: number): void {
    const delta = insertCount - deleteCount;
    if (delta > 0) {
      this.reserveBack(delta);
    }
    const c = this.cols;
    const srcStart = c.offset + from + deleteCount;
    const srcEnd = c.offset + c.length;
    const dst = c.offset + from + insertCount;
    if (delta !== 0 && srcEnd > srcStart) {
      for (const key of COLUMN_KEYS) {
        c[key].copyWithin(dst, srcStart, srcEnd);
      }
    }
    c.length += delta;
  }

  private reallocate(capacity: number, headRoom: number): void {
    const prev = this.cols;
    const next = createColumns(capacity, headRoom);
    const start = prev.offset;
    const end = prev.offset + prev.length;
    for (const key of COLUMN_KEYS) {
      next[key].set(prev[key].subarray(start, end), headRoom);
    }
    next.length = prev.length;
    this.replaceColumns(next);
  }

  /** Copies the new arrays into the stable `cols` object. */
  private replaceColumns(next: MutableColumns): void {
    const c = this.cols;
    c.time = next.time;
    c.open = next.open;
    c.high = next.high;
    c.low = next.low;
    c.close = next.close;
    c.volume = next.volume;
    c.offset = next.offset;
    c.length = next.length;
  }
}
