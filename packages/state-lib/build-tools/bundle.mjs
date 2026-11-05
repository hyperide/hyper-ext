import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { build, version } from 'esbuild';
import { resolve } from 'node:path';
process.stdin.setEncoding('utf8');
let input = '';
const rewritten = new Set();
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const result = await build({
  absWorkingDir: request.root,
  entryPoints: [request.entry],
  outfile: resolve(request.outDir ?? request.root, 'app.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: request.target,
  minify: true,
  sourcemap: 'external',
  write: false,
  metafile: true,
  logLevel: 'silent',
  legalComments: 'none',
  plugins: [
    {
      name: 'state-static-strategy',
      setup(plugin) {
        plugin.onResolve({ filter: /.*/ }, (args) => {
          if (!args.path.startsWith('.') && !args.path.startsWith('/')) return undefined;
          const target = resolve(args.resolveDir, args.path);
          return Object.hasOwn(request.generated ?? {}, target)
            ? { path: target, namespace: 'state-generated' }
            : undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: 'state-generated' }, (args) => ({
          contents: request.generated[args.path],
          loader: 'js',
          resolveDir: request.root,
        }));
        plugin.onResolve({ filter: /^\./ }, (args) => {
          const target = resolve(args.resolveDir, args.path),
            replacement = request.aliases[target];
          return replacement ? { path: target, namespace: 'state-facade' } : undefined;
        });
        plugin.onLoad({ filter: /.*/, namespace: 'state-facade' }, (args) => {
          rewritten.add(args.path);
          return { ...request.aliases[args.path], loader: 'ts' };
        });
      },
    },
  ],
});
const file = (ext) => result.outputFiles.find((f) => f.path.endsWith(ext))?.text ?? '';
console.log(
  JSON.stringify({
    code: file('app.js'),
    brotliBytes: brotliCompressSync(Buffer.from(file('app.js')), {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
      },
    }).byteLength,
    map: file('app.js.map'),
    version: 'esbuild/' + version,
    inputs: Object.keys(result.metafile.inputs),
    rewritten: [...rewritten],
  }),
);
