/**
 * Test perspective table — P10 overlay specs (offsets, clouds, dots)
 *
 * | Case | Input / Precondition                                   | Perspective          | Expected                                     |
 * |------|--------------------------------------------------------|----------------------|----------------------------------------------|
 * | S1   | Ichimoku defaults                                      | Normal               | 5 strokes with offsets 0,0,−25,25,25; cloud  |
 * |      |                                                        |                      | fill (downColor, offset 25), 5 legend values |
 * | S2   | Ichimoku refs                                          | Normal               | auto-scale refs carry the offsets            |
 * | S3   | Supertrend (bands without edges)                       | Equivalence          | 2 fills, 2 strokes, 2 legend values          |
 * | S4   | Parabolic SAR (points series)                          | Equivalence          | 1 stroke with `dots: true`                   |
 * | S5   | Ichimoku with `fill: false`                            | Boundary             | no cloud; strokes unchanged                  |
 * | S6   | plain band (Donchian)                                  | Equivalence          | no downColor key, offset 0                   |
 */
import { describe, expect, it } from '@jest/globals';
import { createIndicatorRegistry } from '../../../indicators/builtins';
import {
  ICHIMOKU_BEAR_COLOR,
  ICHIMOKU_BULL_COLOR,
} from '../../../indicators/builtins/Ichimoku';
import type { IndicatorInput } from '../../../indicators/Indicator';
import { createIndicatorEntry } from '../../../indicators/IndicatorDefinitions';
import {
  overlayAutoScaleRefs,
  resolveOverlaySpecs,
} from '../OverlayRenderSpec';

const registry = createIndicatorRegistry();
const PALETTE = ['#111'];

function spec(input: IndicatorInput) {
  const m = registry.get(input.type);
  if (!m) throw new Error('unknown');
  const [s] = resolveOverlaySpecs(
    [createIndicatorEntry(m, input, input.type).entry],
    PALETTE
  );
  if (!s) throw new Error('no spec');
  return s;
}

describe('P10 overlay specs', () => {
  it('S1: Ichimoku strokes, offsets and cloud', () => {
    // Given / When
    const s = spec({ type: 'ichimoku' });
    // Then
    expect(s.strokes.map((k) => [k.output, k.offset])).toEqual([
      [0, 0],
      [1, 0],
      [2, -25],
      [3, 25],
      [4, 25],
    ]);
    expect(s.fills).toEqual([
      {
        upper: 3,
        lower: 4,
        color: ICHIMOKU_BULL_COLOR,
        downColor: ICHIMOKU_BEAR_COLOR,
        opacity: expect.any(Number),
        offset: 25,
      },
    ]);
    expect(s.legend.map((l) => l.offset)).toEqual([0, 0, -25, 25, 25]);
  });

  it('S2: auto-scale refs carry the offsets', () => {
    // Given / When
    const refs = overlayAutoScaleRefs([spec({ type: 'ichimoku' })]);
    // Then
    expect(refs.map((r) => r.offset)).toEqual([0, 0, -25, 25, 25]);
  });

  it('S3: Supertrend fills without edge strokes', () => {
    // Given / When
    const s = spec({ type: 'supertrend' });
    // Then
    expect(s.fills.map((f) => [f.upper, f.lower])).toEqual([
      [2, 0],
      [2, 1],
    ]);
    expect(s.strokes.map((k) => k.output)).toEqual([0, 1]);
    expect(s.legend.map((l) => l.output)).toEqual([0, 1]);
  });

  it('S4: SAR is a dots stroke', () => {
    // Given / When
    const s = spec({ type: 'parabolicSar' });
    // Then
    expect(s.strokes).toHaveLength(1);
    expect(s.strokes[0]).toMatchObject({ output: 0, dots: true, offset: 0 });
    expect(s.fills).toEqual([]);
  });

  it('S5: Ichimoku without fill', () => {
    // Given / When
    const s = spec({ type: 'ichimoku', style: { fill: false } });
    // Then
    expect(s.fills).toEqual([]);
    expect(s.strokes).toHaveLength(5);
  });

  it('S6: plain bands have no down color', () => {
    // Given / When
    const s = spec({ type: 'donchian' });
    // Then
    expect(s.fills).toHaveLength(1);
    expect('downColor' in (s.fills[0] ?? {})).toBe(false);
    expect(s.fills[0]?.offset).toBe(0);
    expect(s.strokes.every((k) => !k.dots && k.offset === 0)).toBe(true);
  });
});
