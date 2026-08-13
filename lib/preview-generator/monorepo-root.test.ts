import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../ast/file-io';
import { resolveActiveProjectRoot } from './monorepo-root';

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
