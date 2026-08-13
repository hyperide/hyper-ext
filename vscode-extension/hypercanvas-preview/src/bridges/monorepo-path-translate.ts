/**
 * @file Sub-project → repo path translation for monorepo in-canvas editing.
 *
 * Accessed via: AstBridge, when re-rooting iframe-supplied edit coordinates.
 * Assumptions: in a monorepo opened at the repo ROOT, the preview dev server
 *   runs inside a sub-project (e.g. `targets/conloca-app`), so every source
 *   path the iframe reports — React `_debugSource.fileName` baked into element
 *   ids (`fileName:line:col`) and the derived `filePath` — is relative to that
 *   SUB-project root (`src/app/page.tsx`). The repo-rooted AstBridge /
 *   NodeMapService key files by their REPO-relative path
 *   (`targets/conloca-app/src/app/page.tsx`). Without translation the two never
 *   line up exactly; the only thing that bridged them was suffix (`endsWith`)
 *   matching, which silently picks the wrong file when two sub-projects share a
 *   suffix (`src/app/page.tsx` exists in two targets). This module makes the
 *   translation explicit and unambiguous (HYP-430).
 *
 * Single-package projects: the sub-project root IS the repo root, so the prefix
 *   is empty and every function below is an identity no-op.
 *
 * All paths are normalized to forward slashes first: the iframe always emits
 *   forward-slash paths, but the repo/sub component paths are derived with Node
 *   `path.relative`, which yields backslashes on Windows. Comparing the two raw
 *   would disable translation on Windows (HYP-435).
 */

import { isAbsolute, join } from 'node:path';

import { stripViteFsPrefix, toProjectRelative } from '@shared/element-tracing/path-normalization';

/** Convert any backslash separators to forward slashes. */
function toForwardSlashes(p: string): string {
  return p.includes('\\') ? p.replace(/\\/g, '/') : p;
}

/**
 * Derive the constant sub-project path prefix from a repo-relative component
 * path and its sub-project-relative counterpart.
 *
 * Example: repoRel `targets/conloca-app/src/app/page.tsx`, subRel
 * `src/app/page.tsx` → `targets/conloca-app/`.
 *
 * Returns `''` (empty prefix, identity translation) when the two coincide
 * (single-package project) or when `subRel` is not actually a suffix of
 * `repoRel` (defensive: never fabricate a bogus prefix).
 */
export function deriveSubProjectPrefix(repoRel: string | undefined, subRel: string | undefined): string {
  if (!repoRel || !subRel) return '';
  const repo = toForwardSlashes(repoRel);
  const sub = toForwardSlashes(subRel);
  if (repo === sub) return '';
  // sub must be a path-segment-aligned suffix of repo for the prefix to be
  // meaningful. `targets/app/src/x.tsx` vs `src/x.tsx` → prefix `targets/app/`;
  // reject `src/x.tsx` vs `rc/x.tsx` style partial (non-segment) matches.
  const suffix = sub.startsWith('/') ? sub : `/${sub}`;
  if (!repo.endsWith(suffix)) return '';
  return repo.slice(0, repo.length - sub.length);
}

/**
 * Translate a single sub-project-relative path to repo-relative by prepending
 * the sub-project prefix.
 *
 * No-ops (returns the path unchanged) when:
 * - the prefix is empty (single-package project),
 * - the path is absolute (already resolved),
 * - the path already starts with the prefix (already repo-relative — e.g. a
 *   `filePath` taken from the repo-rooted editor state, not from the iframe).
 */
export function toRepoRelativePath(filePath: string, subProjectPrefix: string): string {
  if (!filePath) return filePath;
  // Strip Vite's `/@fs/` prefix FIRST — unconditionally, before the empty-prefix
  // early return. A cross-package library file has an empty sub-project prefix
  // (its path is not a suffix of the repo-relative form), so the prefix logic
  // below no-ops; the `/@fs/` strip is what makes the absolute path usable (HYP-443).
  const stripped = stripViteFsPrefix(filePath);
  if (!subProjectPrefix) return stripped;
  const fwd = toForwardSlashes(stripped);
  // Platform-independent absolute-path check on purpose: paths are forward-slash
  // normalized (see file header), so a host-dependent `path.isAbsolute` would
  // misclassify `C:/...` on POSIX. POSIX-absolute (`/`) and Windows drive-letter
  // forms are the only shapes the iframe ever emits here.
  if (fwd.startsWith('/') || /^[a-zA-Z]:/.test(fwd)) return stripped;
  // Already repo-relative: return the slash-normalized form used throughout this
  // module (`fwd` equals `stripped` when no backslashes were present).
  if (fwd.startsWith(subProjectPrefix)) return fwd;
  return `${subProjectPrefix}${fwd}`;
}

