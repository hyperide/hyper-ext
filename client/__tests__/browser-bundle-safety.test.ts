// Browser-bundle safety guards (HYP-855).
//
// How this is reached: `bun test ./client/` (root `test` script / CI).
//
// Why it exists: the client is bundled by Bun (Bun.serve HTML import in prod,
// Bun.build for dist/client), NOT Vite. Two node/Vite-isms have each taken the
// whole SaaS down with a white screen at module-evaluation time:
//   1. `import.meta.env.PROD` (Vite-ism) — Bun leaves it verbatim in browser
//      output where `import.meta.env` is undefined → TypeError before mount.
//   2. Bare `process.env.*` reads at module scope in transitive deps
//      (@babel/types via shared/i18n-text) — browsers have no `process` →
//      ReferenceError before mount. Guarded by the shim in index.html.
//
// Invariants asserted here are source-level tripwires for both classes.
import { describe, expect, test } from 'bun:test';
import { Glob } from 'bun';

const CLIENT_DIR = new URL('..', import.meta.url).pathname;
const REPO_ROOT = new URL('../..', import.meta.url).pathname;

describe('browser bundle safety (HYP-855)', () => {
  test('client sources never use import.meta.env (Vite-ism; crashes Bun browser bundles)', async () => {
    const glob = new Glob('**/*.{ts,tsx}');
    const offenders: string[] = [];
    for await (const rel of glob.scan({ cwd: CLIENT_DIR })) {
      if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const text = await Bun.file(`${CLIENT_DIR}${rel}`).text();
      if (text.includes('import.meta.env')) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  test('index.html declares the process shim before the module entrypoint', async () => {
    const html = await Bun.file(`${REPO_ROOT}index.html`).text();
    const shimIdx = html.indexOf('window.process');
    const moduleIdx = html.indexOf('type="module"');
    expect(shimIdx).toBeGreaterThan(-1);
    expect(moduleIdx).toBeGreaterThan(shimIdx);
    // The shim must not define NODE_ENV: `process.env.NODE_ENV === 'production'`
    // guards must fold at bundle time, never read the runtime shim (a runtime
    // NODE_ENV would silently flip analytics on in dev or off in prod).
    expect(html).not.toContain('NODE_ENV');
  });
});
