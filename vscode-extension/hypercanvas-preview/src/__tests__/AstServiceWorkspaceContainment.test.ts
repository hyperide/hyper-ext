/**
 * @file AstService write-boundary workspace containment (HYP-1012)
 *
 * Surfaced by HYP-1006 review (codex P1): nodeRef file paths are browser/iframe-supplied
 * and therefore untrusted, `resolveWorkspacePath` returned absolute paths as-is with no
 * containment check, and `AstService` followed them straight through to a file write. A
 * crafted nodeRef (e.g. a forged `_debugSource.fileName`) pointing at an absolute
 * out-of-workspace path, or at a relative path that `../`-traverses out of the workspace
 * root, could make AstService read and mutate a file entirely outside the authorized
 * project the extension was opened on.
 *
 * These tests use the REAL `NodeFileIO` against real temp directories on disk (not
 * `InMemoryFileIO`) specifically for the `../` traversal case: an in-memory string-keyed
 * fake never resolves `..` segments, so it can't reproduce the actual vulnerability —
 * only the OS's real path resolution does that (`fs.readFile('/a/../b')` genuinely reads
 * `/b`). Exercising the real AstService end-to-end against real disk paths, with no mocks
 * of the resolution layer, means these tests fail for the genuine reason if the
 * containment check is ever removed.
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { NodeFileIO } from '@lib/ast/node-file-io';
import { AstService } from '../services/AstService';

/** Build a nodeRef `${fileName}:${line}:${column}` — fileName is used verbatim, so an
 * absolute or `../`-laden string here simulates a crafted/forged nodeRef. */
function refFor(source: string, fileName: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, fileName);
  return `${fileName}:${entries[0].loc.line}:${entries[0].loc.column}`;
}

/**
 * Lay out `<tmp>/workspace/` (the authorized root passed to AstService) and a SIBLING
 * `<tmp>/secret/` directory outside it, mirroring "attacker-reachable file that happens
 * to exist somewhere on the developer's disk outside the opened project".
 */
async function scratchWorkspace(): Promise<{ workspaceRoot: string; secretDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'hyp1012-containment-'));
  const workspaceRoot = join(root, 'workspace');
  const secretDir = join(root, 'secret');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(secretDir, { recursive: true });
  return { workspaceRoot, secretDir };
}

const evilSource = `export function Evil() {
  return <div style={{ color: 'blue' }}>content</div>;
}
`;

const appSource = `export default function App() {
  return <div>shell</div>;
}
`;

