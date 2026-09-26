/**
 * Test perspective table — pane rendering: usePaneScales, usePaneLayer,
 * pane axes, pane legends, crosshair across panes
 * (Skia mocked, real Reanimated, fake timers; fixtures in layerTestUtils:
 * canvas 464 × 324 → stack 300 dp; RSI + MACD panes → 180 / 60 / 60.)
 *
 * | Case | Input / Precondition                                   | Perspective       | Expected                                           |
 * |------|--------------------------------------------------------|-------------------|----------------------------------------------------|
 * | R1   | pane item / overlay item / unknown pane                | Equivalence       | pane rect / bottom ratio of price / zero height    |
 * | R2   | overlay ratio 0 / 1 / 1.5                              | Boundary          | whole pane                                         |
 * | S1   | RSI, MACD, volume overlay with data                    | Normal            | padded 0–100 RSI, finite MACD, rects follow layout |
 * | S2   | no data                                                | Boundary (empty)  | NaN ranges                                         |
 * | S3   | no indicator results yet                               | Abnormal          | NaN ranges (fixed RSI kept)                        |
 * | PL1  | RSI + MACD + volume                                    | Normal            | underlay: 2 buckets; panes: 2 clips, band, guides  |
 * | PL2  | no items / no data                                     | Boundary (empty)  | empty pictures                                     |
 * | PL3  | pane collapsed (not in layout) / invalid scale         | Abnormal          | skipped                                            |
 * | PL4  | results not aligned                                    | Abnormal          | clip + guides only, no histogram                   |
 * | PL5  | unknown histogram output                               | Invalid           | no histogram path                                  |
 * | PL6  | non-finite guide level / band bound                    | Invalid           | skipped (valid guides still drawn)                 |
 * | PL7  | spacing 0.05 dp at pr 2 (group 32 → 32 buckets)        | Equivalence       | ≤ 1 histogram rect per bucket (volume, MACD)       |
 * | AX1  | pane axes                                              | Normal            | RSI at guide levels, MACD ticks, widest counts     |
 * | AX2  | no scale frame / invalid scale / overlay only          | Abnormal          | no pane labels                                     |
 * | AX3  | guide labels with chart decimals (-1)                  | Boundary          | integer labels                                     |
 * | LG1  | pane legends                                           | Normal            | captions at the pane tops, volume under OHLC       |
 * | LG2  | pane shorter than a legend row                         | Boundary          | legend skipped                                     |
 * | CH1  | crosshair in the RSI pane                              | Normal            | vertical line spans stack, RSI value label         |
 * | CH2  | crosshair in a pane without a valid scale              | Abnormal          | vertical line only, no value label                 |
 * | CH3  | crosshair in the price pane                            | Equivalence       | price label (unchanged behaviour)                  |
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { FakeDrawOp } from '../../../../jest/mocks/react-native-skia';
import { createUiCandleSeries } from '../../../data/UiCandleSeries';
import { showCrosshair } from '../../../engine/CrosshairActions';
import { connectIndicatorsToUi } from '../../../engine/IndicatorSync';
import { setPaneSpec } from '../../../engine/LayoutActions';
import { toPaneLayoutSpec } from '../../../engine/PaneSync';
import type { IndicatorInput } from '../../../indicators/Indicator';
import { IndicatorEngine } from '../../../indicators/IndicatorEngine';
import { PaneManager } from '../../../panes/PaneManager';
import { defaultDarkTheme } from '../../../theme/defaultDarkTheme';
import { resolvePaneSpecs } from '../../panes/PaneRenderSpec';
import { createPaneDrawList, type PaneDrawItem } from '../PanePaints';
import { useAxesLayer } from '../useAxesLayer';
import { useOverlayLayer } from '../useOverlayLayer';
import { usePaneLayer } from '../usePaneLayer';
import { paneItemRect, usePaneScales } from '../usePaneScales';
import { engine, FONT, PAINTS, pic, tick } from './layerTestUtils';

beforeEach(() => {
  jest.useFakeTimers();
});

const INPUTS: IndicatorInput[] = [
  { type: 'volume', id: 'vol', paneId: 'price' },
  { type: 'rsi', id: 'rsi' },
  { type: 'macd', id: 'macd' },
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
  const panes = new PaneManager();
  panes.sync(ind.getEntries());
  act(() => {
    connectIndicatorsToUi(ind, e.state);
    setPaneSpec(e.state, e.options, toPaneLayoutSpec(panes.getPanes()));
  });
  tick();
  const items = createPaneDrawList(
    resolvePaneSpecs(ind.getEntries(), panes.getPanes(), defaultDarkTheme)
  );
  return { e, ind, items };
}

type Engine = ReturnType<typeof engine>;

function layers(e: Engine, items: readonly PaneDrawItem[]) {
  const hook = renderHook(() => {
    const scales = usePaneScales(e.state, items, 0.2);
    const frame = usePaneLayer(e.state, items, scales, {
      paints: PAINTS,
      bodyRatio: 0.7,
      wickWidth: 1,
      conflationPx: 2,
      pixelRatio: 2,
    });
    return { scales, frame };
  });
  tick();
  return hook;
}

const opsOf = (ops: readonly FakeDrawOp[], op: FakeDrawOp['op']) =>
  ops.filter((o) => o.op === op);

describe('paneItemRect', () => {
  const frame = {
    ids: ['price', 'a'],
    tops: [0, 200],
    heights: [200, 100],
    total: 300,
  };

  it('R1: pane, overlay and unknown pane rects', () => {
    // Given
    const out = { top: -1, height: -1 };
    // When / Then
    paneItemRect(frame, 'a', false, 0.2, out);
    expect(out).toEqual({ top: 200, height: 100 });
    paneItemRect(frame, 'price', true, 0.2, out);
    expect(out).toEqual({ top: 160, height: 40 });
    paneItemRect(frame, 'missing', false, 0.2, out);
    expect(out).toEqual({ top: 0, height: 0 });
  });

  it.each([0, 1, 1.5])('R2: overlay ratio %p takes the whole pane', (r) => {
    // Given
    const out = { top: -1, height: -1 };
    // When
    paneItemRect(frame, 'price', true, r, out);
    // Then
    expect(out).toEqual({ top: 0, height: 200 });
  });
});

describe('usePaneScales', () => {
  it('S1: scales follow the layout and the values', () => {
    // Given
    const { e, items } = setup();
    // When
    const { result } = layers(e, items);
    // Then
    expect(items.map((i) => [i.paneId, i.overlay])).toEqual([
      ['price', true],
      ['pane:rsi', false],
      ['pane:macd', false],
    ]);
    const [vol, rsi, macd] = result.current.scales.value.scales;
    expect(vol).toMatchObject({ top: 144, height: 36 });
    expect(vol?.min).toBe(0);
    expect(rsi).toMatchObject({ top: 180, height: 60, min: -5, max: 105 });
    expect(macd).toMatchObject({ top: 240, height: 60 });
    expect(Number.isFinite(macd?.min)).toBe(true);
    expect(macd!.max).toBeGreaterThan(macd!.min);
  });

  it('S2: no data gives NaN ranges', () => {
    // Given
    const { items } = setup();
    const e = engine(0);
    // When
    const { result } = layers(e, items);
    // Then
    for (const s of result.current.scales.value.scales) {
      expect(s.min).toBeNaN();
      expect(s.max).toBeNaN();
    }
  });

  it('S3: missing results give NaN ranges except fixed scales', () => {
    // Given: items from another engine, nothing synced to this state
    const { items } = setup();
    const e = engine();
    // When
    const { result } = layers(e, items);
    // Then
    const [vol, rsi, macd] = result.current.scales.value.scales;
    expect(vol?.min).toBeNaN();
    expect(rsi?.min).toBe(-5);
    expect(macd?.min).toBeNaN();
  });
});

describe('usePaneLayer', () => {
  it('PL1: underlay volume and clipped panes', () => {
    // Given
    const { e, items } = setup();
    // When
    const { result } = layers(e, items);
    // Then
    const { underlay, panes } = result.current.frame.value;
    const under = pic({ value: underlay }).ops;
    expect(opsOf(under, 'clip')).toHaveLength(1);
    expect(opsOf(under, 'path')).toHaveLength(2);
    const ops = pic({ value: panes }).ops;
    expect(opsOf(ops, 'clip').map((o) => (o as { rect: object }).rect)).toEqual(
      [
        { x: 0, y: 180, width: 400, height: 60 },
        { x: 0, y: 240, width: 400, height: 60 },
      ]
    );
    expect(opsOf(ops, 'save')).toHaveLength(2);
    expect(opsOf(ops, 'restore')).toHaveLength(2);
    // RSI band + 30 / 50 / 70 guides; MACD zero line.
    expect(opsOf(ops, 'rect')).toHaveLength(1);
    expect(opsOf(ops, 'line').length).toBeGreaterThanOrEqual(3);
    // RSI line, MACD histogram buckets + MACD / signal lines.
    expect(opsOf(ops, 'path').length).toBeGreaterThanOrEqual(5);
  });

  it('PL7: conflated histograms draw one bar per bucket', () => {
    // Given: 1000 bars at 0.05 dp (0.1 px slots → groups of 32)
    const { e, items } = setup();
    e.state.barSpacing.value = 0.05;
    // When
    const { result } = layers(e, items);
    // Then
    const { underlay, panes } = result.current.frame.value;
    const rectsOf = (ops: readonly FakeDrawOp[]) =>
      opsOf(ops, 'path').reduce(
        (n, o) => n + (o.op === 'path' ? o.path.rects.length : 0),
        0
      );
    const volume = rectsOf(pic({ value: underlay }).ops);
    const macd = rectsOf(pic({ value: panes }).ops);
    expect(volume).toBeGreaterThan(16);
    expect(volume).toBeLessThanOrEqual(32);
    expect(macd).toBeGreaterThan(16);
    expect(macd).toBeLessThanOrEqual(32);
  });

  it('PL2: empty pictures without items or data', () => {
    // Given
    const { items } = setup();
    // When
    const noItems = layers(engine(), []);
    const noData = layers(engine(0), items);
    // Then
    for (const hook of [noItems, noData]) {
      const { underlay, panes } = hook.result.current.frame.value;
      expect(pic({ value: underlay }).ops).toHaveLength(0);
      expect(pic({ value: panes }).ops).toHaveLength(0);
    }
  });

  it('PL3: collapsed panes and invalid scales are skipped', () => {
    // Given: only the price pane is laid out
    const { e, items } = setup();
    act(() => {
      setPaneSpec(e.state, e.options, {
        ids: ['price'],
        ratios: [1],
        minHeights: [0],
      });
    });
    tick();
    // When
    const { result } = layers(e, items);
    // Then: RSI / MACD have zero height; volume still drawn
    const { underlay, panes } = result.current.frame.value;
    expect(pic({ value: panes }).ops).toHaveLength(0);
    expect(opsOf(pic({ value: underlay }).ops, 'path')).toHaveLength(2);
  });

  it('PL4: unaligned results draw guides only', () => {
    // Given
    const { e, items } = setup();
    const set = e.state.indicators.value;
    act(() => {
      e.state.indicators.value = {
        ...set,
        series: Object.fromEntries(
          Object.entries(set.series).map(([k, s]) => [
            k,
            { ...s, resetVersion: s.resetVersion + 1 },
          ])
        ),
      };
    });
    // When
    const { result } = layers(e, items);
    // Then: RSI keeps its fixed scale; nothing else is drawable
    const ops = pic({ value: result.current.frame.value.panes }).ops;
    expect(opsOf(ops, 'clip')).toHaveLength(1);
    expect(opsOf(ops, 'path')).toHaveLength(0);
    expect(opsOf(ops, 'line')).toHaveLength(3);
  });

  it('PL5: unknown histogram outputs draw nothing', () => {
    // Given
    const { e, items } = setup([{ type: 'volume', id: 'vol' }]);
    const broken = items.map((i) => ({
      ...i,
      histograms: i.histograms.map((h) => ({ ...h, output: 9 })),
    }));
    // When
    const { result } = layers(e, broken);
    // Then
    const ops = pic({ value: result.current.frame.value.panes }).ops;
    expect(opsOf(ops, 'clip')).toHaveLength(1);
    expect(opsOf(ops, 'path')).toHaveLength(0);
  });
});

describe('guides', () => {
  it('PL6: non-finite guides are skipped', () => {
    // Given
    const { e, items } = setup([{ type: 'rsi', id: 'rsi' }]);
    const broken = items.map((i) => ({
      ...i,
      guideLevels: [Infinity, 50],
      guideBand: { upper: NaN, lower: 30 },
    }));
    // When
    const { result } = layers(e, broken);
    // Then
    const ops = pic({ value: result.current.frame.value.panes }).ops;
    expect(opsOf(ops, 'rect')).toHaveLength(0);
    expect(opsOf(ops, 'line')).toHaveLength(1);
  });
});

function axes(e: Engine, items: readonly PaneDrawItem[], withScales = true) {
  return renderHook(() => {
    const bar = useSharedValue(60_000);
    const scales = usePaneScales(e.state, items, 0.2);
    return useAxesLayer(e.state, bar, {
      font: FONT,
      paints: PAINTS,
      gridLineWidth: 1,
      pixelRatio: 2,
      timeAxisHeight: 24,
      pricePrecision: NaN,
      thousandsSeparator: ',',
      timeZone: 'utc',
      showLastPrice: false,
      panes: items,
      paneScales: withScales ? scales : undefined,
    });
  });
}

const textYs = (ops: readonly FakeDrawOp[]) =>
  ops.flatMap((o) => (o.op === 'text' ? [{ text: o.text, y: o.y }] : []));

describe('pane axes', () => {
  it('AX1: each pane gets its own labels', () => {
    // Given
    const { e, items } = setup();
    const base = axes(e, []);
    // When
    const { result } = axes(e, items);
    tick();
    // Then
    const all = textYs(pic(result.current.picture).ops);
    const baseCount = textYs(pic(base.result.current.picture).ops).length;
    const extra = all.length - baseCount;
    expect(extra).toBeGreaterThanOrEqual(4);
    // RSI is labelled at its guide levels, inside the RSI pane.
    const rsi = all.filter((t) => t.y > 180 && t.y < 240).map((t) => t.text);
    expect(rsi.map(Number).sort((a, b) => a - b)).toEqual([30, 50, 70]);
    // MACD: generic ticks inside the MACD pane.
    expect(all.filter((t) => t.y > 240 && t.y < 300).length).toBeGreaterThan(0);
    expect(result.current.frame.value.requiredAxisWidth).toBeGreaterThan(0);
  });

  it('AX2: no labels without a scale frame, valid scale or pane', () => {
    // Given
    const { e, items } = setup();
    const base = axes(e, []);
    tick();
    const baseCount = pic(base.result.current.picture).texts().length;
    // When
    const noFrame = axes(e, items, false);
    const overlayOnly = axes(
      e,
      items.filter((i) => i.overlay)
    );
    const noData = axes(engine(), items.slice(2));
    tick();
    // Then
    expect(pic(noFrame.result.current.picture).texts()).toHaveLength(baseCount);
    expect(pic(overlayOnly.result.current.picture).texts()).toHaveLength(
      baseCount
    );
    // MACD without results → no MACD labels.
    expect(pic(noData.result.current.picture).texts()).toHaveLength(baseCount);
  });
});

describe('guide labels', () => {
  it('AX3: chart decimals (-1) label guide levels as integers', () => {
    // Given
    const { e, items } = setup([{ type: 'rsi', id: 'rsi' }]);
    const chartFormat = items.map((i) => ({
      ...i,
      format: { decimals: -1, compact: false },
    }));
    // When
    const { result } = axes(e, chartFormat);
    tick();
    // Then
    const texts = textYs(pic(result.current.picture).ops)
      .filter((t) => t.y > 225)
      .map((t) => t.text);
    expect(texts).toEqual(expect.arrayContaining(['30', '50', '70']));
  });
});

function overlay(e: Engine, items: readonly PaneDrawItem[]) {
  return renderHook(() => {
    const bar = useSharedValue(60_000);
    const scales = usePaneScales(e.state, items, 0.2);
    return useOverlayLayer(e.state, bar, {
      font: FONT,
      paints: PAINTS,
      pixelRatio: 2,
      timeAxisHeight: 24,
      pricePrecision: NaN,
      thousandsSeparator: ',',
      timeZone: 'utc',
      showLegend: true,
      showLegendVolume: false,
      panes: items,
      paneScales: scales,
    });
  });
}

describe('pane legends', () => {
  it('LG1: captions at the pane tops, volume under the OHLC row', () => {
    // Given
    const { e, items } = setup();
    // When
    const { result } = overlay(e, items);
    tick();
    // Then
    const texts = textYs(pic(result.current.legend).ops);
    const caption = (name: string) => texts.find((t) => t.text === name);
    expect(caption('Vol')!.y).toBeLessThan(40);
    expect(caption('RSI 14')!.y).toBeGreaterThan(180);
    expect(caption('RSI 14')!.y).toBeLessThan(200);
    expect(caption('MACD 12 26 9')!.y).toBeGreaterThan(240);
  });

  it('LG2: panes shorter than a row get no legend', () => {
    // Given
    const { e, items } = setup();
    act(() => {
      setPaneSpec(e.state, e.options, {
        ids: ['price', 'pane:rsi', 'pane:macd'],
        ratios: [1000, 1, 1],
        minHeights: [0, 0, 0],
      });
    });
    tick();
    // When
    const { result } = overlay(e, items);
    tick();
    // Then
    const texts = pic(result.current.legend).texts();
    expect(texts).toContain('Vol');
    expect(texts).not.toContain('RSI 14');
  });
});

describe('crosshair across panes', () => {
  const vertical = (ops: readonly FakeDrawOp[]) =>
    opsOf(ops, 'line').find((o) => o.op === 'line' && o.x0 === o.x1) as Extract<
      FakeDrawOp,
      { op: 'line' }
    >;

  it('CH1: value label on the RSI scale, vertical line spans the stack', () => {
    // Given
    const { e, items } = setup();
    const { result } = overlay(e, items);
    // When: RSI pane 180–240, y = 210 → RSI 50
    act(() => showCrosshair(e.state, 200, 210));
    tick();
    // Then
    const ops = pic(result.current.crosshair).ops;
    expect(opsOf(ops, 'line')).toHaveLength(2);
    expect(vertical(ops)).toMatchObject({ y0: 0, y1: 300 });
    const texts = pic(result.current.crosshair).texts();
    expect(Number(texts[0])).toBeCloseTo(50, 0);
    const label = opsOf(ops, 'rrect')[0] as Extract<
      FakeDrawOp,
      { op: 'rrect' }
    >;
    expect(label.rect.y).toBeGreaterThanOrEqual(180);
    expect(label.rect.y + label.rect.height).toBeLessThanOrEqual(240);
  });

  it('CH2: no horizontal line in a pane without a scale', () => {
    // Given: MACD without results
    const { items } = setup();
    const e = engine();
    act(() => {
      setPaneSpec(e.state, e.options, {
        ids: ['price', 'pane:rsi', 'pane:macd'],
        ratios: [3, 1, 1],
        minHeights: [0, 0, 0],
      });
    });
    const { result } = overlay(e, items);
    // When
    act(() => showCrosshair(e.state, 200, 270));
    tick();
    // Then: vertical line + time label only
    const ops = pic(result.current.crosshair).ops;
    expect(opsOf(ops, 'line')).toHaveLength(1);
    expect(vertical(ops)).toMatchObject({ y0: 0, y1: 300 });
    expect(pic(result.current.crosshair).texts()).toHaveLength(1);
  });

  it('CH3: price pane keeps the price label', () => {
    // Given
    const { e, items } = setup();
    const { result } = overlay(e, items);
    // When
    act(() => showCrosshair(e.state, 200, 90));
    tick();
    // Then
    const ops = pic(result.current.crosshair).ops;
    expect(opsOf(ops, 'line')).toHaveLength(2);
    const price = Number(
      pic(result.current.crosshair).texts()[0]?.replace(/,/g, '')
    );
    expect(price).toBeGreaterThanOrEqual(e.state.priceMin.value);
    expect(price).toBeLessThanOrEqual(e.state.priceMax.value);
  });
});
