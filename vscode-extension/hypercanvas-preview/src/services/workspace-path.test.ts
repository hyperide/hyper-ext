import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { assertPathLexicallyContained, resolveContainedPath } from './workspace-path';

/**
 * HYP-1131: regression tests for `assertPathLexicallyContained`, the segment-boundary-aware
 * containment check PanelRouter's `file:read` and `hypercanvas:resolveServerSourceMap`
 * handlers now run before touching disk.
 */
describe('assertPathLexicallyContained', () => {
  it('accepts a path inside the workspace root', () => {
    expect(assertPathLexicallyContained('/test-workspace', '/test-workspace/src/App.tsx')).toBe(
      '/test-workspace/src/App.tsx',
    );
  });

  it('accepts the workspace root itself', () => {
    expect(assertPathLexicallyContained('/test-workspace', '/test-workspace')).toBe('/test-workspace');
  });

  it('rejects a `../` traversal that escapes the workspace root', () => {
    expect(() => assertPathLexicallyContained('/test-workspace', '/test-workspace/../../etc/passwd')).toThrow(
      /Path resolves outside workspace root/,
    );
  });

  it('rejects an absolute-path escape outside the workspace root', () => {
    expect(() => assertPathLexicallyContained('/test-workspace', '/etc/passwd')).toThrow(
      /Path resolves outside workspace root/,
    );
  });

  it('rejects a sibling directory that merely shares a name prefix', () => {
    // Segment-boundary-aware: '/test-workspace-evil' is NOT inside '/test-workspace',
    // even though it starts with the same characters. A naive startsWith(root) check
    // would wrongly allow this.
    expect(() => assertPathLexicallyContained('/test-workspace', '/test-workspace-evil/secret.txt')).toThrow(
      /Path resolves outside workspace root/,
    );
  });

  it('normalizes redundant separators and `.` segments before checking containment', () => {
    expect(assertPathLexicallyContained('/test-workspace', '/test-workspace//src/./App.tsx')).toBe(
      '/test-workspace/src/App.tsx',
    );
  });

  // The `containedPrefix = sep` special case (workspace root IS the filesystem root) —
  // `${root}${sep}` would otherwise double up to `//` and reject every one of the root's
  // own children.
  it('accepts any path when the workspace root is the filesystem root', () => {
    expect(assertPathLexicallyContained('/', '/etc/passwd')).toBe('/etc/passwd');
  });

  it('strips a trailing separator from the workspace root before comparing', () => {
    expect(assertPathLexicallyContained('/test-workspace/', '/test-workspace/src/App.tsx')).toBe(
      '/test-workspace/src/App.tsx',
    );
  });
});

/**
 * `resolveContainedPath` is the single safe entry point PanelRouter's `file:read` /
 * `hypercanvas:resolveServerSourceMap` handlers call. Fake-`RealpathFs` tests exercise the
 * pure control flow (ENOENT falls back to the lexical path; non-ENOENT fails closed;
 * `additionalRoots` widening); the real-filesystem tests at the bottom prove the actual
 * symlink-escape closure with `node:fs` doing the resolving, not a stand-in.
 */
