import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  parseParamValue,
  type ChartTheme,
  type IndicatorEntry,
  type IndicatorParam,
  type TradingChartHandle,
} from 'react-native-fast-chart';
import { Toggle } from './Toggle';

interface IndicatorParamsEditorProps {
  controller: TradingChartHandle;
  entry: IndicatorEntry;
  theme: ChartTheme;
}

/**
 * Param form of one indicator, generated from `meta.params`. Each commit
 * calls `updateIndicator`, which recalculates only this indicator.
 */
export function IndicatorParamsEditor({
  controller,
  entry,
  theme,
}: IndicatorParamsEditorProps) {
  const commit = (param: IndicatorParam, input: string | number) => {
    const parsed = parseParamValue(param, input);
    if (parsed.valid) {
      controller.updateIndicator(entry.id, {
        config: { ...entry.definition.config, [param.key]: parsed.value },
      });
    }
    return parsed;
  };
  return (
    <View style={styles.form}>
      {entry.meta.params.map((param) => (
        <ParamField
          key={param.key}
          param={param}
          current={entry.definition.config[param.key] ?? param.default}
          theme={theme}
          onCommit={commit}
        />
      ))}
    </View>
  );
}

function ParamField({
  param,
  current,
  theme,
  onCommit,
}: {
  param: IndicatorParam;
  current: unknown;
  theme: ChartTheme;
  onCommit: (
    param: IndicatorParam,
    input: string | number
  ) => ReturnType<typeof parseParamValue>;
}) {
  const [text, setText] = useState(String(current));
  const [hint, setHint] = useState('');
  const color = theme.axis.textColor;
  if (param.kind === 'source' || param.kind === 'choice') {
    const options: readonly string[] = param.options;
    return (
      <View style={styles.row}>
        <Text style={[styles.label, { color }]}>{param.label}</Text>
        <View style={styles.options}>
          {options.map((option) => (
            <Toggle
              key={option}
              label={option}
              active={option === current}
              theme={theme}
              onPress={() => onCommit(param, option)}
            />
          ))}
        </View>
      </View>
    );
  }
  const submit = () => {
    const parsed = onCommit(param, text);
    setText(String(parsed.value));
    setHint(
      !parsed.valid
        ? 'invalid — default kept'
        : parsed.adjusted
          ? `clamped to ${param.min}…${param.max}`
          : ''
    );
  };
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color }]}>{param.label}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        onEndEditing={submit}
        onSubmitEditing={submit}
        keyboardType="numeric"
        style={[styles.input, { color, borderColor: theme.axis.lineColor }]}
      />
      {hint ? <Text style={[styles.hint, { color }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 6, paddingVertical: 6, paddingLeft: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  label: { width: 90, fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 70,
  },
  hint: { fontSize: 11, opacity: 0.7 },
});
