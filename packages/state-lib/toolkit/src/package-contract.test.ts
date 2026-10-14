import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { exportPackage } from '../tools/export-package.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const toolkitRoot = resolve(here, '..');
const repoRoot = resolve(toolkitRoot, '..', '..', '..');
const toolkitManifest = JSON.parse(readFileSync(join(toolkitRoot, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  private: boolean;
  exports?: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
};

const CORE_NAME = '@ultrabricks/state-lib';
const TOOLKIT_NAME = '@ultrabricks/state-toolkit-async';
const CORE_VERSION = (
  JSON.parse(readFileSync(join(repoRoot, 'packages/state-lib/runtime/package.json'), 'utf8')) as {
    version: string;
  }
).version;

// Independent expectation: written out literally so the test does not depend
// on the exporter's own KNOWN_BUILT_FILES constant.
const EXPECTED_BUILT_FILES = [
  'dist/index.js',
  'dist/index.d.ts',
  'dist/async-resource.js',
  'dist/async-resource.d.ts',
  'dist/match-async-state.js',
  'dist/match-async-state.d.ts',
  'dist/testing.js',
  'dist/testing.d.ts',
  'dist/async-conformance.js',
  'dist/async-conformance.d.ts',
];

// Files that resolve the public core directly. Barrels (index, testing) only
// re-export local modules, and match-async-state.d.ts needs no core types, so
// they must NOT contain the specifier; the consumer run proves they resolve
// transitively instead.
const EXPECTED_CORE_BACKED_FILES = [
  'dist/async-resource.js',
  'dist/async-resource.d.ts',
  'dist/match-async-state.js',
  'dist/async-conformance.js',
  'dist/async-conformance.d.ts',
];

const requireFromRepo = createRequire(join(repoRoot, 'package.json'));
const tscBin = requireFromRepo.resolve('typescript/lib/tsc.js');
const nodeBin = process.env.NODE_BIN ?? 'node';
const npmBin = process.env.NPM_BIN ?? 'npm';
const bunBin = process.execPath.includes('bun') ? process.execPath : 'bun';

const hashFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');

function hashTree(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules') continue;
      const full = join(dir, name);
      const rel = prefix === '' ? name : `${prefix}/${name}`;
      if (statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = hashFile(full);
    }
  };
  walk(root, '');
  return out;
}

function listAllFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

function buildCoreDist(outDir: string): void {
  execFileSync(
    nodeBin,
    [tscBin, '-p', join(repoRoot, 'packages/state-lib/runtime/tsconfig.build.json'), '--outDir', outDir],
    { stdio: 'pipe' },
  );
}

const CONSUMER_JS = `import assert from 'node:assert/strict';
import { createAsyncResource, matchAsyncState } from '${TOOLKIT_NAME}';
import { NotificationError, Runtime, StateError } from '${CORE_NAME}';
import { runFullConformance } from '${TOOLKIT_NAME}/testing';

assert.equal(process.versions.bun, undefined, 'standalone consumer must run under Node, not Bun');
const runtime = new Runtime();
const okResource = createAsyncResource(runtime, { load: (input) => 'value:' + input });
assert.equal(await okResource.run('a'), 'committed');
assert.deepEqual(okResource.getSnapshot(), { status: 'success', data: 'value:a' });

const badResource = createAsyncResource(runtime, { load: () => Promise.reject(new Error('nope')) });
await assert.rejects(badResource.run('b'), /nope/);
assert.equal(badResource.getSnapshot().status, 'error');

let release;
const gate = new Promise((done) => { release = done; });
const cancellable = createAsyncResource(runtime, { load: () => gate });
const pending = cancellable.run('x');
cancellable.cancel();
assert.equal(cancellable.getSnapshot().status, 'cancelled');
release('late');
await pending;
assert.equal(cancellable.getSnapshot().status, 'cancelled');

try {
  createAsyncResource(runtime, {});
  assert.fail('expected options validation to throw');
} catch (error) {
  assert.ok(error instanceof StateError, 'toolkit StateError shares identity with consumer core');
}
try {
  matchAsyncState({ status: 'idle' }, {});
  assert.fail('expected missing-handler validation to throw');
} catch (error) {
  assert.ok(error instanceof StateError, 'match StateError shares identity with consumer core');
}
assert.equal(new NotificationError([new Error('x')]) instanceof NotificationError, true);

const check = {
  equal: (actual, expected, message) => assert.equal(actual, expected, message),
  ok: (value, message) => assert.ok(value, message),
  throws: (fn, expected, message) => assert.throws(fn, expected, message),
  rejects: (promise, expected, message) => assert.rejects(promise, expected, message),
};
await runFullConformance(new Runtime(), check);
assert.equal(okResource.getSnapshot().status, 'success');
process.stdout.write('CONSUMER_OK\\n');
`;

const CONSUMER_DECLARATIONS_TS = `import { Runtime } from '${CORE_NAME}';
import { createAsyncResource, matchAsyncState } from '${TOOLKIT_NAME}';

const runtime = new Runtime();
const resource = createAsyncResource<string, number>(runtime, { load: (input) => input.length });

// @ts-expect-error input type is preserved end to end.
void resource.run(42);

// @ts-expect-error a missing exhaustive case fails typechecking.
matchAsyncState(resource.getSnapshot(), { idle: () => 'idle' });

const snapshot = resource.getSnapshot();
if (snapshot.status === 'error') {
  // @ts-expect-error failure payloads are unknown and need narrowing.
  const label: string = snapshot.error;
  void label;
}
resource.dispose();
runtime.dispose();
`;

const CONSUMER_TSCONFIG = {
  compilerOptions: {
    target: 'es2022',
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    types: [],
  },
  files: ['consumer-check.ts'],
};

function stageConsumer(exportDir: string, coreDistDir: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'toolkit-consumer-'));
  const toolkitLink = join(dir, 'node_modules', '@ultrabricks', 'state-toolkit-async');
  const coreLink = join(dir, 'node_modules', '@ultrabricks', 'state-lib');
  mkdirSync(join(toolkitLink, 'dist'), { recursive: true });
  mkdirSync(join(coreLink, 'dist'), { recursive: true });
  cpSync(join(exportDir, 'package.json'), join(toolkitLink, 'package.json'));
  cpSync(join(exportDir, 'dist'), join(toolkitLink, 'dist'), { recursive: true });
  cpSync(join(repoRoot, 'packages/state-lib/runtime/package.json'), join(coreLink, 'package.json'));
  cpSync(coreDistDir, join(coreLink, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'toolkit-resolver-smoke', private: true, type: 'module' }),
  );
  writeFileSync(join(dir, 'consumer.mjs'), CONSUMER_JS);
  writeFileSync(join(dir, 'consumer-check.ts'), CONSUMER_DECLARATIONS_TS);
  writeFileSync(join(dir, 'consumer-tsconfig.json'), JSON.stringify(CONSUMER_TSCONFIG, null, 2));
  return dir;
}

