import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useAnimatedReaction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import {
  DEFAULT_CHART_CONFIG,
  type ChartTheme,
  type TradingChartHandle,
} from 'react-native-fast-chart';

interface JumpToLatestButtonProps {
  controller: TradingChartHandle;
  theme: ChartTheme;
}

/**
 * "Jump to latest" pill shown while the last bar is off screen. Driven by
 * the chart's `isAtRealtime` shared value: React re-renders only when the
 * flag flips, not while panning.
 */
export function JumpToLatestButton({
  controller,
  theme,
}: JumpToLatestButtonProps) {
  const [visible, setVisible] = useState(false);
  const { isAtRealtime } = controller;

  useAnimatedReaction(
    () => isAtRealtime.value,
    (atRealtime, previous) => {
      if (atRealtime !== previous) {
        scheduleOnRN(setVisible, !atRealtime);
      }
    }
  );

  if (!visible) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => controller.scrollToRealtime()}
      style={[
        styles.button,
        {
          backgroundColor: theme.surface,
          borderColor: theme.axis.lineColor,
        },
      ]}
    >
      <Text style={{ color: theme.axis.textColor }}>Jump to latest »</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: DEFAULT_CHART_CONFIG.layout.priceAxisWidth + 8,
    bottom: DEFAULT_CHART_CONFIG.layout.timeAxisHeight + 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
});
