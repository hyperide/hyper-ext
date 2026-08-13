import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../ast/file-io';
import { resolveActiveProjectRoot, resolveRunnableProjectRoot } from './monorepo-root';

/** Mock FileIO backed by a Set of existing absolute paths (files + dirs). */
function mockIO(existing: Set<string>): FileIO {
  return {
    readFile: async () => {
      throw new Error('not used');
    },
    writeFile: async () => {},
    access: async (p: string) => {
      if (!existing.has(p)) throw new Error(`ENOENT: ${p}`);
    },
  };
}

describe('resolveActiveProjectRoot', () => {
  const ROOT = '/repo';

  it('returns the workspace member dir for a component inside an app target (conloca)', async () => {
    const io = mockIO(new Set([`${ROOT}/package.json`, `${ROOT}/targets/conloca-app/package.json`]));
    const result = await resolveActiveProjectRoot(ROOT, 'targets/conloca-app/src/app/App.tsx', io);
    expect(result).toBe(`${ROOT}/targets/conloca-app`);
  });

  it('handles deeply nested component paths', async () => {
    const io = mockIO(new Set([`${ROOT}/package.json`, `${ROOT}/targets/conloca-app/package.json`]));
    const result = await resolveActiveProjectRoot(
      ROOT,
      'targets/conloca-app/src/app/slots/org-settings/OrgSettingsSlot.tsx',
      io,
    );
    expect(result).toBe(`${ROOT}/targets/conloca-app`);
  });

  it('resolves packages/* members too', async () => {
    const io = mockIO(new Set([`${ROOT}/package.json`, `${ROOT}/packages/cms-spa/package.json`]));
    const result = await resolveActiveProjectRoot(ROOT, 'packages/cms-spa/src/components/Button.tsx', io);
    expect(result).toBe(`${ROOT}/packages/cms-spa`);
  });

  it('returns workspaceRoot when component lives directly under the root (no member match)', async () => {
    const io = mockIO(new Set([`${ROOT}/package.json`]));
    const result = await resolveActiveProjectRoot(ROOT, 'src/App.tsx', io);
    expect(result).toBe(ROOT);
  });

  it('returns workspaceRoot when the component path is absolute and already the root', async () => {
    const io = mockIO(new Set([`${ROOT}/package.json`]));
    const result = await resolveActiveProjectRoot(ROOT, `${ROOT}/src/App.tsx`, io);
    expect(result).toBe(ROOT);
  });

  it('picks the nearest package.json (member with its own nested package wins)', async () => {
    // targets/app has a package.json; so does targets/app/sub. Component under sub → sub wins.
    const io = mockIO(
      new Set([`${ROOT}/package.json`, `${ROOT}/targets/app/package.json`, `${ROOT}/targets/app/sub/package.json`]),
    );
    const result = await resolveActiveProjectRoot(ROOT, 'targets/app/sub/src/X.tsx', io);
    expect(result).toBe(`${ROOT}/targets/app/sub`);
  });
});

/**
 * Richer mock that backs readFile with a path→content map and listFiles with a
 * directory-membership map, so resolveRunnableProjectRoot can run detectFramework
 * and the dev/start-script check against realistic package.json contents.
 */
function richIO(files: Record<string, string>): FileIO {
  const paths = new Set(Object.keys(files));
  // Directories exist if any registered file path lives under them (mirrors fs.stat
  // succeeding on a directory).
  const dirs = new Set<string>();
  for (const p of paths) {
    let d = p.slice(0, p.lastIndexOf('/'));
    while (d.length > 0 && !dirs.has(d)) {
      dirs.add(d);
      d = d.slice(0, d.lastIndexOf('/'));
    }
  }
  return {
    readFile: async (p: string) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: async () => {},
    access: async (p: string) => {
      if (!paths.has(p) && !dirs.has(p)) throw new Error(`ENOENT: ${p}`);
    },
    listFiles: async (dir: string, extensions?: string[]) => {
      const exts = extensions ?? ['.tsx', '.jsx'];
      return [...paths].filter((p) => p.startsWith(`${dir}/`) && exts.some((ext) => p.endsWith(ext)));
    },
  };
}

