/**
 * Test perspective table — RealtimeStatus
 *
 * | Case | Input / Precondition                        | Perspective     | Expected                                 |
 * |------|---------------------------------------------|-----------------|------------------------------------------|
 * | R1   | default construction                        | Boundary (NULL) | 'offline'                                |
 * | R2   | set a new valid status                      | Equivalence     | true, listener called with the status    |
 * | R3   | set the same status                         | Boundary        | false, no notification                   |
 * | R4   | set unknown / '' / null / number            | Invalid type    | false, status unchanged                  |
 * | R5   | isRealtimeStatus for all values and junk    | Equivalence     | true only for the four statuses          |
 * | R6   | unsubscribe / dispose                       | Equivalence     | no further notifications                 |
 * | R7   | REALTIME_STATUSES is frozen                 | Abnormal        | mutation throws                          |
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  isRealtimeStatus,
  REALTIME_STATUSES,
  RealtimeStatusStore,
  type RealtimeStatus,
} from '../RealtimeStatus';

describe('RealtimeStatusStore', () => {
  it('R1: starts offline by default, or with the given status', () => {
    // Given / When / Then
    expect(new RealtimeStatusStore().get()).toBe('offline');
    expect(new RealtimeStatusStore('live').get()).toBe('live');
  });

  it('R2: notifies on a change', () => {
    // Given
    const store = new RealtimeStatusStore();
    const listener = jest.fn();
    store.subscribe(listener);
    // When
    const changed = store.set('reconnecting');
    // Then
    expect(changed).toBe(true);
    expect(store.get()).toBe('reconnecting');
    expect(listener).toHaveBeenCalledWith('reconnecting');
  });

  it('R3: ignores the same status', () => {
    // Given
    const store = new RealtimeStatusStore('live');
    const listener = jest.fn();
    store.subscribe(listener);
    // When / Then
    expect(store.set('live')).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each(['unknown', '', null, 3, undefined])('R4: rejects %p', (value) => {
    // Given
    const store = new RealtimeStatusStore('delayed');
    const listener = jest.fn();
    store.subscribe(listener);
    // When
    const changed = store.set(value as unknown as RealtimeStatus);
    // Then
    expect(changed).toBe(false);
    expect(store.get()).toBe('delayed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('R5: isRealtimeStatus', () => {
    // Given / When / Then
    for (const s of ['live', 'reconnecting', 'delayed', 'offline']) {
      expect(isRealtimeStatus(s)).toBe(true);
    }
    for (const junk of ['LIVE', '', null, undefined, 0, {}]) {
      expect(isRealtimeStatus(junk)).toBe(false);
    }
  });

  it('R6: unsubscribe and dispose stop notifications', () => {
    // Given
    const store = new RealtimeStatusStore();
    const a = jest.fn();
    const b = jest.fn();
    const off = store.subscribe(a);
    store.subscribe(b);
    // When
    off();
    store.set('live');
    store.dispose();
    store.set('delayed');
    // Then
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe('delayed');
  });

  it('R7: the status list is frozen', () => {
    // Given / When / Then
    expect(REALTIME_STATUSES).toHaveLength(4);
    expect(() => (REALTIME_STATUSES as RealtimeStatus[]).push('live')).toThrow(
      TypeError
    );
  });
});
