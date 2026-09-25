/**
 * Test perspective table — PriceAxisRenderer / TimeAxisRenderer
 *
 * Price pane top 0 / height 100 / [0, 100] (y = 100 - price); text box
 * ascent 8 / descent 2 (half height 5, baseline = y + 3). Time scale:
 * width 100, spacing 10, 10 bars (x(i) = 5 + 10 i); glyphs 4 dp each.
 *
 * | Case | Input / Precondition                                   | Perspective        | Expected                                 |
 * |------|--------------------------------------------------------|--------------------|------------------------------------------|
 * | PA1  | ticks 20 / 50 / 80, no reserved span                   | Equivalence        | 3 labels at textX, centered baselines    |
 * | PA2  | tick whose box crosses the pane edge (2 / 98)          | Boundary           | skipped; box exactly on the edge kept    |
 * | PA3  | reserved span over 50 (with gap)                       | Equivalence        | label 50 skipped                         |
 * | PA4  | label '' / missing                                     | Invalid            | skipped                                  |
 * | PA5  | NaN tick / degenerate scale                            | Invalid            | skipped / 0                              |
 * | PA6  | reserved span with NaN edges                           | Invalid            | ignored (no overlap)                     |
 * | TA1  | ticks at bars 2 / 5                                    | Equivalence        | centered under the bars                  |
 * | TA2  | label clipped by the left / right edge                 | Boundary           | skipped                                  |
 * | TA3  | label exactly touching the edges                       | Boundary           | kept                                     |
 * | TA4  | '' / missing label / NaN position                      | Invalid            | skipped                                  |
 * | TA5  | baseline centered in the gutter                        | Equivalence        | top + height / 2 + 3                     |
 */
import { describe, expect, it } from '@jest/globals';
import { createPriceTicks } from '../../../axes/PriceTicks';
import { createGlyphWidthTable } from '../../../axes/TextMetrics';
import { createTimeTicks } from '../../../axes/TimeTicks';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import type { TimeScaleState } from '../../../viewport/TimeScale';
import type { TextSink } from '../../RenderModel';
import {
  layoutPriceAxisLabels,
  PRICE_LABEL_STYLE,
  type ReservedSpan,
} from '../PriceAxisRenderer';
import { layoutTimeAxisLabels, TIME_LABEL_STYLE } from '../TimeAxisRenderer';

interface Text {
  text: string;
  x: number;
  baseline: number;
  style: number;
}

function recorder(): { sink: TextSink; texts: Text[] } {
  const texts: Text[] = [];
  return {
    texts,
    sink: {
      text(text, x, baseline, style) {
        texts.push({ text, x, baseline, style });
      },
    },
  };
}

const METRICS = { ascent: 8, descent: 2 };
const PRICE: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};
const TIME: TimeScaleState = {
  width: 100,
  barSpacing: 10,
  rightOffset: 0,
  barCount: 10,
};
const GLYPHS = createGlyphWidthTable(new Array<number>(95).fill(4));

function priceTicks(values: number[]) {
  const ticks = createPriceTicks();
  values.forEach((v, i) => {
    ticks.values[i] = v;
  });
  ticks.count = values.length;
  return ticks;
}

function placePrices(
  values: number[],
  labels: string[] = values.map(String),
  reserved: ReservedSpan | null = null,
  price: PriceScaleSnapshot = PRICE
) {
  const { sink, texts } = recorder();
  const count = layoutPriceAxisLabels(
    priceTicks(values),
    labels,
    price,
    { textX: 106, metrics: METRICS, gap: 2 },
    reserved,
    sink
  );
  return { count, texts };
}

function placeTimes(positions: number[], labels: string[]) {
  const ticks = createTimeTicks();
  positions.forEach((p, i) => {
    ticks.positions[i] = p;
  });
  ticks.count = positions.length;
  const { sink, texts } = recorder();
  const count = layoutTimeAxisLabels(
    ticks,
    labels,
    TIME,
    { top: 100, height: 24, metrics: METRICS, glyphs: GLYPHS },
    sink
  );
  return { count, texts };
}

describe('layoutPriceAxisLabels', () => {
  it('PA1: emits one centered label per tick', () => {
    // Given / When
    const { count, texts } = placePrices([20, 50, 80]);
    // Then
    expect(count).toBe(3);
    expect(texts).toEqual([
      { text: '20', x: 106, baseline: 83, style: PRICE_LABEL_STYLE },
      { text: '50', x: 106, baseline: 53, style: PRICE_LABEL_STYLE },
      { text: '80', x: 106, baseline: 23, style: PRICE_LABEL_STYLE },
    ]);
  });

  it('PA2: skips labels crossing the pane edges', () => {
    // Given / When
    const { texts } = placePrices([2, 5, 95, 98]);
    // Then: boxes [93, 103] and [-3, 7] leave the pane; [90, 100] fits
    expect(texts.map((t) => t.text)).toEqual(['5', '95']);
  });

  it('PA3: skips labels overlapping the reserved span', () => {
    // Given / When: badge [40, 44]; label 50 box [45, 55] within gap 2
    const { texts } = placePrices([20, 50, 80], undefined, {
      top: 40,
      bottom: 44,
    });
    // Then
    expect(texts.map((t) => t.text)).toEqual(['20', '80']);
  });

  it('PA4: skips empty and missing labels', () => {
    // Given / When
    const { count } = placePrices([20, 50, 80], ['', '50']);
    // Then
    expect(count).toBe(1);
  });

  it('PA5: skips NaN ticks and degenerate scales', () => {
    // Given / When / Then
    expect(placePrices([NaN, 50]).count).toBe(1);
    expect(
      placePrices([50], ['50'], null, { ...PRICE, min: 50, max: 50 }).count
    ).toBe(0);
  });

  it('PA6: ignores a reserved span with NaN edges', () => {
    // Given / When / Then
    expect(placePrices([50], ['50'], { top: NaN, bottom: NaN }).count).toBe(1);
  });
});

describe('layoutTimeAxisLabels', () => {
  it('TA1/TA5: centers labels under their bars in the gutter', () => {
    // Given / When
    const { texts } = placeTimes([2, 5], ['ab', 'abcd']);
    // Then: x(2) = 25 - 4, x(5) = 55 - 8; baseline 112 + 3
    expect(texts).toEqual([
      { text: 'ab', x: 21, baseline: 115, style: TIME_LABEL_STYLE },
      { text: 'abcd', x: 47, baseline: 115, style: TIME_LABEL_STYLE },
    ]);
  });

  it('TA2: skips labels clipped by the plot edges', () => {
    // Given / When: 'abcd' = 16 dp at x 5 → [-3, 13]; at x 95 → [87, 103]
    const { count } = placeTimes([0, 9], ['abcd', 'abcd']);
    // Then
    expect(count).toBe(0);
  });

  it('TA3: keeps labels touching the edges', () => {
    // Given / When: 'ab' (8 dp) at x 4 and 96 → [0, 8] and [92, 100]
    const { count } = placeTimes([-0.1, 9.1], ['ab', 'ab']);
    // Then
    expect(count).toBe(2);
  });

  it('TA4: skips empty / missing labels and NaN positions', () => {
    // Given / When / Then
    expect(placeTimes([2, 5, NaN], ['', undefined as never, 'x']).count).toBe(
      0
    );
  });
});
