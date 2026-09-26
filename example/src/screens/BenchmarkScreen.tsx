import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  defaultDarkTheme,
  type FrameStatsSummary,
} from 'react-native-fast-chart';
import { SceneRun, type SceneResult } from '../benchmark/SceneRun';
import { BENCH_SCENES, RUN_MS } from '../benchmark/scenes';
import { Toggle } from '../components/Toggle';

/*
 * Benchmark harness (spec §28 scenes A–D, the §36 gate, P8 100k scene).
 * "Run all" plays every scene back to back on a fresh chart: scripted
 * pan → pinch → crosshair (see `benchmark/scenes.ts`) with the scene's
 * realtime feed, then lists UI / JS frame times and dropped frames.
 * Profiling stays off so the chart runs as in production; run a release
 * build for representative numbers.
 */

const fmt = (s: FrameStatsSummary) =>
  `${s.avgMs.toFixed(1)}/${s.p95Ms.toFixed(1)}/${s.maxMs.toFixed(0)} ms ` +
  `drop ${s.dropped}`;

export function BenchmarkScreen() {
  const theme = defaultDarkTheme;
  const [queue, setQueue] = useState<number[]>([]);
  const [results, setResults] = useState<readonly SceneResult[]>([]);
  const [runId, setRunId] = useState(0);
  const current = queue[0];
  const scene = current === undefined ? undefined : BENCH_SCENES[current];

  const start = (indices: number[]) => {
    setResults([]);
    setQueue(indices);
    setRunId((id) => id + 1);
  };
  const onDone = useCallback((result: SceneResult) => {
    setResults((r) => [...r, result]);
    setQueue((q) => q.slice(1));
  }, []);

  const color = { color: theme.axis.textColor };
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <Text style={[styles.title, color]}>Benchmark</Text>
        <Toggle
          label={scene ? 'Running…' : 'Run all'}
          active={scene !== undefined}
          theme={theme}
          onPress={() => start(BENCH_SCENES.map((_, i) => i))}
        />
      </View>
      <ScrollView horizontal style={styles.scenes}>
        {BENCH_SCENES.map((s, i) => (
          <Toggle
            key={s.id}
            label={s.id}
            active={scene?.id === s.id}
            theme={theme}
            onPress={() => start([i])}
          />
        ))}
      </ScrollView>
      <Text style={[styles.status, color]}>
        {scene
          ? `${scene.id}: ${scene.title} (${(RUN_MS / 1000).toFixed(0)} s)`
          : 'UI and JS frame time avg/p95/max, dropped frames at 60 Hz'}
      </Text>
      <View style={styles.chart}>
        {scene ? (
          <SceneRun
            key={`${runId}-${scene.id}`}
            scene={scene}
            theme={theme}
            onDone={onDone}
          />
        ) : null}
      </View>
      <View style={styles.results}>
        {results.map((r) => (
          <Text key={r.id} style={[styles.row, color]}>
            {`${r.id.padEnd(5)} UI ${fmt(r.ui)} · JS ${fmt(r.js)} · ` +
              `${r.bars} bars` +
              (r.heapMb === null ? '' : ` · heap ${r.heapMb.toFixed(0)} MB`)}
          </Text>
        ))}
      </View>
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
  scenes: { flexGrow: 0, paddingHorizontal: 12, gap: 6 },
  status: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 4 },
  chart: { flex: 1 },
  results: { paddingHorizontal: 12, paddingVertical: 8, minHeight: 120 },
  row: { fontSize: 11, fontFamily: 'Menlo', lineHeight: 16 },
});
