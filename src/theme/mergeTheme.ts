import { deepMerge, type DeepPartial } from '../utils/deepMerge';
import type { ChartTheme } from './ChartTheme';

export type ChartThemeOverride = DeepPartial<ChartTheme>;

/**
 * Deep-merges `override` over `base` and returns a new theme.
 * Arrays (`indicatorPalette`, dash patterns) are replaced, not merged.
 * Neither argument is mutated.
 */
export function mergeTheme(
  base: ChartTheme,
  override?: ChartThemeOverride | null
): ChartTheme {
  return deepMerge<ChartTheme>(base, override);
}
