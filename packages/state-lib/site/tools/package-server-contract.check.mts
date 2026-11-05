import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
assert(
  existsSync('tools/package-server-contract.mjs'),
  'Packaging needs explicit package-name and traced-file contracts',
);
const { assertPackageName, assertOnlyPgMappings } = await import('./package-server-contract.mjs');
for (const name of ['pg', 'pg-types', '@scope/package']) assert.doesNotThrow(() => assertPackageName(name));
for (const name of ['.', '..', '@scope/..', '../private', 'pg/other', '']) assert.throws(() => assertPackageName(name));
assert.doesNotThrow(() => assertOnlyPgMappings(undefined));
assert.doesNotThrow(() =>
  assertOnlyPgMappings({
    'node_modules/pg': 'node_modules/pg',
    'node_modules/.bun/pg@8.16.3+635858982ab829dd': 'node_modules/.bun/pg@8.16.3+635858982ab829dd',
  }),
);
for (const mapping of [
  [],
  { '../private.txt': 'private.txt' },
  { 'node_modules/pg': 'server/other.js' },
  { 'node_modules/another': 'node_modules/another' },
])
  assert.throws(() => assertOnlyPgMappings(mapping));
console.log('PASS: invalid dependency names and unhandled traced files stop packaging');
