/**
 * Micro-benchmark entry point: `yarn bench` (plain Node, not Jest — Jest's
 * vm sandbox and Babel transform slow hot loops down ~8x). Numbers are
 * V8/JIT on the dev machine; Hermes on devices will be slower, so treat
 * them as relative indicators and regression baselines.
 */
import { runDataBenchmarks } from './data.bench';
import { sink } from './harness';
import { runIndicatorBenchmarks } from './indicators.bench';
import { runRenderBenchmarks } from './render.bench';
import { runViewportBenchmarks } from './viewport.bench';

console.log(`Node ${process.version}`);
runDataBenchmarks();
runViewportBenchmarks();
runRenderBenchmarks();
runIndicatorBenchmarks();
console.log(`\n(sink ${sink() !== 0 ? 'ok' : 'empty'})`);
