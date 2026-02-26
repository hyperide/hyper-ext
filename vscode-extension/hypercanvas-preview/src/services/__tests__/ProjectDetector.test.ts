import { afterEach, describe, expect, it, mock } from 'bun:test';

// Mock the types module (path alias @lib/types won't resolve in bun test)
mock.module('../types', () => ({
  // ProjectType and ProjectInfo are type-only, no runtime value needed
}));

// Mock node:fs/promises
let mockFiles: Record<string, string> = {};
let mockAccessible: Set<string> = new Set();

mock.module('node:fs/promises', () => ({
  readFile: async (filePath: string) => {
    const content = mockFiles[filePath];
    if (content === undefined) throw new Error(`ENOENT: ${filePath}`);
    return content;
  },
  access: async (filePath: string) => {
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
  getPackageScripts,
} = await import('../../services/ProjectDetector');

function setPackageJson(projectPath: string, content: Record<string, unknown>) {
  mockFiles[`${projectPath}/package.json`] = JSON.stringify(content);
}

function setFileExists(filePath: string) {
  mockAccessible.add(filePath);
}

afterEach(() => {
  mockFiles = {};
  mockAccessible = new Set();
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
  it('remix → 3000', () => expect(getDefaultPort('remix')).toBe(3000));
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
});

describe('detectUIKit', () => {
  it('detects tailwindcss', async () => {
    setPackageJson('/proj', { devDependencies: { tailwindcss: '3.0.0' } });
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
    setFileExists('/proj/bun.lockb');
    setFileExists('/proj/pnpm-lock.yaml');
    setFileExists('/proj/yarn.lock');
    expect(await detectPackageManager('/proj')).toBe('bun');
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
