import assert from 'node:assert/strict';
import { build } from 'esbuild-wasm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExampleProject } from '../src/lib/example-lab/types';
const built = await build({
  stdin: {
    contents:
      "export {loadProject} from './src/lib/example-lab/client.ts'; export {LAB_EXAMPLES} from './src/data/example-lab/catalogue.ts';",
    resolveDir: resolve(import.meta.dirname, '..'),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'raw-source',
      setup(builder) {
        builder.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-source',
        }));
        builder.onLoad({ filter: /.*/, namespace: 'raw-source' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text',
        }));
      },
    },
  ],
});
const { loadProject, LAB_EXAMPLES } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);
const originalFetch = globalThis.fetch;
const controller = new AbortController();
let requests = 0;
try {
  for (const example of LAB_EXAMPLES) {
    const project: ExampleProject = {
      ...example,
      files: { 'index.ts': 'export const value = 1;' },
      entry: 'index.ts',
      config: {},
      editable: ['index.ts'],
      defaultFile: 'index.ts',
      sourceRevision: 'a'.repeat(40),
    };
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        requests++;
        assert.equal(input, `/lab/${example.id}.json`);
        assert.equal(init?.signal, controller.signal);
        return Response.json(project);
      },
      { preconnect: originalFetch.preconnect },
    );
    assert.deepEqual(await loadProject(example.id, controller.signal), project);
  }
  const validRequests = requests;
  for (const id of [
    'unknown',
    '../board-commands',
    '//attacker.example/x',
    '%2fboard-commands',
    'board-commands?x=1',
  ]) {
    await assert.rejects(loadProject(id), /Unknown example/);
  }
  assert.equal(requests, validRequests, 'Unknown IDs must never create a request');
  globalThis.fetch = Object.assign(async () => Response.json({ id: 'issue-triage', files: {} }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(loadProject('board-commands'), /Invalid example source/);
  globalThis.fetch = Object.assign(async () => Response.json({ id: 'board-commands' }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(loadProject('board-commands'), /Invalid example source/);
  globalThis.fetch = Object.assign(async () => new Response('Unavailable', { status: 503 }), {
    preconnect: originalFetch.preconnect,
  });
  await assert.rejects(loadProject('board-commands'), /Could not load/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log('PASS: catalogue-only example requests, abort propagation and matching response identity');
