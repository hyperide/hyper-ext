import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { build, version } from 'esbuild';
import { resolve, dirname, basename, join, relative, sep } from 'node:path';
import { realpathSync } from 'node:fs';
process.stdin.setEncoding('utf8');
let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const loweredSources = new Map();
const authored = (request.sourceFiles ?? []).filter(
  (path) => Object.keys(request.defines ?? {}).length || !/\.[cm]?js$/.test(path),
);
const prelink = {
  builds: 0,
  files: authored.length,
  elapsedMs: 0,
  linkBuilds: 0,
  reusedByLinks: Boolean(request.compare),
  pathResolutions: 0,
};
// Reuse canonical filesystem identities across both links without skipping any
// browser-root checks. Only successful resolutions enter this build-local cache.
const canonicalPaths = new Map();
function canonicalPath(path) {
  if (canonicalPaths.has(path)) return canonicalPaths.get(path);
  const resolved = realpathSync(path);
  canonicalPaths.set(path, resolved);
  prelink.pathResolutions++;
  return resolved;
}
const browserBoundary = request.browserRoot ? canonicalPath(request.browserRoot) : null;
// A `node_modules` path segment alone does not make a file a dependency: an authored
// `src/node_modules/...` tree reached through a tsconfig alias or baseUrl would bypass the
// boundary. A file inside the project root is a dependency only when it sits directly under
// `<root>/node_modules`. A file outside the project root counts only when its first
// `node_modules` directory belongs to an ancestor of the root (workspace-hoisted installs).
// Linked packages already resolve to their real path (esbuild default).
// Limit: a config alias pointing INTO an installed tree is indistinguishable from a bare
// import and is accepted; installed packages are governed by the dependency lock, not by
// browserRoot.
function isDependencyPath(loadedPath, root) {
  if (!loadedPath.split(sep).includes('node_modules')) return false;
  // Classify the real location, the same identity the browserRoot check uses.
  const path = canonicalPath(loadedPath);
  const parts = path.split(sep);
  const index = parts.indexOf('node_modules');
  if (index === -1) return false;
  const projectRoot = canonicalPath(root);
  if (path.startsWith(projectRoot + sep)) {
    const insideRoot = path.slice(projectRoot.length + sep.length);
    return insideRoot.split(sep)[0] === 'node_modules';
  }
  // An empty owner is the filesystem root, which `+ sep` turns into `/`.
  return projectRoot.startsWith(parts.slice(0, index).join(sep) + sep);
}
if (authored.length) {
  const started = performance.now();
  const result = await build({
    absWorkingDir: request.root,
    // Emit each lowered file beside its source so the inline map's relative `sources`
    // stay correct when the final link loads the text under the original path.
    entryPoints: authored.map((path, index) => ({
      in: path,
      out: join(dirname(relative(request.root, path)), 'source-' + index),
    })),
    outdir: '.',
    bundle: false,
    write: false,
    platform: 'neutral',
    define: request.defines ?? {},
    target: request.target,
    minifySyntax: true,
    minifyIdentifiers: false,
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  for (const output of result.outputFiles) {
    const match = /^source-(\d+)\.js$/.exec(basename(output.path));
    if (!match) throw new Error('Unexpected prelink output: ' + output.path);
    loweredSources.set(authored[Number(match[1])], output.text);
  }
  prelink.builds = 1;
  prelink.elapsedMs = performance.now() - started;
}

// A tsconfig path alias and JSON imports can bypass onResolve's relative-specifier
// checks. Validate the actual loaded author file.
function assertLoadInsideBrowserRoot(request, path) {
  if (!request.browserRoot || isDependencyPath(path, request.root)) return;
  if (!canonicalPath(path).startsWith(browserBoundary + sep)) {
    throw new Error('Authored input leaves browserRoot: ' + path);
  }
}

function loadAuthored(request, args) {
  assertLoadInsideBrowserRoot(request, args.path);
  const contents = loweredSources.get(args.path);
  if (contents === undefined) return undefined;
  return { contents, loader: 'js', resolveDir: dirname(args.path) };
}

function virtualModule(request, target) {
  if (Object.hasOwn(request.generated ?? {}, target)) return { path: target, namespace: 'state-generated' };
  if (Object.hasOwn(request.aliases, target)) return { path: target, namespace: 'state-facade' };
  return undefined;
}

async function enforceBrowserBoundary(plugin, request, args, target, browserImport) {
  if (!request.browserRoot || args.kind === 'entry-point' || args.namespace !== 'file') return undefined;
  const authoredImporter = args.importer && canonicalPath(args.importer).startsWith(browserBoundary + sep);
  if (!browserImport && !authoredImporter) return undefined;
  // Resolve extensions and package metadata before enforcing the source boundary.
  const result = await plugin.resolve(target, {
    kind: args.kind,
    resolveDir: request.root,
    pluginData: { stateResolved: true },
  });
  if (result.errors.length) return result;
  if (!canonicalPath(result.path).startsWith(browserBoundary + sep))
    throw new Error('Browser import leaves browserRoot: ' + args.path);
  return result;
}

async function resolveSpecifier(plugin, request, args) {
  if (args.pluginData?.stateResolved) return undefined;
  if (!args.path.startsWith('.') && !args.path.startsWith('/')) return undefined;
  const browserImport =
    request.browserRoot && args.kind !== 'entry-point' && args.namespace === 'file' && args.path.startsWith('/');
  const target = browserImport ? resolve(request.browserRoot, '.' + args.path) : resolve(args.resolveDir, args.path);
  return virtualModule(request, target) ?? enforceBrowserBoundary(plugin, request, args, target, browserImport);
}

async function link(request) {
  const rewritten = new Set();
  prelink.linkBuilds++;
  const result = await build({
    absWorkingDir: request.root,
    entryPoints: [request.entry],
    outfile: resolve(request.outDir ?? request.root, 'app.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: request.target,
    minify: true,
    define: request.defines ?? {},
    sourcemap: 'external',
    write: false,
    metafile: true,
    logLevel: 'silent',
    legalComments: 'none',
    plugins: [
      {
        name: 'state-static-strategy',
        setup(plugin) {
          // One shared prelink preserves per-file configuration without renaming
          // late-bound JSX factories or choosing NODE_ENV before the final link.
          plugin.onLoad({ filter: /.*/, namespace: 'file' }, (args) => loadAuthored(request, args));
          plugin.onResolve({ filter: /.*/ }, (args) => resolveSpecifier(plugin, request, args));
          plugin.onLoad({ filter: /.*/, namespace: 'state-generated' }, (args) => ({
            contents: request.generated[args.path],
            loader: 'js',
            resolveDir: request.root,
          }));
          plugin.onLoad({ filter: /.*/, namespace: 'state-facade' }, (args) => {
            rewritten.add(args.path);
            return { ...request.aliases[args.path], loader: 'ts' };
          });
        },
      },
    ],
  });
  const file = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
  return {
    code: file('app.js'),
    brotliBytes: brotliCompressSync(Buffer.from(file('app.js')), {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    }).byteLength,
    map: file('app.js.map'),
    version: 'esbuild/' + version,
    prelink,
    inputs: Object.keys(result.metafile.inputs),
    contributions: Object.values(result.metafile.outputs).find((output) => output.entryPoint)?.inputs ?? {},
    rewritten: [...rewritten],
  };
}
if (request.compare) {
  const baseline = await link({ ...request, aliases: {} });
  const selected = await link(request);
  console.log(JSON.stringify({ baseline, selected }));
} else {
  console.log(JSON.stringify(await link(request)));
}
