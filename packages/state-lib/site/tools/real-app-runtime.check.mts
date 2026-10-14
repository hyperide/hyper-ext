/** App-derived tests run in a separate Node worker; early process.exit cannot fake this gate. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const paths = ['latest-task.test.ts', 'app-contracts.test.ts', 'external-store.test.ts'].map((file) =>
  fileURLToPath(new URL(`../../runtime/src/${file}`, import.meta.url)),
);
const tests = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=tap', ...paths], {
  cwd,
  input: '',
  encoding: 'utf8',
  timeout: 30_000,
  maxBuffer: 4 * 1024 * 1024,
});
process.stdout.write(tests.stdout ?? '');
process.stderr.write(tests.stderr ?? '');
assert.ifError(tests.error);
assert.equal(tests.status, 0, 'App-derived runtime contracts failed');
assert.match(tests.stdout, /^# tests [1-9]\d*\s*$/m);
assert.match(tests.stdout, /^# fail 0\s*$/m);
const types = spawnSync(
  fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url)),
  ['--project', fileURLToPath(new URL('../../runtime/tsconfig.latest.json', import.meta.url)), '--noEmit'],
  { cwd, input: '', encoding: 'utf8', timeout: 30_000 },
);
process.stdout.write(types.stdout ?? '');
process.stderr.write(types.stderr ?? '');
assert.ifError(types.error);
assert.equal(types.status, 0, 'Async result type contracts failed');
console.info('PASS: app-derived atomic publication, latest/cancel/error ownership and strict sync-commit types');
