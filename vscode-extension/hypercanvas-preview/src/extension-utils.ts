/**
 * @file Pure utility functions extracted from extension.ts for testability.
 *
 * Accessed via: extension.ts activate() — called at extension startup
 * Assumptions: no VS Code API dependencies; pure functions only
 * Past bugs: HYP-363 — global unhandledRejection handler mislabeled foreign
 *            extension errors (open.bun-vscode, github.copilot-chat) as
 *            [HyperIDE] failures. Fixed by filtering via stack-trace origin.
 *            HYP-420 follow-up (P2 #277) — a stale resolveActiveProjectRoot
 *            callback could re-root the preview pipeline to the OLD monorepo
 *            sub-project after a newer selection landed. Fixed by gating the
 *            reroot on a monotonic selection sequence (createSequencedReroot).
 *            HYP-435 follow-up (P2 #280) — the missing-component self-heal path
 *            called setComponentParam with a single (sub-relative) arg, so the
 *            derived monorepo prefix was cleared and regenerated-preview edits
 *            broke. Fixed by resolveSelfHealComponentParams supplying BOTH the
 *            repo-relative and sub-project-relative paths.
 */
import { isAbsolute, join, relative } from 'node:path';

/**
 * Returns true when the rejection stack trace originates from a foreign VS Code
 * extension, not from HyperIDE preview extension code. Foreign extension errors
 * must not be logged as [HyperIDE] because the extension host is shared across
 * all installed extensions.
 */
export function isForeignExtensionError(reason: unknown): boolean {
  const stack = reason instanceof Error ? (reason.stack ?? '') : String(reason);
  // If our extension appears anywhere in the stack, always treat as ours — even if
  // a foreign extension's frame also appears (e.g. cross-extension async callbacks).
  if (/[/\\]\.vscode(?:-server)?[/\\]extensions[/\\]hyperide\.hypercanvas[-./]/.test(stack)) {
    return false;
  }
  // A stack mentioning .vscode/extensions/ (local) or .vscode-server/extensions/
  // (Remote SSH/WSL/Codespaces) without our ID is a foreign error.
  return /[/\\]\.vscode(?:-server)?[/\\]extensions[/\\]/.test(stack);
}

/**
 * Returns true when an error message is a React context-provider error —
 * the kind a hook like `useAuth` / `useFeatureFlags` throws when the
 * component renders OUTSIDE its provider tree.
 *
 * HYP-487: no-router Vite apps patch the entry file to mount the previewed
 * component via its own `createRoot`, bypassing `<App>` where the providers
 * live. The context hooks then throw and the preview is blank. Matching this
 * pattern lets the extension auto-generate the `.hyperide/preview.tsx`
 * wrapper (isolated mode) so the component renders inside its providers.
 *
 * Matches both real phrasings observed in conloca-app:
 *   "useAuth must be used inside <AuthProvider>"        (angle brackets)
 *   "useFeatureFlags must be used inside FeatureFlagsProvider"  (bare)
 * and the common "within (a) XProvider" variant. The `\w*Provider` anchor
 * keeps it from firing on generic "must be used" errors that don't name a
 * Provider (e.g. "useId must be used during render").
 *
 * DEFENSIVE BROADENING (HYP-487 follow-up — not observed in conloca-app):
 * the original regex matches ONLY the "must be used (inside|within) …Provider"
 * phrasing. Other libraries throw "missing provider" errors with different
 * wording; a component reaching one of those FIRST would slip the detector and
 * leave a silent blank preview with no guidance. We also recognise:
 *   - react-query: "No QueryClient set, use QueryClientProvider to set one"
 *   - react-redux: "could not find react-redux context value; … wrapped in a <Provider>"
 *   - generic:     "must be wrapped in <ThemeProvider>"
 * Note: in conloca-app this path is not actually reached — every previewed
 * component calls a conloca context hook (useWorkspace/useHostClient/
 * useFeatureFlags) BEFORE useQuery, so the FIRST throw is already a
 * "must be used inside <…Provider>" message the original regex matched. These
 * branches are hardening for other apps, not a fix for a confirmed conloca bug.
 */
export function isProviderContextError(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    /must be used (?:inside|within)\s+(?:an?\s+)?<?\w*Provider>?/.test(message) ||
    // "(must be )?wrapped in (a/an) <XProvider>" — react-redux, many context libs
    /wrapped in\s+(?:an?\s+)?<?\w*Provider>?/.test(message) ||
    // react-query: "No QueryClient set, use QueryClientProvider to set one"
    /\bNo QueryClient set\b/i.test(message)
  );
}

export type SerializedReason = { name: string; message: string; stack?: string; [key: string]: unknown } | string;

/**
 * Converts an unhandled rejection / uncaught exception reason to a
 * JSON-safe value for structured log sinks.
 *
 * Returns `{ name, message, stack? }` for Error instances.
 * Returns a JSON string for everything else; falls back to `String(reason)`
 * when the value contains circular references or is otherwise not serialisable.
 */
export function serializeRejectionReason(reason: unknown): SerializedReason {
  if (reason instanceof Error) {
    const base: Record<string, unknown> = { name: reason.name, message: reason.message, stack: reason.stack };
    // Include enumerable own properties (e.g. code/errno/syscall/path on Node.js system errors).
    for (const key of Object.keys(reason)) {
      if (!(key in base)) {
        base[key] = (reason as unknown as Record<string, unknown>)[key];
      }
    }
    return base as { name: string; message: string; stack?: string; [key: string]: unknown };
  }
  try {
    // JSON.stringify returns undefined for `undefined` itself (not a string) —
    // fall through to String() for that case too.
    const s = JSON.stringify(reason);
    return s !== undefined ? s : String(reason);
  } catch {
    return String(reason);
  }
}

