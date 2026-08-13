/**
 * @file Workspace path resolution helper for VS Code extension services
 *
 * Accessed via: VS Code extension AST and style-read services resolving project files
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { realpath as fsRealpath } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

/**
 * @deprecated Naive, un-hardened path join — no containment check, so an absolute or
 * `../`-traversing `filePath` escapes `workspaceRoot` unchecked. This is the exact HYP-1012
 * bug class; PR #675 (not yet merged) owns hardening THIS function (with the monorepo
 * `additionalRoots` allowlist plumbing needed to avoid regressing AstService/StyleReadService's
 * supported sibling-sub-project workflow). Do not add new callers — use
 * `resolveContainedPath` below for any new raw-filesystem read.
 */
export function resolveWorkspacePath(workspaceRoot: string, filePath: string): string {
  if (filePath.startsWith('/')) {
    return filePath;
  }
  return `${workspaceRoot}/${filePath}`;
}

/**
 * Strip a single trailing path separator (normalize() collapses runs of separators to
 * one, so at most one remains). Plain string op on purpose — building a RegExp from
 * `sep` is wrong on Windows, where `sep` is a literal backslash that escapes the
 * following regex character instead of matching itself.
 */
function stripTrailingSep(p: string): string {
  return p.length > 1 && p.endsWith(sep) ? p.slice(0, -1) : p;
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
 * This is the same containment algorithm reviewed and hardened by HYP-1012 (see
 * `resolveWorkspacePath`'s sibling fix in PR #675, not yet merged at the time this was
 * written) — reused here as a standalone assertion for PanelRouter's raw filesystem
 * message handlers (`file:read`, `hypercanvas:resolveServerSourceMap`),
 * which resolve paths directly with `path.resolve`/`path.join` rather than through
 * `resolveWorkspacePath`'s relative-path-joining convention above. Deliberately NOT
 * folded into `resolveWorkspacePath` itself: that function is still the naive,
 * un-hardened implementation on `main` today (PR #675 owns hardening it, including the
 * monorepo `additionalRoots` allowlist plumbing needed to avoid regressing
 * AstService/StyleReadService's supported sibling-sub-project workflow) — changing its
 * behavior here would race that in-flight PR and risk breaking monorepo callers that
 * currently work only because containment is absent. Once PR #675 lands, this and
 * `resolveWorkspacePath` should converge onto one shared implementation.
 */
export function assertPathLexicallyContained(workspaceRoot: string, resolvedPath: string): string {
  const canonicalizedRoot = stripTrailingSep(normalize(workspaceRoot));
  const canonicalizedCandidate = stripTrailingSep(normalize(resolvedPath));

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
