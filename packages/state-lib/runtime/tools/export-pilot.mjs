import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2] ? resolve(process.argv[2]) : null;
if (!target || existsSync(target))
  throw new Error('Pass a new, non-existing destination directory; existing packages are never overwritten');
const temp = mkdtempSync(join(tmpdir(), 'state-pilot-build-'));
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
try {
  execFileSync(
    resolve(root, '../site/node_modules/.bin/tsc'),
    ['-p', join(root, 'tsconfig.build.json'), '--outDir', temp],
    { stdio: 'inherit' },
  );
  const inputs = [
    'package.json',
    'src/index.ts',
    'src/core.ts',
    'src/latest-task.ts',
    'src/external-store.ts',
    'tsconfig.build.json',
  ];
  const built = readdirSync(temp)
    .filter((name) => /\.(?:js|d\.ts)$/.test(name))
    .sort();
  const manifest = {
    package: '@ultrabricks/state-lib',
    version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    sourceRepository: 'hyperide/hyper-saas',
    sourceBase: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceIsUncommittedCandidate:
      execFileSync('git', ['status', '--porcelain', '--', '.'], { cwd: root, encoding: 'utf8' }).trim().length > 0,
    sourceFiles: Object.fromEntries(inputs.map((name) => [name, hash(join(root, name))])),
    builtFiles: Object.fromEntries(built.map((name) => [`dist/${name}`, hash(join(temp, name))])),
  };
  mkdirSync(join(target, 'dist'), { recursive: true });
  for (const name of built) copyFileSync(join(temp, name), join(target, 'dist', name));
  for (const name of ['package.json', 'README.md']) copyFileSync(join(root, name), join(target, name));
  manifest.scope =
    'Pilot synchronous runtime, latest-result task and external-store selectors; no stable v1, normalized-store or Wasm equivalence claim.';
  writeFileSync(join(target, 'PROVENANCE.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(target, '.gitignore'), '!dist/\n!dist/**\n');
  console.info(`Exported ${manifest.package}@${manifest.version} to ${target}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
