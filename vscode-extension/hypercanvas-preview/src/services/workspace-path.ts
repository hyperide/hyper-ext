/**
 * @file Workspace path resolution helper for VS Code extension services
 *
 * Accessed via: VS Code extension AST and style-read services resolving project files.
 *   Every AstService mutation (updateStyles, moveElement, deleteElements, etc.) funnels
 *   `filePath`/nodeRef fileName through this function before touching disk — it is the
 *   AST write boundary's single containment choke point (HYP-1012).
 * Assumptions: `workspaceRoot` is the VS Code workspace folder root, which for a monorepo
 *   is expected to be the REPO root, not a sub-package folder (see
 *   AstServiceMonorepoCollision.test.ts and shared/element-tracing/path-normalization.ts's
 *   `/@fs/`-stripping — a legitimate cross-package/Vite-`/@fs/`-served file still resolves
 *   as long as it lands inside that repo root). Sub-project-RELATIVE paths were already
 *   only resolvable when opened at the repo root (monorepo-path-translate.ts's prefix
 *   translation assumes it). Cross-package ABSOLUTE `/@fs/`-stripped paths are a real,
 *   intentional narrowing by this fix: pre-fix, any absolute path was returned as-is with
 *   no root check at all, so it happened to keep working even when VS Code was opened at a
 *   sub-package; post-fix it's rejected unless it's inside whatever `workspaceRoot` this
 *   AstService instance was actually constructed with. That's the correct behavior for the
 *   write boundary — "authorized workspace root" means the root this instance was scoped
 *   to, not the whole disk — so the supported/documented monorepo workflow (open at the
 *   repo root) is what keeps cross-package edits working; a sub-package-opened workspace
 *   trades that convenience for containment.
 * Known limitation: containment is a LEXICAL check (resolves `.`/`..` textually via
 *   `path.normalize`), not a symlink-safe one — it does not call `fs.realpath`. A symlink
 *   inside the workspace pointing outside it can still be followed by the actual file I/O
 *   layer. Adding symlink resolution here would require every caller's `workspaceRoot` to
 *   be an on-disk path (this function is also exercised against `InMemoryFileIO` fixtures
 *   with synthetic paths that don't exist on disk), so it's deferred as a follow-up
 *   (HYP-1060) rather than folded into this fix. HYP-1060 also covers this function's
 *   case-SENSITIVE containment comparison potentially false-rejecting a legitimate path on
 *   a case-insensitive filesystem (macOS/Windows default).
 * Known pre-existing limitation, unchanged by this fix: absolute-path detection
 *   (`filePath.startsWith('/')` below) is POSIX-only, same as before this fix. A Windows
 *   drive-letter path (`C:\...`) isn't recognized as absolute, so it gets joined onto
 *   `workspaceRoot` instead of used as-is — pre-fix this silently produced a broken
 *   (non-existent) path that failed at the `fs` read; post-fix it's rejected earlier, by
 *   the containment check, with a clearer error. Either way the operation already didn't
 *   succeed — not a new regression, just an earlier and clearer failure point.
 * Return value is ALWAYS forward-slash separated, regardless of host OS. On Windows,
 *   `path.normalize` rewrites embedded `/` to `\`, which would otherwise turn a relative
 *   nodeRef fileName (e.g. "src/screens/RecordScreen.tsx", always forward-slash — it
 *   originates from the browser/webview side) into a backslash-joined absolute path.
 *   AstService._resolveElement hardcodes forward-slash suffix checks
 *   (`absolutePath.endsWith(\`/${entryFile}\`)`, AstService.ts:375-376/411/423) when
 *   matching this function's return value against nodeMap `entryFile`/`locFile` values —
 *   a backslash-joined path silently stops matching every one of those checks, regressing
 *   ordinary writes to "Element not found" on Windows even though containment itself is
 *   correct (Codex P1 follow-up on the HYP-1012 fix, PR #675). Note this function's own
 *   forward-slash return value is the ONLY thing that needed fixing for this: the
 *   `entryFile`/`locFile` side of those comparisons already goes through
 *   NodeMapService.toStorageKey -> `toProjectRelative`
 *   (shared/element-tracing/path-normalization.ts), which independently forward-slash-
 *   normalizes both its `fileName` and `projectRoot` operands regardless of this fix — so
 *   it was never part of the break and needs no change.
 * Known limitation, deferred to HYP-1060 alongside the symlink/case-sensitivity items
 *   above: a Windows extended-length root (`\\?\C:\workspace`) is left untouched by the
 *   forward-slash conversion (converting its `\\?\` prefix to `//?/` is rejected by
 *   Win32), so containment/resolution still work but the backslash-suffix-match break
 *   this fix targets would reappear for that one root shape. Not reachable through VS
 *   Code's ordinary `workspaceFolders[0].uri.fsPath`, which doesn't surface extended-length
 *   form for a normally-opened project.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { realpath as fsRealpath } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

/** The subset of `node:path` this module depends on — narrow enough that a test can
 *  inject `path.win32`'s `normalize`/`sep` to deterministically reproduce Windows path
 *  behavior from any host OS, without mocking the global `node:path` module (bun's
 *  `mock.module` is process-global, so mocking `node:path` here would leak into every
 *  other test file sharing the process). Only `resolveWorkspacePath` below uses this —
 *  `assertPathLexicallyContained`/`resolveContainedPath` use the real `node:path`
 *  directly, since PanelRouter's callers don't share the nodeMap-suffix-matching
 *  constraint that requires Windows-forward-slash normalization.
 *
 *  Written as a plain structural interface, NOT `Pick<PlatformPath, 'normalize' | 'sep'>`
 *  (`import type { PlatformPath } from 'node:path'`) — `shared/ast-service-insert.test.ts`
 *  dynamically imports `AstService.ts`, which imports this module, so this file is
 *  reachable from the ROOT tsconfig's typecheck (`bun run typecheck` / tsgo), not only the
 *  extension's own (`vscode-extension/hypercanvas-preview/tsconfig.json`). The two resolve
 *  a DIFFERENT `@types/node` (root: `^25.0.3`, extension: `^18.0.0`), and `PlatformPath`'s
 *  export shape isn't compatible across both — the extension's own `npx tsc` passes, but the
 *  root tsgo run fails with `TS2305: Module "node:path" has no exported member
 *  'PlatformPath'`, which blocks `ci/local-checks.sh`'s typecheck step (the CI billing-block
 *  fallback gate). A hand-written structural type has no such cross-version dependency. */
