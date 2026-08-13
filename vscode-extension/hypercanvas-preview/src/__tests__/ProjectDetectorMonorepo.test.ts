import { describe, expect, it, mock } from 'bun:test';

// Control which files "exist" and their content
const fsFiles = new Map<string, string>();

mock.module('node:fs/promises', () => ({
  readFile: async (p: string) => {
    const content = fsFiles.get(p);
    if (content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return content;
  },
  access: async (p: string) => {
    if (!fsFiles.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
  readdir: async (p: string) => {
    const prefix = p.endsWith('/') ? p : `${p}/`;
    const entries = new Set<string>();
    for (const key of fsFiles.keys()) {
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const segment = rest.split('/')[0];
        if (segment) entries.add(segment);
      }
    }
    return [...entries];
  },
}));

function pkg(deps: Record<string, string> = {}, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ dependencies: deps, ...extra });
}

function setup(files: Record<string, string>) {
  fsFiles.clear();
  for (const [p, content] of Object.entries(files)) fsFiles.set(p, content);
}

const { detectRepoType, detectProjectType, detectCssSystem, resolveRunnableTargets } =
  await import('../services/ProjectDetector');

function pkgWithScripts(scripts: Record<string, string>): string {
  return JSON.stringify({ scripts });
}

// A runnable, renderable React front-end target: dev/start script + react dep.
// resolveRunnableTargets only auto-picks renderable React members (HYP-434 P2).
function reactTarget(scripts: Record<string, string>): string {
  return JSON.stringify({ dependencies: { react: '^19' }, scripts });
}

const ROOT = '/workspace';

// ─── detectRepoType ──────────────────────────────────────────────────────────

