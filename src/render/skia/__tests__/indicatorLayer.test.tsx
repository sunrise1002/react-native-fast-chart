/**
 * Test perspective table — indicator Skia layer, paints, UI sync, legend rows
 * (Skia mocked, real Reanimated, fake timers; fixtures in layerTestUtils.)
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                        |
 * |------|--------------------------------------------------------|-------------------|-------------------------------------------------|
 * | P1   | draw list from EMA + BB specs                          | Normal            | stroke paints (width, round, alpha), legend map |
 * | P2   | opacity 0.5                                            | Boundary          | alpha halved                                    |
 * | Y1   | connect engine → UI                                    | Normal            | series mirrored in state.indicators             |
 * | Y2   | realtime tick after connect                            | Normal            | tail applied, revision bumps                    |
 * | Y3   | removal / after unsubscribe                            | Normal / Abnormal | series deleted / no longer applied              |
 * | Y4   | connect after results exist (remount)                  | Boundary          | snapshot pushed immediately, old set replaced   |
 * | L1   | EMA + BB drawn                                         | Normal            | 1 fill path + 4 stroke paths in one picture     |
 * | L2   | no items / no data                                     | Boundary (empty)  | empty picture                                   |
 * | L3   | results not aligned (resetVersion differs) / missing   | Abnormal          | nothing drawn                                   |
 * | L4   | all-NaN outputs (period > bars) / unknown output index | Boundary          | nothing drawn                                   |
 * | L5   | profiling on / off                                     | Equivalence       | finite buildMs / NaN                            |
 * | L6   | spacing 0.05 dp, conflation on (group 64 → 16 buckets) | Equivalence       | envelopes: ≤ 2 points / bucket, fill kept       |
 * | L7   | spacing 0.05 dp, conflation off                        | Boundary          | every bar: 1000-point polylines                 |
 * | G1   | legend rows under OHLC                                 | Normal            | label + value in series paint                   |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { FakePaint } from '../../../../jest/mocks/react-native-skia';
import { createUiCandleSeries } from '../../../data/UiCandleSeries';
import { connectIndicatorsToUi } from '../../../engine/IndicatorSync';
import type { IndicatorInput } from '../../../indicators/Indicator';
import { IndicatorEngine } from '../../../indicators/IndicatorEngine';
import { defaultDarkTheme } from '../../../theme/defaultDarkTheme';
import {
  NO_CONFLATION,
  type ConflationStyle,
} from '../../conflation/ConflatedLayers';
import { resolveOverlaySpecs } from '../../indicators/OverlayRenderSpec';
import {
  createIndicatorDrawList,
  type IndicatorDrawList,
} from '../IndicatorPaints';
import { useIndicatorLayer } from '../useIndicatorLayer';
import { useOverlayLayer } from '../useOverlayLayer';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const INPUTS: IndicatorInput[] = [
  { type: 'ema', id: 'ema', config: { period: 20 } },
  { type: 'bollinger', id: 'bb' },
];

function setup(inputs = INPUTS, bars = 1000) {
  const e = engine(bars);
  e.state.series.value = createUiCandleSeries(
    e.store.columns,
    0,
    e.store.resetVersion
  );
  const ind = new IndicatorEngine(e.store, { requestFrame: () => {} });
  ind.setIndicators(inputs);
  ind.flush();
  let unsubscribe = () => {};
  act(() => {
    unsubscribe = connectIndicatorsToUi(ind, e.state);
  });
  tick();
  const specs = resolveOverlaySpecs(
    ind.getEntries(),
    defaultDarkTheme.indicatorPalette
  );
  return {
    e,
    ind,
    drawList: createIndicatorDrawList(specs),
    unsubscribe: () => unsubscribe(),
  };
}

function layer(
  e: ReturnType<typeof engine>,
  drawList: IndicatorDrawList,
  profiling = false,
  conflation: ConflationStyle = NO_CONFLATION
) {
  const hook = renderHook(() =>
    useIndicatorLayer(e.state, drawList, profiling, conflation)
  );
  tick();
  return hook;
}

describe('createIndicatorDrawList', () => {
  it('P1: paints and legend styles', () => {
    // Given
    const { drawList } = setup();
    // When
    const [ema, bb] = drawList.items;
    // Then
    const paint = ema?.strokes[0]?.paint as unknown as FakePaint;
    expect(paint.strokeWidth).toBe(1.5);
    expect(paint.strokeCap).toBe(1);
    expect(paint.alpha).toBe(1);
    expect(bb?.fills).toHaveLength(1);
    expect((bb?.fills[0]?.paint as unknown as FakePaint).alpha).toBeCloseTo(
      0.08,
      9
    );
    expect(drawList.legend.map((l) => l.values.map((v) => v.style))).toEqual([
      [1],
      [2, 3, 4],
    ]);
    expect(drawList.legendPaints).toHaveLength(4);
  });

  it('P2: opacity scales alpha', () => {
    // Given / When
    const { drawList } = setup([
      { type: 'ema', id: 'e', style: { opacity: 0.5 } },
    ]);
    // Then
    expect(
      (drawList.items[0]?.strokes[0]?.paint as unknown as FakePaint).alpha
    ).toBe(0.5);
  });
});

describe('connectIndicatorsToUi', () => {
  it('Y1: mirrors results', () => {
    // Given / When
    const { e, ind } = setup();
    // Then
    const ui = e.state.indicators.value.series.ema;
    expect(ui?.length).toBe(1000);
    expect(ui?.outputs[0]?.[999]).toBe(ind.getResult('ema')?.outputs[0]?.[999]);
    expect(e.state.indicators.value.series.bb?.outputs).toHaveLength(3);
  });

  it('Y2 / Y3: ticks, removal, unsubscribe', () => {
    // Given
    const { e, ind, unsubscribe } = setup();
    const revision = e.state.indicators.value.revision;
    const last = e.store.get(999);
    if (!last) throw new Error('missing bar');
    // When: tick
    act(() => {
      e.store.updateLast({ ...last, close: last.high });
      ind.flush();
    });
    tick();
    // Then
    expect(e.state.indicators.value.revision).toBe(revision + 1);
    expect(e.state.indicators.value.series.ema?.outputs[0]?.[999]).toBe(
      ind.getResult('ema')?.outputs[0]?.[999]
    );
    // When: removal
    act(() => {
      ind.remove('bb');
      ind.flush();
    });
    tick();
    // Then
    expect(e.state.indicators.value.series.bb).toBeUndefined();
    // When: unsubscribed
    unsubscribe();
    act(() => {
      ind.remove('ema');
      ind.flush();
    });
    tick();
    // Then
    expect(e.state.indicators.value.series.ema).toBeDefined();
  });

  it('Y4: reconnect replaces the UI set', () => {
    // Given
    const { e, ind } = setup();
    e.state.indicators.value = {
      series: {
        stale: { outputs: [], length: 0, resetVersion: 0, firstTime: 0 },
      },
      revision: 0,
    };
    // When
    act(() => {
      connectIndicatorsToUi(ind, e.state);
    });
    tick();
    // Then
    expect(Object.keys(e.state.indicators.value.series).sort()).toEqual([
      'bb',
      'ema',
    ]);
  });
});

describe('useIndicatorLayer', () => {
  const paths = (p: ReturnType<typeof pic>) =>
    p.ops.filter((o) => o.op === 'path');

  it('L1: one picture with fills then strokes', () => {
    // Given
    const { e, drawList } = setup();
    // When
    const { result } = layer(e, drawList);
    // Then
    const ops = paths(pic(result.current.picture));
    expect(ops).toHaveLength(5);
    const fill = ops[0];
    expect(
      fill?.op === 'path' && fill.path.commands.some((c) => c.cmd === 'Z')
    ).toBe(true);
    expect(fill?.op === 'path' && fill.paint).toBe(
      drawList.items[1]?.fills[0]?.paint
    );
    expect(Number.isNaN(result.current.frame.value.buildMs)).toBe(true);
  });

  it.each([
    [2, 32],
    [0, 1000],
  ])(
    'L6/L7: conflationPx %p → ≤ %p points per line',
    (conflationPx, maxPoints) => {
      // Given: 0.05 dp bars (all 1000 in view)
      const { e, drawList } = setup();
      e.state.barSpacing.value = 0.05;
      // When
      const { result } = layer(e, drawList, false, {
        conflationPx,
        wickWidth: 1,
        pixelRatio: 1,
      });
      // Then: 1 fill + 4 strokes, strokes bounded by the bucket count
      const ops = paths(pic(result.current.picture));
      expect(ops).toHaveLength(5);
      const points = ops.map((o) =>
        o.op === 'path'
          ? o.path.commands.filter((c) => c.cmd !== 'Z').length
          : 0
      );
      for (const n of points.slice(1)) {
        expect(n).toBeGreaterThan(1);
        expect(n).toBeLessThanOrEqual(maxPoints);
      }
      expect(Math.max(...points.slice(1))).toBeGreaterThan(maxPoints / 2);
    }
  );

  it('L2: empty draw list / no data', () => {
    // Given
    const { e } = setup();
    const empty = createIndicatorDrawList([]);
    const noData = setup(INPUTS, 0);
    // When
    const a = layer(e, empty);
    const b = layer(noData.e, noData.drawList);
    // Then
    expect(pic(a.result.current.picture).ops).toHaveLength(0);
    expect(pic(b.result.current.picture).ops).toHaveLength(0);
  });

  it('L3: unaligned or missing results are skipped', () => {
    // Given
    const { e, drawList } = setup();
    const { result } = layer(e, drawList);
    // When
    act(() => {
      e.state.series.value = createUiCandleSeries(e.store.columns, 0, 99);
    });
    tick();
    // Then
    expect(pic(result.current.picture).ops).toHaveLength(0);
    // When
    act(() => {
      e.state.series.value = createUiCandleSeries(
        e.store.columns,
        0,
        e.store.resetVersion
      );
      e.state.indicators.value = { series: {}, revision: 9 };
    });
    tick();
    // Then
    expect(pic(result.current.picture).ops).toHaveLength(0);
  });

  it('L4: all-NaN outputs and unknown output indices draw nothing', () => {
    // Given
    const { e, drawList } = setup([
      { type: 'bollinger', id: 'bb', config: { period: 5000 } },
    ]);
    const bogus: IndicatorDrawList = {
      ...drawList,
      items: [
        {
          id: 'bb',
          fills: [
            {
              upper: 7,
              lower: 8,
              paint: drawList.items[0]?.fills[0]?.paint as never,
            },
          ],
          strokes: [
            { output: 9, paint: drawList.items[0]?.strokes[0]?.paint as never },
          ],
        },
      ],
    };
    // When
    const a = layer(e, drawList);
    const b = layer(e, bogus);
    // Then
    expect(pic(a.result.current.picture).ops).toHaveLength(0);
    expect(pic(b.result.current.picture).ops).toHaveLength(0);
  });

  it('L5: profiling measures build time', () => {
    // Given
    const { e, drawList } = setup();
    // When
    const { result } = layer(e, drawList, true);
    // Then
    expect(Number.isFinite(result.current.frame.value.buildMs)).toBe(true);
    expect(Number.isFinite(result.current.frame.value.builtAt)).toBe(true);
  });
});

describe('legend indicator rows', () => {
  it('G1: label and value in the series paint', () => {
    // Given
    const { e, drawList, ind } = setup([
      { type: 'ema', id: 'ema', config: { period: 20 } },
    ]);
    // When
    const { result } = renderHook(() => {
      const bar = useSharedValue(60_000);
      return useOverlayLayer(e.state, bar, {
        font: FONT,
        paints: PAINTS,
        pixelRatio: 2,
        timeAxisHeight: 24,
        pricePrecision: 2,
        thousandsSeparator: '',
        timeZone: 'utc',
        showLegend: true,
        showLegendVolume: false,
        indicators: drawList,
      });
    });
    tick();
    // Then
    const ops = pic(result.current.legend).ops;
    const value = (ind.getResult('ema')?.outputs[0]?.[999] as number).toFixed(
      2
    );
    const label = ops.find((o) => o.op === 'text' && o.text === 'EMA 20');
    const text = ops.find((o) => o.op === 'text' && o.text === value);
    expect(label?.op === 'text' && label.paint).toBe(PAINTS.axisText);
    expect(text?.op === 'text' && text.paint).toBe(drawList.legendPaints[0]);
  });
});