describe('resolveContainedPath', () => {
  it('resolves a relative path inside the workspace when the candidate does not exist on disk (realpath ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    const fakeFs = {
      realpath: (p: string) => (p === '/test-workspace' ? Promise.resolve(p) : Promise.reject(enoent)),
    };
    await expect(resolveContainedPath('/test-workspace', 'src/App.tsx', { fs: fakeFs })).resolves.toBe(
      '/test-workspace/src/App.tsx',
    );
  });

  it('rejects a `../` traversal that escapes the workspace root', async () => {
    const fakeFs = { realpath: (p: string) => Promise.resolve(p) };
    await expect(resolveContainedPath('/test-workspace', '../../etc/passwd', { fs: fakeFs })).rejects.toThrow(
      /Path resolves outside workspace root/,
    );
  });

  // Fable review: a nonexistent candidate under a SYMLINKED workspace root must not be
  // false-rejected. The ENOENT fallback keeps the RAW-form lexical candidate (built from
  // '/tmp/test-workspace' as given), which would never lexically match the realpath'd root
  // ('/private/tmp/test-workspace') — checking against both raw and real root forms (not
  // just real) on the ENOENT path is what fixes this.
  it('resolves a nonexistent candidate under a symlinked workspace root instead of false-rejecting', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    const fakeFs = {
      realpath: (p: string) =>
        p === '/tmp/test-workspace' ? Promise.resolve('/private/tmp/test-workspace') : Promise.reject(enoent),
    };
    await expect(resolveContainedPath('/tmp/test-workspace', 'src/Missing.tsx', { fs: fakeFs })).resolves.toBe(
      '/tmp/test-workspace/src/Missing.tsx',
    );
  });

  // HYP-1131: an obviously-outside absolute path must be rejected WITHOUT ever calling
  // realpath on it — avoids performing a filesystem lookup (and leaking a distinguishable
  // EACCES/ELOOP/ENOENT error) for attacker-controlled input like `/etc/passwd`. Only the
  // (trusted, extension-configured) ROOT is realpath'd before the fast-reject fires.
  it('rejects an absolute escape without ever calling realpath on the candidate', async () => {
    const realpathCalls: string[] = [];
    const fakeFs = {
      realpath: (p: string) => {
        realpathCalls.push(p);
        return Promise.resolve(p);
      },
    };
    await expect(resolveContainedPath('/test-workspace', '/etc/passwd', { fs: fakeFs })).rejects.toThrow(
      /Path resolves outside workspace root/,
    );
    expect(realpathCalls).toEqual(['/test-workspace']); // only the root, never the candidate
  });

  it("rejects when realpath resolves the candidate to a location outside the (realpath'd) root", async () => {
    // Simulates a symlink `workspace/leak -> /etc/passwd`: the lexical path is inside the
    // workspace, but its realpath is not.
    const fakeFs = {
      realpath: (p: string) => Promise.resolve(p === '/test-workspace' ? '/test-workspace' : '/etc/passwd'),
    };
    await expect(resolveContainedPath('/test-workspace', 'leak', { fs: fakeFs })).rejects.toThrow(
      /Path resolves outside workspace root/,
    );
  });

  it("accepts when both the root and the candidate resolve through the same realpath'd parent", async () => {
    // Simulates the workspace root itself being reached via a symlink (e.g. macOS
    // /tmp -> /private/tmp) — both sides must be realpath'd for containment to hold.
    const fakeFs = {
      realpath: (p: string) => Promise.resolve(p.replace('/tmp/test-workspace', '/private/tmp/test-workspace')),
    };
    await expect(resolveContainedPath('/tmp/test-workspace', 'src/App.tsx', { fs: fakeFs })).resolves.toBe(
      '/private/tmp/test-workspace/src/App.tsx',
    );
  });

  // HYP-1131: an absolute candidate that is ALREADY in canonical (realpath'd) form —
  // exactly what a Node.js stack-trace file:// URL is, the source of
  // `hypercanvas:resolveServerSourceMap`'s filePath — must not be falsely rejected just
  // because the WORKSPACE ROOT VS Code reports is still in its symlinked (non-canonical)
  // form. Both sides are realpath'd before the final containment check, not compared raw.
  it('accepts a canonical absolute candidate even when the root is reported in symlinked form', async () => {
    const fakeFs = {
      realpath: (p: string) => Promise.resolve(p === '/tmp/test-workspace' ? '/private/tmp/test-workspace' : p),
    };
    await expect(
      resolveContainedPath('/tmp/test-workspace', '/private/tmp/test-workspace/.next/server/chunk.js', {
        fs: fakeFs,
      }),
    ).resolves.toBe('/private/tmp/test-workspace/.next/server/chunk.js');
  });

  // HYP-1131: a non-ENOENT realpath failure (EACCES, EIO, ELOOP…) must fail closed —
  // silently falling back to the lexical path here would let containment be bypassed by
  // simply making the real check error out.
  it('rethrows a non-ENOENT realpath error instead of falling back to the lexical path', async () => {
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const fakeFs = {
      realpath: (p: string) => (p === '/test-workspace' ? Promise.resolve(p) : Promise.reject(eacces)),
    };
    await expect(resolveContainedPath('/test-workspace', 'locked', { fs: fakeFs })).rejects.toThrow(/EACCES/);
  });

  // HYP-1131: mirrors AstBridge.setAdditionalWorkspaceRoot's monorepo widening — a sibling
  // sub-project outside the opened leaf, already authorized for AST writes, must not be
  // rejected for a read PanelRouter itself gates.
  it('accepts a path inside an additionalRoots entry outside the primary workspace root', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    const fakeFs = { realpath: (p: string) => (p.includes('.') ? Promise.reject(enoent) : Promise.resolve(p)) };
    await expect(
      resolveContainedPath('/repo/apps/web', '/repo/apps/mobile/src/App.tsx', {
        fs: fakeFs,
        additionalRoots: ['/repo/apps/mobile'],
      }),
    ).resolves.toBe('/repo/apps/mobile/src/App.tsx');
  });

  it('still rejects a path outside both the primary root and every additionalRoots entry', async () => {
    const fakeFs = { realpath: (p: string) => Promise.resolve(p) };
    await expect(
      resolveContainedPath('/repo/apps/web', '/etc/passwd', { fs: fakeFs, additionalRoots: ['/repo/apps/mobile'] }),
    ).rejects.toThrow(/Path resolves outside workspace root/);
  });

  describe('real filesystem (symlink escape)', () => {
    let workspaceDir: string;
    let outsideDir: string;

    beforeEach(async () => {
      workspaceDir = await mkdtemp(join(tmpdir(), 'hyp1131-workspace-'));
      outsideDir = await mkdtemp(join(tmpdir(), 'hyp1131-outside-'));
      await writeFile(join(outsideDir, 'secret.txt'), 'top secret');
    });

    afterEach(async () => {
      await rm(workspaceDir, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    });

    it('rejects a file symlink planted inside the workspace that points outside it', async () => {
      await symlink(join(outsideDir, 'secret.txt'), join(workspaceDir, 'leak.txt'));
      await expect(resolveContainedPath(workspaceDir, 'leak.txt')).rejects.toThrow(
        /Path resolves outside workspace root/,
      );
    });

    it('rejects a file reached THROUGH a directory symlink planted inside the workspace', async () => {
      // A directory symlink is a broader escape than a single-file symlink: every file
      // under it escapes, not just one. realpath() resolves symlinked path COMPONENTS,
      // not just a symlinked final segment, so this must be caught the same way.
      await symlink(outsideDir, join(workspaceDir, 'dirlink'));
      await expect(resolveContainedPath(workspaceDir, 'dirlink/secret.txt')).rejects.toThrow(
        /Path resolves outside workspace root/,
      );
    });

    it('still accepts a real, non-symlinked in-workspace file', async () => {
      await writeFile(join(workspaceDir, 'App.tsx'), 'export {}');
      const resolved = await resolveContainedPath(workspaceDir, 'App.tsx');
      expect(resolved.endsWith('/App.tsx')).toBe(true);
    });

    // Documents the accepted read-only contract for a DANGLING symlink (points to a
    // target that doesn't exist): realpath ENOENTs the same as an ordinary missing file,
    // so the ENOENT fallback passes it through rather than rejecting — this is safe ONLY
    // because there's nothing to actually read afterward (the caller's own `readFile` also
    // ENOENTs). See the "minor, accepted info-leak" note on `resolveContainedPath` — this
    // is the exact case that note describes, pinned so a future write-path caller reusing
    // this function doesn't accidentally inherit the assumption without re-reading it.
    it('resolves (does not reject) a dangling symlink pointing to a nonexistent outside target', async () => {
      await symlink(join(outsideDir, 'does-not-exist.txt'), join(workspaceDir, 'dangling-leak.txt'));
      const resolved = await resolveContainedPath(workspaceDir, 'dangling-leak.txt');
      expect(resolved.endsWith('/dangling-leak.txt')).toBe(true);
    });
  });
});