describe('detectRepoType', () => {
  it('returns simple for a plain project', async () => {
    setup({ [`${ROOT}/package.json`]: pkg({ vite: '^5' }) });
    expect(await detectRepoType(ROOT)).toBe('simple');
  });

  it('returns mono-nx when nx.json present', async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/nx.json`]: '{}' });
    expect(await detectRepoType(ROOT)).toBe('mono-nx');
  });

  it('returns mono-nx when nx in root devDeps', async () => {
    setup({ [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }) });
    expect(await detectRepoType(ROOT)).toBe('mono-nx');
  });

  it('returns mono-turbo when turbo.json present', async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/turbo.json`]: '{}' });
    expect(await detectRepoType(ROOT)).toBe('mono-turbo');
  });

  it('returns mono-pnpm when pnpm-workspace.yaml present', async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - apps/*' });
    expect(await detectRepoType(ROOT)).toBe('mono-pnpm');
  });

  it('returns mono-lerna when lerna.json present', async () => {
    setup({ [`${ROOT}/package.json`]: pkg(), [`${ROOT}/lerna.json`]: '{}' });
    expect(await detectRepoType(ROOT)).toBe('mono-lerna');
  });

  it('returns mono-generic when root package.json has workspaces field', async () => {
    setup({ [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['packages/*'] }) });
    expect(await detectRepoType(ROOT)).toBe('mono-generic');
  });

  it('returns simple when no monorepo signals', async () => {
    setup({ [`${ROOT}/package.json`]: pkg({ react: '^19' }) });
    expect(await detectRepoType(ROOT)).toBe('simple');
  });
});

// ─── monorepo-aware detectProjectType ────────────────────────────────────────

describe('detectProjectType — monorepo-aware (Nx)', () => {
  it('falls back to sub-package when root has no bundler dep (nx monorepo)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/apps/conloca-app/package.json`]: pkg({ astro: '^4' }),
    });
    expect(await detectProjectType(ROOT)).toBe('vite');
  });

  it('falls back to sub-package for pnpm workspace', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*'] }),
      [`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - apps/*',
      [`${ROOT}/apps/web/package.json`]: pkg({ vite: '^5' }),
    });
    expect(await detectProjectType(ROOT)).toBe('vite');
  });

  it('root package.json wins if it has bundler dep (no sub-package scan)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19', vite: '^5' } }),
      [`${ROOT}/apps/other/package.json`]: pkg({ next: '^15' }),
    });
    // root has vite → returns vite without scanning sub-packages
    expect(await detectProjectType(ROOT)).toBe('vite');
  });

  it('returns unknown when no bundler found anywhere in monorepo', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/apps/lib/package.json`]: JSON.stringify({ dependencies: { react: '^19' } }),
    });
    expect(await detectProjectType(ROOT)).toBe('unknown');
  });
});

// ─── targets/ directory scanning ─────────────────────────────────────────────

describe('detectCssSystem — targets/ directory (Conloca pattern)', () => {
  it('detects tailwind in targets/ sub-package when root has none', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^22', vite: '^7' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/targets/conloca-app/package.json`]: pkg({ tailwindcss: '^4', '@tailwindcss/vite': '^4' }),
    });
    expect(await detectCssSystem(ROOT)).toBe('tailwind');
  });

  it('detects tailwind in libs/ sub-package', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^22' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/libs/ui/package.json`]: pkg({ tailwindcss: '^3' }),
    });
    expect(await detectCssSystem(ROOT)).toBe('tailwind');
  });
});

// ─── resolveRunnableTargets (start-before-select, HYP-431) ───────────────────

describe('resolveRunnableTargets', () => {
  it('returns the single target that has a dev script (conloca shape)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({
        workspaces: ['packages/*', 'targets/*'],
        scripts: { 'dev:app': 'nx run @conloca/conloca-app:dev' },
      }),
      [`${ROOT}/nx.json`]: '{}',
      // app target: runnable (dev + start) and a renderable React front-end
      [`${ROOT}/targets/conloca-app/package.json`]: reactTarget({ dev: 'vite dev', start: 'vite dev' }),
      // library packages: no scripts → not runnable
      [`${ROOT}/packages/cms-spa/package.json`]: pkg(),
      [`${ROOT}/packages/content-api/package.json`]: pkg(),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([`${ROOT}/targets/conloca-app`]);
  });

  it('counts a target with only a start script as runnable', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*'] }),
      [`${ROOT}/apps/web/package.json`]: reactTarget({ start: 'react-scripts start' }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([`${ROOT}/apps/web`]);
  });

  it('returns multiple runnable targets when several have dev/start', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*'] }),
      [`${ROOT}/apps/web/package.json`]: reactTarget({ dev: 'vite dev' }),
      [`${ROOT}/apps/admin/package.json`]: reactTarget({ dev: 'next dev' }),
    });
    const targets = await resolveRunnableTargets(ROOT);
    expect(targets.sort()).toEqual([`${ROOT}/apps/admin`, `${ROOT}/apps/web`]);
  });

  it('returns empty when no sub-project has a dev/start script', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['packages/*'] }),
      [`${ROOT}/packages/lib-a/package.json`]: pkg(),
      [`${ROOT}/packages/lib-b/package.json`]: pkgWithScripts({ build: 'tsc' }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([]);
  });

  it('scans all conventional workspace dirs (targets/apps/packages/libs/services)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^22' } }),
      [`${ROOT}/nx.json`]: '{}',
      // renderable React front-end living under services/ — proves the services/ dir is scanned
      [`${ROOT}/services/web/package.json`]: JSON.stringify({
        dependencies: { react: '^19' },
        scripts: { dev: 'vite dev' },
      }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([`${ROOT}/services/web`]);
  });

  // P2 (codex, PR #281): a runnable backend package (dev script, no React) must NOT be
  // auto-selected. Filtering it out makes the single-target list empty → caller defers
  // ("No dev or start script" stands) instead of autostarting a non-renderable API server.
  it('excludes a backend-only runnable target (dev script, no React)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['services/*'] }),
      // Hono/Express API: has a dev script but no React → not renderable in the preview
      [`${ROOT}/services/api/package.json`]: JSON.stringify({
        dependencies: { hono: '^4' },
        scripts: { dev: 'tsx watch src' },
      }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([]);
  });

  it('keeps a renderable React target and drops a sibling backend target', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*', 'services/*'] }),
      [`${ROOT}/apps/web/package.json`]: JSON.stringify({
        dependencies: { react: '^19' },
        scripts: { dev: 'vite dev' },
      }),
      [`${ROOT}/services/api/package.json`]: JSON.stringify({
        dependencies: { express: '^4' },
        scripts: { dev: 'tsx watch src' },
      }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([`${ROOT}/apps/web`]);
  });

  it('keeps a target with JSX source but no local react dep (React hoisted to root)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*'], dependencies: { react: '^19' } }),
      // Member declares no react itself (hoisted to root) but ships .tsx source → renderable
      [`${ROOT}/apps/web/package.json`]: pkgWithScripts({ dev: 'vite dev' }),
      [`${ROOT}/apps/web/src/App.tsx`]: 'export const App = () => null;',
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([`${ROOT}/apps/web`]);
  });

  it('excludes non-React frontend frameworks (Vue) even with a dev script', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ workspaces: ['apps/*'] }),
      [`${ROOT}/apps/vue-app/package.json`]: JSON.stringify({
        dependencies: { vue: '^3' },
        scripts: { dev: 'vite dev' },
      }),
    });
    expect(await resolveRunnableTargets(ROOT)).toEqual([]);
  });
});

// ─── monorepo-aware detectCssSystem ──────────────────────────────────────────

describe('detectCssSystem — monorepo-aware (Nx)', () => {
  it('detects tailwind in sub-package when root has none', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/apps/app/package.json`]: pkg({ tailwindcss: '^3' }),
    });
    expect(await detectCssSystem(ROOT)).toBe('tailwind');
  });

  it('detects @astrojs/tailwind in sub-package', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/apps/app/package.json`]: pkg({ '@astrojs/tailwind': '^5' }),
    });
    expect(await detectCssSystem(ROOT)).toBe('tailwind');
  });

  it('root package.json wins if it has CSS dep', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19', 'styled-components': '^6' } }),
      [`${ROOT}/apps/app/package.json`]: pkg({ tailwindcss: '^3' }),
    });
    expect(await detectCssSystem(ROOT)).toBe('styled-components');
  });

  // Regression: extension.ts pre-resolves pkg and passes it as 2nd arg.
  // Without the fix, the sub-package fallback was gated on `if (!packageJson)`
  // and would NEVER fire on the production path — Conloca's tailwindcss in
  // targets/ stayed invisible → cssSystem: 'unknown' → readonly mode.
  it('finds tailwind in sub-package even when root pkg is pre-passed (production path)', async () => {
    const rootPkg = { devDependencies: { nx: '^22', vite: '^7' } };
    setup({
      [`${ROOT}/package.json`]: JSON.stringify(rootPkg),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/targets/conloca-app/package.json`]: pkg({ tailwindcss: '^4', '@tailwindcss/vite': '^4' }),
    });
    // Simulate extension.ts: pre-pass pkg as second argument
    expect(await detectCssSystem(ROOT, rootPkg)).toBe('tailwind');
  });
});
