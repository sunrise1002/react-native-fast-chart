import { performance } from 'node:perf_hooks';

interface BenchResult {
  name: string;
  /** Median wall time of one run, ms. */
  medianMs: number;
  /** Median time per logical operation, µs. */
  perOpUs: number;
}

const results: BenchResult[] = [];

/**
 * Runs `fn` `runs` times after `warmup` untimed runs (JIT warm-up) and
 * records the median. `ops` = logical operations performed by one run.
 * `setup` runs before every run and is not timed.
 */
export function bench(
  name: string,
  ops: number,
  fn: () => void,
  { runs = 9, warmup = 3, setup = () => {} } = {}
): BenchResult {
  for (let i = 0; i < warmup; i++) {
    setup();
    fn();
  }
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    setup();
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const medianMs = samples[Math.floor(samples.length / 2)] as number;
  const result = { name, medianMs, perOpUs: (medianMs * 1000) / ops };
  results.push(result);
  return result;
}

/** Prints and clears the recorded results as a Markdown table. */
export function report(title: string): void {
  const lines = [
    `\n### ${title}\n`,
    '| Benchmark | median run (ms) | per op (µs) |',
    '| --- | ---: | ---: |',
    ...results.map(
      (r) =>
        `| ${r.name} | ${r.medianMs.toFixed(3)} | ${r.perOpUs.toFixed(3)} |`
    ),
  ];
  console.log(lines.join('\n'));
  results.length = 0;
}

/** Throws when a sanity check fails (benchmarks must measure real work). */
export function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Benchmark sanity check failed: ${message}`);
  }
}

let sinkValue = 0;
/** Keeps results observable so the JIT cannot drop the work. */
export function consume(value: number): void {
  sinkValue += value;
}
export function sink(): number {
  return sinkValue;
}
