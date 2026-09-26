/**
 * Test perspective table — ConfigSanitize (via resolveChartConfig)
 *
 * | Case | Input / Precondition                                     | Perspective        | Expected                                   |
 * |------|----------------------------------------------------------|--------------------|--------------------------------------------|
 * | CS1  | no override / valid override                             | Equivalence        | defaults / values kept, sections reused    |
 * | CS2  | numbers NaN / ∞ / -∞ / negative / string                 | Invalid            | default for that field only                |
 * | CS3  | numbers 0 on zero-allowed field (rightOffsetBars)        | Boundary (0)       | kept                                       |
 * | CS4  | zero on positive fields (spacings, ratio, sample ms)     | Boundary (0)       | default                                    |
 * | CS5  | bodyRatio 1 / 1.01, overlayScaleHeightRatio 1 / 1.5      | Boundary (max ±1)  | kept / default                             |
 * | CS6  | booleans as strings / numbers                            | Invalid type       | default                                    |
 * | CS7  | thousandsSeparator '' / number                           | Boundary / invalid | '' kept / default                          |
 * | CS8  | crosshair.mode 'sticky' / 'bogus'                        | Enum               | kept / default                             |
 * | CS9  | dailyBarsTimeZone 'chart' / 'local'                      | Enum               | kept / default                             |
 * | CS10 | timeZone IANA / minutes / '' / NaN / object              | Equivalence / inv. | kept, kept / default ×3                    |
 * | CS11 | symbol tickSize number / null / string                   | Nullable           | kept / kept / null                         |
 * | CS12 | section replaced by a non-object (null, array, number)   | Invalid type       | whole default section                      |
 * | CS13 | minBarSpacing > maxBarSpacing                            | Invalid (order)    | both defaults                              |
 * | CS14 | initialBarSpacing below min / above max / equal to max   | Boundary           | clamped to min / max / kept                |
 * | CS15 | defaults are not mutated                                 | Safety             | DEFAULT_CHART_CONFIG unchanged             |
 */
import { describe, expect, it } from '@jest/globals';
import type { DeepPartial } from '../../utils/deepMerge';
import {
  DEFAULT_CHART_CONFIG,
  resolveChartConfig,
  type ChartConfig,
} from '../ChartConfig';
import { sanitizeChartConfig } from '../ConfigSanitize';

const resolve = (override: unknown) =>
  resolveChartConfig(override as DeepPartial<ChartConfig>);
const D = DEFAULT_CHART_CONFIG;