type PathOps = { normalize: (path: string) => string; sep: string };

const nativePathOps: PathOps = { normalize, sep };

/**
 * Strip a single trailing path separator (normalize() collapses runs of separators to
 * one, so at most one remains). Plain string op on purpose — building a RegExp from
 * `sep` is wrong on Windows, where `sep` is a literal backslash that escapes the
 * following regex character instead of matching itself.
 */
function stripTrailingSep(p: string, pathSep: string): string {
  return p.length > 1 && p.endsWith(pathSep) ? p.slice(0, -1) : p;
}

/**
 * Convert a path's separators to forward slashes. No-op on POSIX (`pathSep === '/'`).
 * Plain string split/join on purpose, same reasoning as `stripTrailingSep` — a RegExp
 * built from `pathSep` would be wrong on Windows (`\` escapes instead of matching).
 *
 * Leaves a Windows extended-length root (`\\?\C:\...`) untouched: that prefix is
 * verbatim-only per Win32 — converting it to `//?/` is rejected by the OS — so
 * converting the rest of the path would produce something worse than the backslash
 * form this function exists to fix. Narrow, deliberately unhandled edge; see the
 * file header's HYP-1060 note.
 */
function toForwardSlashes(p: string, pathSep: string): string {
  if (pathSep === '/' || p.startsWith('\\\\?\\')) return p;
  return p.split(pathSep).join('/');
}

