/**
 * Test perspective table — ChartConfig
 *
 * | Case | Input / Precondition            | Perspective      | Expected                               |
 * |------|---------------------------------|------------------|----------------------------------------|
 * | C1   | no override / null              | Boundary (empty) | equals defaults, debug disabled        |
 * | C2   | nested debug override           | Equivalence      | only debug.overlay changes             |
 * | C3   | defaults object                 | Safety           | frozen, not mutated by resolve         |
 * | C4   | viewport limits consistency     | Invariant        | min < initial < max, all > 0           |
 */
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_CHART_CONFIG, resolveChartConfig } from '../ChartConfig';

describe('resolveChartConfig', () => {
  it.each([undefined, null])('C1: %p override yields defaults', (o) => {
    // Given / When
    const config = resolveChartConfig(o);
    // Then
    expect(config).toEqual(DEFAULT_CHART_CONFIG);
    expect(config.debug).toEqual({ overlay: false, profiling: false });
  });

  it('C2: merges a nested override', () => {
    // Given / When
    const config = resolveChartConfig({ debug: { overlay: true } });
    // Then
    expect(config.debug).toEqual({ overlay: true, profiling: false });
    expect(config.layout).toEqual(DEFAULT_CHART_CONFIG.layout);
  });

  it('C3: defaults are frozen and untouched', () => {
    // Given / When
    resolveChartConfig({ layout: { priceAxisWidth: 1 } });
    // Then
    expect(Object.isFrozen(DEFAULT_CHART_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CHART_CONFIG.layout)).toBe(true);
    expect(DEFAULT_CHART_CONFIG.layout.priceAxisWidth).toBe(64);
  });

  it('C4: default viewport limits are consistent', () => {
    // Given
    const { minBarSpacing, initialBarSpacing, maxBarSpacing } =
      DEFAULT_CHART_CONFIG.viewport;
    // When / Then
    expect(minBarSpacing).toBeGreaterThan(0);
    expect(minBarSpacing).toBeLessThan(initialBarSpacing);
    expect(initialBarSpacing).toBeLessThan(maxBarSpacing);
  });
});
