import { jest } from '@jest/globals';
import { act } from '@testing-library/react-native';
import type { FakePicture } from '../../../../jest/mocks/react-native-skia';
import { makeEngine } from '../../../engine/__tests__/engineTestUtils';
import { resizeCanvas } from '../../../engine/LayoutActions';
import { defaultDarkTheme } from '../../../theme/defaultDarkTheme';
import { createChartFont, createChartPaints } from '../SkiaResources';

/*
 * Layer hook fixtures: 1000 × 1 m bars, canvas 464 × 324 → plot 400 × 300,
 * rightOffset 0, price range = data range. Requires fake timers.
 */

export function tick(ms = 20) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

export const FONT = createChartFont(10);
export const PAINTS = createChartPaints(defaultDarkTheme);
export const pic = (v: { readonly value: unknown }) => v.value as FakePicture;

export function engine(bars = 1000) {
  const e = makeEngine(bars);
  resizeCanvas(e.state, e.options, 464, 324, 24);
  e.state.rightOffset.value = 0;
  const s = e.state.series.value;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < s.length; i++) {
    lo = Math.min(lo, s.low[s.offset + i] as number);
    hi = Math.max(hi, s.high[s.offset + i] as number);
  }
  e.state.priceMin.value = bars > 0 ? lo : NaN;
  e.state.priceMax.value = bars > 0 ? hi : NaN;
  return e;
}