/**
 * Resolve `filePath` (relative to `workspaceRoot`, or already absolute) to an absolute
 * path, normalizing `.`/`..` segments, and reject (throw) any result that lexically
 * escapes `workspaceRoot` — both an absolute path outside the root and a `../` traversal
 * that walks out of it. Segment-boundary-aware: a sibling directory that merely shares a
 * name prefix (`/workspace-evil` vs `/workspace`) is never treated as contained. This is
 * the AST write boundary's containment choke point (HYP-1012); every `AstService`
 * mutation funnels its target path through this function before touching disk.
 *
 * NOT SYMLINK-SAFE on its own — same caveat `assertPathLexicallyContained` below
 * documents (both converged on the same lexical-containment algorithm independently:
 * this one for the write boundary, HYP-1012; that one for PanelRouter's raw read
 * handlers, HYP-1131). Use `resolveContainedPath` for a symlink-safe read.
 *
 * `pathOps` defaults to the real `node:path`; it exists only so tests can pass
 * `path.win32` to deterministically exercise Windows separator behavior (see `PathOps`).
 *
 * `additionalRoots` (HYP-1012 monorepo follow-up) widens the containment ALLOWLIST. It exists
 * because a monorepo opened at a sub-package leaf has a documented, supported workflow
 * (PanelRouter.getComponentGroups / AstBridge.setAdditionalWorkspaceRoot) where the Explorer's
 * ancestor-fallback scan surfaces SIBLING sub-projects living outside the opened leaf, reached
 * via absolute (Vite `/@fs/`-stripped) paths. Pre-HYP-1012 those absolute sibling paths were
 * returned as-is with no containment check at all, so they resolved; the leaf-only containment
 * check this file introduced regressed that supported flow (review round 1, HYP-1012
 * follow-up). The candidate — absolute OR a relative path once JOINED against `workspaceRoot`
 * (relative filePaths are always joined against `workspaceRoot` specifically, never directly
 * against an additional root) — is accepted when it lands inside `workspaceRoot` OR any
 * `additionalRoots` entry. NOTE (review round 2, P2): a relative `../`-traversal CAN still
 * land inside an `additionalRoots` entry once joined+normalized (e.g. `../../shared/x.tsx`
 * from a leaf under a widened monorepo root) — this is intentional, not a gap: an
 * `additionalRoots` entry is already a FULLY TRUSTED boundary (the caller only ever widens to
 * the monorepo root that `setAdditionalWorkspaceRoot` was invoked with), so a relative path
 * that stays inside it is exactly as authorized as one that stays inside `workspaceRoot`
 * itself. It is NOT an unbounded escape hatch: both the join AND the final containment check
 * still apply, so a traversal that walks past every allowed root is still rejected.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  filePath: string,
  pathOps: PathOps = nativePathOps,
  additionalRoots: readonly string[] = [],
): string {
  const { normalize: normalizePath, sep: pathSep } = pathOps;
  const canonicalizedRoot = stripTrailingSep(normalizePath(workspaceRoot), pathSep);
  const candidate = filePath.startsWith('/') ? filePath : `${canonicalizedRoot}${pathSep}${filePath}`;
  const canonicalizedCandidate = stripTrailingSep(normalizePath(candidate), pathSep);

  const allRoots = [canonicalizedRoot, ...additionalRoots.map((r) => stripTrailingSep(normalizePath(r), pathSep))];
  const isContained = allRoots.some((root) => {
    // When a root IS the filesystem root (normalizes to just `pathSep`), the "contained"
    // prefix is `pathSep` itself, not `pathSep+pathSep` — `${root}${pathSep}` would double up
    // and reject every one of the root's own children.
    const containedPrefix = root === pathSep ? pathSep : `${root}${pathSep}`;
    return canonicalizedCandidate === root || canonicalizedCandidate.startsWith(containedPrefix);
  });

  if (!isContained) {
    throw new Error(`Path resolves outside workspace root: ${filePath}`);
  }
  return toForwardSlashes(canonicalizedCandidate, pathSep);
}

/**
 * Segment-boundary-aware containment check: reject (throw) any `resolvedPath` that
 * lexically escapes `workspaceRoot` — an absolute path outside the root, or a `../`
 * traversal that walked out of it. "Segment-boundary-aware" means a sibling directory
 * that merely shares a name prefix (`/workspace-evil` vs `/workspace`) is never
 * treated as contained (a naive `startsWith(root)` check would wrongly allow it).
 *
 * NOT SYMLINK-SAFE on its own: this is a pure string operation that never touches the
 * filesystem, so a symlink planted inside `workspaceRoot` pointing outside it (e.g.
 * `workspace/leak -> /etc/passwd`) passes this check. Do NOT call this alone at a
 * filesystem trust boundary — use `resolveContainedPath` below, which wraps this with a
 * realpath-based check that closes that gap. This function is exported for its own unit
 * tests and for `resolveContainedPath`'s internal use; every actual read call site should
 * go through `resolveContainedPath`, never this directly.
 *
 * Known limitation, not fixed here (same one HYP-1012's `resolveWorkspacePath` hardening
 * documents, deferred there as HYP-1060): this comparison is CASE-SENSITIVE, which can
 * false-reject a legitimate path on a case-insensitive filesystem (macOS APFS default,
 * Windows default) — e.g. workspace root reported as `/Users/x/Repo` and a candidate under
 * `/Users/x/repo`. A DIFFERENT limitation from the leading-`/` Windows-drive-letter issue
 * documented at this function's PanelRouter.ts call sites (that one is a path-FORMAT
 * problem; this one is a filesystem-SEMANTICS problem) — they share only the tracking
 * ticket and the "no proper fix without more design work" status, not a root cause or a
 * single code change that closes both. A functional (fail-safe, availability-only)
 * regression from pre-fix behavior: before this fix there was no containment check at all,
 * so a differently-cased path always reached `fs` and worked; now it's rejected.
 * IMPORTANT for whoever picks up HYP-1060: the naive fix (case-fold both sides before
 * comparing) is NOT safe — it would false-ACCEPT on a case-SENSITIVE filesystem (Linux),
 * where `/home/x/Repo` and `/home/x/repo` are genuinely different directories, reintroducing
 * a containment bypass. Any fix must be conditioned on the ACTUAL filesystem's case
 * semantics (e.g. via a runtime probe), not a blanket case-insensitive comparison.
 *
 * This is the same containment algorithm HYP-1012 hardened for `resolveWorkspacePath`
 * above (the AST write boundary) — reused here as a standalone assertion for
 * PanelRouter's raw filesystem message handlers (`file:read`,
 * `hypercanvas:resolveServerSourceMap`), which resolve paths directly with
 * `path.resolve`/`path.join` rather than through `resolveWorkspacePath`'s
 * relative-path-joining convention above. Deliberately NOT folded into
 * `resolveWorkspacePath` itself — that function additionally forward-slash-normalizes
 * its return value for AstService's nodeMap suffix matching (see its own doc comment),
 * a concern this read-only assertion doesn't share. Uses the real `node:path` `sep`
 * directly (not the `PathOps`/Windows-forward-slash machinery `resolveWorkspacePath`
 * needs) since PanelRouter's callers don't have the same nodeMap-suffix-matching
 * constraint driving that machinery.
 */
