/**
 * Millisecond clock usable inside worklets: `performance.now()` when the
 * runtime provides it (Hermes, UI runtime on recent RN), else `Date.now()`.
 */
export function uiNow(): number {
  'worklet';
  const perf = (globalThis as { performance?: { now?: () => number } })
    .performance;
  return perf !== undefined && typeof perf.now === 'function'
    ? perf.now()
    : Date.now();
}
