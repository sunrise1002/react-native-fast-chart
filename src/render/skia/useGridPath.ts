import { Skia, type SkPath } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { ChartSharedState } from '../../engine/ChartSharedState';
import {
  buildGridGeometry,
  DEFAULT_GRID_OPTIONS,
  type BarStepFn,
  type PriceStepFn,
} from '../grid/GridGeometry';
import { niceBarStep, nicePriceStep } from '../grid/NiceStep';
import { framePriceScale, frameTimeScale } from './frameScales';

export interface GridStyle {
  lineWidth: number;
  pixelRatio: number;
  /** Worklet tick sources; P4 plugs its axis tick generators in here. */
  priceStep?: PriceStepFn;
  barStep?: BarStepFn;
}

/**
 * Horizontal + vertical grid lines as one Skia path, rebuilt on the UI
 * thread from the viewport shared values (same builder reuse as
 * `useCandlePaths`).
 */
export function useGridPath(
  state: ChartSharedState,
  style: GridStyle
): SharedValue<SkPath> {
  const builder = useMemo(() => Skia.PathBuilder.Make(), []);
  const { series, barSpacing, rightOffset, plotWidth, plotHeight } = state;
  const { priceMin, priceMax } = state;
  const {
    lineWidth,
    pixelRatio,
    priceStep = nicePriceStep,
    barStep = niceBarStep,
  } = style;
  const { priceSpacing, timeSpacing, maxLines } = DEFAULT_GRID_OPTIONS;

  return useDerivedValue(() => {
    const time = frameTimeScale(
      plotWidth,
      barSpacing,
      rightOffset,
      series.value.length
    );
    const price = framePriceScale(plotHeight, priceMin, priceMax);
    builder.reset();
    const rect = { x: 0, y: 0, width: 0, height: 0 };
    buildGridGeometry(
      time,
      price,
      { priceSpacing, timeSpacing, lineWidth, pixelRatio, maxLines },
      {
        line(_horizontal, x, y, w, h) {
          rect.x = x;
          rect.y = y;
          rect.width = w;
          rect.height = h;
          builder.addRect(rect);
        },
      },
      priceStep,
      barStep
    );
    return builder.detach();
  });
}
