import { afterEach, describe, expect, it, mock } from 'bun:test';

// Mock the types module (path alias @lib/types won't resolve in bun test)
mock.module('../types', () => ({
  // ProjectType and ProjectInfo are type-only, no runtime value needed
}));

// Mock node:fs/promises
let mockFiles: Record<string, string> = {};
let mockAccessible: Set<string> = new Set();
let readFileCalls: string[] = [];
let accessCalls: string[] = [];

mock.module('node:fs/promises', () => ({
  readFile: async (filePath: string) => {
    readFileCalls.push(filePath);
    const content = mockFiles[filePath];
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  },
  access: async (filePath: string) => {
    accessCalls.push(filePath);
    if (!mockAccessible.has(filePath)) throw new Error(`ENOENT: ${filePath}`);
  },
}));

const {
  detectProjectType,
  getDevCommand,
  getDefaultPort,
  getProjectInfo,
  detectUIKit,
  detectPackageManager,
  detectPackageManagerLockfile,
  getPackageScripts,
  detectUnsupportedProject,
  findWorkspaceRoot,
} = await import('../ProjectDetector');

function setPackageJson(projectPath: string, content: Record<string, unknown>) {
  mockFiles[`${projectPath}/package.json`] = JSON.stringify(content);
}

function setFileExists(filePath: string) {
  mockAccessible.add(filePath);
}

afterEach(() => {
  mockFiles = {};
  mockAccessible = new Set();
  readFileCalls = [];
  accessCalls = [];
});

describe('getDevCommand (pure)', () => {
  it('nextjs → dev', () => expect(getDevCommand('nextjs')).toBe('dev'));
  it('vite → dev', () => expect(getDevCommand('vite')).toBe('dev'));
  it('cra → start', () => expect(getDevCommand('cra')).toBe('start'));
  it('remix → dev', () => expect(getDevCommand('remix')).toBe('dev'));
  it('unknown → dev', () => expect(getDevCommand('unknown')).toBe('dev'));
});

describe('getDefaultPort (pure)', () => {
  it('vite → 5173', () => expect(getDefaultPort('vite')).toBe(5173));
  it('nextjs → 3000', () => expect(getDefaultPort('nextjs')).toBe(3000));
  it('cra → 3000', () => expect(getDefaultPort('cra')).toBe(3000));
  it('remix → 5173', () => expect(getDefaultPort('remix')).toBe(5173));
  it('unknown → 3000', () => expect(getDefaultPort('unknown')).toBe(3000));
});