/**
 * Translate the `fileName` part of an element id / nodeRef of the form
 * `fileName:line:column` (the React `_debugSource` coordinate the iframe emits).
 * The `line:column` tail is preserved verbatim.
 *
 * Ids that don't match the `fileName:line:column` shape (e.g. synthetic refs)
 * are returned unchanged.
 */
/**
 * Rewrite the `fileName` part of an element id / nodeRef (`fileName:line:column`)
 * with `mapFileName`, preserving the `line:column` tail verbatim. Ids that don't
 * match the shape (UUIDs, synthetic refs) are returned unchanged, as are ids whose
 * mapped fileName is identical to the input.
 */
function mapElementIdFileName(elementId: string, mapFileName: (fileName: string) => string): string {
  if (!elementId) return elementId;
  const m = elementId.match(/^(.+):(\d+):(\d+)$/);
  if (!m) return elementId;
  const mapped = mapFileName(m[1]);
  if (mapped === m[1]) return elementId;
  return `${mapped}:${m[2]}:${m[3]}`;
}

export function toRepoRelativeElementId(elementId: string, subProjectPrefix: string): string {
  // toRepoRelativePath strips `/@fs/` unconditionally (HYP-443) and applies the
  // sub-project prefix when present, so this works even for an empty prefix.
  return mapElementIdFileName(elementId, (fileName) => toRepoRelativePath(fileName, subProjectPrefix));
}

/**
 * Normalize the `fileName` part of an element id / nodeRef (`fileName:line:column`)
 * to PROJECT-relative when it carries an absolute filesystem path rooted under
 * `workspaceRoot` — e.g. a `file://`-absolute source-map path leaking through the
 * fiber resolution on Tamagui/vite projects (HYP-1173: `/abs/root/App.web.tsx:10:6`
 * → `App.web.tsx:10:6`). A raw `file://` scheme prefix is stripped first (the
 * source-map resolver normally does this upstream, but unmapped fallback paths can
 * commit scheme-carrying values).
 *
 * Ids that are already relative, UUID-shaped, synthetic, or absolute OUTSIDE the
 * workspace root are returned unchanged (fail closed — containment is enforced
 * downstream by AstService/resolveContainedPath). Out of scope, documented: the
 * Turbopack dropped-leading-slash shape (`test-workspace/src/App.tsx:10:6`,
 * HYP-268) can't be distinguished from a genuinely relative path here and is
 * handled by EditorBridge's restore-slash heuristic instead.
 */
export function toProjectRelativeElementId(elementId: string, workspaceRoot: string): string {
  return mapElementIdFileName(elementId, (fileName) => {
    const schemeStripped = fileName.startsWith('file://') ? fileName.replace(/^file:\/\//, '') : fileName;
    return toProjectRelative(schemeStripped, workspaceRoot);
  });
}

/**
 * Resolve a (possibly sub-project-relative) component path to an absolute path on
 * disk, re-rooting it through the sub-project prefix first.
 *
 * In a monorepo opened at the repo root the iframe/error-boundary reports
 * sub-project-relative paths (`src/app/ui/HostField.tsx`), but files live under
 * the sub-project (`<workspaceRoot>/targets/conloca-app/src/app/ui/HostField.tsx`).
 * Joining the sub-relative path straight onto the workspace root misses the prefix
 * and the read fails ("Could not read component file"). Single-package projects
 * have an empty prefix, so this is an identity re-root.
 */
export function resolveComponentAbsPath(
  componentPath: string,
  workspaceRoot: string,
  subProjectPrefix: string,
): string {
  if (isAbsolute(componentPath)) return componentPath;
  const repoRel = toRepoRelativePath(componentPath, subProjectPrefix);
  return isAbsolute(repoRel) ? repoRel : join(workspaceRoot, repoRel);
}
