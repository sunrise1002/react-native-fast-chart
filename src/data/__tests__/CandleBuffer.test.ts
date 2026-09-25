/**
 * Test perspective table — CandleBuffer (SoA storage with two-sided growth)
 *
 * | Case | Input / Precondition                        | Perspective       | Expected                                     |
 * |------|---------------------------------------------|-------------------|----------------------------------------------|
 * | F1   | fresh buffer                                | Boundary (empty)  | length 0, capacity >= 64                     |
 * | F2   | reset(0) / reset(100k)                      | Boundary (0/huge) | head+tail room reserved, length 0            |
 * | F3   | reset smaller after large                   | Boundary          | shrinks when > 4x oversized                  |
 * | F4   | reset slightly smaller                      | Equivalence       | keeps arrays                                 |
 * | G1   | append beyond tail room                     | Boundary (max+1)  | grows, data preserved                        |
 * | G2   | prepend beyond head room                    | Boundary (max+1)  | grows, data preserved, order kept            |
 * | G3   | reserve within room                         | Equivalence       | arrays not reallocated                       |
 * | G4   | 1000 single-bar prepends                    | Amortization      | few reallocations (O(log n))                 |
 * | S1   | splice insert / delete / replace in middle  | Equivalence       | tail shifted correctly                       |
 * | S2   | splice at end, no tail                      | Boundary          | length changes, nothing shifted              |
 * | S3   | splice insert that needs growth             | Boundary          | grows, data preserved                        |
 */
import { describe, expect, it } from '@jest/globals';
import { CandleBuffer } from '../CandleBuffer';

function times(buffer: CandleBuffer): number[] {
  const { time, offset, length } = buffer.columns;
  return Array.from(time.subarray(offset, offset + length));
}

function fill(buffer: CandleBuffer, values: number[]): void {
  buffer.reset(values.length);
  buffer.growBack(values.length);
  values.forEach((t, i) => buffer.write(i, t, t, t, t, t, t));
}

describe('CandleBuffer', () => {
  it('F1: starts empty with a minimum capacity', () => {
    // Given / When
    const buffer = new CandleBuffer();
    // Then
    expect(buffer.length).toBe(0);
    expect(buffer.capacity).toBeGreaterThanOrEqual(64);
  });

  it.each([0, 100_000])('F2: reset(%p) reserves room at both ends', (n) => {
    // Given
    const buffer = new CandleBuffer();
    // When
    buffer.reset(n);
    // Then
    expect(buffer.length).toBe(0);
    expect(buffer.headRoom).toBeGreaterThanOrEqual(64);
    expect(buffer.tailRoom).toBeGreaterThanOrEqual(n + 64);
  });

  it('F3: shrinks when heavily oversized', () => {
    // Given: a large buffer
    const buffer = new CandleBuffer();
    buffer.reset(100_000);
    // When
    buffer.reset(10);
    // Then
    expect(buffer.capacity).toBeLessThan(1000);
  });

  it('F4: reuses arrays when the size is similar', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [1, 2, 3]);
    const before = buffer.columns.time;
    // When
    buffer.reset(2);
    // Then
    expect(buffer.columns.time).toBe(before);
    expect(buffer.length).toBe(0);
  });

  it('G1: grows at the back and preserves data', () => {
    // Given: tail room exhausted
    const buffer = new CandleBuffer();
    fill(buffer, [1, 2, 3]);
    const room = buffer.tailRoom;
    // When
    buffer.reserveBack(room + 1);
    buffer.growBack(room + 1);
    // Then
    expect(buffer.length).toBe(room + 4);
    expect(times(buffer).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('G2: grows at the front and preserves data', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [10, 20]);
    const k = buffer.headRoom + 5;
    // When
    buffer.reserveFront(k);
    buffer.growFront(k);
    for (let i = 0; i < k; i++) {
      buffer.write(i, i, i, i, i, i, i);
    }
    // Then
    const t = times(buffer);
    expect(t.length).toBe(k + 2);
    expect(t.slice(-2)).toEqual([10, 20]);
    expect(t[0]).toBe(0);
    expect(buffer.columns.close[buffer.columns.offset + k]).toBe(10);
  });

  it('G3: reserving within room does not reallocate', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [1]);
    const before = buffer.columns.time;
    // When
    buffer.reserveBack(1);
    buffer.reserveFront(1);
    // Then
    expect(buffer.columns.time).toBe(before);
  });

  it('G4: repeated single prepends are amortized', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [1_000_000]);
    let reallocations = 0;
    // When
    for (let i = 0; i < 1000; i++) {
      const before = buffer.columns.time;
      buffer.reserveFront(1);
      if (buffer.columns.time !== before) {
        reallocations++;
      }
      buffer.growFront(1);
      buffer.write(0, 999_999 - i, 0, 0, 0, 0, 0);
    }
    // Then
    expect(reallocations).toBeLessThanOrEqual(6);
    const t = times(buffer);
    expect(t.length).toBe(1001);
    expect(t[0]).toBe(999_000);
    expect(t[1000]).toBe(1_000_000);
  });

  it('S1: splice shifts the tail', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [1, 2, 3, 4, 5]);
    // When: replace [2,3] with 3 slots, then delete one
    buffer.splice(1, 2, 3);
    buffer.write(1, 20, 0, 0, 0, 0, 0);
    buffer.write(2, 21, 0, 0, 0, 0, 0);
    buffer.write(3, 22, 0, 0, 0, 0, 0);
    // Then
    expect(times(buffer)).toEqual([1, 20, 21, 22, 4, 5]);
    // When: delete 2 slots
    buffer.splice(0, 2, 0);
    // Then
    expect(times(buffer)).toEqual([21, 22, 4, 5]);
  });

  it('S2: splice at the end without tail', () => {
    // Given
    const buffer = new CandleBuffer();
    fill(buffer, [1, 2, 3]);
    // When
    buffer.splice(3, 0, 1);
    buffer.write(3, 4, 0, 0, 0, 0, 0);
    buffer.splice(1, 3, 0);
    // Then
    expect(times(buffer)).toEqual([1]);
  });

  it('S3: splice insert grows the buffer', () => {
    // Given: no tail room left
    const buffer = new CandleBuffer();
    fill(buffer, [1, 2]);
    const extra = buffer.tailRoom + 10;
    // When
    buffer.splice(1, 0, extra);
    // Then
    const t = times(buffer);
    expect(t.length).toBe(extra + 2);
    expect(t[0]).toBe(1);
    expect(t[t.length - 1]).toBe(2);
  });
});
