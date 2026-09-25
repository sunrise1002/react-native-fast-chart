/**
 * Test perspective table — LastPriceRenderer
 *
 * Pane top 0 / height 100 / [0, 100] (y = 100 - price), badge height 10.
 *
 * | Case | Input / Precondition                          | Perspective        | Expected                                     |
 * |------|-----------------------------------------------|--------------------|----------------------------------------------|
 * | LP1  | last close 60 > open 50                       | Equivalence        | bullish, line y 40, badge centered (35)      |
 * | LP2  | close < open                                  | Equivalence        | bearish                                      |
 * | LP3  | close == open                                 | Boundary           | bullish (unchanged counts as up)             |
 * | LP4  | close above the pane (150)                    | Boundary           | pinned top, badge top 0, line NaN            |
 * | LP5  | close below the pane (-50)                    | Boundary           | pinned bottom, badge top 90, line NaN        |
 * | LP6  | close exactly on the edges (100 / 0)          | Boundary           | not pinned, badge clamped into the pane      |
 * | LP7  | no bars / NaN close / height 0 / min == max   | Invalid            | invisible                                    |
 * | LP8  | badge height NaN / -1 / ∞                     | Invalid            | badge height 0                               |
 * | LP9  | columns with a physical offset                | Equivalence        | reads the last logical bar                   |
 */
import { describe, expect, it } from '@jest/globals';
import type { PriceScaleSnapshot } from '../../../viewport/PriceScale';
import { columns } from '../../__tests__/columns';
import {
  computeLastPriceMarker,
  createLastPriceMarker,
  LAST_PRICE_PINNED_BOTTOM,
  LAST_PRICE_PINNED_NONE,
  LAST_PRICE_PINNED_TOP,
} from '../LastPriceRenderer';

const PRICE: PriceScaleSnapshot = {
  mode: 'linear',
  top: 0,
  height: 100,
  min: 0,
  max: 100,
};

function marker(
  open: number,
  close: number,
  price: PriceScaleSnapshot = PRICE,
  badge = 10
) {
  const out = createLastPriceMarker();
  const visible = computeLastPriceMarker(
    columns([
      [1, 1, 1, 1, 1],
      [open, 0, 0, close, 0],
    ]),
    price,
    badge,
    out
  );
  return { visible, out };
}

describe('computeLastPriceMarker', () => {
  it('LP1: bullish line and centered badge', () => {
    // Given / When
    const { visible, out } = marker(50, 60);
    // Then
    expect(visible).toBe(true);
    expect(out).toMatchObject({
      price: 60,
      bullish: true,
      lineY: 40,
      badgeTop: 35,
      badgeHeight: 10,
      pinned: LAST_PRICE_PINNED_NONE,
    });
  });

  it('LP2: bearish when close < open', () => {
    // Given / When / Then
    expect(marker(60, 50).out.bullish).toBe(false);
  });

  it('LP3: unchanged bar counts as bullish', () => {
    // Given / When / Then
    expect(marker(50, 50).out.bullish).toBe(true);
  });

  it('LP4: pins the badge to the top when the price is above', () => {
    // Given / When
    const { out } = marker(50, 150);
    // Then
    expect(out.pinned).toBe(LAST_PRICE_PINNED_TOP);
    expect(out.badgeTop).toBe(0);
    expect(out.lineY).toBeNaN();
  });

  it('LP5: pins the badge to the bottom when the price is below', () => {
    // Given / When
    const { out } = marker(50, -50);
    // Then
    expect(out.pinned).toBe(LAST_PRICE_PINNED_BOTTOM);
    expect(out.badgeTop).toBe(90);
    expect(out.lineY).toBeNaN();
  });

  it.each([
    [100, 0, 0],
    [0, 100, 90],
  ])('LP6: close %p on the edge → line %p, badge %p', (close, y, top) => {
    // Given / When
    const { out } = marker(50, close);
    // Then
    expect(out.pinned).toBe(LAST_PRICE_PINNED_NONE);
    expect(out.lineY).toBe(y);
    expect(out.badgeTop).toBe(top);
  });

  it('LP7: invisible for empty / invalid input', () => {
    // Given
    const out = createLastPriceMarker();
    // When / Then
    expect(computeLastPriceMarker(columns([]), PRICE, 10, out)).toBe(false);
    expect(marker(50, NaN).visible).toBe(false);
    expect(marker(50, 60, { ...PRICE, height: 0 }).visible).toBe(false);
    expect(marker(50, 60, { ...PRICE, min: 5, max: 5 }).visible).toBe(false);
    expect(out.badgeTop).toBeNaN();
  });

  it.each([[NaN], [-1], [Infinity]])('LP8: badge height %p → 0', (h) => {
    // Given / When / Then
    expect(marker(50, 60, PRICE, h).out.badgeHeight).toBe(0);
  });

  it('LP9: honors the physical offset', () => {
    // Given
    const out = createLastPriceMarker();
    // When
    computeLastPriceMarker(
      columns([[50, 0, 0, 70, 0]], Date.UTC(2024, 0, 1), 3),
      PRICE,
      10,
      out
    );
    // Then
    expect(out.price).toBe(70);
  });
});