describe('AstService workspace containment (HYP-1012)', () => {
  it('rejects a nodeRef whose fileName is an absolute path outside the workspace root', async () => {
    const { workspaceRoot, secretDir } = await scratchWorkspace();
    const appPath = join(workspaceRoot, 'App.tsx');
    const evilPath = join(secretDir, 'outside.tsx');
    await writeFile(appPath, appSource, 'utf-8');
    await writeFile(evilPath, evilSource, 'utf-8');

    const service = new AstService(workspaceRoot, new NodeFileIO());
    // Crafted nodeRef pointing directly at the out-of-workspace file. filePath
    // ('App.tsx') doesn't contain the target element, forcing the cross-file nodeRef
    // fallback that `_extractFileFromNodeRef` drives.
    const evilNodeRef = refFor(evilSource, evilPath);

    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles('App.tsx', evilNodeRef, { color: 'red' }, undefined, evilNodeRef);
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
    expect(await readFile(appPath, 'utf-8')).toBe(appSource); // untouched
  });

  it('rejects a nodeRef whose fileName ../-traverses out of the workspace root', async () => {
    const { workspaceRoot, secretDir } = await scratchWorkspace();
    const appPath = join(workspaceRoot, 'App.tsx');
    const evilPath = join(secretDir, 'outside.tsx');
    await writeFile(appPath, appSource, 'utf-8');
    await writeFile(evilPath, evilSource, 'utf-8');
    // The traversal below walks through workspaceRoot/src, so that directory segment
    // must actually exist on disk for the OS to resolve the `../../` hops at all —
    // otherwise the read fails on a missing intermediate directory rather than on the
    // containment check, which would prove nothing.
    await mkdir(join(workspaceRoot, 'src'), { recursive: true });

    const service = new AstService(workspaceRoot, new NodeFileIO());
    // Relative-looking fileName that escapes the workspace root once joined: real `fs`
    // calls resolve `../` transparently, so `<workspaceRoot>/src/../../secret/outside.tsx`
    // genuinely reads/writes `<secretDir>/outside.tsx` unless containment is enforced
    // BEFORE the resolved path reaches `fs`.
    const traversalFileName = `src/../../${join('secret', 'outside.tsx')}`;
    const evilNodeRef = refFor(evilSource, traversalFileName);

    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles('App.tsx', evilNodeRef, { color: 'red' }, undefined, evilNodeRef);
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
  });

  it('rejects an out-of-workspace absolute filePath passed directly (no cross-file fallback involved)', async () => {
    const { workspaceRoot, secretDir } = await scratchWorkspace();
    const evilPath = join(secretDir, 'outside.tsx');
    await writeFile(evilPath, evilSource, 'utf-8');

    const service = new AstService(workspaceRoot, new NodeFileIO());
    const nodeRef = refFor(evilSource, evilPath);

    const result = await service.updateStyles(evilPath, nodeRef, { color: 'red' }, undefined, nodeRef);

    expect(result.success).toBe(false);
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
  });

  // updateStyles funnels through updateStylesWrapper's own try/catch. Every AstService
  // mutation method resolves `filePath` through the same `resolveWorkspacePath`, so this
  // covers two more shapes: deleteElements (self-catching wrapper -> success:false) and
  // moveElement (documented to propagate exceptions per the visual-foundation spec — the
  // AstBridge layer, not AstService itself, is the one that converts the throw into a
  // toast). Both must fail safely instead of writing to — or deleting from — the escaped file.
  it('rejects an out-of-workspace absolute filePath in deleteElements (self-catching wrapper)', async () => {
    const { workspaceRoot, secretDir } = await scratchWorkspace();
    const evilPath = join(secretDir, 'outside.tsx');
    await writeFile(evilPath, evilSource, 'utf-8');

    const service = new AstService(workspaceRoot, new NodeFileIO());
    const nodeRef = refFor(evilSource, evilPath);

    const result = await service.deleteElements(evilPath, [nodeRef]);

    expect(result.success).toBe(false);
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
  });

  it('propagates a rejection (not a silent no-op) for an out-of-workspace absolute filePath in moveElement', async () => {
    const { workspaceRoot, secretDir } = await scratchWorkspace();
    const evilPath = join(secretDir, 'outside.tsx');
    await writeFile(evilPath, evilSource, 'utf-8');

    const service = new AstService(workspaceRoot, new NodeFileIO());
    const nodeRef = refFor(evilSource, evilPath);

    // moveElement's own contract (see its doc comment) is to propagate internal failures
    // as exceptions — AstBridge._handleMoveElement is what converts this into
    // { success: false }. Asserting the rejection here, rather than a resolved value,
    // matches that documented contract instead of silently swallowing it.
    await expect(service.moveElement(evilPath, nodeRef, nodeRef, 'after')).rejects.toThrow();
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
  });
});

