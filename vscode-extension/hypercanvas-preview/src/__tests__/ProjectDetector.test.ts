import { describe, expect, it, mock } from 'bun:test';

// Control which files "exist" on disk
const existingFiles = new Set<string>();

mock.module('node:fs/promises', () => ({
  readFile: async (p: string) => {
    if (p.endsWith('package.json') && existingFiles.has(p)) {
      const dir = p.replace('/package.json', '');
      return pkgJsonContent[dir] ?? '{}';
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
  access: async (p: string) => {
    if (!existingFiles.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  },
}));

const pkgJsonContent: Record<string, string> = {};

function setupProject(dir: string, pkg: object, configFiles: string[] = []) {
  const pkgPath = `${dir}/package.json`;
  existingFiles.add(pkgPath);
  pkgJsonContent[dir] = JSON.stringify(pkg);
  for (const f of configFiles) existingFiles.add(`${dir}/${f}`);
}

function teardown(dir: string) {
  existingFiles.clear();
  delete pkgJsonContent[dir];
}

const { detectProjectType } = await import('../services/ProjectDetector');

describe('detectProjectType — Astro', () => {
  const DIR = '/test/astro-project';

  it('detects astro dep as vite', async () => {
    setupProject(DIR, { devDependencies: { astro: '^4.0.0' } });
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('detects astro dep in dependencies as vite', async () => {
    setupProject(DIR, { dependencies: { astro: '^4.0.0' } });
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('detects astro.config.mjs as vite when no deps', async () => {
    setupProject(DIR, {}, ['astro.config.mjs']);
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('detects astro.config.ts as vite when no deps', async () => {
    setupProject(DIR, {}, ['astro.config.ts']);
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('detects astro.config.js as vite when no deps', async () => {
    setupProject(DIR, {}, ['astro.config.js']);
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('still detects plain vite project', async () => {
    setupProject(DIR, { devDependencies: { vite: '^5.0.0' } });
    expect(await detectProjectType(DIR)).toBe('vite');
    teardown(DIR);
  });

  it('returns unknown for empty package.json and no config files', async () => {
    setupProject(DIR, {});
    expect(await detectProjectType(DIR)).toBe('unknown');
    teardown(DIR);
  });
});
