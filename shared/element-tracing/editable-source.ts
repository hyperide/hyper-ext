/**
 * @file Source-provenance predicate: is a source file one the user can edit?
 *
 * Accessed via: shared/canvas-interaction/resolve-source.ts (call-site resolution),
 *   consumed transitively by both SaaS (client ElementTracer) and the VS Code
 *   extension (iframe-interaction.ts / iframe-resolver.ts).
 *
 * Why this exists (HYP-1006): a clicked DOM element is resolved to a source
 * nodeRef so the AST can target it. The ONLY reason to collapse a clicked
 * element to the CALL SITE of the component that renders it (`<Button/>` in the
 * parent) instead of the element's OWN authored location is that the element's
 * own source is NOT editable — e.g. the internal `<button>` of a `node_modules`
 * design-system primitive, which the user cannot open and edit. For a
 * first-party child component (its source lives in the project), the element the
 * user clicked IS editable, so it must resolve to its own authored location.
 *
 * Collapse-to-call-site is therefore a DEGRADATION for non-editable internals,
 * NOT a statement about component boundaries. This predicate is the boundary:
 * editable → resolve to own source; non-editable → collapse to the nearest
 * editable call-site. Making the rule turn on editability (not on whether the
 * file equals the previewed/rendered file) is what makes resolution
 * DEPTH-INDEPENDENT — the previewed file no longer changes where a click lands,
 * which was the root cause of HYP-1006 (worked previewing Feed.tsx directly,
 * collapsed everything to the `<Feed/>` call site previewing App.tsx).
 */

import { isSyntheticPreviewPath } from './synthetic-preview';

/**
 * Matches an installed-dependency path segment: `node_modules/…` at the start of
 * the path or after any `/` or `\` separator (covers Vite's `node_modules/.vite/deps`
 * pre-bundle cache too, since it lives under `node_modules/`).
 */
const NODE_MODULES_SEGMENT = /(?:^|[\\/])node_modules[\\/]/;

/**
 * Non-file source identifiers that can appear in a fiber `_debugSource` / source map but are
 * NEVER an editable on-disk project file: URL schemes with an authority (`http://`,
 * `webpack-internal://`, `file://`, `ws://`), no-authority schemes (`data:`, `blob:`, `about:`), nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket
 * (the insecure-websocket scheme above is doc text enumerating schemes to REJECT, not a
 * connection; the nosemgrep marker must share the finding's line — block-comment markers
 * on adjacent lines are not honored, and a justification line that repeats the literal
 * scheme becomes the NEW finding line — found the hard way).
 * Vite virtual modules (`virtual:…` and the `\0`-prefixed form). These must never be classified
 * editable — otherwise a browser-fabricated `http://…`/`data:…`/`blob:…` source could be
 * committed as a nodeRef and handed to the AST write path.
 *
 * `blob:` and `about:` are enumerated explicitly (not matched by the generic `scheme://` pattern
 * below, since neither carries `//`) rather than folded into a scheme-agnostic `scheme:` match —
 * a bare `scheme:` regex would false-positive on a Windows absolute path's drive letter
 * (`C:\proj\src\App.tsx` is NOT a URL).
 *
 * NOTE: Vite's `/@fs/…` is a PATH prefix (not a scheme) and is intentionally NOT rejected here —
 * it is canonicalized downstream (`toProjectRelative`) and is a real monorepo file path.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: \0 is the real Vite virtual-module marker.
const NON_FILE_SOURCE = /^(?:\0|data:|blob:|about:|virtual:|[a-z][a-z0-9+.-]*:\/\/)/i;

/**
 * True when `fileName` names a source file the user can edit in this project —
 * i.e. a resolution to it is a valid AST-edit target.
 *
 * NOT editable:
 *  - synthetic preview scaffolding (`__canvas_preview__.tsx`) — never a go-to-code target.
 *  - installed dependencies (`node_modules/…`) — the user cannot edit package internals,
 *    so a click inside a dependency component collapses to the first-party call site.
 *  - empty/absent path.
 *
 * Deliberately permissive for everything else (any non-`node_modules`,
 * non-synthetic path): a first-party monorepo package served from `packages/ui`
 * or via Vite `/@fs/` is treated as editable, because it IS. This predicate only
 * decides which source nodeRef a click produces from a fiber's own source map.
 *
 * SECURITY BOUNDARY — NOT enforced here (tracked follow-up): a source map is
 * browser-provided, so a nodeRef path is UNTRUSTED. Today the AST write boundary
 * (`AstService._extractFileFromNodeRef` → `resolveWorkspacePath`) does NOT
 * canonicalize or containment-check the path against the workspace root — an
 * absolute nodeRef is followed as-is. This predicate does not close that gap, and
 * (like the pre-existing call-site walk it replaces) can hand an absolute
 * out-of-workspace path to that boundary. Practical exploitability is low (the
 * source maps come from the user's OWN dev server), but the correct fix is a
 * canonical workspace-containment check AT the write boundary, protecting ALL
 * nodeRef writes — see the HYP-1006 follow-up ticket. Do NOT rely on this
 * read-side classification for authorization.
 *
 * KNOWN follow-up (not required for the HYP-1006 fix): a workspace-canonical
 * editability check (explicit project roots, pnpm/`.pnpm` layouts, symlink
 * resolution) would tighten the `dependency` classification for exotic layouts.
 * The `node_modules` segment match covers the standard npm/Vite/Next case.
 */
export function isEditableSourcePath(fileName: string | null | undefined): boolean {
  if (!fileName) return false;
  if (NON_FILE_SOURCE.test(fileName)) return false;
  if (isSyntheticPreviewPath(fileName)) return false;
  if (NODE_MODULES_SEGMENT.test(fileName)) return false;
  return true;
}
