import wabtFactory from '../../build-tools/node_modules/wabt/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const wabt = await wabtFactory();
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
const builds = [];
for (const name of ['numeric', 'strings', 'simd']) {
  const source = readFileSync(new URL(name + '.wat', import.meta.url), 'utf8');
  const module = wabt.parseWat(name + '.wat', source, { reference_types: true, simd: true });
  module.resolveNames();
  module.validate();
  const { buffer } = module.toBinary({ write_debug_names: false });
  writeFileSync(new URL(name + '.wasm', import.meta.url), buffer);
  builds.push({
    name,
    bytes: buffer.length,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    sha256: createHash('sha256').update(buffer).digest('hex'),
  });
  module.destroy();
}
writeFileSync(
  new URL('./results/wasm-build.json', import.meta.url),
  JSON.stringify({ tool: 'wabt@1.0.39', builds }, null, 2) + '\n',
);
console.log(JSON.stringify(builds));
