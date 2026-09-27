import { useCallback, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  DRAWING_TYPES,
  type ChartTheme,
  type DrawingType,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { Toggle } from './Toggle';

const TOOL_LABELS: Readonly<Record<DrawingType, string>> = {
  trendLine: 'Trend',
  horizontalLine: 'H-Line',
  horizontalRay: 'Ray',
  rectangle: 'Rect',
  fibRetracement: 'Fib',
};

interface DrawingToolbarProps {
  controller: TradingChartHandle;
  theme: ChartTheme;
  onSave: () => void;
  onRestore: () => void;
}

/**
 * Drawing tools (tap-tap creation), delete of the selected drawing and
 * settings save / restore. Re-renders only when drawings, the selection
 * or the active tool change (`subscribeDrawings`).
 */
export function DrawingToolbar({
  controller,
  theme,
  onSave,
  onRestore,
}: DrawingToolbarProps) {
  const subscribe = useCallback(
    (cb: () => void) => controller.subscribeDrawings(cb),
    [controller]
  );
  const tool = useSyncExternalStore(subscribe, () =>
    controller.getDrawingTool()
  );
  const selected = useSyncExternalStore(subscribe, () =>
    controller.getSelectedDrawingId()
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {DRAWING_TYPES.map((type) => (
        <Toggle
          key={type}
          label={TOOL_LABELS[type]}
          active={tool === type}
          theme={theme}
          onPress={() => controller.setDrawingTool(tool === type ? null : type)}
        />
      ))}
      <Toggle
        label="Delete"
        active={selected !== null}
        theme={theme}
        onPress={() => {
          if (selected !== null) controller.removeDrawing(selected);
        }}
      />
      <Toggle label="Save" theme={theme} onPress={onSave} />
      <Toggle label="Restore" theme={theme} onPress={onRestore} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 6, paddingHorizontal: 16, paddingBottom: 6 },
});
