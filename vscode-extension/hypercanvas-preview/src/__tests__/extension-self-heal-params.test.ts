/**
 * @file Unit tests for resolveSelfHealComponentParams — the monorepo
 * missing-component self-heal path must re-supply BOTH the repo-relative and
 * the sub-project-relative component paths to setComponentParam.
 *
 * Accessed via: extension.ts activate() → previewPanel.onComponentMissing
 *               (HYP-435 monorepo in-canvas edit re-rooting).
 * Assumptions: the iframe's componentMissing signal carries the PREVIEW
 *              (sub-project-relative, `?component=` query) path, e.g.
 *              `src/app/page.tsx`. The dev-server-rooted activeWorkspaceRoot is
 *              the sub-project; the VS Code folder root is the repo root.
 * Past bugs: P2 #280 (codex) — the self-heal path called
 *            `setComponentParam(relPath)` with a single arg, so
 *            previewComponentPath defaulted to the same value, deriveSubProjectPrefix
 *            returned '' and the AstBridge prefix was cleared. Subsequent
 *            iframe AST edits in the regenerated preview were sent as `src/...`
 *            again and either failed or hit suffix collisions across targets.
 */
import { describe, expect, it } from 'bun:test';
import { resolveSelfHealComponentParams } from '../extension-utils';

describe('resolveSelfHealComponentParams', () => {
  it('monorepo: returns repo-relative componentPath + sub-relative previewComponentPath', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: 'src/app/page.tsx', // iframe-supplied preview (sub-relative) path
      activeWorkspaceRoot: '/repo/targets/conloca-app',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'targets/conloca-app/src/app/page.tsx',
      previewComponentPath: 'src/app/page.tsx',
    });
  });

  it('single-package: repo root === active root → both paths coincide (prefix becomes empty)', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: 'src/Button.tsx',
      activeWorkspaceRoot: '/repo',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'src/Button.tsx',
      previewComponentPath: 'src/Button.tsx',
    });
  });

  it('absolute iframe path: resolved against both roots independently', () => {
    const result = resolveSelfHealComponentParams({
      componentPath: '/repo/targets/conloca-app/src/app/page.tsx',
      activeWorkspaceRoot: '/repo/targets/conloca-app',
      repoRoot: '/repo',
    });

    expect(result).toEqual({
      componentPath: 'targets/conloca-app/src/app/page.tsx',
      previewComponentPath: 'src/app/page.tsx',
    });
  });
});