export function assertPathLexicallyContained(workspaceRoot: string, resolvedPath: string): string {
  const canonicalizedRoot = stripTrailingSep(normalize(workspaceRoot), sep);
  const canonicalizedCandidate = stripTrailingSep(normalize(resolvedPath), sep);

  // When the root IS the filesystem root (normalizes to just `sep`), the "contained"
  // prefix is `sep` itself, not `sep+sep` — `${root}${sep}` would double up and reject
  // every one of the root's own children.
  const containedPrefix = canonicalizedRoot === sep ? sep : `${canonicalizedRoot}${sep}`;
  const isContained =
    canonicalizedCandidate === canonicalizedRoot || canonicalizedCandidate.startsWith(containedPrefix);

  if (!isContained) {
    throw new Error(`Path resolves outside workspace root: ${resolvedPath}`);
  }

  return canonicalizedCandidate;
}

/** The subset of `node:fs/promises` this module depends on for symlink-safe containment —
 *  narrow enough for a test to inject a fake without touching the real filesystem. Not
 *  exported: the test file passes a structurally-matching object literal without needing
 *  the type, and `ResolveContainedPathOptions.fs` is the only production-facing surface. */
interface RealpathFs {
  realpath(path: string): Promise<string>;
}

const nodeFs: RealpathFs = { realpath: fsRealpath };

function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT';
}

export interface ResolveContainedPathOptions {
  /** Test-only filesystem seam — defaults to real `node:fs/promises.realpath`. */
  fs?: RealpathFs;
  /** Extra authorized roots (monorepo sibling sub-projects) — see the doc below. */
  additionalRoots?: readonly string[];
}

