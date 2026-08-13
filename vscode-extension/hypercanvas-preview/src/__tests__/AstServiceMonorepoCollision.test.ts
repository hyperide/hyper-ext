/**
 * @file AstService monorepo suffix-collision resolution (HYP-435 / task HYP-430)
 *
 * Reproduces the core bug: a monorepo opened at the repo ROOT with two
 * sub-projects that each contain `src/app/page.tsx`. The iframe reports the
 * clicked element with SUB-project-relative paths (`src/app/page.tsx` +
 * `src/app/page.tsx:L:C`). Pre-fix, the repo-rooted AstService resolves these
 * against the repo root → the file is either NOT FOUND (`/repo/src/app/page.tsx`
 * doesn't exist) or, when a path happens to resolve, the sub-relative nodeRef
 * suffix-matches BOTH targets ambiguously. The fix translates filePath + nodeRef
 * to REPO-relative (`targets/<name>/src/app/page.tsx`) before they reach
 * AstService, making resolution exist and be unambiguous.
 *
 * These tests exercise the REAL AstService against an in-memory filesystem — no
 * mocks of the resolution layer — so they fail for the genuine reason if the
 * translation is removed.
 */
import { describe, expect, it } from 'bun:test';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import { toRepoRelativeElementId, toRepoRelativePath } from '../bridges/monorepo-path-translate';
import { AstService } from '../services/AstService';

function refFor(source: string, relativePath: string): string {
  const helper = new NodeMapService();
  const entries = helper.parseAndBuild(source, relativePath);
  return `${relativePath}:${entries[0].loc.line}:${entries[0].loc.column}`;
}

// Two sub-projects, each with src/app/page.tsx but DIFFERENT marker text so we
// can tell which file an edit actually hit.
const appAPath = '/repo/targets/conloca-app/src/app/page.tsx';
const appBPath = '/repo/targets/conloca-web/src/app/page.tsx';
const appASource = `export function Page() {
  return <h1 className="from-app">App target</h1>;
}
`;
const appBSource = `export function Page() {
  return <h1 className="from-web">Web target</h1>;
}
`;

const subPrefixA = 'targets/conloca-app/';

describe('AstService monorepo suffix-collision', () => {
  it('repo-relative (translated) nodeRef edits the correct sub-project file', async () => {
    const fileIO = new InMemoryFileIO({ [appAPath]: appASource, [appBPath]: appBSource });
    const service = new AstService('/repo', fileIO);

    // What the iframe emits — sub-project-relative.
    const subRelFilePath = 'src/app/page.tsx';
    const subRelNodeRef = refFor(appASource, subRelFilePath);

    // What AstBridge produces after translation.
    const repoFilePath = toRepoRelativePath(subRelFilePath, subPrefixA);
    const repoNodeRef = toRepoRelativeElementId(subRelNodeRef, subPrefixA);
    expect(repoFilePath).toBe('targets/conloca-app/src/app/page.tsx');

    const result = await service.updateStyles(repoFilePath, repoNodeRef, { color: 'red' }, undefined, repoNodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    // Edit landed in the APP target, not the WEB target.
    expect(fileIO.content(appAPath)).toContain('from-app');
    expect(fileIO.content(appAPath)).toContain('red');
    expect(fileIO.content(appBPath)).toBe(appBSource); // web target untouched
  });

  it('UNTRANSLATED sub-relative path fails outright — proving translation is required', async () => {
    // Documents the pre-fix bug. The iframe emits a SUB-project-relative
    // filePath/nodeRef (`src/app/page.tsx`). The repo-rooted AstService resolves
    // filePath against the REPO root → `/repo/src/app/page.tsx`, which does not
    // exist (the file lives under `/repo/targets/conloca-app/...`). So an
    // in-canvas edit of a monorepo sub-project component fails before it can even
    // reach element resolution — and neither target file is touched.
    const fileIO = new InMemoryFileIO({ [appAPath]: appASource, [appBPath]: appBSource });
    const service = new AstService('/repo', fileIO);

    const subRelFilePath = 'src/app/page.tsx';
    const subRelNodeRef = refFor(appBSource, subRelFilePath); // user intended WEB target

    // AstService logs an expected "file not found" error on this failure path.
    const originalError = console.error;
    console.error = () => {};
    let result: Awaited<ReturnType<typeof service.updateStyles>>;
    try {
      result = await service.updateStyles(
        subRelFilePath,
        subRelNodeRef,
        { color: 'magenta' },
        undefined,
        subRelNodeRef,
      );
    } finally {
      console.error = originalError;
    }

    expect(result.success).toBe(false);
    // Both targets remain pristine — the edit went nowhere.
    expect(fileIO.content(appAPath)).toBe(appASource);
    expect(fileIO.content(appBPath)).toBe(appBSource);
  });

  it('repo-relative nodeRef for the OTHER target edits that target, proving disambiguation', async () => {
    const fileIO = new InMemoryFileIO({ [appAPath]: appASource, [appBPath]: appBSource });
    const service = new AstService('/repo', fileIO);

    const subRelFilePath = 'src/app/page.tsx';
    const subRelNodeRef = refFor(appBSource, subRelFilePath);
    const subPrefixB = 'targets/conloca-web/';
    const repoFilePath = toRepoRelativePath(subRelFilePath, subPrefixB);
    const repoNodeRef = toRepoRelativeElementId(subRelNodeRef, subPrefixB);

    const result = await service.updateStyles(repoFilePath, repoNodeRef, { color: 'blue' }, undefined, repoNodeRef);

    expect(result).toEqual(expect.objectContaining({ success: true }));
    // Same sub-relative coordinate, different prefix → the WEB target is edited.
    expect(fileIO.content(appBPath)).toContain('from-web');
    expect(fileIO.content(appBPath)).toContain('blue');
    expect(fileIO.content(appAPath)).toBe(appASource); // app target untouched
  });
});