describe('detectProjectType', () => {
  it('detects next from dependencies', async () => {
    setPackageJson('/proj', { dependencies: { next: '14.0.0' } });
    expect(await detectProjectType('/proj')).toBe('nextjs');
  });

  it('detects vite from dependencies', async () => {
    setPackageJson('/proj', { devDependencies: { vite: '5.0.0' } });
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects vite when present in both dependencies and devDependencies', async () => {
    setPackageJson('/proj', {
      dependencies: { vite: '5.0.1' },
      devDependencies: { vite: '5.0.0' },
    });
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects react-scripts from dependencies', async () => {
    setPackageJson('/proj', { dependencies: { 'react-scripts': '5.0.0' } });
    expect(await detectProjectType('/proj')).toBe('cra');
  });

  it('detects @remix-run/react from dependencies', async () => {
    setPackageJson('/proj', { dependencies: { '@remix-run/react': '2.0.0' } });
    expect(await detectProjectType('/proj')).toBe('remix');
  });

  it('falls back to config files (vite.config.ts)', async () => {
    setPackageJson('/proj', { dependencies: {} });
    setFileExists('/proj/vite.config.ts');
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('falls back to config files (next.config.js)', async () => {
    setPackageJson('/proj', { dependencies: {} });
    setFileExists('/proj/next.config.js');
    expect(await detectProjectType('/proj')).toBe('nextjs');
  });

  // ── Astro detection ──
  it('detects astro dep (devDependencies) as vite', async () => {
    setPackageJson('/proj', { devDependencies: { astro: '^4.0.0' } });
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects astro dep (dependencies) as vite', async () => {
    setPackageJson('/proj', { dependencies: { astro: '^4.0.0' } });
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects astro.config.mjs as vite when no deps', async () => {
    setPackageJson('/proj', {});
    setFileExists('/proj/astro.config.mjs');
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects astro.config.ts as vite when no deps', async () => {
    setPackageJson('/proj', {});
    setFileExists('/proj/astro.config.ts');
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects astro.config.js as vite when no deps', async () => {
    setPackageJson('/proj', {});
    setFileExists('/proj/astro.config.js');
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('detects astro.config.cjs as vite when no deps', async () => {
    setPackageJson('/proj', {});
    setFileExists('/proj/astro.config.cjs');
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('returns unknown when nothing matches', async () => {
    setPackageJson('/proj', { dependencies: {} });
    expect(await detectProjectType('/proj')).toBe('unknown');
  });

  it('returns unknown when no package.json', async () => {
    expect(await detectProjectType('/proj')).toBe('unknown');
  });

  it('deps checked before config files', async () => {
    setPackageJson('/proj', { dependencies: { next: '14.0.0' } });
    setFileExists('/proj/vite.config.ts');
    expect(await detectProjectType('/proj')).toBe('nextjs');
  });

  it('reads package.json via readFile', async () => {
    setPackageJson('/project/fs-test', {
      name: 'fs-test',
      scripts: { dev: 'vite dev' },
      dependencies: { vite: '^5.0.0' },
    });

    await detectProjectType('/project/fs-test');

    expect(readFileCalls).toContain('/project/fs-test/package.json');
  });

  // ── Bun detection (HYP-904) ──
  // ProjectDetector.detectProjectType is a SECOND, independent bun/framework detector
  // from lib/preview-generator/framework-routing.ts::detectFramework (fixed by HYP-885).
  // It had the exact same nx-monorepo blind spot HYP-885 fixed in the OTHER detector: an
  // nx-passthrough `scripts.dev` ("nx run cms-spa:dev --outputStyle=stream") never reads the
  // REAL host command at `nx.targets.dev.options.command`, and the former regex
  // (`/\bbun\s+(--hot|--watch|src\/|index\.)/`) required a specific flag immediately after
  // "bun" — missing conloca's actual `bun --bun --hot dev-server.tsx`.
  it('detects @types/bun as bun', async () => {
    setPackageJson('/proj', { devDependencies: { '@types/bun': '^1.0.0' } });
    expect(await detectProjectType('/proj')).toBe('bun');
  });

  it('detects a bun-plugin-* dependency as bun', async () => {
    setPackageJson('/proj', { devDependencies: { 'bun-plugin-tailwind': '^0.1.0' } });
    expect(await detectProjectType('/proj')).toBe('bun');
  });

  it('detects a direct bun dev script as bun', async () => {
    setPackageJson('/proj', { scripts: { dev: 'bun --hot index.ts' } });
    expect(await detectProjectType('/proj')).toBe('bun');
  });

  it('detects an nx-passthrough Bun sub-package (cms-spa-shaped fixture) as bun', async () => {
    setPackageJson('/proj', {
      scripts: { dev: 'nx run cms-spa:dev --outputStyle=stream' },
      nx: { targets: { dev: { options: { command: 'bun --bun --hot dev-server.tsx' } } } },
      dependencies: { react: '^19.0.0' },
      devDependencies: { 'bun-tailwindcss': '^0.0.9' },
    });
    expect(await detectProjectType('/proj')).toBe('bun');
  });

  it('does not misclassify an nx-passthrough non-Bun sub-package as bun', async () => {
    setPackageJson('/proj', {
      scripts: { dev: 'nx run some-app:dev --outputStyle=stream' },
      nx: { targets: { dev: { options: { command: 'vite' } } } },
      dependencies: { vite: '^5.0.0' },
    });
    expect(await detectProjectType('/proj')).toBe('vite');
  });

  it('does not false-match a hyphenated dependency name via the nx dev command', async () => {
    // bunyan-logger (or bun-tailwindcss) as a bare word should NOT count as "runs bun".
    setPackageJson('/proj', {
      scripts: { dev: 'nx run some-app:dev' },
      nx: { targets: { dev: { options: { command: 'bunyan-logger start' } } } },
      dependencies: {},
    });
    expect(await detectProjectType('/proj')).toBe('unknown');
  });
});

describe('detectUIKit', () => {
  it('detects tailwindcss', async () => {
    setPackageJson('/proj', { devDependencies: { tailwindcss: '3.0.0' } });
    expect(await detectUIKit('/proj')).toBe('tailwind');
  });

  // HYP-383: Astro Tailwind integrations must keep detectUIKit in sync with
  // detectCssSystem, otherwise projectUIKit stays 'none' and the right sidebar
  // hides hover/focus variant editing for Astro+Tailwind projects.
  it('detects @astrojs/tailwind as tailwind', async () => {
    setPackageJson('/proj', { devDependencies: { '@astrojs/tailwind': '5.0.0' } });
    expect(await detectUIKit('/proj')).toBe('tailwind');
  });

  it('detects @tailwindcss/vite as tailwind', async () => {
    setPackageJson('/proj', { devDependencies: { '@tailwindcss/vite': '4.0.0' } });
    expect(await detectUIKit('/proj')).toBe('tailwind');
  });

  it('detects tamagui', async () => {
    setPackageJson('/proj', { dependencies: { tamagui: '1.0.0' } });
    expect(await detectUIKit('/proj')).toBe('tamagui');
  });

  it('detects @tamagui/core', async () => {
    setPackageJson('/proj', { dependencies: { '@tamagui/core': '1.0.0' } });
    expect(await detectUIKit('/proj')).toBe('tamagui');
  });

  it('tamagui priority over tailwind', async () => {
    setPackageJson('/proj', {
      dependencies: { tamagui: '1.0.0' },
      devDependencies: { tailwindcss: '3.0.0' },
    });
    expect(await detectUIKit('/proj')).toBe('tamagui');
  });

  it('returns none when neither', async () => {
    setPackageJson('/proj', { dependencies: { react: '18.0.0' } });
    expect(await detectUIKit('/proj')).toBe('none');
  });

  it('returns none when no package.json', async () => {
    expect(await detectUIKit('/proj')).toBe('none');
  });
});

describe('detectPackageManager', () => {
  it('detects bun.lockb', async () => {
    setFileExists('/proj/bun.lockb');
    expect(await detectPackageManager('/proj')).toBe('bun');
  });

  it('detects bun.lock', async () => {
    setFileExists('/proj/bun.lock');
    expect(await detectPackageManager('/proj')).toBe('bun');
  });

  it('detects pnpm-lock.yaml', async () => {
    setFileExists('/proj/pnpm-lock.yaml');
    expect(await detectPackageManager('/proj')).toBe('pnpm');
  });

  it('detects yarn.lock', async () => {
    setFileExists('/proj/yarn.lock');
    expect(await detectPackageManager('/proj')).toBe('yarn');
  });

  it('defaults to npm', async () => {
    expect(await detectPackageManager('/proj')).toBe('npm');
  });

  it('bun has priority over pnpm and yarn', async () => {
    setFileExists('/proj/bun.lock');
    setFileExists('/proj/pnpm-lock.yaml');
    setFileExists('/proj/yarn.lock');
    expect(await detectPackageManager('/proj')).toBe('bun');
  });

  it('walks up to the workspace root lockfile when the subpackage has none (HYP-1160)', async () => {
    // conloca shape: targets/conloca-app carries no lockfile; the workspace
    // root has bun.lock. Detection from the app dir must resolve bun, not the
    // npm fallback.
    setFileExists('/repo/bun.lock');
    expect(await detectPackageManager('/repo/targets/conloca-app')).toBe('bun');
  });

  it('nearest lockfile wins over an ancestor one (HYP-1160)', async () => {
    setFileExists('/repo/bun.lock');
    setFileExists('/repo/targets/conloca-app/pnpm-lock.yaml');
    expect(await detectPackageManager('/repo/targets/conloca-app')).toBe('pnpm');
  });

  it('does not walk past the git repo root (HYP-1160)', async () => {
    // A stray lockfile ABOVE the repository must not leak into the project.
    setFileExists('/bun.lock');
    setFileExists('/repo/.git');
    expect(await detectPackageManager('/repo/targets/conloca-app')).toBe('npm');
  });

  it('stops the walk-up at a nested npm project lockfile (PR #692 review)', async () => {
    // An npm-managed nested project inside a bun repo: its own
    // package-lock.json is authoritative for THAT project; inheriting bun
    // from the ancestor would spawn bun where npm is expected.
    setFileExists('/repo/bun.lock');
    setFileExists('/repo/packages/legacy-app/package-lock.json');
    expect(await detectPackageManager('/repo/packages/legacy-app')).toBe('npm');
  });

  it('a stale package-lock.json does not flip a bun-managed directory', async () => {
    // bun.lock outranks package-lock.json WITHIN one directory (the npm lock
    // is the weakest evidence) — a lockfile left behind by a past npm install
    // must not flip a bun project.
    setFileExists('/proj/bun.lock');
    setFileExists('/proj/package-lock.json');
    expect(await detectPackageManager('/proj')).toBe('bun');
  });

  it('detectPackageManagerLockfile returns the determining lock and its manager', async () => {
    setFileExists('/repo/bun.lock');
    const evidence = await detectPackageManagerLockfile('/repo/targets/conloca-app');
    expect(evidence).toEqual({ path: '/repo/bun.lock', manager: 'bun' });
  });

  it('detectPackageManagerLockfile returns null when no lockfile exists', async () => {
    expect(await detectPackageManagerLockfile('/proj')).toBeNull();
  });

  describe('home-directory walk bound (PR #692 review)', () => {
    // With no .git anywhere above, the walk used to reach the filesystem root
    // and inherit a stray ~/bun.lock. $HOME is now a hard bound: its own files
    // are not project evidence, and the walk never ascends above it.
    it('does not inherit a stray lockfile from $HOME when no .git exists above', async () => {
      setFileExists('/home/u/bun.lock');
      expect(await detectPackageManager('/home/u/work/proj', '/home/u')).toBe('npm');
    });

    it('detectPackageManagerLockfile stops before $HOME', async () => {
      setFileExists('/home/u/bun.lock');
      expect(await detectPackageManagerLockfile('/home/u/work/proj', '/home/u')).toBeNull();
    });

    it('still finds evidence between the project and $HOME', async () => {
      setFileExists('/home/u/work/bun.lock');
      expect(await detectPackageManager('/home/u/work/proj', '/home/u')).toBe('bun');
    });

    it('checks $HOME itself when the project IS the home directory', async () => {
      setFileExists('/home/u/bun.lock');
      expect(await detectPackageManager('/home/u', '/home/u')).toBe('bun');
    });

    it('a project outside $HOME is unaffected by the bound', async () => {
      setFileExists('/repo/bun.lock');
      expect(await detectPackageManager('/repo/targets/app', '/home/u')).toBe('bun');
    });
  });
});

describe('findWorkspaceRoot (HYP-1160)', () => {
  it('returns the nearest ancestor carrying a lockfile', async () => {
    setFileExists('/repo/bun.lock');
    expect(await findWorkspaceRoot('/repo/targets/conloca-app')).toBe('/repo');
  });

  it('returns the nearest ancestor with a task-runner config when no lockfile exists', async () => {
    setFileExists('/repo/nx.json');
    expect(await findWorkspaceRoot('/repo/targets/conloca-app')).toBe('/repo');
  });

  it('falls back to the git root when neither lockfile nor task-runner config exists', async () => {
    setFileExists('/repo/.git');
    expect(await findWorkspaceRoot('/repo/targets/conloca-app')).toBe('/repo');
  });

  it('returns the start dir when no root markers exist anywhere above', async () => {
    expect(await findWorkspaceRoot('/proj/sub/app')).toBe('/proj/sub/app');
  });

  it('returns the start dir itself when it carries a marker', async () => {
    setFileExists('/proj/turbo.json');
    expect(await findWorkspaceRoot('/proj')).toBe('/proj');
  });

  it('does not return $HOME for a stray marker there (PR #692 review)', async () => {
    // A stray ~/nx.json must not make the home directory the spawn cwd.
    setFileExists('/home/u/nx.json');
    expect(await findWorkspaceRoot('/home/u/work/proj', '/home/u')).toBe('/home/u/work/proj');
  });
});

describe('getProjectInfo', () => {
  it('returns complete ProjectInfo', async () => {
    setPackageJson('/proj', { dependencies: { vite: '5.0.0' } });
    const info = await getProjectInfo('/proj');
    expect(info.type).toBe('vite');
    expect(info.devCommand).toBe('dev');
    expect(info.defaultPort).toBe(5173);
    expect(info.hasTypeScript).toBe(false);
  });

  it('detects hasTypeScript from dependency', async () => {
    setPackageJson('/proj', {
      dependencies: { next: '14.0.0' },
      devDependencies: { typescript: '5.0.0' },
    });
    const info = await getProjectInfo('/proj');
    expect(info.hasTypeScript).toBe(true);
  });

  it('detects hasTypeScript from tsconfig.json', async () => {
    setPackageJson('/proj', { dependencies: { next: '14.0.0' } });
    setFileExists('/proj/tsconfig.json');
    const info = await getProjectInfo('/proj');
    expect(info.hasTypeScript).toBe(true);
  });
});

describe('detectUnsupportedProject', () => {
  it('returns null for plain React project', async () => {
    setPackageJson('/proj', { dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('returns error for react-native without react-native-web', async () => {
    setPackageJson('/proj', { dependencies: { 'react-native': '^0.73.0' } });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('react-native');
    expect(result?.fixLabel).toBe('Fix: Add react-native-web + Vite config');
  });

  it('returns error for tamagui without react-native-web', async () => {
    setPackageJson('/proj', { dependencies: { tamagui: '^1.0.0' } });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
  });

  it('returns error for @tamagui/core without react-native-web', async () => {
    setPackageJson('/proj', { dependencies: { '@tamagui/core': '^1.0.0' } });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
  });

  it('returns null for @tamagui/cli only (build-time tool, not runtime indicator)', async () => {
    setPackageJson('/proj', { devDependencies: { '@tamagui/cli': '^1.0.0' } });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('returns null when react-native-web is already installed', async () => {
    setPackageJson('/proj', {
      dependencies: { 'react-native': '^0.73.0', 'react-native-web': '^0.19.0' },
    });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('returns null when tamagui + react-native-web both present', async () => {
    setPackageJson('/proj', {
      dependencies: { tamagui: '^1.0.0', 'react-native-web': '^0.19.0' },
    });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('returns null when no package.json', async () => {
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('checks devDependencies too', async () => {
    setPackageJson('/proj', { devDependencies: { 'react-native': '^0.73.0' } });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
  });

  // ── Next.js + Tamagui combinations ──
  // fixLabel is context-aware: Next.js and Tamagui One only install react-native-web,
  // while the default Vite path also generates Vite config + stubs.

  it('returns error for Next.js + tamagui without react-native-web (short fixLabel)', async () => {
    setPackageJson('/proj', {
      dependencies: { next: '^14.0.0', tamagui: '^1.0.0', react: '^18.0.0' },
    });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('react-native');
    expect(result?.fixLabel).toBe('Fix: Add react-native-web');
  });

  it('returns error for Next.js + react-native without react-native-web (short fixLabel)', async () => {
    setPackageJson('/proj', {
      dependencies: { next: '^14.0.0', 'react-native': '^0.73.0' },
    });
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('react-native');
    expect(result?.fixLabel).toBe('Fix: Add react-native-web');
  });

  it('returns short fixLabel for Tamagui One project (vite.config.ts with one())', async () => {
    setPackageJson('/proj', {
      dependencies: { tamagui: '^1.0.0', react: '^18.0.0' },
    });
    mockFiles['/proj/vite.config.ts'] = `import { one } from 'one/vite'\nexport default { plugins: [one()] }`;
    const result = await detectUnsupportedProject('/proj');
    expect(result).not.toBeNull();
    expect(result?.fixLabel).toBe('Fix: Add react-native-web');
  });

  it('returns null for Next.js + tamagui when react-native-web is present', async () => {
    setPackageJson('/proj', {
      dependencies: {
        next: '^14.0.0',
        tamagui: '^1.0.0',
        'react-native-web': '^0.19.0',
      },
    });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });

  it('returns null for Next.js without tamagui or react-native (plain Next.js)', async () => {
    setPackageJson('/proj', {
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    });
    expect(await detectUnsupportedProject('/proj')).toBeNull();
  });
});

describe('getPackageScripts', () => {
  it('returns scripts object', async () => {
    setPackageJson('/proj', { scripts: { dev: 'vite', build: 'vite build' } });
    const scripts = await getPackageScripts('/proj');
    expect(scripts).toEqual({ dev: 'vite', build: 'vite build' });
  });

  it('returns empty object when no package.json', async () => {
    expect(await getPackageScripts('/proj')).toEqual({});
  });

  it('returns empty object when no scripts field', async () => {
    setPackageJson('/proj', { dependencies: {} });
    expect(await getPackageScripts('/proj')).toEqual({});
  });
});