describe('sanitizeChartConfig', () => {
  it('CS1: valid configs pass through', () => {
    // Given / When
    const plain = resolve(undefined);
    const custom = resolve({ viewport: { bodyRatio: 0.5 } });
    // Then
    expect(plain).toEqual(D);
    expect(custom.viewport.bodyRatio).toBe(0.5);
    expect(custom.layout).toEqual(D.layout);
  });

  it.each([[NaN], [Infinity], [-Infinity], [-1], ['12']])(
    'CS2: priceAxisWidth %p → default',
    (value) => {
      // Given / When
      const out = resolve({
        layout: { priceAxisWidth: value, timeAxisHeight: 30 },
      });
      // Then
      expect(out.layout.priceAxisWidth).toBe(D.layout.priceAxisWidth);
      expect(out.layout.timeAxisHeight).toBe(30);
    }
  );

  it('CS3: zero is kept where allowed', () => {
    // Given / When
    const out = resolve({ layout: { rightOffsetBars: 0 } });
    // Then
    expect(out.layout.rightOffsetBars).toBe(0);
  });

  it.each<[string, string]>([
    ['viewport', 'minBarSpacing'],
    ['viewport', 'maxBarSpacing'],
    ['viewport', 'initialBarSpacing'],
    ['layout', 'overlayScaleHeightRatio'],
    ['telemetry', 'performanceSampleMs'],
  ])('CS4: %s.%s = 0 → default', (section, key) => {
    // Given / When
    const out = resolve({ [section]: { [key]: 0 } }) as unknown as Record<
      string,
      Record<string, unknown>
    >;
    const defaults = D as unknown as Record<string, Record<string, unknown>>;
    // Then
    expect(out[section]?.[key]).toBe(defaults[section]?.[key]);
  });

  it('CS5: ratios are capped at 1', () => {
    // Given / When / Then
    expect(resolve({ viewport: { bodyRatio: 1 } }).viewport.bodyRatio).toBe(1);
    expect(resolve({ viewport: { bodyRatio: 1.01 } }).viewport.bodyRatio).toBe(
      D.viewport.bodyRatio
    );
    expect(
      resolve({ layout: { overlayScaleHeightRatio: 1 } }).layout
        .overlayScaleHeightRatio
    ).toBe(1);
    expect(
      resolve({ layout: { overlayScaleHeightRatio: 1.5 } }).layout
        .overlayScaleHeightRatio
    ).toBe(D.layout.overlayScaleHeightRatio);
  });

  it.each([['false'], [0], [null]])('CS6: boolean %p → default', (value) => {
    // Given / When
    const out = resolve({ interaction: { panEnabled: value } });
    // Then
    expect(out.interaction.panEnabled).toBe(true);
  });

  it('CS7: thousandsSeparator', () => {
    // Given / When / Then
    expect(
      resolve({ axes: { thousandsSeparator: '' } }).axes.thousandsSeparator
    ).toBe('');
    expect(
      resolve({ axes: { thousandsSeparator: 1 } }).axes.thousandsSeparator
    ).toBe(',');
  });

  it('CS8: crosshair.mode enum', () => {
    // Given / When / Then
    expect(resolve({ crosshair: { mode: 'sticky' } }).crosshair.mode).toBe(
      'sticky'
    );
    expect(resolve({ crosshair: { mode: 'bogus' } }).crosshair.mode).toBe(
      'hold'
    );
  });

  it('CS9: dailyBarsTimeZone enum', () => {
    // Given / When / Then
    expect(
      resolve({ axes: { dailyBarsTimeZone: 'chart' } }).axes.dailyBarsTimeZone
    ).toBe('chart');
    expect(
      resolve({ axes: { dailyBarsTimeZone: 'local' } }).axes.dailyBarsTimeZone
    ).toBe('utc');
  });

  it.each<[unknown, unknown]>([
    ['Asia/Seoul', 'Asia/Seoul'],
    [540, 540],
    [-0, -0],
    ['', 'local'],
    [NaN, 'local'],
    [{ zone: 'x' }, 'local'],
  ])('CS10: timeZone %p → %p', (zone, expected) => {
    // Given / When / Then
    expect(resolve({ axes: { timeZone: zone } }).axes.timeZone).toBe(expected);
  });

  it.each<[unknown, unknown]>([
    [0.25, 0.25],
    [null, null],
    ['0.25', null],
  ])('CS11: symbol.tickSize %p → %p', (tick, expected) => {
    // Given / When / Then
    expect(resolve({ symbol: { tickSize: tick } }).symbol.tickSize).toBe(
      expected
    );
  });

  it.each([[null], [[1, 2]], [42]])(
    'CS12: section %p → defaults',
    (section) => {
      // Given
      const merged = { ...D, viewport: section } as unknown as ChartConfig;
      // When
      const out = sanitizeChartConfig(merged, D);
      // Then
      expect(out.viewport).toEqual(D.viewport);
    }
  );

  it('CS13: inverted zoom limits → both defaults', () => {
    // Given / When
    const out = resolve({ viewport: { minBarSpacing: 80, maxBarSpacing: 10 } });
    // Then
    expect(out.viewport.minBarSpacing).toBe(D.viewport.minBarSpacing);
    expect(out.viewport.maxBarSpacing).toBe(D.viewport.maxBarSpacing);
  });

  it.each([
    [1, 2, 2],
    [100, 2, 40],
    [40, 2, 40],
  ])(
    'CS14: initialBarSpacing %p within [%p, 40] → %p',
    (initial, min, expected) => {
      // Given / When
      const out = resolve({
        viewport: {
          initialBarSpacing: initial,
          minBarSpacing: min,
          maxBarSpacing: 40,
        },
      });
      // Then
      expect(out.viewport.initialBarSpacing).toBe(expected);
    }
  );

  it('CS15: never mutates the defaults', () => {
    // Given
    const before = JSON.stringify(D);
    // When
    resolve({
      viewport: { minBarSpacing: 80, maxBarSpacing: 10, bodyRatio: NaN },
    });
    // Then
    expect(JSON.stringify(D)).toBe(before);
    expect(Object.isFrozen(D.viewport)).toBe(true);
  });
});
