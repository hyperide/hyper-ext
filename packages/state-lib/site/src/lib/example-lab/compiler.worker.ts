import initStateCompiler, { compile_json } from './generated/statec.js';
import * as esbuild from 'esbuild-wasm';
import { resolveSourcePath, sha256, compilerIdentity } from './core';
import type { ExampleProject, ExampleBuild, BuildArtifact } from './types';
interface GeneratedModule {
  path: string;
  content: string;
  unit: string;
  variant: string;
}
interface NativeDecision {
  unit: string;
  facade: string;
  baseline: string;
  baselineImport: string;
  rewrite: { before: string; after: string };
}
interface NativePlan {
  generatedModules: GeneratedModule[];
  decisions: NativeDecision[];
}
interface StateCompiler {
  default(options: { module_or_path: string }): Promise<unknown>;
  compile_json(input: string): string;
}
let initialization: Promise<StateCompiler> | undefined;
function initialize() {
  return (initialization ??= (async () => {
    const native: StateCompiler = { default: initStateCompiler, compile_json };
    await Promise.all([
      native.default({ module_or_path: '/lab/statec_bg.wasm' }),
      esbuild.initialize({ wasmURL: '/lab/esbuild.wasm', worker: false }),
    ]);
    return native;
  })().catch((error) => {
    initialization = undefined;
    throw error;
  }));
}
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/';
async function gzipBytes(code: string) {
  const stream = new Blob([code]).stream().pipeThrough(new CompressionStream('gzip'));
  return (await new Response(stream).arrayBuffer()).byteLength;
}
async function bundle(files: Record<string, string>, entry: string, generated: Set<string>): Promise<BuildArtifact> {
  const plugin: esbuild.Plugin = {
    name: 'local-example',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const path = resolveSourcePath(args.resolveDir || '/', args.path);
        const resolved = [path, `${path}.ts`, `${path}.js`, `${path}.mjs`, `${path}/index.ts`].find((p) =>
          Object.hasOwn(files, p),
        );
        if (!resolved) return { errors: [{ text: `Missing local source: ${path}` }] };
        return { path: resolved, namespace: 'example' };
      });
      build.onLoad({ filter: /.*/, namespace: 'example' }, (args) => ({
        contents: files[args.path],
        loader: args.path.endsWith('.tsx') ? 'tsx' : args.path.endsWith('.ts') ? 'ts' : 'js',
        resolveDir: generated.has(args.path) ? '/' : dirname(args.path),
      }));
    },
  };
  const options: esbuild.BuildOptions = {
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__stateExample',
    platform: 'browser',
    target: 'es2022',
    plugins: [plugin],
    metafile: true,
    logLevel: 'silent',
  };
  const compact = await esbuild.build({ ...options, minify: true }),
    readable = await esbuild.build({ ...options, minify: false });
  const code = compact.outputFiles?.[0]?.text,
    readableCode = readable.outputFiles?.[0]?.text;
  if (!code || !readableCode) throw new Error('Build produced no executable output');
  return {
    code,
    readableCode,
    rawBytes: new TextEncoder().encode(code).byteLength,
    gzipBytes: await gzipBytes(code),
    inputs: Object.keys(compact.metafile?.inputs ?? {}).map((path) => path.replace(/^example:\//, '')),
  };
}
async function compile(project: ExampleProject, edits: Record<string, string>): Promise<ExampleBuild> {
  const source = { ...project.files };
  for (const [path, value] of Object.entries(edits)) {
    if (!project.editable.includes(path) || typeof value !== 'string')
      throw new Error('Only project source files can be edited');
    source[path] = value;
  }
  if (JSON.stringify(source).length > 3 * 1024 * 1024) throw new Error('Example source exceeds 3 MiB');
  const config = JSON.parse(source['state.config.json']);
  if (!config || !Array.isArray(config.units) || config.units.length > 512 || typeof config.entry !== 'string')
    throw new Error('Invalid example configuration');
  const paths = new Set<string>();
  for (const unit of config.units) {
    if (!unit || !Array.isArray(unit.variants) || typeof unit.facade !== 'string')
      throw new Error('Invalid command declaration');
    for (const variant of unit.variants) {
      const path = resolveSourcePath('/', `./${variant.entry}`);
      if (paths.has(path) || Object.hasOwn(source, path.slice(1)))
        throw new Error('Generated source path collides with an existing module');
      paths.add(path);
    }
  }
  const provenanceResponse = await fetch('/lab/provenance.json');
  if (!provenanceResponse.ok) throw new Error('Compiler source identity is unavailable');
  const provenance = await provenanceResponse.json();
  const sourceHash = await sha256(
    JSON.stringify({
      files: Object.entries(source).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      toolchain: compilerIdentity(provenance),
      method: 'paired-command-v1',
    }),
  );
  const native = await initialize(),
    start = performance.now();
  const plan: NativePlan = JSON.parse(
    native.compile_json(
      JSON.stringify({
        version: 1,
        config,
        files: Object.entries(source)
          .filter(([p]) => /\.[cm]?[jt]sx?$/.test(p))
          .map(([path, content]) => ({ path, content })),
        sourceHash,
        profile: null,
        mode: 'baseline',
      }),
    ),
  );
  const files = Object.fromEntries(
    Object.entries(source)
      .filter(([p]) => p !== 'state.config.json')
      .map(([p, c]) => [resolveSourcePath('/', `./${p}`), c]),
  );
  const alternatives = { ...files },
    generatedFiles: Record<string, string> = {},
    generatedPaths = new Set<string>();
  for (const module of plan.generatedModules) {
    const path = resolveSourcePath('/', `./${module.path}`);
    alternatives[path] = module.content;
    generatedPaths.add(path);
    generatedFiles[module.path] = module.content;
  }
  for (const decision of plan.decisions) {
    const facade = resolveSourcePath('/', `./${decision.facade}`),
      base = resolveSourcePath('/', `./${decision.baseline}`);
    if (!decision.rewrite || resolveSourcePath(dirname(facade), decision.baselineImport) !== base)
      throw new Error('A command facade must re-export its declared runtime implementation');
    const module = plan.generatedModules.find((item) => item.unit === decision.unit);
    if (!module) throw new Error(`No generated implementation for ${decision.unit}`);
    alternatives[facade] = decision.rewrite.before + JSON.stringify('/' + module.path) + decision.rewrite.after;
  }
  // Explicit comparison builds both candidates; this does not change state build's admission policy.
  const entry = resolveSourcePath('/', `./${config.entry}`);
  const reference = await bundle(files, entry, new Set()),
    compiled = await bundle(alternatives, entry, generatedPaths);
  return {
    example: project,
    sourceHash,
    sourceRevision: project.sourceRevision,
    artifacts: { reference, compiled },
    generatedFiles,
    compileMs: performance.now() - start,
    files: source,
  };
}
self.addEventListener(
  'message',
  async (event: MessageEvent<{ id: number; project: ExampleProject; edits: Record<string, string> }>) => {
    const { id, project, edits } = event.data;
    try {
      self.postMessage({ id, result: await compile(project, edits) });
    } catch (error) {
      self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  },
);
