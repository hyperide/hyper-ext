/**
 * Fail-closed exporter for the unpublished pre-release toolkit package.
 *
 * The universal toolkit is NOT internal-only: `private: true` in
 * `toolkit/package.json` is only a temporary no-npm-publish guard for this
 * unfinished pre-release, mirrored into the emitted manifest. Nothing here
 * changes licensing, repository access, or registry publication.
 *
 * Source-development import (`../../runtime/src/index.js`) is rewritten to the
 * public peer (`@ultrabricks/state-lib`) in the emitted JS and declarations, so
 * the exported package never vendors, bundles or inlines Runtime. The complete
 * package is assembled in an owned sibling of `dest` and promoted with a plain
 * same-filesystem rename. Entries observed during either preflight are refused;
 * these checks are NOT an atomic no-replace operation against concurrent writers.
 * On POSIX, an empty destination created after the last check can be replaced.
 *
 * Assumptions (local filesystem only): `dest` must be absent and exclusively
 * owned by this export; its parent directory must already exist and be
 * writable and outside both copied source trees after symlink resolution.
 * Staging uses the destination filesystem. An unexpected EXDEV
 * promotion failure is refused with an error
 * that leaves `dest` untouched — the exporter never copies into, repairs, or
 * deletes the final destination. Rename atomicity covers the same-filesystem
 * move itself; no claim is made against arbitrary external concurrent writers
 * racing the pre-check without a real filesystem primitive. The compiler runs
 * under an explicit Node host (never an ambient Bun executable), recorded in
 * provenance without workstation paths.
 *
 * Compile options come from `../tsconfig.build.json` (single source of truth
 * for options). Sources are staged to a temp tree that preserves the
 * `toolkit/src` + `runtime/src` sibling layout, because the monorepo-relative
 * specifier cannot be compiled in place with a fixed `rootDir`. Provenance
 * hashes the staged bytes actually compiled. Compiler scratch is removed BEFORE
 * promotion; no filesystem cleanup runs after publication. Failed exports remove
 * only their owned staging, preserving both errors if cleanup also fails.
 */
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOOLKIT_ROOT = resolve(here, '..');
const DEFAULT_REPO_ROOT = resolve(DEFAULT_TOOLKIT_ROOT, '..', '..', '..');

export const SOURCE_RUNTIME_SPECIFIER = '../../runtime/src/index.js';
export const PUBLIC_CORE_SPECIFIER = '@ultrabricks/state-lib';
const KNOWN_MODULES = ['index', 'async-resource', 'match-async-state', 'testing', 'async-conformance'];
export const KNOWN_BUILT_FILES = KNOWN_MODULES.flatMap((name) => [`dist/${name}.js`, `dist/${name}.d.ts`]);

const hashFile = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function shaOfText(text) {
  return createHash('sha256').update(text).digest('hex');
}

function resolveTsc(explicit, repoRoot) {
  if (explicit) return explicit;
  if (process.env.TSC_BIN) return process.env.TSC_BIN;
  return createRequire(join(repoRoot, 'package.json')).resolve('typescript/lib/tsc.js');
}

function resolveNodeBin(explicit) {
  if (explicit) return explicit;
  if (process.env.NODE_BIN) return process.env.NODE_BIN;
  return 'node';
}

function gitFact(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function toolVersion(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return 'unavailable';
  }
}

/** Refuse entries visible at this check; only ENOENT means absence. */
function assertDestAbsent(path) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Refusing to export into ${path}: entries observed during preflight are never overwritten`);
}

/** Generated staging must not become part of either copied source input. */
function assertDestOutsideSources(dest, sources) {
  const parent = realpathSync(dirname(dest));
  for (const source of sources) {
    const offset = relative(realpathSync(source), parent);
    if (offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`))) {
      throw new Error(`Refusing toolkit export: destination parent must be outside all source trees (${source})`);
    }
  }
}

/**
 * Promote an assembled package directory onto `dest` with a same-filesystem
 * rename. Refuses entries observed by the final preflight. It never copies
 * into or explicitly removes `dest`; the caller must exclude racing writers.
 * Cross-device (EXDEV) promotion is unsupported and refused without touching
 * `dest`. Requires the caller-held guarantee that `dest` is absent and
 * exclusively owned by this export: the preflight check plus rename is NOT a
 * no-replace primitive against an external writer racing after the check.
 */