/**
 * Resolve `filePath` against `workspaceRoot` (`path.resolve` semantics — an absolute
 * `filePath` is used as-is) and return a path proven, at the moment of the call, to be
 * inside `workspaceRoot` or one of `additionalRoots`. Throws otherwise. This is the single
 * safe entry point for PanelRouter's raw filesystem READ handlers (`file:read`,
 * `hypercanvas:resolveServerSourceMap`) — callers should feed the RETURNED path into
 * `fs.readFile`, not the raw `filePath`. Read-only contract: the ENOENT fallback below
 * returns an unresolved (not-yet-existing) path, which is safe for a read that will itself
 * fail with "not found" but is NOT safe to hand to a create/write call (a directory symlink
 * in the parent chain could still redirect the write outside the workspace) — a future
 * `file:write`-style handler needs a stricter contract, not this one.
 *
 * Minor, accepted info-leak: a workspace-planted symlink to an outside target is
 * distinguishable by a `file:read` caller from a plain missing file — "Path resolves
 * outside workspace root" (realpath succeeded, containment rejected) vs a `readFile`
 * ENOENT (realpath itself ENOENT'd, the fallback passed, then the read failed). This is a
 * file-EXISTENCE oracle for arbitrary outside paths, not a content leak. Low severity today
 * (`file:read` has no production sender; `hypercanvas:resolveServerSourceMap` collapses
 * both cases to `result: null`) — worth normalizing `file:read`'s error responses before a
 * production sender appears, not fixed here.
 *
 * `additionalRoots` is a general-purpose widening hook — pass extra authorized roots
 * (e.g. a monorepo sibling sub-project) and containment is enforced against EACH one, not
 * an unbounded escape hatch. NOT currently wired up by PanelRouter's `file:read` /
 * `hypercanvas:resolveServerSourceMap` callers (HYP-1131): an early version threaded
 * AstBridge/UndoRedoService's monorepo `setAdditionalWorkspaceRoot` widening (HYP-1012)
 * through here too, but a safe implementation needs its own lifecycle-correct home (the
 * widening must invalidate atomically with a workspace switch, and the `monorepoRoot` the
 * scanner returns needs a bound tighter than "is an ancestor of the workspace root" —
 * `/` and `$HOME` both pass that check) — real design work tracked as
 * https://linear.app/glide-vc/issue/HYP-1136, not bolted onto this security-hotfix diff.
 * See PanelRouter.ts's `getComponentGroups` doc comment for the current, deliberate
 * consequence (a monorepo-sibling source-map request resolves to `null` instead of
 * widening implicitly, same as before this fix existed).
 *
 * Containment check, in one pass per candidate root:
 *  1. Every root (`workspaceRoot` + `additionalRoots`) is REALPATH'd up front. This does
 *     double duty: it resolves symlinks in the root itself (e.g. macOS `/tmp` is a symlink
 *     to `/private/tmp` — VS Code may report the workspace folder in either form, while a
 *     runtime stack trace's file:// URL for `hypercanvas:resolveServerSourceMap` is already
 *     OS-canonicalized), so comparing a realpath'd root against a realpath'd candidate
 *     avoids a false rejection purely from the two sides using different symlink forms of
 *     the SAME real location. Roots are workspace folders VS Code has open and therefore
 *     exist; a realpath failure here (e.g. deleted mid-session) falls back to the lexical
 *     root form rather than throwing on an unrelated fs hiccup.
 *  2. `filePath` is lexically resolved, then REALPATH'd. This is what closes the actual
 *     symlink-escape hole (a symlink planted inside the workspace pointing outside it, e.g.
 *     `workspace/leak -> /etc/passwd` — undetectable by a lexical-only check, since it never
 *     touches the filesystem). Same pattern as `isContainedArtifact` in
 *     `lib/tamagui/extract-tokens.ts` (HYP-676) — realpath-containment + reject on escape.
 *     ENOENT (the file doesn't exist) is the ONLY error that falls back to the
 *     lexically-resolved candidate — a nonexistent path has no symlink to follow, and the
 *     caller's own `fs.readFile` will surface a clear "not found" error. Any OTHER realpath
 *     error (EACCES, EIO, ELOOP, …) is rethrown rather than silently downgrading to a
 *     lexical-only check — containment must fail closed, not guess.
 *  3. The realpath'd (or ENOENT-fallback lexical) candidate is checked against EVERY
 *     realpath'd root in turn; the first that contains it wins.
 *
 * This intentionally does NOT close the TOCTOU window between this check and the caller's
 * read (an attacker who can plant/replace a symlink between the two calls in this
 * single-user, single-request VS Code extension is already running arbitrary code on the
 * machine) — it closes the "attacker pre-plants a symlink in workspace content" class,
 * which is the actual threat model here (a cloned/opened untrusted project).
 *
 * Known, accepted limitation: a workspace-internal symlink to a LEGITIMATE external
 * target — `npm link` / `yarn link` / pnpm-linked local packages, a real pattern in
 * monorepo dev workflows — is realpath-rejected the same as a malicious one; this function
 * cannot distinguish "attacker-planted" from "developer-linked" by the symlink alone.
 * Accepted for `file:read` (currently has no production sender at all — see PanelRouter.ts)
 * and `hypercanvas:resolveServerSourceMap` (reads build-output `.map` files under
 * `.next/`, not `node_modules` package sources, so a linked-package `.map` reaching this
 * path is not the expected shape). If a future caller needs symlinked-dependency reads,
 * that's a deliberate widening decision for that caller to make (e.g. its own
 * `additionalRoots` entries), not a reason to weaken this function's default.
 */
