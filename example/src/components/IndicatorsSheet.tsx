import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  allowedPlacements,
  createIndicatorInput,
  placementOf,
  type ChartTheme,
  type IndicatorMeta,
  type IndicatorPlacement,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { IndicatorParamsEditor } from './IndicatorParamsEditor';
import { Toggle } from './Toggle';

interface IndicatorsSheetProps {
  controller: TradingChartHandle;
  theme: ChartTheme;
  visible: boolean;
  onClose: () => void;
}

/**
 * "Indicators" bottom sheet built on the library's headless helpers:
 * add (overlay vs pane defaults), edit params (only that indicator
 * recalculates) and remove (cache + empty pane cleaned up).
 */
export function IndicatorsSheet({
  controller,
  theme,
  visible,
  onClose,
}: IndicatorsSheetProps) {
  const engine = controller.indicators;
  const entries = useSyncExternalStore(
    useCallback((cb: () => void) => engine.subscribeEntries(cb), [engine]),
    () => engine.getEntries()
  );
  const [editing, setEditing] = useState<string | null>(null);
  const color = theme.axis.textColor;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color }]}>Indicators</Text>
          <Toggle label="Done" theme={theme} onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.section, { color }]}>Active</Text>
          {entries.length === 0 ? (
            <Text style={{ color }}>None — add one below.</Text>
          ) : null}
          {entries.map((entry) => (
            <View key={entry.id}>
              <View style={styles.row}>
                <Text style={[styles.name, { color }]} numberOfLines={1}>
                  {entry.label} · {placementOf(entry.definition.paneId)}
                </Text>
                <Toggle
                  label="Edit"
                  active={editing === entry.id}
                  theme={theme}
                  onPress={() =>
                    setEditing((id) => (id === entry.id ? null : entry.id))
                  }
                />
                <Toggle
                  label="Remove"
                  theme={theme}
                  onPress={() => controller.removeIndicator(entry.id)}
                />
              </View>
              {editing === entry.id ? (
                <IndicatorParamsEditor
                  controller={controller}
                  entry={entry}
                  theme={theme}
                />
              ) : null}
            </View>
          ))}
          <Text style={[styles.section, { color }]}>Add</Text>
          {engine.registry.list().map((meta) => (
            <AddRow
              key={meta.type}
              meta={meta}
              theme={theme}
              controller={controller}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function AddRow({
  meta,
  theme,
  controller,
}: {
  meta: IndicatorMeta;
  theme: ChartTheme;
  controller: TradingChartHandle;
}) {
  const placements = allowedPlacements(meta);
  const [placement, setPlacement] = useState<IndicatorPlacement>(
    placements[0] as IndicatorPlacement
  );
  const add = () =>
    controller.addIndicator(
      createIndicatorInput(controller.indicators.registry, meta.type, {
        placement,
      })
    );
  return (
    <View style={styles.row}>
      <Text
        style={[styles.name, { color: theme.axis.textColor }]}
        numberOfLines={1}
      >
        {meta.name}
      </Text>
      {placements.length > 1
        ? placements.map((p) => (
            <Toggle
              key={p}
              label={p === 'pane' ? 'Pane' : 'Overlay'}
              active={p === placement}
              theme={theme}
              onPress={() => setPlacement(p)}
            />
          ))
        : null}
      <Toggle label="Add" theme={theme} onPress={add} />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '600' },
  content: { paddingHorizontal: 16, gap: 6 },
  section: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { flex: 1, fontSize: 14 },
});
