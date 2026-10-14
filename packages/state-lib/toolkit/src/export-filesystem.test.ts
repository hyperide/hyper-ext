import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const toolkitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(toolkitRoot, '../../..');
const exporterUrl = pathToFileURL(resolve(toolkitRoot, 'tools/export-package.mjs')).href;

// Each case patches OS failure boundaries in its own Node process. The real
// exporter, TypeScript compiler and filesystem run; no patch leaks into Bun's
// module cache or another test. All fixture-owned paths are removed afterwards.
function runFilesystemCase(body: string, parent = tmpdir()): void {
  const program = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import childProcess from 'node:child_process';
    import { basename, dirname, join } from 'node:path';
    import { syncBuiltinESMExports } from 'node:module';
    const scratch = fs.mkdtempSync(join(${JSON.stringify(parent)}, 'toolkit-io-case-'));
    const dest = join(scratch, 'package');
    const owned = [];
    const patches = [];
    function patch(object, key, replacement) {
      patches.push([object, key, object[key]]);
      object[key] = replacement;
      syncBuiltinESMExports();
    }
    const makeTemporary = fs.mkdtempSync;
    patch(fs, 'mkdtempSync', (...args) => {
      const path = makeTemporary(...args);
      owned.push(path);
      return path;
    });
    try {
      const { exportPackage } = await import(${JSON.stringify(exporterUrl)});
      ${body}
    } finally {
      for (const [object, key, original] of patches.reverse()) object[key] = original;
      syncBuiltinESMExports();
      for (const path of owned) fs.rmSync(path, { recursive: true, force: true });
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  `;
  execFileSync(process.env.NODE_BIN ?? 'node', ['--input-type=module', '--eval', program], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

test('EXDEV retains its cause and never copies into the destination', () => {
  runFilesystemCase(`
    const failure = Object.assign(new Error('injected cross-device rename'), { code: 'EXDEV' });
    const rename = fs.renameSync;
    patch(fs, 'renameSync', (source, target) => {
      if (target === dest) throw failure;
      return rename(source, target);
    });
    assert.throws(() => exportPackage({ dest }), (error) => error.cause === failure);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(scratch), []);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});

test('destination lookup propagates EACCES instead of treating it as absence', () => {
  runFilesystemCase(`
    const failure = Object.assign(new Error('injected destination access failure'), { code: 'EACCES' });
    const lstat = fs.lstatSync;
    patch(fs, 'lstatSync', (path, ...args) => {
      if (path === dest) throw failure;
      return lstat(path, ...args);
    });
    assert.throws(() => exportPackage({ dest }), (error) => error === failure);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(owned.length, 0, 'a rejected destination must not start staging');
  `);
});

test('a dangling destination symlink is refused without changing the link', () => {
  runFilesystemCase(`
    fs.symlinkSync('missing-target', dest, 'dir');
    assert.throws(() => exportPackage({ dest }), /never overwritten/);
    assert.equal(fs.readlinkSync(dest), 'missing-target');
    assert.equal(fs.lstatSync(dest).isSymbolicLink(), true);
    assert.equal(owned.length, 0, 'an existing link must be refused before compilation');
  `);
});

test('export performs all temporary cleanup before publishing the package', () => {
  runFilesystemCase(`
    const remove = fs.rmSync;
    patch(fs, 'rmSync', (...args) => {
      assert.equal(fs.existsSync(dest), false, 'cleanup after publication can turn success into failure');
      return remove(...args);
    });
    const result = exportPackage({ dest });
    assert.equal(result.dest, dest);
    assert.ok(fs.existsSync(join(dest, 'dist/index.js')));
    assert.deepEqual(fs.readdirSync(scratch), ['package']);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});

test('cleanup failure before promotion leaves no destination', () => {
  runFilesystemCase(`
    const failure = Object.assign(new Error('injected preparation cleanup failure'), { code: 'EIO' });
    const remove = fs.rmSync;
    let injected = false;
    patch(fs, 'rmSync', (...args) => {
      if (!injected && !fs.existsSync(dest)) {
        injected = true;
        throw failure;
      }
      return remove(...args);
    });
    assert.throws(() => exportPackage({ dest }), (error) => error === failure);
    assert.equal(injected, true);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(scratch), []);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});