export async function resolveContainedPath(
  workspaceRoot: string,
  filePath: string,
  options: ResolveContainedPathOptions = {},
): Promise<string> {
  const { fs = nodeFs, additionalRoots = [] } = options;
  const lexicalCandidate = resolve(workspaceRoot, filePath);
  const allRoots = [workspaceRoot, ...additionalRoots];

  // Realpath the ROOTS unconditionally — cheap and safe, since roots are trusted,
  // extension-configured workspace folders (not attacker input), not the untrusted
  // `filePath`. Needed up front so the fast-reject below can check the candidate against
  // BOTH the raw and the canonical form of each root: a root can legitimately be reported
  // in symlinked form (e.g. macOS `/tmp` vs `/private/tmp`) while a caller's candidate
  // (e.g. a Node.js stack-trace file:// URL) arrives already canonicalized — checking only
  // the raw form would false-reject that case.
  const realRoots = await Promise.all(allRoots.map((root) => fs.realpath(root).catch(() => root)));
  const lexicalRootForms = [...allRoots, ...realRoots];

  // Fast reject, ZERO disk I/O on the untrusted `filePath`: if the lexical candidate isn't
  // contained by ANY root form (raw or realpath'd, both computed above without touching the
  // candidate), realpath-ing the CANDIDATE could only rescue it via a symlink somewhere in
  // ITS OWN path pointing INTO the workspace from an unrelated external location — not a
  // case this function needs to support, and not worth a filesystem lookup on
  // attacker-controlled input (avoids leaking distinguishable EACCES/ELOOP/ENOENT errors
  // for paths like `/etc/passwd` before rejecting them).
  const lexicallyContained = lexicalRootForms.some((root) => {
    try {
      assertPathLexicallyContained(root, lexicalCandidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!lexicallyContained) {
    throw new Error(`Path resolves outside workspace root: ${filePath}`);
  }

  // Past this point the candidate is lexically inside SOME root form, but may still be an
  // internal symlink escape (`workspace/leak -> /etc/passwd`) — realpath-ing the candidate
  // is what actually closes that hole.
  let realCandidate: string;
  let candidateWasEnoent = false;
  try {
    realCandidate = await fs.realpath(lexicalCandidate);
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
    // ENOENT: the file doesn't exist, so it kept the RAW-form lexical candidate (built from
    // `workspaceRoot` as given, not its realpath). Checking that only against `realRoots`
    // below would false-reject a legitimate missing file whenever the workspace root is
    // itself reported in symlinked form (e.g. macOS `/tmp` vs `/private/tmp`) — the raw
    // candidate and the realpath'd root would never match even though both denote the same
    // location. Falling through to check against `lexicalRootForms` (raw AND real root
    // forms) instead of just `realRoots` fixes this.
    //
    // NOTE this does NOT mean "an ENOENT candidate can't involve a symlink" — a dangling
    // symlink (`workspace/dirlink -> /outside/nonexistent.txt`) also ENOENTs on realpath,
    // and its raw form legitimately IS lexically inside the workspace even though it
    // resolves through a symlink to somewhere it doesn't exist yet (see the dangling-symlink
    // test). The actual safety argument is narrower and read-only-specific: realpath and the
    // caller's own `fs.readFile` share the SAME kernel path-resolution semantics, so
    // whichever path (raw or symlinked) causes realpath to ENOENT causes `readFile` to
    // ENOENT identically — there is no way for this fallback to hand back a path that reads
    // successfully from somewhere outside the workspace. That equivalence holds ONLY for a
    // read; it does not extend to a create/write, which is exactly why this whole function's
    // contract is documented as read-only above.
    realCandidate = lexicalCandidate;
    candidateWasEnoent = true;
  }

  const finalRootForms = candidateWasEnoent ? lexicalRootForms : realRoots;
  for (const root of finalRootForms) {
    try {
      return assertPathLexicallyContained(root, realCandidate);
    } catch {
      // Not contained by this root — try the next allowed root before rejecting outright.
    }
  }
  throw new Error(`Path resolves outside workspace root: ${filePath}`);
}
