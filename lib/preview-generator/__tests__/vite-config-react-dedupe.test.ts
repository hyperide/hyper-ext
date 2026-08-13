/**
 * @file Tests for the React-dedupe vite.config patcher (Remix dual-React hydration crash fix).
 *
 * Covers: bare config gets dedupe + the always-safe include set; the gated bare packages
 * (@remix-run/node, @remix-run/react, @remix-run/server-runtime, react-router*) are added ONLY when
 * RESOLVABLE IN node_modules — including TRANSITIVE deps not listed in package.json (the authoritative
 * gate; a plain React+Vite app with none of them in node_modules never gets an unresolvable
 * optimizeDeps.include entry); existing arrays are union-merged (not clobbered); a non-object
 * resolve/optimizeDeps value is left untouched (no clobber); idempotency (second run = no write);
 * the Remix fixture shape is extended without touching alias/plugins; no-op for a missing config and
 * an unparseable function-config; extension fallbacks.
 */

import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import type { ObjectExpression } from '@babel/types';
import type { FileIO } from '../../ast/file-io';
import {
  REACT_DEDUPE_ENTRIES,
  REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS,
  REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS,
  reactSubpathArtifactRelPath,
} from '../vite-config-ast';
import { patchViteConfigForReactDedupe } from '../vite-config-react-dedupe';

const PROJECT_ROOT = '/proj';
/** A Remix project's installed set: react/react-dom + the full Remix client graph, incl. transitive. */
const REMIX_NODE_MODULES = [
  'react',
  'react-dom',
  '@remix-run/react',
  '@remix-run/node',
  '@remix-run/server-runtime',
  'react-router',
  'react-router-dom',
];
/** The version-dependent React subpaths a modern (React 18+) install physically resolves. */
const REACT18_SUBPATHS = [...REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS];

/**
 * In-memory FileIO over a path→content map. `access` throws for unknown paths, `writeFile`
 * mutates the map so a second patch run sees the first run's output. `installed` lists packages
 * present in node_modules — each gets a `node_modules/<pkg>/package.json` stub so the patcher's
 * node_modules-presence gate sees it. `subpaths` lists the version-dependent React subpaths whose
 * physical artifact (e.g. `node_modules/react/jsx-runtime.js`) exists — these are gated on
 * resolvability, so a React 16/17 install simply omits them. Absent => nothing installed/resolvable
 * => no gated entries.
 */
function makeIO(
  files: Record<string, string>,
  installed?: string[],
  subpaths?: string[],
): { io: FileIO; files: Record<string, string>; writes: string[] } {
  const all = { ...files };
  for (const pkg of installed ?? []) {
    all[`${PROJECT_ROOT}/node_modules/${pkg}/package.json`] = JSON.stringify({ name: pkg });
  }
  for (const sub of subpaths ?? []) {
    all[`${PROJECT_ROOT}/node_modules/${reactSubpathArtifactRelPath(sub)}`] = '// stub';
  }
  const writes: string[] = [];
  const io: FileIO = {
    async readFile(p: string) {
      if (p in all) return all[p];
      throw new Error(`ENOENT: ${p}`);
    },
    async writeFile(p: string, content: string) {
      all[p] = content;
      writes.push(p);
    },
    async access(p: string) {
      if (!(p in all)) throw new Error(`ENOENT: ${p}`);
    },
  };
  return { io, files: all, writes };
}

