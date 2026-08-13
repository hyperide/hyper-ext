/**
 * @file Workspace containment tests for `resolveWorkspacePath` (HYP-1012)
 *
 * Accessed via: VS Code extension AST/style-read services resolving project files
 * Assumptions: `resolveWorkspacePath` is the single choke point every nodeRef/filePath
 *   resolution in AstService funnels through before touching disk. A crafted nodeRef
 *   (browser/iframe-supplied, therefore untrusted) is the attack surface — this file
 *   proves the write boundary refuses to leave the authorized workspace root.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import { win32 } from 'node:path';
import { resolveWorkspacePath } from '../services/workspace-path';

describe('resolveWorkspacePath workspace containment (HYP-1012)', () => {
  it('resolves an ordinary relative path under the workspace root', () => {
    expect(resolveWorkspacePath('/workspace', 'src/App.tsx')).toBe('/workspace/src/App.tsx');
  });

  it('resolves an absolute path that is already inside the workspace root', () => {
    expect(resolveWorkspacePath('/workspace', '/workspace/src/App.tsx')).toBe('/workspace/src/App.tsx');
  });

  it('resolves a monorepo sub-package path nested inside the workspace root', () => {
    // AstServiceMonorepoCollision.test.ts covers translation into this shape; here we
    // only assert containment doesn't regress a legitimate nested-package absolute path.
    expect(resolveWorkspacePath('/repo', '/repo/targets/conloca-app/src/app/page.tsx')).toBe(
      '/repo/targets/conloca-app/src/app/page.tsx',
    );
  });

  it('resolves a Vite /@fs/-stripped absolute path when it lands inside the workspace root', () => {
    // Vite serves cross-package monorepo libraries via /@fs/<absolute> (HYP-443); by the
    // time it reaches AstService the /@fs/ prefix has already been stripped, leaving a
    // plain absolute path. As long as that path is still inside the authorized root, it
    // must keep resolving — the fix must not regress this legitimate flow.
    expect(resolveWorkspacePath('/repo', '/repo/packages/shared-lib/src/Button.tsx')).toBe(
      '/repo/packages/shared-lib/src/Button.tsx',
    );
  });

  it('resolves a relative path containing a redundant ../ that stays inside the root', () => {
    expect(resolveWorkspacePath('/workspace', 'src/../src/App.tsx')).toBe('/workspace/src/App.tsx');
  });

  it('rejects an absolute path outside the workspace root', () => {
    expect(() => resolveWorkspacePath('/workspace', '/etc/passwd')).toThrow();
  });

  it('rejects an absolute path under a sibling directory that merely shares a name prefix', () => {
    // Naive `startsWith(root)` containment would wrongly allow this — must be
    // segment-boundary-aware ("/workspace-evil" is NOT inside "/workspace").
    expect(() => resolveWorkspacePath('/workspace', '/workspace-evil/src/App.tsx')).toThrow();
  });

  it('rejects a relative ../ traversal that escapes the workspace root', () => {
    expect(() => resolveWorkspacePath('/workspace', '../../etc/passwd')).toThrow();
  });

  it('rejects a deeply nested relative ../ traversal that escapes the workspace root', () => {
    expect(() => resolveWorkspacePath('/workspace', 'src/../../secret/outside.tsx')).toThrow();
  });

  it('resolves a legitimately-contained child when the workspace root IS the filesystem root', () => {
    // Degenerate/unrealistic for a real VS Code workspace, but the containment prefix
    // must not double up ("//") and reject every one of the root's own children.
    expect(resolveWorkspacePath('/', 'etc/passwd')).toBe('/etc/passwd');
  });

  it('resolves correctly when workspaceRoot itself has a trailing separator', () => {
    // Exercises stripTrailingSep's `p.length > 1` branch on a multi-char root — the `/`
    // root case above only exercises the length-1 special-case, not this one. A missed
    // strip here would double up the containment prefix ("/workspace//") and reject
    // every legitimate child.
    expect(resolveWorkspacePath('/workspace/', 'src/App.tsx')).toBe('/workspace/src/App.tsx');
    expect(resolveWorkspacePath('/workspace/', '/workspace/src/App.tsx')).toBe('/workspace/src/App.tsx');
  });
});

describe('resolveWorkspacePath Windows separator normalization (HYP-1012 Codex P1 follow-up)', () => {
  // `path.win32` is a real, always-available Node.js submodule (not a Windows-only
  // feature) — passing it in exercises the exact separator behavior `path.normalize`
  // has on an actual Windows host, deterministically, from any OS running this suite.
  // We inject it via the optional `pathOps` param rather than `mock.module('node:path')`
  // because bun's `mock.module` is process-global: mocking `node:path` here would leak
  // into every other test file sharing the bun test process.
  //
  // Bug mechanism this guards: pre-`toForwardSlashes`, `resolveWorkspacePath` returned
  // whatever `pathOps.normalize` produced verbatim. On win32 that's always
  // backslash-joined (`C:\workspace\src\screens\RecordScreen.tsx`), which fails
  // AstService._resolveElement's hardcoded `absolutePath.endsWith(\`/${entryFile}\`)`
  // suffix checks (AstService.ts:375-376, 411, 423) against the nodeMap's `entryFile` —
  // itself always forward-slash + project-relative, via NodeMapService.toStorageKey ->
  // toProjectRelative (shared/element-tracing/path-normalization.ts), which independently
  // forward-slash-normalizes both its `fileName` and `projectRoot` operands regardless of
  // this fix. So the ONLY thing that needed fixing here is resolveWorkspacePath's own
  // return value; toProjectRelative's separator-agnostic key derivation was already safe.

  it('resolveWorkspacePath with win32 path ops returns a forward-slash path that satisfies the suffix match', () => {
    const resolved = resolveWorkspacePath('C:\\workspace', 'src/screens/RecordScreen.tsx', win32);
    expect(resolved).toBe('C:/workspace/src/screens/RecordScreen.tsx');

    const entryFile = 'src/screens/RecordScreen.tsx';
    expect(resolved.endsWith(`/${entryFile}`)).toBe(true);
  });

  it('resolveWorkspacePath with win32 path ops still rejects a ..\\ traversal that escapes the root', () => {
    expect(() => resolveWorkspacePath('C:\\workspace', '..\\..\\secret\\outside.tsx', win32)).toThrow();
  });

  it('resolveWorkspacePath with win32 path ops still rejects a sibling directory sharing a name prefix', () => {
    // win32 counterpart of the POSIX "/workspace-evil" test above — the `../` here
    // walks out of `workspace` and back into the sibling `workspace-evil` on the SAME
    // parent, which the segment-boundary-aware containedPrefix check must still reject.
    expect(() => resolveWorkspacePath('C:\\workspace', '..\\workspace-evil\\x.tsx', win32)).toThrow();
  });

  it('resolveWorkspacePath with win32 path ops still rejects an absolute out-of-workspace path', () => {
    // A crafted nodeRef fileName is browser/webview-supplied, hence always forward-slash
    // (`filePath.startsWith('/')` is the absolute-path branch, POSIX-only by design — see
    // the file header's documented pre-existing limitation on Windows drive-letter paths).
    expect(() => resolveWorkspacePath('C:\\workspace', '/secret/outside.tsx', win32)).toThrow();
  });

  it('resolveWorkspacePath with win32 path ops resolves a legitimate nested child unchanged in shape', () => {
    expect(resolveWorkspacePath('C:\\workspace\\', 'src/App.tsx', win32)).toBe('C:/workspace/src/App.tsx');
  });

  it('resolveWorkspacePath with win32 path ops still rejects a traversal when the root has a trailing separator', () => {
    expect(() => resolveWorkspacePath('C:\\workspace\\', '..\\secret.tsx', win32)).toThrow();
  });

  it('resolveWorkspacePath with win32 path ops normalizes a backslash-separated relative filePath', () => {
    // The nodeRef fileName is always forward-slash in practice (browser-supplied), but
    // nothing prevents a caller from passing an already-backslash relative path — must
    // still resolve, and still come back forward-slash.
    expect(resolveWorkspacePath('C:\\workspace', 'src\\App.tsx', win32)).toBe('C:/workspace/src/App.tsx');
  });

  it('resolveWorkspacePath with win32 path ops normalizes a MIXED forward/backslash relative filePath', () => {
    expect(resolveWorkspacePath('C:\\workspace', 'src\\screens/Foo.tsx', win32)).toBe('C:/workspace/src/screens/Foo.tsx');
  });

  it('resolveWorkspacePath with win32 path ops resolves when the workspace root is a bare drive letter', () => {
    // `stripTrailingSep` reduces "C:\" to "C:" here, so the root-is-filesystem-root
    // special case (containedPrefix === pathSep) does NOT apply on this shape — pins that
    // containment still works via the ordinary `${root}${sep}` prefix instead.
    expect(resolveWorkspacePath('C:\\', 'src/App.tsx', win32)).toBe('C:/src/App.tsx');
  });

  it('leaves a Windows extended-length (`\\\\?\\`) root untouched rather than producing an invalid `//?/` path', () => {
    // Documented deferred limitation (HYP-1060, see file header): the backslash-suffix-
    // match break this fix targets would reappear for this one root shape, but that beats
    // silently emitting a `//?/`-prefixed path Win32 rejects outright.
    expect(resolveWorkspacePath('\\\\?\\C:\\workspace', 'src/App.tsx', win32)).toBe('\\\\?\\C:\\workspace\\src\\App.tsx');
  });

  it('forward-slashes a Windows UNC root (unlike `\\\\?\\`, a UNC root is not left verbatim)', () => {
    // A UNC root (`\\server\share\project`) doesn't start with `\\?\`, so unlike the
    // extended-length case above it goes through the ordinary forward-slash conversion,
    // producing a `//server/share/...` path. Pinning this shape per Opus review note on
    // the HYP-1012 follow-up (PR #675): still satisfies AstService's
    // `endsWith('/${entryFile}')` suffix check, and Node's `fs` accepts forward-slash UNC.
    expect(resolveWorkspacePath('\\\\server\\share\\project', 'src/App.tsx', win32)).toBe('//server/share/project/src/App.tsx');
  });
});

describe('resolveWorkspacePath additionalRoots (HYP-1012 monorepo review-round-1 follow-up)', () => {
  // Review round 1 (codex, PR #675) P1: opening VS Code at a monorepo sub-package LEAF has a
  // supported workflow where the Explorer's ancestor-fallback scan surfaces SIBLING
  // sub-projects living outside the opened leaf (PanelRouter.getComponentGroups's
  // `monorepoRoot`, threaded to AstBridge.setAdditionalWorkspaceRoot). Pre-HYP-1012 those
  // absolute sibling paths resolved with no containment check at all; the leaf-only
  // containment check regressed them. `additionalRoots` restores the widened allowlist while
  // keeping relative-path joining scoped to the primary `workspaceRoot` only.

  it('accepts an absolute path under an additional root that is outside the primary workspace root', () => {
    expect(
      resolveWorkspacePath('/repo/targets/app', '/repo/targets/lib/src/Button.tsx', undefined, ['/repo']),
    ).toBe('/repo/targets/lib/src/Button.tsx');
  });

  it('still rejects a path outside BOTH the primary root and the additional roots', () => {
    expect(() =>
      resolveWorkspacePath('/repo/targets/app', '/etc/passwd', undefined, ['/repo']),
    ).toThrow();
  });

  it('still rejects a sibling directory sharing a name prefix with an additional root', () => {
    expect(() =>
      resolveWorkspacePath('/repo/targets/app', '/repo-evil/targets/lib/x.tsx', undefined, ['/repo']),
    ).toThrow();
  });

  it('joins a RELATIVE filePath against the primary root only, never an additional root', () => {
    // additionalRoots widens containment for ABSOLUTE paths; a relative filePath must still
    // resolve under the opened leaf, not get silently redirected to the monorepo root.
    expect(resolveWorkspacePath('/repo/targets/app', 'src/App.tsx', undefined, ['/repo'])).toBe(
      '/repo/targets/app/src/App.tsx',
    );
  });

  it('accepts a path already inside the primary root even with additionalRoots present', () => {
    expect(
      resolveWorkspacePath('/repo/targets/app', '/repo/targets/app/src/App.tsx', undefined, ['/repo']),
    ).toBe('/repo/targets/app/src/App.tsx');
  });
});
