/** Run every Node experiment in its own Node test worker, not in Bun discovery. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const experiments = resolve(dirname(fileURLToPath(import.meta.url)), '../../experiments');
function discover(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : entry.name.endsWith('.check.mjs') ? [path] : [];
  });
}
const files = discover(experiments).sort();
assert(files.length > 0, 'The Node experiment inventory must not be empty');
const child = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], {
  cwd: experiments,
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(child.stdout ?? '');
process.stderr.write(child.stderr ?? '');
assert.ifError(child.error);
assert.equal(child.status, 0, 'A Node experiment failed');
const output = (child.stdout ?? '') + (child.stderr ?? '');
assert.match(output, /^# tests [1-9]\d*\s*$/m, 'Node must report completed tests');
assert.match(output, /^# fail 0\s*$/m, 'The Node experiment report must be clean');
console.info(`PASS: ${files.length} Node experiment files completed with their original assertions`);