function promoteDir(staged, dest) {
  assertDestAbsent(dest);
  try {
    renameSync(staged, dest);
  } catch (error) {
    if (error?.code === 'EXDEV') {
      throw new Error(
        `Refusing cross-device toolkit export into ${dest}: same-filesystem rename only; destination left untouched`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Build the standalone package into `dest` (must not exist). Returns the
 * export manifest. Failure cleanup removes only this invocation's owned staging.
 */
export function exportPackage(options) {
  const dest = options?.dest ? resolve(options.dest) : undefined;
  if (!dest) throw new Error('exportPackage needs { dest }: refusing to guess an output directory');
  assertDestAbsent(dest);
  const toolkitRoot = options?.toolkitRoot ? resolve(options.toolkitRoot) : DEFAULT_TOOLKIT_ROOT;
  const repoRoot = options?.repoRoot ? resolve(options.repoRoot) : DEFAULT_REPO_ROOT;
  const srcDir = options?.srcDir ? resolve(options.srcDir) : join(toolkitRoot, 'src');
  const runtimeSrcDir = join(repoRoot, 'packages/state-lib/runtime/src');
  assertDestOutsideSources(dest, [srcDir, runtimeSrcDir]);

  const sourceManifest = JSON.parse(readFileSync(join(toolkitRoot, 'package.json'), 'utf8'));
  const coreManifest = JSON.parse(readFileSync(join(repoRoot, 'packages/state-lib/runtime/package.json'), 'utf8'));
  const tsc = resolveTsc(options?.tscBin, repoRoot);
  const nodeBin = resolveNodeBin(options?.nodeBin);
  const typescriptPackage = JSON.parse(
    readFileSync(createRequire(join(repoRoot, 'package.json')).resolve('typescript/package.json'), 'utf8'),
  );

  const stage = mkdtempSync(join(dirname(dest), '.toolkit-export-stage-'));
  const build = join(stage, '.build');
  const emittedRoot = join(build, 'out', 'toolkit', 'src');
  try {
    cpSync(srcDir, join(build, 'toolkit', 'src'), { recursive: true });
    cpSync(runtimeSrcDir, join(build, 'runtime', 'src'), { recursive: true });
    const effective = {
      extends: join(toolkitRoot, 'tsconfig.build.json'),
      compilerOptions: { outDir: join(build, 'out') },
      include: [join(build, 'toolkit', 'src', 'index.ts'), join(build, 'toolkit', 'src', 'testing.ts')],
    };
    writeFileSync(join(build, 'tsconfig.json'), JSON.stringify(effective, null, 2));
    try {
      execFileSync(nodeBin, [tsc, '-p', join(build, 'tsconfig.json')], { stdio: 'pipe' });
    } catch (error) {
      // Failure to launch the host is an OS error, not a compiler diagnostic.
      // Preserve its identity so callers and cleanup aggregates retain errno.
      if (error.code !== undefined) throw error;
      const detail = [error.stdout, error.stderr, error.message]
        .filter((part) => part !== undefined && part !== null && String(part).length !== 0)
        .map((part) => part.toString())
        .join('\n');
      throw new Error(`Toolkit export compile failed; no package was written:\n${detail}`, { cause: error });
    }

    const emitted = [];
    for (const name of KNOWN_MODULES) {
      for (const ext of ['.js', '.d.ts']) {
        const file = join(emittedRoot, `${name}${ext}`);
        if (!existsSync(file)) throw new Error(`Expected emitted file is missing: toolkit/src/${name}${ext}`);
        emitted.push(file);
      }
    }
    const stray = readdirSync(emittedRoot)
      .filter((name) => /\.(?:js|d\.ts)$/.test(name))
      .sort();
    const expected = KNOWN_MODULES.flatMap((name) => [`${name}.js`, `${name}.d.ts`]).sort();
    if (JSON.stringify(stray) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected emitted toolkit files: ${stray.join(', ')}`);
    }

    const rewritten = new Map();
    for (const file of emitted) {
      const text = readFileSync(file, 'utf8');
      const next = text.split(SOURCE_RUNTIME_SPECIFIER).join(PUBLIC_CORE_SPECIFIER);
      if (next.includes(SOURCE_RUNTIME_SPECIFIER) || next.includes('../')) {
        throw new Error(`Emitted file escapes its directory after rewriting: ${file}`);
      }
      rewritten.set(file, next);
    }

    const destManifest = {
      name: sourceManifest.name,
      version: sourceManifest.version,
      private: sourceManifest.private,
      description: sourceManifest.description,
      type: 'module',
      sideEffects: false,
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
        './testing': {
          types: './dist/testing.d.ts',
          import: './dist/testing.js',
          default: './dist/testing.js',
        },
      },
      peerDependencies: { [PUBLIC_CORE_SPECIFIER]: coreManifest.version },
      files: ['dist', 'README.md', 'PROVENANCE.json'],
    };
    const destManifestText = `${JSON.stringify(destManifest, null, 2)}\n`;

    const usingDefaultSources = srcDir === join(toolkitRoot, 'src');
    const sourceFiles = {};
    for (const name of readdirSync(join(build, 'toolkit', 'src'))
      .filter((name) => name.endsWith('.ts'))
      .sort()) {
      sourceFiles[`src/${name}`] = hashFile(join(build, 'toolkit', 'src', name));
    }
    for (const rel of [
      'package.json',
      'README.md',
      'tsconfig.json',
      'tsconfig.build.json',
      'tools/export-package.mjs',
    ]) {
      sourceFiles[rel] = hashFile(join(toolkitRoot, rel));
    }

    const builtFiles = {};
    for (const file of emitted) {
      const base = relative(emittedRoot, file);
      builtFiles[`dist/${base}`] = shaOfText(rewritten.get(file));
    }
    builtFiles['package.json'] = shaOfText(destManifestText);
    builtFiles['README.md'] = hashFile(join(toolkitRoot, 'README.md'));

    const provenance = {
      package: sourceManifest.name,
      version: sourceManifest.version,
      corePeer: { name: PUBLIC_CORE_SPECIFIER, version: coreManifest.version },
      sourceRepository: 'hyperide/hyper-saas',
      sourceBase: gitFact(['rev-parse', 'HEAD'], toolkitRoot),
      sourceIsUncommittedCandidate:
        gitFact(['status', '--porcelain', '--', 'packages/state-lib/toolkit'], repoRoot).length > 0,
      inputOrigin: usingDefaultSources ? 'toolkit/src' : srcDir,
      specifierRewrite: { from: SOURCE_RUNTIME_SPECIFIER, to: PUBLIC_CORE_SPECIFIER },
      sourceFiles,
      builtFiles,
      tools: {
        typescript: { specifier: 'typescript/lib/tsc.js', package: typescriptPackage.version },
        tscVersion: toolVersion(nodeBin, [tsc, '--version']),
        node: toolVersion(nodeBin, ['--version']),
        bun: toolVersion('bun', ['--version']),
      },
      scope:
        'Headless async-resource contract plus separate testing entrypoint; unpublished pre-release, not published; single Runtime comes from the core peer, never vendored.',
    };

    const assembled = stage;
    mkdirSync(join(assembled, 'dist'), { recursive: true });
    for (const file of emitted) {
      const base = relative(emittedRoot, file);
      writeFileSync(join(assembled, 'dist', base), rewritten.get(file));
    }
    writeFileSync(join(assembled, 'package.json'), destManifestText);
    copyFileSync(join(toolkitRoot, 'README.md'), join(assembled, 'README.md'));
    writeFileSync(join(assembled, 'PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
    rmSync(build, { recursive: true, force: true });
    // Keep compiler scratch private; expose only completed package files using
    // the same permission policy as mkdir's default mode under the caller's umask.
    chmodSync(assembled, 0o777 & ~process.umask());
    promoteDir(assembled, dest);
    return {
      package: provenance.package,
      version: provenance.version,
      corePeer: provenance.corePeer,
      dest,
      builtFiles: KNOWN_BUILT_FILES,
    };
  } catch (error) {
    try {
      rmSync(stage, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Toolkit export failed and staging cleanup also failed: ${stage}`,
        { cause: error },
      );
    }
    throw error;
  }
}

const invokedAsScript = process.argv[1] !== undefined && resolve(process.argv[1]) === join(here, 'export-package.mjs');
if (invokedAsScript) {
  const target = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const result = exportPackage({ dest: target });
  console.info(`Exported ${result.package}@${result.version} to ${result.dest}`);
}
