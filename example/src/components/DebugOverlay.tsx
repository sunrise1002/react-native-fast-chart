import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChartMetricsSnapshot } from 'react-native-fast-chart';

/** How often the overlay samples the metrics, ms. */
const POLL_MS = 500;

interface DebugOverlayProps {
  /** Returns the current metrics (the chart may swap the instance). */
  getSnapshot: () => ChartMetricsSnapshot;
}

const ms = (v: number) => v.toFixed(2);

/**
 * FPS / frame-time readout for `config.debug.profiling`. Polls the chart
 * metrics on a timer, so the overlay itself never re-renders per frame.
 */
export function DebugOverlay({ getSnapshot }: DebugOverlayProps) {
  const [snapshot, setSnapshot] = useState(getSnapshot);

  useEffect(() => {
    const id = setInterval(() => setSnapshot(getSnapshot()), POLL_MS);
    return () => clearInterval(id);
  }, [getSnapshot]);

  const { frame, render } = snapshot.channels;
  return (
    <View style={styles.box} pointerEvents="none">
      <Text style={styles.text}>{`FPS ${snapshot.fps.toFixed(1)}`}</Text>
      <Text style={styles.text}>
        {`frame avg ${ms(frame.avg)} / p95 ${ms(frame.p95)} ms`}
      </Text>
      <Text style={styles.text}>
        {`paths avg ${ms(render.avg)} / p95 ${ms(render.p95)} ms`}
      </Text>
      <Text style={styles.text}>{`React renders ${snapshot.renderCount}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    left: 8,
    top: 8,
    padding: 6,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  text: { color: '#e8e8e8', fontSize: 11, fontVariant: ['tabular-nums'] },
});
