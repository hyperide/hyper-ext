import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { runBenchmark } from './benchmark.mjs';
const result = await runBenchmark(
  JSON.parse(await readFile(new URL('./results/binaries.json', import.meta.url), 'utf8')),
);
result.environment = {
  node: process.version,
  v8: process.versions.v8,
  cpu: os.cpus()[0].model,
  platform: os.platform(),
  arch: os.arch(),
};
await writeFile(new URL('./results/node.json', import.meta.url), JSON.stringify(result, null, 2));
for (const c of result.results)
  console.info(c.n, c.scenario, Object.fromEntries(c.variants.map((v) => [v.name, +v.medianMs.toFixed(4)])));
