import { StyleSheet, View } from 'react-native';
import type { ChartTheme, IndicatorInput } from 'react-native-fast-chart';
import { Toggle } from './Toggle';

export type VolumeMode = 'off' | 'overlay' | 'pane';

/** Which pane indicators are shown (example playground). */
export interface PaneSelection {
  volume: VolumeMode;
  rsi: boolean;
  macd: boolean;
  atr: boolean;
}

export const DEFAULT_PANE_SELECTION: PaneSelection = {
  volume: 'overlay',
  rsi: true,
  macd: false,
  atr: false,
};

const NEXT_VOLUME: Record<VolumeMode, VolumeMode> = {
  off: 'overlay',
  overlay: 'pane',
  pane: 'off',
};

const VOLUME_LABEL: Record<VolumeMode, string> = {
  off: 'Vol off',
  overlay: 'Vol overlay',
  pane: 'Vol pane',
};

/**
 * Indicator inputs for a selection: volume as a price-pane overlay or in
 * its own pane, then RSI / MACD / ATR panes in that order.
 */
export function paneIndicatorInputs(
  selection: PaneSelection
): IndicatorInput[] {
  const inputs: IndicatorInput[] = [];
  if (selection.volume !== 'off') {
    inputs.push({
      type: 'volume',
      config: { maPeriod: 20 },
      ...(selection.volume === 'overlay' ? { paneId: 'price' } : {}),
    });
  }
  if (selection.rsi) {
    inputs.push({ type: 'rsi', config: { period: 14 } });
  }
  if (selection.macd) {
    inputs.push({ type: 'macd' });
  }
  if (selection.atr) {
    inputs.push({ type: 'atr', config: { period: 14 } });
  }
  return inputs;
}

interface PaneSelectorProps {
  selection: PaneSelection;
  theme: ChartTheme;
  onChange: (selection: PaneSelection) => void;
}

/** Row of pane toggles: volume mode cycles off → overlay → pane. */
export function PaneSelector({
  selection,
  theme,
  onChange,
}: PaneSelectorProps) {
  const toggle = (key: 'rsi' | 'macd' | 'atr') =>
    onChange({ ...selection, [key]: !selection[key] });
  return (
    <View style={styles.row}>
      <Toggle
        label={VOLUME_LABEL[selection.volume]}
        active={selection.volume !== 'off'}
        theme={theme}
        onPress={() =>
          onChange({ ...selection, volume: NEXT_VOLUME[selection.volume] })
        }
      />
      <Toggle
        label="RSI"
        active={selection.rsi}
        theme={theme}
        onPress={() => toggle('rsi')}
      />
      <Toggle
        label="MACD"
        active={selection.macd}
        theme={theme}
        onPress={() => toggle('macd')}
      />
      <Toggle
        label="ATR"
        active={selection.atr}
        theme={theme}
        onPress={() => toggle('atr')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
});
