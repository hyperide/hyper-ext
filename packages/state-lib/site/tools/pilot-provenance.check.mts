import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// A package can have identical emitted JS but stale provenance after a source-only edit.
const runtime = fileURLToPath(new URL('../../runtime/', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(runtime, 'PROVENANCE.json'), 'utf8')) as {
  sourceFiles: Record<string, string>;
};
const required = [
  'package.json',
  'src/index.ts',
  'src/core.ts',
  'src/latest-task.ts',
  'src/external-store.ts',
  'tsconfig.build.json',
];
for (const name of required) assert(name in manifest.sourceFiles, `Missing provenance input: ${name}`);
const mismatches: string[] = [];
for (const [relative, expected] of Object.entries(manifest.sourceFiles)) {
  const path = resolve(runtime, relative);
  assert(path.startsWith(resolve(runtime) + sep), 'Provenance input must stay inside runtime');
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== expected) mismatches.push(relative);
}
assert.deepEqual(
  mismatches,
  [],
  'Recorded pilot inputs must describe this source; regenerate with runtime/tools/export-pilot.mjs',
);
console.info(`PASS: all ${Object.keys(manifest.sourceFiles).length} recorded pilot input hashes match this source`);
