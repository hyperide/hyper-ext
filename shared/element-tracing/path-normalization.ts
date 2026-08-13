/**
 * @file Path normalization for element-tracing lookups across environments
 *
 * Accessed via: client ElementTracer (empty-container lookup, click resolution)
 *   and server NodeMapService populate (node-map key construction)
 * Assumptions: server writes node map entries with sandbox-mount-prefixed
 *   paths (e.g. `/app/src/App.tsx`) while React 19 fibers produce relative
 *   paths (`src/App.tsx`) via parseDebugStack. React 18 sandbox fibers produce
 *   sandbox-mount paths. Lookups must match either form.
 */

/**
 * Mount point where the project-sandbox Docker image exposes the workspace.
 * React 18 `_debugSource.fileName` and the server's node-map keys share this
 * prefix. Single source of truth — keep in sync on both sides. Changing this
 * requires matching sandbox image rebuild.
 */
const SANDBOX_MOUNT_PREFIX = '/app/';

const CONTAINER_PREFIXES = [SANDBOX_MOUNT_PREFIX] as const;

/**
 * Strip a known container mount prefix, yielding a project-relative path.
 * Returns the input unchanged when no prefix matches.
 */
export function stripContainerPrefix(fileName: string): string {
  for (const prefix of CONTAINER_PREFIXES) {
    if (fileName.startsWith(prefix)) {
      return fileName.slice(prefix.length);
    }
  }
  return fileName;
}

/**
 * Strip the SaaS preview proxy prefix: "project-preview/{projectId}/src/…" → "src/…".
 * The platform serves the project dev server through /project-preview/<uuid>/
 * (server/proxy/project-preview.ts) and that prefix leaks into React 19 _debugStack
 * module URLs and source-map-resolved paths — node-map and AST lookups expect
 * project-relative paths. A leading slash is accepted (URL pathname form).
 * Returns the input unchanged when no prefix matches.
 */
export function stripPreviewProxyPrefix(fileName: string): string {
  return fileName.replace(/^\/?project-preview\/[a-f0-9-]+\//, '');
}

/** Convert any backslash separators to forward slashes. */
function toForwardSlashes(p: string): string {
  return p.includes('\\') ? p.replace(/\\/g, '/') : p;
}

/**
 * Strip Vite's `/@fs/` file-serving prefix, recovering the real absolute path.
 *
 * Vite serves files OUTSIDE the project root (a cross-package monorepo library,
 * HYP-443) via `/@fs/<absolute-path>`, and that URL leaks into the React fiber
 * `_debugSource.fileName` used for navigation AND AST mutation. POSIX:
 * `/@fs/Users/a/x.tsx` → `/Users/a/x.tsx`. Windows: `/@fs/C:/repo/x.tsx` →
 * `C:/repo/x.tsx` (drop the slash before the drive letter). The webview→extension
 * hop may drop the leading slash, so both `/@fs/<abs>` and `@fs/<abs>` are
 * accepted. Input is expected to already be forward-slash normalized. Returns the
 * input unchanged when no `@fs/` prefix is present. Single source of truth — the
 * extension's path translators reuse this.
 */
export function stripViteFsPrefix(fileName: string): string {
  const m = /^\/?@fs\/(.*)$/.exec(fileName);
  if (!m) return fileName;
  const rest = m[1];
  // Windows drive path: `C:/...` → keep as-is; POSIX: re-add the leading slash.
  return /^[a-zA-Z]:/.test(rest) ? rest : `/${rest}`;
}

/** Uppercase a leading Windows drive letter so case-variant roots compare equal. */
function canonicalizeDriveLetter(p: string): string {
  return /^[a-z]:/.test(p) ? p[0].toUpperCase() + p.slice(1) : p;
}

/**
 * Normalize any source file path to project-relative form with forward slashes.
 *
 * Handles three environment-specific inputs that element-tracing lookups
 * encounter:
 * - Sandbox container paths (`/app/src/App.tsx`) — stripped unconditionally.
 * - Host-absolute paths (`/Users/alice/project/src/App.tsx` or
 *   `C:\\alice\\project\\src\\App.tsx`) — stripped when `projectRoot` matches.
 *   Windows backslashes are converted to forward slashes for comparison.
 * - Already-relative paths (`src/App.tsx`) — returned unchanged.
 *
 * When `projectRoot` is omitted only the sandbox prefix is stripped.
 */
export function toProjectRelative(fileName: string, projectRoot?: string): string {
  if (!fileName) return fileName;

  // Strip Vite's `/@fs/` serving prefix first — a cross-package library file is
  // served via `/@fs/<absolute>` and that URL leaks into the fiber path (HYP-443).
  // Recovering the real absolute path lets the projectRoot strip below apply.
  const fwd = canonicalizeDriveLetter(stripViteFsPrefix(toForwardSlashes(fileName)));

  // projectRoot takes priority — devcontainer workspaces can live under
  // `/app/<something>`, so stripping the sandbox prefix first would yield
  // `<something>/src/App.tsx` instead of `src/App.tsx`.
  if (projectRoot) {
    const fwdRoot = canonicalizeDriveLetter(toForwardSlashes(projectRoot));
    const normalizedRoot = fwdRoot.endsWith('/') ? fwdRoot : `${fwdRoot}/`;
    if (fwd.startsWith(normalizedRoot)) {
      return fwd.slice(normalizedRoot.length);
    }
  }

  const sandboxStripped = stripContainerPrefix(fwd);
  if (sandboxStripped !== fwd) return sandboxStripped;

  return fwd;
}
