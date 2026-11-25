import { composeSpec } from '../src/lib/spec-compose.mjs';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LAB_EXAMPLES } from '../src/data/example-lab/catalogue';
const root = 'public/lab';
const manifest = JSON.parse(readFileSync(`${root}/provenance.json`, 'utf8'));
for (const [name, record] of Object.entries(manifest.assets) as Array<[string, { sha256: string; bytes: number }]>) {
  assert(!name.includes('/') && !name.includes('..'));
  const data = readFileSync(`${root}/${name}`);
  assert.equal(data.byteLength, record.bytes, `${name} size`);
  assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256, `${name} content`);
}
for (const [name, hash] of Object.entries(manifest.harness))
  assert.equal(
    createHash('sha256').update(readFileSync(name)).digest('hex'),
    hash,
    `Regenerate the lab manifest for ${name}`,
  );
for (const example of LAB_EXAMPLES) {
  const project = JSON.parse(readFileSync(`${root}/${example.id}.json`, 'utf8'));
  assert.equal(project.id, example.id);
  assert(Object.keys(project.files).length >= 12);
  assert(project.files[project.entry].includes('createDocumentPublication'));
  assert(project.files['src/state-lib/core.js'].includes('class Runtime'));
  for (const file of project.editable) assert(Object.hasOwn(project.files, file));
  for (const mechanism of example.mechanisms) assert(/^\/spec#[a-z0-9-]+$/.test(mechanism.href));
}
assert(manifest.assets['statec_bg.wasm'].bytes < 2 * 1024 * 1024, 'State compiler download budget');
assert(manifest.assets['esbuild.wasm'].bytes < 16 * 1024 * 1024, 'Bundler download budget');
assert(existsSync('src/lib/example-lab/generated/statec.js'));
console.log('PASS: source-pinned compiler/assets, bounded lazy tooling and complete example sources');

const composed = composeSpec('# Master\n## 5. Compiler\nBody', [[5, '# Embedded chapter\n\n## Mechanism']]);
assert.equal([...composed.matchAll(/^# /gm)].length, 1, 'Only the document owns an H1');
assert(composed.includes('## Embedded chapter'));

assert.deepEqual(
  readFileSync('src/lib/example-lab/generated/statec.js'),
  readFileSync(`${root}/statec.js`),
  'The browser binding must match the pinned published glue',
);