test('a primary export error survives a second staging-cleanup error', () => {
  runFilesystemCase(`
    const primary = Object.assign(new Error('injected source I/O failure'), { code: 'EIO' });
    const cleanup = Object.assign(new Error('injected cleanup permission failure'), { code: 'EPERM' });
    patch(fs, 'cpSync', () => { throw primary; });
    patch(fs, 'rmSync', () => { throw cleanup; });
    assert.throws(() => exportPackage({ dest }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary, cleanup]);
      return true;
    });
    assert.equal(fs.existsSync(dest), false);
  `);
});

test('an output write error keeps its identity and removes only owned staging', () => {
  runFilesystemCase(`
    const failure = Object.assign(new Error('injected output I/O failure'), { code: 'EIO' });
    const write = fs.writeFileSync;
    patch(fs, 'writeFileSync', (path, ...args) => {
      if (basename(path) === 'PROVENANCE.json') throw failure;
      return write(path, ...args);
    });
    assert.throws(() => exportPackage({ dest }), (error) => error === failure);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(scratch), []);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});

for (const hasSentinel of [false, true]) {
  test(`a destination created during compilation is preserved (${hasSentinel ? 'nonempty' : 'empty'})`, () => {
    runFilesystemCase(`
      const exec = childProcess.execFileSync;
      patch(childProcess, 'execFileSync', (command, args, ...options) => {
        const result = exec(command, args, ...options);
        if (args.includes('-p')) {
          fs.mkdirSync(dest);
          if (${hasSentinel}) fs.writeFileSync(join(dest, 'sentinel'), 'owned by someone else');
        }
        return result;
      });
      assert.throws(() => exportPackage({ dest }), /never overwritten/);
      assert.deepEqual(fs.readdirSync(dest), ${hasSentinel ? "['sentinel']" : '[]'});
      if (${hasSentinel}) assert.equal(fs.readFileSync(join(dest, 'sentinel'), 'utf8'), 'owned by someone else');
      assert.deepEqual(fs.readdirSync(scratch), ['package']);
      assert.ok(owned.every((path) => !fs.existsSync(path)));
    `);
  });
}

test('a destination on another filesystem is published by a same-device rename', (t) => {
  if (!existsSync('/dev/shm') || statSync('/dev/shm').dev === statSync(tmpdir()).dev) {
    t.skip('requires a writable second filesystem; Linux CI uses /dev/shm');
    return;
  }
  assert.notEqual(statSync('/dev/shm').dev, statSync(tmpdir()).dev);
  runFilesystemCase(
    `
    const rename = fs.renameSync;
    patch(fs, 'renameSync', (source, target) => {
      if (target === dest) {
        assert.equal(fs.statSync(source).dev, fs.statSync(dirname(dest)).dev,
          'the complete package must already be on the destination filesystem');
        assert.equal(fs.existsSync(dest), false);
      }
      return rename(source, target);
    });
    exportPackage({ dest });
    assert.ok(fs.existsSync(join(dest, 'dist/index.js')));
    assert.deepEqual(fs.readdirSync(scratch), ['package']);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `,
    '/dev/shm',
  );
});

for (const mask of [0o022, 0o077]) {
  test(`published directory respects umask ${mask.toString(8)} without exposing compiler scratch`, (t) => {
    if (process.platform === 'win32') {
      t.skip('requires POSIX directory mode bits');
      return;
    }
    runFilesystemCase(`
      process.umask(${mask});
      const copy = fs.cpSync;
      patch(fs, 'cpSync', (...args) => {
        assert.equal(fs.statSync(owned[0]).mode & 0o777, 0o700, 'compiler staging must stay owner-only');
        return copy(...args);
      });
      exportPackage({ dest });
      assert.equal(fs.statSync(dest).mode & 0o777, 0o777 & ~${mask});
      assert.equal(fs.existsSync(join(dest, '.build')), false);
    `);
  });
}

test('a publication-permission failure preserves the cause and leaves no destination', () => {
  runFilesystemCase(`
    const failure = Object.assign(new Error('injected mode update failure'), { code: 'EACCES' });
    patch(fs, 'chmodSync', () => { throw failure; });
    assert.throws(() => exportPackage({ dest }), (error) => error === failure);
    assert.equal(fs.existsSync(dest), false);
    assert.deepEqual(fs.readdirSync(scratch), []);
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});

for (const executableState of ['missing', 'non-executable'] as const) {
  test(`compiler launch preserves the original ${executableState} host error`, (t) => {
    if (executableState === 'non-executable' && process.platform === 'win32') {
      t.skip('requires POSIX executable permission bits');
      return;
    }
    runFilesystemCase(`
      const nodeBin = join(scratch, 'invalid-node');
      if (${executableState === 'non-executable'}) {
        fs.writeFileSync(nodeBin, 'non-executable fixture', { mode: 0o600 });
      }
      const exec = childProcess.execFileSync;
      let original;
      patch(childProcess, 'execFileSync', (...args) => {
        try { return exec(...args); }
        catch (error) { original = error; throw error; }
      });
      assert.throws(() => exportPackage({ dest, nodeBin }), (error) => {
        assert.equal(error, original);
        assert.equal(error.code, '${executableState === 'missing' ? 'ENOENT' : 'EACCES'}');
        return true;
      });
      assert.equal(fs.existsSync(dest), false);
      assert.ok(owned.every((path) => !fs.existsSync(path)));
    `);
  });
}

test('compiler launch plus cleanup failure preserves both original errors', () => {
  runFilesystemCase(`
    const nodeBin = join(scratch, 'missing-node');
    const cleanup = Object.assign(new Error('injected cleanup failure'), { code: 'EPERM' });
    const exec = childProcess.execFileSync;
    let original;
    patch(childProcess, 'execFileSync', (...args) => {
      try { return exec(...args); }
      catch (error) { original = error; throw error; }
    });
    patch(fs, 'rmSync', () => { throw cleanup; });
    assert.throws(() => exportPackage({ dest, nodeBin }), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(original.code, 'ENOENT');
      assert.equal(error.cause, original);
      assert.deepEqual(error.errors, [original, cleanup]);
      return true;
    });
    assert.equal(fs.existsSync(dest), false);
  `);
});

for (const viaSymlink of [false, true]) {
  test(`source-tree output is refused before staging (${viaSymlink ? 'symlink parent' : 'direct parent'})`, () => {
    runFilesystemCase(`
      const srcDir = join(scratch, 'src');
      fs.cpSync(${JSON.stringify(resolve(toolkitRoot, 'src'))}, srcDir, { recursive: true });
      const originalFiles = fs.readdirSync(srcDir);
      const alias = join(scratch, 'source-alias');
      if (${viaSymlink}) fs.symlinkSync(srcDir, alias, 'dir');
      const output = join(${viaSymlink} ? alias : srcDir, 'package');
      assert.throws(() => exportPackage({ srcDir, dest: output }),
        /destination parent must be outside all source trees/);
      assert.equal(fs.existsSync(output), false);
      assert.deepEqual(fs.readdirSync(srcDir), originalFiles);
      assert.equal(owned.length, 0, 'overlapping paths must be refused before staging');
    `);
  });
}

test('runtime source-tree output is also refused before staging', () => {
  runFilesystemCase(`
    const repoRoot = join(scratch, 'repo');
    const runtimeRoot = join(repoRoot, 'packages/state-lib/runtime');
    const runtimeSrc = join(runtimeRoot, 'src');
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.cpSync(${JSON.stringify(resolve(repoRoot, 'packages/state-lib/runtime/src'))}, runtimeSrc, { recursive: true });
    fs.copyFileSync(${JSON.stringify(resolve(repoRoot, 'package.json'))}, join(repoRoot, 'package.json'));
    fs.copyFileSync(${JSON.stringify(resolve(repoRoot, 'packages/state-lib/runtime/package.json'))}, join(runtimeRoot, 'package.json'));
    fs.symlinkSync(${JSON.stringify(resolve(repoRoot, 'node_modules'))}, join(repoRoot, 'node_modules'), 'dir');
    const originalFiles = fs.readdirSync(runtimeSrc);
    const output = join(runtimeSrc, 'package');
    assert.throws(() => exportPackage({ repoRoot, dest: output }),
      /destination parent must be outside all source trees/);
    assert.equal(fs.existsSync(output), false);
    assert.deepEqual(fs.readdirSync(runtimeSrc), originalFiles);
    assert.equal(owned.length, 0);
  `);
});

test('an output beside custom sources remains supported', () => {
  runFilesystemCase(`
    const srcDir = join(scratch, 'src');
    fs.cpSync(${JSON.stringify(resolve(toolkitRoot, 'src'))}, srcDir, { recursive: true });
    const result = exportPackage({ srcDir, dest });
    assert.equal(result.builtFiles.length, 10);
    assert.ok(fs.existsSync(join(dest, 'dist/index.js')));
    assert.ok(owned.every((path) => !fs.existsSync(path)));
  `);
});
