import { Canvas, Fill } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ChartTheme } from '../theme/ChartTheme';
import { defaultDarkTheme } from '../theme/defaultDarkTheme';
import { mergeTheme, type ChartThemeOverride } from '../theme/mergeTheme';

export interface TradingChartProps {
  /**
   * Base theme. Defaults to `defaultDarkTheme`. Keep the reference stable
   * (module constant or `useMemo`) to avoid re-resolving on every render.
   */
  theme?: ChartTheme;
  /** Partial overrides deep-merged over `theme`. Keep the reference stable. */
  themeOverride?: ChartThemeOverride;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Candlestick trading chart. Phase P1 renders only the themed Skia canvas;
 * data, viewport, candles and gestures arrive in later phases.
 */
export function TradingChart({
  theme = defaultDarkTheme,
  themeOverride,
  style,
  testID,
}: TradingChartProps) {
  const resolvedTheme = useMemo(
    () => (themeOverride ? mergeTheme(theme, themeOverride) : theme),
    [theme, themeOverride]
  );

  return (
    <Canvas style={[styles.canvas, style]} testID={testID}>
      <Fill color={resolvedTheme.background} />
    </Canvas>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1 },
});