export type SequencedRerootResult = { root: string; stale: boolean };

/**
 * Builds a sequence-aware re-root function for monorepo component selection.
 *
 * Resolving the active project root for a selected component is async (it walks
 * the filesystem for the nearest package.json). When the user quickly selects
 * components from different sub-projects, an earlier resolve can finish AFTER a
 * newer selection. Without guarding, the stale callback re-roots the preview
 * pipeline (previewManager / modeManager / devServerManager) back to the OLD
 * sub-project — so subsequent preview generation and dev-server start run in the
 * wrong package, even though the downstream selection handler is later skipped.
 *
 * Each invocation captures a monotonically increasing sequence id. After the
 * async resolve completes, the reroot runs ONLY if no newer selection has
 * arrived (`mySeq === seq`). A stale call returns `{ stale: true }` and performs
 * no reroot at all, so the caller can also skip downstream handling.
 *
 * The happy path (a single in-flight selection) is identical to calling
 * `reroot(resolveRoot(component))` directly — the seq always matches.
 */
export function createSequencedReroot(deps: {
  resolveRoot: (component: string) => Promise<string>;
  reroot: (targetRoot: string) => void;
}): (component: string) => Promise<SequencedRerootResult> {
  let seq = 0;
  return async (component: string): Promise<SequencedRerootResult> => {
    const mySeq = ++seq;
    const root = await deps.resolveRoot(component);
    // A newer selection arrived while we awaited the resolve — do NOT reroot the
    // pipeline to this superseded sub-project.
    if (mySeq !== seq) return { root, stale: true };
    deps.reroot(root);
    return { root, stale: false };
  };
}

/**
 * Resolve the component identifier consumed at the StateHub bus boundary
 * (extension.ts handleComponentSelected) before it is fed to the sample
 * scaffold / JSX tag.
 *
 * The `currentComponent` patch carries both a `name` and a `path`. In-extension
 * producers (PreviewPanel._setCurrentComponent, onOpenComponent) strip the file
 * extension from `name`, so the common path is already clean. But the bus is
 * open: an EXTERNAL sender (SaaS bridge, MCP, RightPanelProvider's
 * `component:open`, a future client, or a hand-built state patch) can put a raw
 * filename like `Foo.tsx` or `components/Foo.tsx` into `name`. Trusting it
 * verbatim leaks `.tsx` / path segments into the generated JSX tag (HYP-460).
 *
 * `path` is the file-path source of truth, so when `name` looks like a filename
 * — it carries a source-file extension or a path separator — re-derive the
 * identifier from the path basename (extension stripped) instead of trusting
 * `name`. A clean name (e.g. `Button`) or a dotted member expression with no
 * file extension (e.g. `Accordion.Item`) is kept verbatim. When `path` is empty
 * we have nothing better, so fall back to `name`.
 *
 * normalizeSampleComponentName stays as defense-in-depth downstream; this
 * boundary check just stops the smell at the source of truth.
 */
const SOURCE_FILE_EXTENSION = /\.(?:tsx?|jsx?|mjs|cjs)$/i;

export function resolveComponentIdentifier(name: string, path: string): string {
  const looksLikeFilename = SOURCE_FILE_EXTENSION.test(name) || /[\\/]/.test(name);
  if (!looksLikeFilename || !path) return name;
  const basename = path.split(/[\\/]/).pop() ?? path;
  return basename.replace(SOURCE_FILE_EXTENSION, '');
}

export type SelfHealComponentParams = { componentPath: string; previewComponentPath: string };

/**
 * Resolve the two component-path arguments for setComponentParam from the
 * monorepo missing-component self-heal path.
 *
 * The iframe's componentMissing signal carries the PREVIEW path — the
 * `?component=` query value, which is relative to the dev server's root
 * (the sub-project, `activeWorkspaceRoot`). The repo-rooted PreviewPanel /
 * AstBridge key files repo-relative, so setComponentParam needs BOTH forms to
 * derive the sub-project prefix:
 *  - `componentPath` (repo-relative): resolved against `repoRoot`.
 *  - `previewComponentPath` (sub-project-relative): resolved against
 *    `activeWorkspaceRoot`.
 *
 * For single-package projects the two roots coincide, so both paths are equal
 * and deriveSubProjectPrefix yields '' downstream (identity translation).
 *
 * The signalled `componentPath` may be absolute or sub-relative; it is resolved
 * to an absolute path against `activeWorkspaceRoot` first (mirrors the dev
 * server's rooting), then re-expressed relative to each root.
 */
export function resolveSelfHealComponentParams(input: {
  componentPath: string;
  activeWorkspaceRoot: string;
  repoRoot: string;
}): SelfHealComponentParams {
  const { componentPath, activeWorkspaceRoot, repoRoot } = input;
  const absPath = isAbsolute(componentPath) ? componentPath : join(activeWorkspaceRoot, componentPath);
  return {
    componentPath: relative(repoRoot, absPath),
    previewComponentPath: relative(activeWorkspaceRoot, absPath),
  };
}