test('packaging manifest keeps the private pilot pair with an exact core peer', () => {
  assert.equal(toolkitManifest.name, TOOLKIT_NAME);
  assert.equal(toolkitManifest.version, '0.0.0-pilot.0');
  assert.equal(toolkitManifest.private, true);
  assert.ok(toolkitManifest.exports?.['.'], 'production entrypoint must be exported');
  assert.ok(toolkitManifest.exports?.['./testing'], 'testing must be a separate explicit subpath');
  assert.equal(toolkitManifest.peerDependencies?.[CORE_NAME], CORE_VERSION);
  assert.equal(CORE_VERSION, '0.1.0-pilot.1');
});

test('export produces known files that resolve the public core, never source-relative runtime', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-export-'));
  try {
    const target = join(scratch, 'package');
    const manifest = exportPackage({ dest: target, nodeBin });
    assert.equal(manifest.package, TOOLKIT_NAME);
    assert.deepEqual([...manifest.builtFiles].sort(), [...EXPECTED_BUILT_FILES].sort());
    assert.deepEqual(
      listAllFiles(join(target, 'dist'))
        .map((file) => file.slice(target.length + 1))
        .sort(),
      [...EXPECTED_BUILT_FILES].sort(),
    );
    assert.deepEqual(
      EXPECTED_BUILT_FILES.filter((rel) => readFileSync(join(target, rel), 'utf8').includes(CORE_NAME)).sort(),
      [...EXPECTED_CORE_BACKED_FILES].sort(),
    );
    for (const file of listAllFiles(target)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(target.length + 1);
      if (rel === 'PROVENANCE.json') {
        assert.ok(!text.includes(tmpdir()), 'provenance must not embed the build staging path');
        assert.ok(!text.includes('/Users/'), 'provenance must not embed a working-machine absolute path');
        assert.ok(!text.includes(toolkitRoot), 'provenance must not embed the checkout path');
        assert.equal(
          text.split('../../runtime').length - 1,
          1,
          'provenance may name the rewritten source specifier exactly once, in specifierRewrite',
        );
        continue;
      }
      if (rel === 'README.md') {
        assert.equal(
          text.split('../../runtime').length - 1,
          1,
          'README may document the rewritten source specifier exactly once',
        );
      } else {
        assert.ok(!text.includes('../../runtime'), `${rel} must not reach the monorepo runtime source tree`);
      }
      assert.ok(!text.includes('/Users/'), `${rel} must not embed a working-machine absolute path`);
      assert.ok(!text.includes(tmpdir()), `${rel} must not embed the build staging path`);
      assert.ok(!text.includes(toolkitRoot), `${rel} must not embed the checkout path`);
    }
    const productionFiles = EXPECTED_BUILT_FILES.filter(
      (name) => !name.includes('testing') && !name.includes('conformance'),
    );
    for (const rel of productionFiles) {
      const text = readFileSync(join(target, rel), 'utf8');
      assert.ok(!text.includes('node:'), `${rel} production output must not import a node: builtin`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('a standalone Node consumer shares one Runtime with the toolkit and runs the lifecycle', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-consumer-run-'));
  try {
    const exportDir = join(scratch, 'package');
    exportPackage({ dest: exportDir, nodeBin });
    const coreDist = join(scratch, 'core-dist');
    mkdirSync(coreDist, { recursive: true });
    buildCoreDist(coreDist);
    const consumer = stageConsumer(exportDir, coreDist);
    try {
      const out = execFileSync(nodeBin, ['consumer.mjs'], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.ok(out.includes('CONSUMER_OK'), `standalone consumer must print CONSUMER_OK (got: ${out})`);
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('offline tarball install of the pair yields one shared core and a working consumer', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-tarball-'));
  try {
    const exportDir = join(scratch, 'package');
    exportPackage({ dest: exportDir, nodeBin });
    const coreDist = join(scratch, 'core-dist');
    mkdirSync(coreDist, { recursive: true });
    buildCoreDist(coreDist);
    const corePackDir = join(scratch, 'core-pack');
    mkdirSync(join(corePackDir, 'dist'), { recursive: true });
    cpSync(join(repoRoot, 'packages/state-lib/runtime/package.json'), join(corePackDir, 'package.json'));
    cpSync(join(repoRoot, 'packages/state-lib/runtime/README.md'), join(corePackDir, 'README.md'));
    cpSync(join(repoRoot, 'packages/state-lib/runtime/PROVENANCE.json'), join(corePackDir, 'PROVENANCE.json'));
    cpSync(coreDist, join(corePackDir, 'dist'), { recursive: true });
    const toolkitTarball = execFileSync(npmBin, ['pack', exportDir, '--pack-destination', scratch, '--offline'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const coreTarball = execFileSync(npmBin, ['pack', corePackDir, '--pack-destination', scratch, '--offline'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const consumer = mkdtempSync(join(tmpdir(), 'toolkit-tarball-consumer-'));
    try {
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'toolkit-tarball-consumer', private: true, type: 'module' }),
      );
      execFileSync(
        npmBin,
        ['install', '--offline', '--no-audit', '--no-fund', join(scratch, toolkitTarball), join(scratch, coreTarball)],
        { cwd: consumer, stdio: 'pipe' },
      );
      assert.ok(
        existsSync(join(consumer, 'node_modules', '@ultrabricks', 'state-toolkit-async', 'dist', 'index.js')),
        'installed toolkit must contain its dist entry',
      );
      assert.ok(
        existsSync(join(consumer, 'node_modules', '@ultrabricks', 'state-lib', 'dist', 'index.js')),
        'installed core must contain its dist entry',
      );
      assert.equal(
        existsSync(join(consumer, 'node_modules', '@ultrabricks', 'state-toolkit-async', 'node_modules')),
        false,
        'installed toolkit must not nest a duplicate core copy',
      );
      writeFileSync(join(consumer, 'consumer.mjs'), CONSUMER_JS);
      const out = execFileSync(nodeBin, ['consumer.mjs'], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.ok(out.includes('CONSUMER_OK'), `tarball consumer must print CONSUMER_OK (got: ${out})`);
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('consumer declarations resolve through the public pair, including negative fixtures', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-consumer-types-'));
  try {
    const exportDir = join(scratch, 'package');
    exportPackage({ dest: exportDir, nodeBin });
    const coreDist = join(scratch, 'core-dist');
    mkdirSync(coreDist, { recursive: true });
    buildCoreDist(coreDist);
    const consumer = stageConsumer(exportDir, coreDist);
    try {
      execFileSync(nodeBin, [tscBin, '-p', join(consumer, 'consumer-tsconfig.json')], {
        cwd: consumer,
        stdio: 'pipe',
      });
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('browser-target bundle keeps the core external and runs against the peer', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-browser-'));
  try {
    const exportDir = join(scratch, 'package');
    exportPackage({ dest: exportDir, nodeBin });
    const coreDist = join(scratch, 'core-dist');
    mkdirSync(coreDist, { recursive: true });
    buildCoreDist(coreDist);
    const consumer = stageConsumer(exportDir, coreDist);
    try {
      const bundle = join(consumer, 'toolkit-browser.js');
      execFileSync(
        bunBin,
        [
          'build',
          join(exportDir, 'dist', 'index.js'),
          '--external',
          CORE_NAME,
          '--target',
          'browser',
          '--outfile',
          bundle,
        ],
        { stdio: 'pipe' },
      );
      const text = readFileSync(bundle, 'utf8');
      assert.ok(text.includes(CORE_NAME), 'browser bundle must keep the public core external');
      for (const marker of ['createTicket', 'invalidateTicket']) {
        assert.ok(!text.includes(marker), `browser bundle must not vendor the core (found ${marker})`);
      }
      assert.ok(!text.includes('node:'), 'browser bundle must not reference node: builtins');
      writeFileSync(
        join(consumer, 'browser-driver.mjs'),
        [
          "import assert from 'node:assert/strict';",
          "import { createAsyncResource } from './toolkit-browser.js';",
          `import { Runtime } from '${CORE_NAME}';`,
          'assert.equal(process.versions.bun, undefined, "browser bundle driver must run under Node");',
          'const runtime = new Runtime();',
          "const resource = createAsyncResource(runtime, { load: (input) => 'b:' + input });",
          "assert.equal(await resource.run('k'), 'committed');",
          "assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'b:k' });",
          "process.stdout.write('BROWSER_BUNDLE_OK\\n');",
        ].join('\n'),
      );
      const out = execFileSync(nodeBin, ['browser-driver.mjs'], {
        cwd: consumer,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.ok(out.includes('BROWSER_BUNDLE_OK'));
    } finally {
      rmSync(consumer, { recursive: true, force: true });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('two exports from identical input are byte-identical', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-determinism-'));
  try {
    exportPackage({ dest: join(scratch, 'first'), nodeBin });
    exportPackage({ dest: join(scratch, 'second'), nodeBin });
    assert.deepEqual(hashTree(join(scratch, 'first')), hashTree(join(scratch, 'second')));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('export fails closed: existing destination, broken sources and blocked promote leave no package', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-fail-closed-'));
  try {
    const taken = join(scratch, 'taken');
    mkdirSync(taken, { recursive: true });
    writeFileSync(join(taken, 'sentinel.txt'), 'untouched');
    assert.throws(() => exportPackage({ dest: taken, nodeBin }), /never overwritten/);
    assert.equal(readFileSync(join(taken, 'sentinel.txt'), 'utf8'), 'untouched');
    assert.equal(readdirSync(taken).length, 1);

    const brokenSrc = join(scratch, 'broken-src');
    mkdirSync(brokenSrc, { recursive: true });
    cpSync(join(toolkitRoot, 'src'), join(brokenSrc, 'src'), { recursive: true });
    writeFileSync(join(brokenSrc, 'src', 'async-resource.ts'), 'this is not TypeScript @@@\n', { flag: 'a' });
    const brokenDest = join(scratch, 'broken-package');
    assert.throws(
      () => exportPackage({ dest: brokenDest, srcDir: join(brokenSrc, 'src'), nodeBin }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Toolkit export compile failed/);
        assert.ok(error.cause instanceof Error);
        assert.ok('status' in error.cause && error.cause.status === 2);
        return true;
      },
    );
    assert.equal(existsSync(brokenDest), false);

    const roParent = join(scratch, 'ro-parent');
    mkdirSync(roParent, { recursive: true });
    chmodSync(roParent, 0o555);
    try {
      const blockedDest = join(roParent, 'blocked-package');
      assert.throws(() => exportPackage({ dest: blockedDest, nodeBin }));
      assert.equal(existsSync(blockedDest), false);
    } finally {
      chmodSync(roParent, 0o755);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('export refuses file and dangling-symlink destinations and preserves neighbours', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-dest-kind-'));
  try {
    const neighbour = join(scratch, 'neighbour.txt');
    writeFileSync(neighbour, 'neighbour');

    const fileDest = join(scratch, 'file-dest');
    writeFileSync(fileDest, 'user file');
    assert.throws(() => exportPackage({ dest: fileDest, nodeBin }), /never overwritten/);
    assert.equal(readFileSync(fileDest, 'utf8'), 'user file');
    assert.equal(readFileSync(neighbour, 'utf8'), 'neighbour');

    const linkDest = join(scratch, 'link-dest');
    symlinkSync(join(scratch, 'no-such-target'), linkDest);
    assert.equal(existsSync(linkDest), false);
    assert.throws(() => exportPackage({ dest: linkDest, nodeBin }), /never overwritten/);
    assert.ok(lstatSync(linkDest).isSymbolicLink(), 'dangling symlink must be left in place, not replaced');
    assert.equal(readFileSync(neighbour, 'utf8'), 'neighbour');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('unreadable input and missing parent leave no package and preserve neighbours', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'toolkit-io-fail-'));
  try {
    const neighbour = join(scratch, 'neighbour.txt');
    writeFileSync(neighbour, 'neighbour');
    const missingSrc = join(scratch, 'no-such-src');
    const missingDest = join(scratch, 'missing-input-package');
    assert.throws(() => exportPackage({ dest: missingDest, srcDir: missingSrc, nodeBin }));
    assert.equal(existsSync(missingDest), false);
    assert.equal(readFileSync(neighbour, 'utf8'), 'neighbour');

    const missingParentDest = join(scratch, 'no-such-parent', 'package');
    assert.throws(() => exportPackage({ dest: missingParentDest, nodeBin }));
    assert.equal(existsSync(join(scratch, 'no-such-parent')), false);
    assert.equal(readFileSync(neighbour, 'utf8'), 'neighbour');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('build-tool declarations expose only actual runtime exports, not injection hooks', async () => {
  const tools = await import('../tools/export-package.mjs');
  assert.deepEqual(Object.keys(tools).sort(), [
    'KNOWN_BUILT_FILES',
    'PUBLIC_CORE_SPECIFIER',
    'SOURCE_RUNTIME_SPECIFIER',
    'exportPackage',
  ]);
  assert.equal(tools.PUBLIC_CORE_SPECIFIER, '@ultrabricks/state-lib');
  assert.equal(tools.SOURCE_RUNTIME_SPECIFIER, '../../runtime/src/index.js');
  assert.ok(Array.isArray(tools.KNOWN_BUILT_FILES));
  assert.equal(tools.KNOWN_BUILT_FILES.length, 10);
  assert.ok(tools.KNOWN_BUILT_FILES.every((file) => typeof file === 'string' && file.startsWith('dist/')));
  assert.equal(typeof tools.exportPackage, 'function');
});
