import { describe, expect, it, mock } from 'bun:test';

// Control which files "exist" and their content (mirrors ProjectDetectorMonorepo.test.ts).
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

const { detectCssSystems } = await import('../services/ProjectDetector');

const ROOT = '/workspace';

describe('detectCssSystems — complete set per member (HYP-787, master-spec §5.6)', () => {
  // The flagship HYP-787 fixture: a monorepo member A declares tailwind + emotion, an
  // unrelated sibling declares chakra. detectCssSystems(A) must return A's OWN set —
  // {tailwind, emotion} — NOT a single priority-winner, and NOT the union with the
  // chakra sibling (which is what the singular's readSubPackageDeps fallback does).
  it('returns the member-A set {tailwind, emotion}, never the chakra sibling (no sibling union)', async () => {
    setup({
      [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: { nx: '^19' } }),
      [`${ROOT}/nx.json`]: '{}',
      [`${ROOT}/apps/web/package.json`]: pkg({
        react: '^19',
        tailwindcss: '^3',
        '@emotion/react': '^11.14.0',
        '@emotion/styled': '^11.14.0',
      }),
      [`${ROOT}/packages/ui/package.json`]: pkg({ '@chakra-ui/react': '^3.34.0' }),
    });
    const systems = await detectCssSystems(`${ROOT}/apps/web`);
    expect([...systems].sort()).toEqual(['emotion', 'tailwind']);
    expect(systems).not.toContain('chakra');
  });

  it('pre-passed package.json: tailwind + emotion → both systems (set, not winner)', async () => {
    const systems = await detectCssSystems('/irrelevant', {
      dependencies: { tailwindcss: '^3', '@emotion/react': '^11.14.0' },
    });
    expect([...systems].sort()).toEqual(['emotion', 'tailwind']);
  });

  it('a single css system still returns a one-element set', async () => {
    expect(await detectCssSystems('/irrelevant', { dependencies: { tailwindcss: '^3' } })).toEqual(['tailwind']);
  });

  it('chakra coexisting with emotion in the SAME member returns both (no shadow)', async () => {
    const systems = await detectCssSystems('/irrelevant', {
      dependencies: {
        '@chakra-ui/react': '^3.34.0',
        '@emotion/react': '^11.14.0',
        '@emotion/styled': '^11.14.0',
      },
    });
    expect(systems).toContain('chakra');
    expect(systems).toContain('emotion');
  });

  it('returns an empty set when no css system is present', async () => {
    expect(await detectCssSystems('/irrelevant', { dependencies: { react: '^19' } })).toEqual([]);
  });

  it('detects cssmodules by scanning the member src (no package dep)', async () => {
    setup({
      [`${ROOT}/apps/web/package.json`]: pkg({ react: '^19' }),
      [`${ROOT}/apps/web/src/Button.module.css`]: '.x{}',
    });
    expect(await detectCssSystems(`${ROOT}/apps/web`)).toContain('cssmodules');
  });
});
