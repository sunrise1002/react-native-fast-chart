import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  DEFAULT_CHART_CONFIG,
  TradingChart,
  defaultDarkTheme,
  defaultLightTheme,
} from 'react-native-fast-chart';
import { EngineDemo } from '../components/EngineDemo';

export type ThemeMode = 'dark' | 'light';

interface PlaygroundScreenProps {
  mode: ThemeMode;
  onModeChange: (mode: ThemeMode) => void;
}

export function PlaygroundScreen({
  mode,
  onModeChange,
}: PlaygroundScreenProps) {
  const theme = mode === 'dark' ? defaultDarkTheme : defaultLightTheme;
  const { width } = useWindowDimensions();
  const plotWidth = width - DEFAULT_CHART_CONFIG.layout.priceAxisWidth;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.axis.textColor }]}>
          Playground
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => onModeChange(mode === 'dark' ? 'light' : 'dark')}
          style={[styles.button, { borderColor: theme.axis.lineColor }]}
        >
          <Text style={{ color: theme.axis.textColor }}>
            {mode === 'dark' ? 'Light theme' : 'Dark theme'}
          </Text>
        </Pressable>
      </View>
      <EngineDemo theme={theme} width={plotWidth} />
      <TradingChart theme={theme} style={styles.chart} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  title: { fontSize: 18, fontWeight: '600' },
  button: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chart: { flex: 1 },
});
