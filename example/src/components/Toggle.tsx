import { Pressable, StyleSheet, Text } from 'react-native';
import type { ChartTheme } from 'react-native-fast-chart';

interface ToggleProps {
  label: string;
  theme: ChartTheme;
  onPress: () => void;
  active?: boolean;
}

/** Small outlined header button shared by the example screens. */
export function Toggle({ label, theme, onPress, active = false }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.button,
        { borderColor: active ? theme.axis.textColor : theme.axis.lineColor },
      ]}
    >
      <Text style={{ color: theme.axis.textColor }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
