/**
 * @file OpfsFileIO unit tests — the lib/ast FileIO over the OPFS NodePod project tree that lets the
 *   shared i18n resolver/writer run in the browser (HYP-372 Phase 2 / HYP-746).
 *
 * Uses the in-memory OPFS mock (happy-dom has no OPFS). Covers read/write/access round-trips, the
 * leading-slash path normalization (shared code builds `/<rel>` paths against projectRoot=''), and
 * recursive listFiles with extension filtering — the capability discoverLayout relies on to
 * enumerate locales.
 */
import { describe, expect, it } from 'bun:test';
import { MockDirectoryHandle } from '@shared/i18n-text/retarget/__tests__/helpers/opfs-mock';
import { OpfsFileIO } from '../opfsFileIO';

function makeIO(projectId = 'p1') {
  const root = new MockDirectoryHandle();
  const io = new OpfsFileIO({ projectId, getRoot: async () => root as unknown as FileSystemDirectoryHandle });
  return { io, root };
}

describe('OpfsFileIO', () => {
  it('writes then reads back nested files (leading-slash path normalized)', async () => {
    const { io } = makeIO();
    await io.writeFile('/locales/en.json', '{"a":1}');
    expect(await io.readFile('/locales/en.json')).toBe('{"a":1}');
    // Without a leading slash too (shared code is consistent, but be robust).
    await io.writeFile('src/App.tsx', 'x');
    expect(await io.readFile('src/App.tsx')).toBe('x');
  });

  it('access throws for an absent file, resolves for a present one', async () => {
    const { io } = makeIO();
    await expect(io.access('/nope.json')).rejects.toThrow();
    await io.writeFile('/yes.json', '{}');
    await expect(io.access('/yes.json')).resolves.toBeUndefined();
  });

  it('listFiles enumerates recursively with extension filter, absent dir → []', async () => {
    const { io } = makeIO();
    await io.writeFile('/locales/en.json', '{}');
    await io.writeFile('/locales/fr.json', '{}');
    await io.writeFile('/locales/readme.md', 'x');
    const json = await io.listFiles('/locales', ['.json']);
    expect(json.sort()).toEqual(['/locales/en.json', '/locales/fr.json']);
    expect(await io.listFiles('/missing', ['.json'])).toEqual([]);
  });

  it('rejects path traversal in read/write/access/listFiles', async () => {
    const { io } = makeIO();
    await expect(io.readFile('/../other/x')).rejects.toThrow(/traversal/);
    await expect(io.writeFile('a/../../escape', 'x')).rejects.toThrow(/traversal/);
    await expect(io.access('/../x')).rejects.toThrow(/traversal/);
    await expect(io.listFiles('/locales/..')).rejects.toThrow(/traversal/);
  });

  it('two projects do not see each other (project-scoped tree)', async () => {
    const root = new MockDirectoryHandle();
    const a = new OpfsFileIO({ projectId: 'A', getRoot: async () => root as unknown as FileSystemDirectoryHandle });
    const b = new OpfsFileIO({ projectId: 'B', getRoot: async () => root as unknown as FileSystemDirectoryHandle });
    await a.writeFile('/x.txt', 'from-A');
    await expect(b.readFile('/x.txt')).rejects.toThrow();
    expect(await a.readFile('/x.txt')).toBe('from-A');
  });
});
