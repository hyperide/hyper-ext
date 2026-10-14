/** Hermetic compiler dependency probes; node-experiments runs the algorithm suite. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
test('compiler regressions need only the declared site TypeScript dependency', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-compiler-deps-'));
  try {
    const experiment = join(root, 'experiments', '2026-09-08');
    cpSync(fileURLToPath(new URL('../../experiments/2026-09-08/', import.meta.url)), experiment, { recursive: true });
    const modules = join(root, 'site', 'node_modules');
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(root, 'site', 'package.json'), '{"private":true}');
    symlinkSync(dirname(require.resolve('typescript/package.json')), join(modules, 'typescript'), 'dir');
    const env = { ...process.env, PATH: '', NODE_PATH: '' };
    const result = spawnSync(process.execPath, ['--test', join(experiment, 'compile-access.check.mjs')], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-4000));
    rmSync(join(modules, 'typescript'));
    const missing = spawnSync(process.execPath, ['--test', join(experiment, 'compile-access.check.mjs')], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    assert.notEqual(missing.status, 0, 'Removing the only declared compiler dependency must fail');
    assert.match(missing.stdout + missing.stderr, /Cannot find (?:module|package) ['"]typescript/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
