import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChartMetricsSnapshot } from 'react-native-fast-chart';

/** How often the overlay samples the metrics, ms. */
const POLL_MS = 500;

interface DebugOverlayProps {
  /** Returns the current metrics (the chart may swap the instance). */
  getSnapshot: () => ChartMetricsSnapshot;
  /** Extra lines (e.g. feed statistics), sampled with the metrics. */
  getExtraLines?: () => readonly string[];
}

const ms = (v: number) => v.toFixed(2);
const NO_LINES: readonly string[] = [];

/**
 * FPS / frame-time readout for `config.debug.profiling`. Polls the chart
 * metrics on a timer, so the overlay itself never re-renders per frame.
 */
export function DebugOverlay({
  getSnapshot,
  getExtraLines,
}: DebugOverlayProps) {
  const [snapshot, setSnapshot] = useState(getSnapshot);
  const [extra, setExtra] = useState<readonly string[]>(NO_LINES);

  useEffect(() => {
    const id = setInterval(() => {
      setSnapshot(getSnapshot());
      setExtra(getExtraLines?.() ?? NO_LINES);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [getSnapshot, getExtraLines]);

  const { frame, render, indicator } = snapshot.channels;
  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.text}>{`FPS ${snapshot.fps.toFixed(1)}`}</Text>
      <Text style={styles.text}>
        {`frame avg ${ms(frame.avg)} / p95 ${ms(frame.p95)} ms`}
      </Text>
      <Text style={styles.text}>
        {`paths avg ${ms(render.avg)} / p95 ${ms(render.p95)} ms`}
      </Text>
      <Text style={styles.text}>
        {`indicators avg ${ms(indicator.avg)} / p95 ${ms(indicator.p95)} ms`}
      </Text>
      <Text style={styles.text}>{`React renders ${snapshot.renderCount}`}</Text>
      {extra.map((line, i) => (
        <Text key={i} style={styles.text}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 8,
    bottom: 32,
    padding: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  text: { color: '#e8e8e8', fontSize: 11, fontVariant: ['tabular-nums'] },
});
