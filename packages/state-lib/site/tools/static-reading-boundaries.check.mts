import assert from 'node:assert/strict';
import { build } from 'esbuild-wasm';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const built = await build({
  stdin: {
    contents:
      "export * from './tools/static-reading.mts'; export {markdownRequestUrl} from './src/lib/page-markdown.ts';",
    resolveDir: resolve(import.meta.dirname, '..'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'external-resources',
      setup(builder) {
        builder.onResolve({ filter: /^(node:fs\/promises|\.\/browser\.mts|\.\/static-server\.mts)$/ }, ({ path }) => ({
          path,
          namespace: 'external-resources',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'external-resources' }, ({ path }) => ({
          contents:
            path === 'node:fs/promises'
              ? "export async function readFile() { return '[]'; }"
              : path === './static-server.mts'
                ? "export async function serveStatic() { return {url:'http://127.0.0.1:65535', close:async()=>{}}; }"
                : "export const chromium = {launch(){throw new Error('Unexpected browser launch')}};",
          loader: 'js',
        }));
      },
    },
  ],
});
const originalFetch = globalThis.fetch;
let requests = 0;
try {
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response('<link rel="canonical" href="http://127.0.0.1:65535/">', { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
  await assert.rejects(async () => {
    const tool = await import(
      `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
    );
    assert.equal(typeof tool.verifyStaticReading, 'function', 'Static reading entry must exist');
    await tool.verifyStaticReading();
  }, /Export manifest must contain exactly the required routes/);
  assert.equal(requests, 0, 'An incomplete export manifest must fail before any HTTP request');
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS: an incomplete export manifest cannot trigger HTTP requests or a browser launch');

const tool = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const routes: string[] = [...tool.requiredRoutes];
for (const route of ['/repl/board-commands', '/repl/issue-triage', '/repl/snippet', '/concepts/practical']) {
  assert.ok(routes.includes(route), `Current public route must remain covered: ${route}`);
}
const manifest = routes.map((route) => ({
  route,
  title: 'Fixture',
  markdown: route === '/' ? '/index.md' : `${route}.md`,
  sha256: 'a'.repeat(64),
}));
assert.equal(tool.assertExportManifest(manifest).size, routes.length);
for (const row of manifest) {
  assert.equal(tool.markdownRequestUrl(row.route, 'https://docs.example')?.href, `https://docs.example${row.markdown}`);
}
assert.throws(() => tool.assertExportManifest(manifest.slice(1)), /manifest/i);
assert.throws(
  () =>
    tool.assertExportManifest([
      ...manifest,
      {
        route: '/unexpected',
        title: 'Unexpected',
        markdown: '/unexpected.md',
        sha256: 'b'.repeat(64),
      },
    ]),
  /manifest/i,
);
assert.throws(() => tool.assertExportManifest([...manifest.slice(1), manifest[1]]), /duplicate/i);
assert.throws(
  () =>
    tool.assertExportManifest([
      ...manifest.slice(1),
      {
        ...manifest[0],
        route: '/unexpected',
        markdown: '/unexpected.md',
      },
    ]),
  /missing/i,
);
for (const markdown of [
  '//attacker.example/export.md',
  'https://attacker.example/export.md',
  '/%2f%2fattacker.md',
  '/wrong.md',
]) {
  assert.throws(
    () => tool.assertExportManifest([{ ...manifest[0], markdown }, ...manifest.slice(1)]),
    /Markdown path/i,
  );
}
console.log(
  `PASS: exact manifest coverage for ${routes.length} public routes, canonical Markdown paths and all Copy page routes`,
);

const temporary = mkdtempSync(join(tmpdir(), 'state-static-reading-'));
try {
  const entry = join(temporary, 'static-reading.mts');
  symlinkSync(fileURLToPath(new URL('./static-reading.mts', import.meta.url)), entry);
  const result = spawnSync(
    process.execPath,
    [...process.execArgv.map((argument) => (argument === 'tsx' ? import.meta.resolve('tsx') : argument)), entry],
    { cwd: temporary, encoding: 'utf8', timeout: 15000 },
  );
  assert.notEqual(result.status, 0, 'A symlinked entry must execute the verification');
  assert.match(
    result.stderr,
    /ENOENT[^]*dist-served[/\\]export-manifest\.json/,
    'The entry must try to read the required manifest, not silently exit',
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('PASS: a symlinked static-reading entry executes and fails when its manifest is missing');