/** Parse the patched config and pull the string[] at `obj.<outer>.<inner>` (e.g. resolve.dedupe). */
function readStringArray(source: string, outer: string, inner: string): string[] | null {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let configObj: ObjectExpression | null = null;
  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (decl.type === 'CallExpression' && decl.arguments[0]?.type === 'ObjectExpression') {
        configObj = decl.arguments[0];
      } else if (decl.type === 'ObjectExpression') {
        configObj = decl;
      }
    }
  }
  if (!configObj) return null;
  const outerProp = configObj.properties.find(
    (p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === outer,
  );
  if (!outerProp || outerProp.type !== 'ObjectProperty' || outerProp.value.type !== 'ObjectExpression') return null;
  const innerProp = outerProp.value.properties.find(
    (p) => p.type === 'ObjectProperty' && p.key.type === 'Identifier' && p.key.name === inner,
  );
  if (!innerProp || innerProp.type !== 'ObjectProperty' || innerProp.value.type !== 'ArrayExpression') return null;
  return innerProp.value.elements.map((el) => (el?.type === 'StringLiteral' ? el.value : '__non_string__'));
}

describe('patchViteConfigForReactDedupe', () => {
  it('React 16 (no jsx-runtime / react-dom/client subpaths): adds dedupe + only the bare react/react-dom include', async () => {
    const cfg = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;
    // React 16: react/react-dom in node_modules, but NONE of the version-dependent subpaths exist
    // (no new JSX transform, no createRoot). Gated bare packages also absent.
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, ['react', 'react-dom']);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const out = files[`${PROJECT_ROOT}/vite.config.ts`];
    expect(readStringArray(out, 'resolve', 'dedupe')).toEqual([...REACT_DEDUPE_ENTRIES]);
    // Only the bare always-safe entries — the unresolvable subpaths are NOT written (they would
    // break a React-16 project's Vite optimizer).
    expect(readStringArray(out, 'optimizeDeps', 'include')).toEqual([...REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS]);
    const include = readStringArray(out, 'optimizeDeps', 'include') ?? [];
    expect(include).not.toContain('react/jsx-runtime');
    expect(include).not.toContain('react/jsx-dev-runtime');
    expect(include).not.toContain('react-dom/client');
    // The gated bare packages are absent (would break Vite optimize on a plain React app).
    expect(include).not.toContain('@remix-run/react');
    expect(include).not.toContain('@remix-run/node');
    expect(include).not.toContain('react-router-dom');
    expect(out).toContain('plugins: [react()]');
  });

  it('React 18 (all subpaths resolve): adds the bare entries + react-dom/client + jsx-runtime pair', async () => {
    const cfg = `import { defineConfig } from 'vite';
export default defineConfig({ plugins: [] });
`;
    // React 18: react/react-dom installed AND all three version-dependent subpaths resolve on disk.
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, ['react', 'react-dom'], REACT18_SUBPATHS);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const include = readStringArray(files[`${PROJECT_ROOT}/vite.config.ts`], 'optimizeDeps', 'include') ?? [];
    for (const entry of [...REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS, ...REACT18_SUBPATHS]) expect(include).toContain(entry);
    // Still no gated bare packages (no Remix/router in node_modules).
    expect(include).not.toContain('@remix-run/react');
  });

  it('React 17 (jsx-runtime pair resolves, react-dom/client does NOT): adds the jsx pair, skips client', async () => {
    const cfg = `export default { plugins: [] };\n`;
    // React 17 added the new JSX transform (jsx-runtime / jsx-dev-runtime) but NOT createRoot
    // (react-dom/client is React 18+). Each subpath is gated independently.
    const { io, files } = makeIO(
      { [`${PROJECT_ROOT}/vite.config.ts`]: cfg },
      ['react', 'react-dom'],
      ['react/jsx-runtime', 'react/jsx-dev-runtime'],
    );

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const include = readStringArray(files[`${PROJECT_ROOT}/vite.config.ts`], 'optimizeDeps', 'include') ?? [];
    expect(include).toContain('react/jsx-runtime');
    expect(include).toContain('react/jsx-dev-runtime');
    expect(include).not.toContain('react-dom/client'); // not in React 17 → skipped
  });

  it('admits a gated package present ONLY transitively in node_modules (not in package.json)', async () => {
    // A Remix project: @remix-run/node + react-router-dom are DIRECT deps, but react-router and
    // @remix-run/server-runtime are TRANSITIVE — present in node_modules, absent from package.json.
    // The node_modules-presence gate must catch ALL of them; a package.json-deps gate would miss the
    // transitive ones (this is exactly why the dedupe-only fix was insufficient).
    const cfg = `export default { plugins: [] };\n`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const include = readStringArray(files[`${PROJECT_ROOT}/vite.config.ts`], 'optimizeDeps', 'include') ?? [];
    for (const pkg of [
      '@remix-run/node',
      '@remix-run/server-runtime',
      'react-router',
      'react-router-dom',
      '@remix-run/react',
    ]) {
      expect(include).toContain(pkg);
    }
  });

  it('adds the gated bare packages ONLY for those in node_modules (react-router-dom yes, remix no)', async () => {
    const cfg = `export default { plugins: [] };\n`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, [
      'react',
      'react-dom',
      'react-router-dom',
    ]);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const include = readStringArray(files[`${PROJECT_ROOT}/vite.config.ts`], 'optimizeDeps', 'include') ?? [];
    expect(include).toContain('react-router-dom'); // installed → added
    expect(include).not.toContain('@remix-run/react'); // not installed → skipped
    expect(include).not.toContain('@remix-run/node'); // not installed → skipped
    expect(include).not.toContain('react-router'); // not installed → skipped
  });

  it('UNION-MERGES into existing resolve.dedupe and optimizeDeps.include (no clobber, no dupes)', async () => {
    const cfg = `export default {
  resolve: { dedupe: ['lodash', 'react'] },
  optimizeDeps: { include: ['@remix-run/react', 'some-other-dep'] },
};
`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const out = files[`${PROJECT_ROOT}/vite.config.ts`];
    const dedupe = readStringArray(out, 'resolve', 'dedupe') ?? [];
    const include = readStringArray(out, 'optimizeDeps', 'include') ?? [];

    // Pre-existing entries preserved (and kept first).
    expect(dedupe[0]).toBe('lodash');
    expect(include.slice(0, 2)).toEqual(['@remix-run/react', 'some-other-dep']);

    // All React dedupe entries present, exactly once each.
    for (const entry of REACT_DEDUPE_ENTRIES) expect(dedupe.filter((e) => e === entry).length).toBe(1);
    // Always-safe include entries present once; the already-present '@remix-run/react' not duplicated.
    for (const entry of REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS) expect(include.filter((e) => e === entry).length).toBe(1);
    expect(include.filter((e) => e === '@remix-run/react').length).toBe(1);

    // Unrelated entries untouched.
    expect(dedupe).toContain('lodash');
    expect(include).toContain('some-other-dep');
  });

  it('is idempotent — a second run makes no change and writes nothing', async () => {
    const cfg = `import { defineConfig } from 'vite';
export default defineConfig({ plugins: [] });
`;
    const { io, files, writes } = makeIO(
      { [`${PROJECT_ROOT}/vite.config.ts`]: cfg },
      REMIX_NODE_MODULES,
      REACT18_SUBPATHS,
    );

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);
    const afterFirst = files[`${PROJECT_ROOT}/vite.config.ts`];
    const writesAfterFirst = writes.length;

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(false);
    expect(files[`${PROJECT_ROOT}/vite.config.ts`]).toBe(afterFirst);
    expect(writes.length).toBe(writesAfterFirst); // no second write
  });

  it('patches the Remix fixture shape — dedupe added, include extended, alias + plugins untouched', async () => {
    const cfg = `import { vitePlugin as remix } from '@remix-run/dev';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), remix({ ssr: true })],
  resolve: {
    alias: { '~': '/app' },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@remix-run/react'],
  },
});
`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);

    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);

    const out = files[`${PROJECT_ROOT}/vite.config.ts`];
    expect(readStringArray(out, 'resolve', 'dedupe')).toEqual([...REACT_DEDUPE_ENTRIES]);

    // include extended: original three kept first, the missing ones appended, no dupes.
    const include = readStringArray(out, 'optimizeDeps', 'include') ?? [];
    expect(include.slice(0, 3)).toEqual(['react', 'react-dom', '@remix-run/react']);
    expect(include).toContain('react-router-dom'); // in REMIX_NODE_MODULES
    // No duplicates anywhere.
    expect(new Set(include).size).toBe(include.length);

    // alias and plugins are preserved verbatim.
    expect(out).toContain("alias: { '~': '/app' }");
    expect(out).toContain('plugins: [tailwindcss(), remix({ ssr: true })]');
  });

  it('does NOT clobber a non-object resolve/optimizeDeps value (dynamic config preserved)', async () => {
    // `resolve: sharedResolve` (Identifier) and `optimizeDeps: makeOptimizeDeps()` (Call) are dynamic
    // values. Replacing them with {} would silently drop the user's config — must no-op those keys.
    const cfg = `import { sharedResolve, makeOptimizeDeps } from './vite-shared';
export default { plugins: [], resolve: sharedResolve, optimizeDeps: makeOptimizeDeps() };
`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);

    // Both targets are dynamic → nothing to safely add → no change, no write.
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(false);
    const out = files[`${PROJECT_ROOT}/vite.config.ts`];
    expect(out).toBe(cfg); // untouched
    expect(out).toContain('resolve: sharedResolve');
    expect(out).toContain('optimizeDeps: makeOptimizeDeps()');
  });

  it('returns false (no-op) when no vite.config exists', async () => {
    const { io } = makeIO({});
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(false);
  });

  it('returns false (no-op) for a function-style config it cannot statically patch', async () => {
    const cfg = `import { defineConfig } from 'vite';
export default defineConfig(({ mode }) => ({
  plugins: [],
  define: { __MODE__: JSON.stringify(mode) },
}));
`;
    const { io, files, writes } = makeIO(
      { [`${PROJECT_ROOT}/vite.config.ts`]: cfg },
      REMIX_NODE_MODULES,
      REACT18_SUBPATHS,
    );
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(false);
    expect(files[`${PROJECT_ROOT}/vite.config.ts`]).toBe(cfg); // untouched
    expect(writes.length).toBe(0);
  });

  it('picks up a .cts config when other extensions are absent', async () => {
    const cfg = `export default { plugins: [] };\n`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.cts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);
    expect(readStringArray(files[`${PROJECT_ROOT}/vite.config.cts`], 'resolve', 'dedupe')).toEqual([
      ...REACT_DEDUPE_ENTRIES,
    ]);
  });

  it('patches the CJS `module.exports = defineConfig({...})` shape', async () => {
    // readStringArray only reads `export default`, so assert on the printed source directly.
    const cfg = `const { defineConfig } = require('vite');
module.exports = defineConfig({ plugins: [] });
`;
    const { io, files } = makeIO({ [`${PROJECT_ROOT}/vite.config.cjs`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(true);
    const out = files[`${PROJECT_ROOT}/vite.config.cjs`];
    expect(out).toContain('dedupe');
    for (const entry of REACT_DEDUPE_ENTRIES) expect(out).toContain(`"${entry}"`);
    expect(out).toContain('@remix-run/react'); // gated pkg in REMIX_NODE_MODULES
  });

  it('returns false (never throws) when the write fails', async () => {
    const cfg = `export default { plugins: [] };\n`;
    const { io } = makeIO({ [`${PROJECT_ROOT}/vite.config.ts`]: cfg }, REMIX_NODE_MODULES, REACT18_SUBPATHS);
    // Simulate a read-only FS: writeFile rejects.
    io.writeFile = async () => {
      throw new Error('EROFS: read-only file system');
    };
    // Must swallow the write error and return false rather than throw.
    expect(await patchViteConfigForReactDedupe(io, PROJECT_ROOT)).toBe(false);
  });
});