describe('resolveRunnableProjectRoot', () => {
  const ROOT = '/repo';

  // conloca-mini-monorepo topology: packages/ui is a React LIBRARY (react in
  // peerDeps, no bundler, no dev/start script); targets/web + targets/admin are
  // Vite apps with index.html and dev/start scripts. The repo root has a vite
  // devDependency (so detectFramework=vite) but NO scripts and NO index.html —
  // rooting there ships a broken preview, so it must NOT win.
  function conlocaMini(): Record<string, string> {
    return {
      [`${ROOT}/package.json`]: JSON.stringify({
        private: true,
        workspaces: ['packages/*', 'targets/*'],
        devDependencies: { vite: '^7.0.0', nx: '22.0.0' },
      }),
      [`${ROOT}/packages/ui/package.json`]: JSON.stringify({
        name: '@m/ui',
        main: 'src/index.ts',
        peerDependencies: { react: '^19.0.0' },
      }),
      [`${ROOT}/packages/ui/src/Button.tsx`]: 'export const Button = () => null;',
      [`${ROOT}/targets/web/package.json`]: JSON.stringify({
        name: '@m/web',
        scripts: { dev: 'vite dev', start: 'vite dev' },
        dependencies: { react: '^19.0.0', '@m/ui': 'workspace:*' },
        devDependencies: { vite: '^7.0.0' },
      }),
      [`${ROOT}/targets/web/index.html`]: '<html></html>',
      [`${ROOT}/targets/web/src/main.tsx`]: 'import "./App";',
      [`${ROOT}/targets/admin/package.json`]: JSON.stringify({
        name: '@m/admin',
        scripts: { dev: 'vite dev', start: 'vite dev' },
        dependencies: { react: '^19.0.0', '@m/ui': 'workspace:*' },
        devDependencies: { vite: '^7.0.0' },
      }),
      [`${ROOT}/targets/admin/index.html`]: '<html></html>',
      [`${ROOT}/targets/admin/src/main.tsx`]: 'import "./App";',
    };
  }

  it('re-roots a library sub-package component to a runnable app target (NOT the library, NOT the bare root)', async () => {
    const io = richIO(conlocaMini());
    const result = await resolveRunnableProjectRoot(ROOT, 'packages/ui/src/Button.tsx', io);
    // Deterministic tiebreak: WORKSPACE_DIRS order (targets before apps/packages),
    // members sorted alphabetically → 'admin' before 'web'.
    expect(result).toBe(`${ROOT}/targets/admin`);
  });

  it('prefers a runnable target that CONSUMES the library over an alphabetically-earlier non-consumer', async () => {
    // 'targets/admin' is alphabetically first but does NOT depend on @m/ui;
    // 'targets/web' consumes it. The consumer must win so its dev server can
    // resolve the cross-package import.
    const files = conlocaMini();
    files[`${ROOT}/targets/admin/package.json`] = JSON.stringify({
      name: '@m/admin',
      scripts: { dev: 'vite dev', start: 'vite dev' },
      dependencies: { react: '^19.0.0' },
      devDependencies: { vite: '^7.0.0' },
    });
    const io = richIO(files);
    const result = await resolveRunnableProjectRoot(ROOT, 'packages/ui/src/Button.tsx', io);
    expect(result).toBe(`${ROOT}/targets/web`);
  });

  it('keeps an app-target component rooted at its own runnable package', async () => {
    const io = richIO(conlocaMini());
    const result = await resolveRunnableProjectRoot(ROOT, 'targets/web/src/main.tsx', io);
    expect(result).toBe(`${ROOT}/targets/web`);
  });

  it('falls back to workspaceRoot for a single-package supported project', async () => {
    const files: Record<string, string> = {
      [`${ROOT}/package.json`]: JSON.stringify({
        scripts: { dev: 'vite dev' },
        dependencies: { react: '^19.0.0', vite: '^7.0.0' },
      }),
      [`${ROOT}/index.html`]: '<html></html>',
      [`${ROOT}/src/App.tsx`]: 'export default function App() { return null; }',
    };
    const io = richIO(files);
    const result = await resolveRunnableProjectRoot(ROOT, 'src/App.tsx', io);
    expect(result).toBe(ROOT);
  });

  it('returns workspaceRoot when no runnable target exists (genuinely unsupported monorepo)', async () => {
    const files: Record<string, string> = {
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['packages/*'] }),
      [`${ROOT}/packages/ui/package.json`]: JSON.stringify({
        name: '@m/ui',
        peerDependencies: { react: '^19.0.0' },
      }),
      [`${ROOT}/packages/ui/src/Button.tsx`]: 'export const Button = () => null;',
    };
    const io = richIO(files);
    const result = await resolveRunnableProjectRoot(ROOT, 'packages/ui/src/Button.tsx', io);
    expect(result).toBe(ROOT);
  });
});
