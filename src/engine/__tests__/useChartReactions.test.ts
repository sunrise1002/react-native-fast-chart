/**
 * Test perspective table — useChartReactions (real Reanimated, fake timers)
 *
 * Fixture: bars with low = 100 + i, high = 110 + i; plot 400 dp, spacing 8
 * → 50 slots; default 10% padding.
 *
 * | Case | Input / Precondition                          | Perspective        | Expected                                 |
 * |------|-----------------------------------------------|--------------------|------------------------------------------|
 * | R1   | first valid frame                             | Equivalence        | snaps to the padded visible range        |
 * | R2   | scroll back a little (ranges overlap)         | Equivalence        | animates, reaches target after 160 ms    |
 * | R3   | tiny change below epsilon                     | Boundary (ε)       | no new animation                         |
 * | R4   | scroll to a disjoint range                    | Boundary           | snaps                                    |
 * | R5   | dataset replaced (resetVersion changes)       | Equivalence        | snaps                                    |
 * | R6   | no data / nothing visible                     | Boundary (empty)   | price range untouched                    |
 * | R7   | scroll last bar off screen and back           | Equivalence        | isAtRealtime false → true                |
 * | R8   | empty series                                  | Boundary (empty)   | isAtRealtime true                        |
 * | R9   | overlay refs with values above the bars       | Equivalence        | range widened to the overlay max         |
 * | R10  | overlay refs, series unaligned / no refs      | Equivalence        | candle range only                        |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { createUiCandleSeries } from '../../data/UiCandleSeries';
import type { CandleColumns } from '../../data/CandleBuffer';
import {
  AUTOSCALE_ANIMATION_MS,
  useChartReactions,
} from '../useChartReactions';
import { makeEngine } from './engineTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

function ramp(n: number, base = 100): CandleColumns {
  const f = (d: number) =>
    Float64Array.from({ length: n }, (_, i) => base + i + d);
  return {
    time: Float64Array.from({ length: n }, (_, i) => i),
    open: f(2),
    high: f(10),
    low: f(0),
    close: f(5),
    volume: new Float64Array(n),
    offset: 0,
    length: n,
  };
}

function mount(n = 1000, resetVersion = 1) {
  const engine = makeEngine(0);
  engine.state.series.value = createUiCandleSeries(ramp(n), 0, resetVersion);
  engine.state.rightOffset.value = 0;
  renderHook(() => useChartReactions(engine.state));
  tick(20);
  return engine;
}

function tick(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** Padded range for visible bars [a, b] (low 100+i, high 110+i). */
function padded(a: number, b: number) {
  const lo = 100 + a;
  const hi = 110 + b;
  const pad = (hi - lo) * 0.1;
  return { min: lo - pad, max: hi + pad };
}

describe('useChartReactions — auto-scale', () => {
  it('R1: snaps to the visible range on the first frame', () => {
    // Given / When: last 50 bars visible (950..999)
    const { state } = mount();
    // Then
    const want = padded(950, 999);
    expect(state.priceMin.value).toBeCloseTo(want.min, 6);
    expect(state.priceMax.value).toBeCloseTo(want.max, 6);
  });

  it('R2: animates towards an overlapping target', () => {
    // Given
    const { state } = mount();
    const start = state.priceMax.value;
    // When: 10 bars back → 940..989
    state.rightOffset.value = -10;
    tick(AUTOSCALE_ANIMATION_MS / 4);
    const mid = state.priceMax.value;
    tick(AUTOSCALE_ANIMATION_MS * 2);
    // Then
    const want = padded(940, 989);
    expect(mid).toBeLessThan(start);
    expect(mid).toBeGreaterThan(want.max);
    expect(state.priceMax.value).toBeCloseTo(want.max, 6);
    expect(state.priceMin.value).toBeCloseTo(want.min, 6);
  });

  it('R3: ignores changes below the epsilon', () => {
    // Given
    const { state } = mount();
    state.priceMax.value = 5000;
    // When: sub-pixel scroll keeps the same bars visible
    state.rightOffset.value = 0.01;
    tick(AUTOSCALE_ANIMATION_MS * 2);
    // Then: no retarget happened
    expect(state.priceMax.value).toBe(5000);
  });

  it('R4: snaps when the new range is disjoint', () => {
    // Given
    const { state } = mount();
    // When: jump far into history (bars 100..149)
    state.rightOffset.value = -850;
    tick(1);
    // Then
    expect(state.priceMax.value).toBeCloseTo(padded(100, 149).max, 6);
  });

  it('R5: snaps when the dataset is replaced', () => {
    // Given
    const { state } = mount();
    // When
    state.series.value = createUiCandleSeries(ramp(1000, 105), 0, 2);
    tick(1);
    // Then
    expect(state.priceMax.value).toBeCloseTo(padded(950, 999).max + 5, 6);
  });

  it.each([
    ['no data', 0, 0],
    ['scrolled past the data', 10, 1000],
  ])('R6: leaves the range untouched with %s', (_label, n, offset) => {
    // Given
    const engine = makeEngine(0);
    engine.state.series.value = createUiCandleSeries(ramp(n));
    engine.state.rightOffset.value = offset;
    // When
    renderHook(() => useChartReactions(engine.state));
    tick(20);
    // Then
    expect(engine.state.priceMin.value).toBeNaN();
    expect(engine.state.priceMax.value).toBeNaN();
  });
});

describe('useChartReactions — isAtRealtime', () => {
  it('R7: tracks whether the last bar is visible', () => {
    // Given
    const { state } = mount();
    const initial = state.isAtRealtime.value;
    // When
    state.rightOffset.value = -100;
    tick(1);
    const away = state.isAtRealtime.value;
    state.rightOffset.value = 3;
    tick(1);
    // Then
    expect([initial, away, state.isAtRealtime.value]).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('R8: is true without data', () => {
    // Given
    const engine = makeEngine(0);
    engine.state.isAtRealtime.value = false;
    // When
    renderHook(() => useChartReactions(engine.state));
    tick(1);
    // Then
    expect(engine.state.isAtRealtime.value).toBe(true);
  });
});

describe('useChartReactions — overlay auto-scale', () => {
  function withOverlay(resetVersion: number, refs = [{ id: 'o', output: 0 }]) {
    const engine = makeEngine(0);
    engine.state.series.value = createUiCandleSeries(ramp(1000), 0, 1);
    engine.state.rightOffset.value = 0;
    const values = new Float64Array(1000).fill(NaN);
    values[990] = 2000;
    engine.state.indicators.value = {
      series: {
        o: { outputs: [values], length: 1000, resetVersion, firstTime: 0 },
      },
      revision: 1,
    };
    renderHook(() => useChartReactions(engine.state, refs));
    tick(20);
    return engine;
  }

  it('R9: widens the range with overlay values', () => {
    // Given / When
    const { state } = withOverlay(1);
    // Then
    const lo = 1050;
    const pad = (2000 - lo) * 0.1;
    expect(state.priceMax.value).toBeCloseTo(2000 + pad, 6);
    expect(state.priceMin.value).toBeCloseTo(lo - pad, 6);
  });

  it('R10: ignores unaligned series and empty refs', () => {
    // Given / When
    const unaligned = withOverlay(2);
    const noRefs = withOverlay(1, []);
    // Then
    const want = padded(950, 999);
    expect(unaligned.state.priceMax.value).toBeCloseTo(want.max, 6);
    expect(noRefs.state.priceMax.value).toBeCloseTo(want.max, 6);
  });
});