describe('AstService.setAdditionalWorkspaceRoot — opened-leaf monorepo sibling access (HYP-1012 review round 1 follow-up)', () => {
  // Review round 1 (codex, PR #675) P1: PanelRouter/UndoRedoService already support a
  // documented workflow where VS Code is opened at a monorepo sub-package LEAF and the
  // Explorer's ancestor-fallback scan surfaces SIBLING sub-projects living outside that
  // leaf, reached via absolute (Vite `/@fs/`-stripped) paths. The leaf-only containment
  // check this file's own describe block above exercises regressed that supported flow —
  // a legitimate sibling absolute path was rejected exactly like a real attack path,
  // because AstService had no way to know the wider monorepo root was authorized.
  // `setAdditionalWorkspaceRoot` (mirroring UndoRedoService's own widening) fixes this:
  // sibling paths resolve once widened, and still reject anything outside the WHOLE
  // monorepo root once widened (not an unbounded escape hatch).

  async function scratchMonorepo(): Promise<{ monorepoRoot: string; leafRoot: string; siblingDir: string }> {
    const monorepoRoot = await mkdtemp(join(tmpdir(), 'hyp1012-monorepo-'));
    const leafRoot = join(monorepoRoot, 'targets', 'app');
    const siblingDir = join(monorepoRoot, 'targets', 'shared-lib', 'src');
    await mkdir(leafRoot, { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    return { monorepoRoot, leafRoot, siblingDir };
  }

  it('rejects a sibling absolute path BEFORE setAdditionalWorkspaceRoot widens the boundary', async () => {
    const { leafRoot, siblingDir } = await scratchMonorepo();
    const siblingPath = join(siblingDir, 'Button.tsx');
    await writeFile(siblingPath, evilSource, 'utf-8');

    const service = new AstService(leafRoot, new NodeFileIO());
    const nodeRef = refFor(evilSource, siblingPath);

    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles(siblingPath, nodeRef, { color: 'red' }, undefined, nodeRef);
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    expect(await readFile(siblingPath, 'utf-8')).toBe(evilSource); // untouched
  });

  it('accepts the same sibling absolute path once setAdditionalWorkspaceRoot(monorepoRoot) widens the boundary', async () => {
    const { monorepoRoot, leafRoot, siblingDir } = await scratchMonorepo();
    const siblingPath = join(siblingDir, 'Button.tsx');
    await writeFile(siblingPath, evilSource, 'utf-8');

    const service = new AstService(leafRoot, new NodeFileIO());
    service.setAdditionalWorkspaceRoot(monorepoRoot);
    const nodeRef = refFor(evilSource, siblingPath);

    const result = await service.updateStyles(siblingPath, nodeRef, { color: 'red' }, undefined, nodeRef);

    expect(result.success).toBe(true);
    expect(await readFile(siblingPath, 'utf-8')).toContain('red');
  });

  it('still rejects a path outside the WHOLE widened monorepo root, not just the leaf', async () => {
    const { monorepoRoot, leafRoot } = await scratchMonorepo();
    const outsideDir = await mkdtemp(join(tmpdir(), 'hyp1012-outside-'));
    const evilPath = join(outsideDir, 'outside.tsx');
    await writeFile(evilPath, evilSource, 'utf-8');

    const service = new AstService(leafRoot, new NodeFileIO());
    service.setAdditionalWorkspaceRoot(monorepoRoot);
    const nodeRef = refFor(evilSource, evilPath);

    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles(evilPath, nodeRef, { color: 'red' }, undefined, nodeRef);
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    expect(await readFile(evilPath, 'utf-8')).toBe(evilSource); // untouched
  });

  it('narrows back to the leaf-only boundary when setAdditionalWorkspaceRoot(null) is called', async () => {
    const { leafRoot, siblingDir } = await scratchMonorepo();
    const siblingPath = join(siblingDir, 'Button.tsx');
    await writeFile(siblingPath, evilSource, 'utf-8');

    const service = new AstService(leafRoot, new NodeFileIO());
    service.setAdditionalWorkspaceRoot('/some/monorepo/root/that/does/not/contain/this/sibling');
    service.setAdditionalWorkspaceRoot(null);
    const nodeRef = refFor(evilSource, siblingPath);

    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles(siblingPath, nodeRef, { color: 'red' }, undefined, nodeRef);
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    expect(await readFile(siblingPath, 'utf-8')).toBe(evilSource); // untouched
  });
});
