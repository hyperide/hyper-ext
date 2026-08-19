import { isFetchableModuleFrameUrl } from '@shared/element-tracing/module-frame-url';
import type { SourceLocation } from '@shared/element-tracing/types';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import { isSyntheticPreviewPath, selectNonSyntheticCachedLocation } from '@shared/element-tracing/synthetic-preview';

/** Cache: "chunkUrl:line:col" → resolved SourceLocation (null = warmed but unresolvable). */
export const clientSourceMapCache = new Map<string, SourceLocation | null>();

/**
 * Keys that resolved to React-internal paths (e.g. node_modules).
 * Lookup skips (continues to next frame) rather than stopping when it finds these.
 */
export const clientInternalFrames = new Set<string>();

/** Cache: "filePath:line:col" → resolved SourceLocation (null = not resolvable). */
export const serverSourceMapCache = new Map<string, SourceLocation | null>();

/** Extract client chunk frames (HTTP URLs) from an Error.stack string.
 *  Supports Next.js (_next/static/chunks/), bun chunks, and any Vite-served module —
 *  /src/ source files AND /@fs/ out-of-root files (symlinked workspace packages served
 *  from prebuilt dist, HYP-1161). The fetchability rule is the SHARED
 *  isFetchableModuleFrameUrl — do not re-narrow it locally; the SaaS
 *  ModuleSourceMapResolver reads the same predicate. */
export function extractClientChunkFrames(err: Error): Array<{ url: string; line: number; col: number }> {
  const frames: Array<{ url: string; line: number; col: number }> = [];
  for (const ln of (err.stack ?? '').split('\n')) {
    const m = ln.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const url = m[1];
    // React 19: _debugStack has compiled positions that need source map warmup.
    // /@fs/ frames (no /src/ segment) MUST be included — excluding them was the
    // HYP-1161 collapse-to-call-site root cause for cross-package components.
    if (isFetchableModuleFrameUrl(url)) {
      frames.push({ url, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
    }
  }
  return frames;
}

/**
 * Extract server-side chunk frames from an Error.stack.
 *
 * Supported formats:
 * - React 19.0: "Server/file:///path/.next/server/chunks/…"
 * - React 19.1+: "about://React/Server/file:///path/.next/dev/server/chunks/…"
 * - Plain: "file:///path/.next/…"
 */
export function extractServerChunkFrames(err: Error): Array<{ filePath: string; line: number; col: number }> {
  const frames: Array<{ filePath: string; line: number; col: number }> = [];
  for (const ln of (err.stack ?? '').split('\n')) {
    const m = ln.match(/^\s+at\s+(?:[^(]+\s+\()?(.+):(\d+):(\d+)\)?$/);
    if (!m) continue;
    const raw = m[1];
    // Find file:/// anywhere in the URL (handles about://React/Server/file:/// prefix)
    const fileIdx = raw.indexOf('file:///');
    if (fileIdx === -1) continue;
    const fileUrl = raw.slice(fileIdx);
    // Only Next.js server chunks
    if (!fileUrl.includes('.next/')) continue;
    let filePath: string;
    try {
      filePath = decodeURIComponent(new URL(fileUrl).pathname);
    } catch {
      filePath = decodeURIComponent(fileUrl.replace(/^file:\/\//, ''));
    }
    frames.push({ filePath, line: Number.parseInt(m[2], 10), col: Number.parseInt(m[3], 10) });
  }
  return frames;
}

/**
 * Resolve server source map for THIS fiber's own _debugStack only.
 * Unlike resolveViaServerSourceMap (which walks the return chain), this gives
 * per-element precision for source cache building — each RSC element has a
 * unique compiled position in its _debugStack.
 */
export function resolveOwnServerSourceMap(fiber: Fiber): SourceLocation | null {
  // HostComponent fibers (tag=5) in React 19.1 RSC have _debugStack directly
  if (fiber._debugStack) {
    const frames = extractServerChunkFrames(fiber._debugStack).map((frame) =>
      serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`),
    );
    const picked = selectNonSyntheticCachedLocation(frames);
    if (picked.found) return picked.value;
  }
  return null;
}

/**
 * Per-fiber classification used by the ancestor-walking resolvers below
 * (`resolveViaClientSourceMap` / `resolveViaServerSourceMap`) to decide whether to STOP
 * at this fiber or keep climbing to `.return`:
 *   - `'hit'` — a real (non-synthetic) user source resolved. Stop, use `location`.
 *   - `'synthetic'` — every frame on this fiber has settled and at least one resolved to
 *     the synthetic preview wrapper. This is a DEFINITIVE BOUNDARY (HYP-1220) — stop and
 *     return `location` (the wrapper's own position) so `resolveCallSiteTarget`'s
 *     `recoverNonSyntheticSourceLocation` can recover the real rendered-component source
 *     from the fiber tree, instead of the walk silently climbing PAST the wrapper to
 *     whatever renders it (a real, editable, non-synthetic file, e.g. the project's
 *     `main.tsx` entry, wrongly committed as the clicked element's source).
 *   - `'miss'` — every frame settled and none resolved to anything at all (no hit, no
 *     synthetic). A definitive per-fiber dead end — stop, do not misattribute to an
 *     ancestor.
 *   - `'cold'` — at least one frame IS PRESENT but still warming. Not settled yet — keep
 *     climbing to the next ancestor, exactly as before this fix.
 *   - `'empty'` — this fiber has ZERO frames of this kind at all (e.g. a Vite-only client
 *     fiber has no server chunk frames, or vice versa). For the ancestor walk below,
 *     `'empty'` behaves identically to `'cold'` — the callers below don't special-case it
 *     (they check for `'hit'`/`'synthetic'`/`'miss'` and treat everything else as "keep
 *     climbing"), same as before this state existed. It exists as a SEPARATE kind (rather
 *     than folding into `'cold'`) because `resolveOwnCallSiteSourceMap` — which checks
 *     BOTH sides and needs a per-side answer, not just "climb or don't" — must NOT let a
 *     side that structurally has nothing to say (empty) veto a definitive answer already
 *     found on the OTHER side (see that function's own doc for the regression this closes).
 */
type OwnCallSiteState = { kind: 'hit' | 'synthetic'; location: SourceLocation } | { kind: 'miss' | 'cold' | 'empty' };

/**
 * Classify `fiber`'s OWN client chunk frames per the `OwnCallSiteState` contract above.
 *
 * A SINGLE scan (not two separate lookups) is deliberate: distinguishing "hit" /
 * "synthetic" / "miss" / "cold" from ONE pass avoids an ordering hazard that two
 * separate early-returning lookups have — e.g. `resolveOwnClientSourceMap` alone
 * returns `{ resolved: null }` (miss) and stops the MOMENT it sees a definitive-miss
 * frame, even when an EARLIER or LATER frame on the SAME fiber already resolved to the
 * synthetic wrapper. That silently loses the synthetic-boundary signal whenever a
 * fiber's `_debugStack` carries both a wrapper-hit frame and an unresolvable-miss frame
 * (in either order) — review flagged this as an untested gap on this exact fix. Scanning
 * once and giving `synthetic` priority over a later-observed `miss` (but never over a
 * `hit`, which short-circuits immediately) closes it regardless of frame order.
 */
function classifyOwnClientCallSite(fiber: Fiber): OwnCallSiteState {
  // No `_debugStack` at all means zero frames of any kind — nothing will ever warm on
  // this fiber, so this is 'empty' by the `OwnCallSiteState` contract above, not 'cold'
  // (review finding: the two used to be conflated here, which made `resolveOwnCallSiteSourceMap`
  // report "still warming" forever for a stack-less fiber instead of settling to a miss).
  // Behavior-preserving for the ancestor walks below (`resolveViaClientSourceMap` /
  // `resolveViaServerSourceMap`), which treat 'empty' identically to 'cold' — both climb.
  if (!fiber._debugStack) return { kind: 'empty' };
  let syntheticHit: SourceLocation | null = null;
  let sawMiss = false;
  let sawCold = false;
  for (const frame of extractClientChunkFrames(fiber._debugStack)) {
    const key = `${frame.url}:${frame.line}:${frame.col}`;
    if (clientInternalFrames.has(key)) continue; // React-internal frame — skip to next
    const cached = clientSourceMapCache.get(key);
    if (cached === undefined) {
      // Still warming — do NOT bail immediately: a LATER frame on this SAME fiber may
      // already be a real hit, which must win over an earlier frame's cold state (review
      // finding on HYP-1220's 3rd-model quorum pass — bailing here let the ancestor walk
      // in resolveViaClientSourceMap skip past this fiber's own would-be hit and commit
      // an ancestor's location instead). Keep scanning for a hit; only fall back to
      // 'cold' at the very end if no hit was found among the settled frames.
      sawCold = true;
      continue;
    }
    if (cached === null) {
      sawMiss = true; // definitive per-frame miss — keep scanning other frames
      continue;
    }
    if (isSyntheticPreviewPath(cached.fileName)) {
      syntheticHit ??= cached; // keep the FIRST synthetic hit; keep scanning for a real one
      continue;
    }
    return { kind: 'hit', location: cached }; // real hit — highest priority, stop
  }
  if (sawCold) return { kind: 'cold' }; // no hit found and at least one frame still warming
  if (syntheticHit) return { kind: 'synthetic', location: syntheticHit };
  if (sawMiss) return { kind: 'miss' };
  // Zero (non-internal) client frames were ever seen on this fiber — structurally
  // different from 'cold': there is nothing here to warm up and wait for. Kept distinct
  // from 'miss' too (a miss means frames existed and definitively resolved to nothing).
  return { kind: 'empty' };
}

/**
 * Next.js/Turbopack bundles React internals (jsxDEV) into the same chunk as user code.
 * The jsxDEV frame comes first in the stack; it maps to node_modules and is recorded in
 * clientInternalFrames — the lookup skips it (continue) and tries the user component frame.
 * A null in clientSourceMapCache (fetch failed or no mapping) stops the search for this
 * fiber so we do not misattribute the element to an ancestor component.
 *
 * Boundary fix (HYP-1220): before this fix, a synthetic-preview hit on this fiber's own
 * frame was indistinguishable from "still cold" (both hidden behind `resolveOwnClientSourceMap`'s
 * `{ resolved: undefined }`), so this loop kept climbing to the NEXT ancestor. That
 * silently carried resolution PAST the wrapper boundary to whatever renders it (the
 * project's `main.tsx` entry — a real, editable, non-synthetic file, wrongly committed as
 * the clicked element's source). Live-e2e reproduced on tamagui-whatsapp: a clicked
 * `<div style>` inside ChatInputBar has its OWN `_debugStack` collapse directly to the
 * synthetic wrapper with no intervening real frame, so the pre-fix walk climbed all the
 * way to `src/main.tsx:11:58` (a residual gap in the earlier call-site-mapper fix, which
 * only guarded the CALL-SITE walk in `resolve-source.ts`, not this separate LEAF ancestor
 * walk). `classifyOwnClientCallSite` above distinguishes `'synthetic'` (stop, return it —
 * `resolveCallSiteTarget`'s `recoverNonSyntheticSourceLocation` recovers the real source
 * from the fiber tree, HYP-424's designed recovery path) from genuine `'cold'` (keep
 * climbing, exactly as before this fix) and `'miss'` (stop, matching the pre-existing
 * "a definitive miss stops the search" contract).
 */
export function resolveViaClientSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    const state = classifyOwnClientCallSite(current);
    if (state.kind === 'hit' || state.kind === 'synthetic') return state.location;
    if (state.kind === 'miss') return null;
    // 'cold' → walk to ancestor.
    current = (current.return as Fiber | null | undefined) ?? null;
  }
  return null;
}

/**
 * Resolve the client source map for a SINGLE fiber's own `_debugStack` frames —
 * NEVER walks the `.return` chain. Distinguishes three states:
 *   - `{ resolved: SourceLocation }` — a frame mapped to a real user source file.
 *   - `{ resolved: null }` — a frame is warmed but unresolvable (a definitive miss).
 *   - `{ resolved: undefined }` — no frame is cached yet (warm-up still in flight).
 *
 * Callers that must NOT attribute an element to an ancestor's source (the
 * provenance-safe decorative drag path, HYP-49 — `getMappedSourceLocation` /
 * `warmElementSource`) use this own-fiber lookup directly and treat both `null` and
 * `undefined` as "no own source" → fail safe + warm, never an ancestor line.
 * `resolveViaClientSourceMap`'s ancestor walk uses the sibling `classifyOwnClientCallSite`
 * above instead (not this function) — see that walk's doc for why (HYP-1220).
 */
export function resolveOwnClientSourceMap(fiber: Fiber): { resolved: SourceLocation | null | undefined } {
  if (!fiber._debugStack) return { resolved: undefined };
  for (const frame of extractClientChunkFrames(fiber._debugStack)) {
    const key = `${frame.url}:${frame.line}:${frame.col}`;
    if (clientInternalFrames.has(key)) continue; // React-internal frame — skip to next
    const cached = clientSourceMapCache.get(key);
    if (cached) {
      // The synthetic preview entry (__canvas_preview__.tsx) renders every user
      // component; Vite source maps can collapse a compiled position back to it.
      // It is never a valid go-to-code target — skip it so the caller falls back
      // to the element's own fiber source (the real component file). (HYP-429)
      if (isSyntheticPreviewPath(cached.fileName)) continue;
      return { resolved: cached }; // resolved to user source file
    }
    // Warmed but unresolvable: a definitive miss for this fiber. Mirrors the original
    // `resolveViaClientSourceMap` which returned null here (and stopped walking ancestors).
    if (cached === null) return { resolved: null };
    // undefined: this frame's warm-up is still in flight; keep checking later frames.
  }
  // No frame produced a hit and none was a definitive miss → warm-up still in flight.
  return { resolved: undefined };
}

/**
 * Resolve a SINGLE fiber's own call-site source from the warmed caches, WITHOUT
 * hiding a synthetic-preview hit — unlike `resolveOwnServerSourceMap`/
 * `resolveOwnClientSourceMap`, which treat a synthetic result as "still warming"
 * so per-fiber LEAF recovery keeps walking to an ancestor (HYP-429's leaf-recovery
 * contract for THAT fiber's own multi-frame `_debugStack`).
 *
 * That hiding behavior is correct for a single fiber's own multi-frame recovery, but is
 * wrong when reused to drive an ANCESTOR walk across multiple fibers — this powers the
 * CALL-SITE mapper passed into `resolveCallSiteTarget`'s ancestor walk (`mapOwnFiberSource`
 * / `mapOrWarmCallSite` below), which depends on seeing "this fiber's call site IS the
 * synthetic wrapper" as a DEFINITIVE, distinct signal from "not resolved yet" — with the
 * hiding resolvers, a fiber whose call site collapses to `__canvas_preview__.tsx` reported
 * "no location yet" instead of "resolved to the wrapper", so the walk silently continued
 * PAST the wrapper fiber to whatever rendered it — the project's entry file (e.g.
 * `main.tsx`, which passes `isEditableSourcePath` and got committed as if it were the
 * clicked element's source). This was HYP-1220's first fix (a regression of HYP-424/HYP-429
 * introduced when HYP-970/#658 wired the hiding resolver in as the call-site mapper).
 *
 * DELEGATES to `classifyOwnServerCallSite` / `classifyOwnClientCallSite` — the same
 * single-pass classifiers `resolveViaServerSourceMap` / `resolveViaClientSourceMap` use for
 * their ancestor walk — instead of a separate hand-rolled scan. The two used to diverge on
 * the cold-frame policy: an earlier version of this function bailed to "not definitive"
 * (`undefined`) the MOMENT it saw the first uncached frame on a side, so a LATER frame on
 * the SAME side that had already resolved to a real hit was silently ignored — the
 * call-site mapper then reported "still cold" for a fiber whose own call site was, in
 * fact, already known and settled. `classifyOwnServerCallSite`/`classifyOwnClientCallSite`
 * scan the WHOLE side and let a real (non-synthetic) hit win immediately regardless of
 * position — this matches this codebase's established `_debugStack` model
 * (`parseDebugStackFrames`'s doc: "the element's real component frame sits further down
 * the same stack" than an earlier library-wrapper frame the internal-frame filter doesn't
 * strip, HYP-424) — a later frame on the SAME fiber can legitimately be the MORE correct
 * one, so waiting on an earlier cold frame to answer a question a later frame had already
 * settled was a real gap, not a safety margin. Sharing the classifiers here (rather than
 * keeping two independently-maintained scans) makes future re-divergence impossible by
 * construction. A definitive MISS or SYNTHETIC hit found only via full-side scanning still
 * requires the WHOLE side to be free of a cold frame before it is trusted (the classifiers'
 * `sawCold` gate) — only a REAL hit is allowed to win past a cold frame on the same side;
 * see "a real hit AFTER a cold frame on the SAME side wins" below and the
 * `[synthetic-hit, cold]` ordering test in `iframe-resolver.test.ts` for both platforms.
 *
 * Returns `undefined` when no cached result exists yet for this fiber's own
 * frames (still warming), so callers can distinguish "warming" from "resolved".
 *
 * A definitive MISS on server frames falls through to client frames (and vice
 * versa) — mirroring the `resolveOwnServerSourceMap(fiber) ?? resolveOwnClientSourceMap(fiber)`
 * chain this replaces, where only a real HIT short-circuited the other side, never a
 * miss. `null` is reported only once BOTH sides are definitively settled (a hit, a
 * miss, or no frames of that kind at all); if either side is still `'cold'`, this returns
 * `undefined` so `mapOrWarmCallSite` keeps treating the fiber as cold (worth warming +
 * another pass) instead of a permanent dead end. In practice server and client frames
 * never both populate for the same fiber (a fiber's `_debugStack` is bundler-specific —
 * Next.js/RSC serves `file://` server frames, Vite serves `http(s)://` client frames), so
 * this only matters as a defensive edge case. React-internal client frames are skipped
 * (inside `classifyOwnClientCallSite`); server frames have no such filter, matching
 * `resolveOwnServerSourceMap` (which never filtered them either).
 *
 * Review finding (HYP-1220, 3rd-model quorum pass): a server-side SYNTHETIC hit returns
 * immediately, before client frames are ever inspected — unlike a server MISS, which falls
 * through. Considered changing this to scan both sides before preferring synthetic, but
 * rejected: this function feeds the CALL-SITE mapper, which needs "this fiber's call site
 * IS the synthetic wrapper" as an immediate, definitive boundary signal (see the type-doc
 * above `OwnCallSiteState`) — treating a same-fiber synthetic hit as anything other than
 * definitive is the EXACT bug class this whole file's HYP-1220 fixes close. Given server
 * and client frames never both populate for the same fiber in practice (previous
 * paragraph), the scenario this finding describes cannot occur on a real fiber today.
 */
export function resolveOwnCallSiteSourceMap(fiber: Fiber): SourceLocation | null | undefined {
  const serverState = classifyOwnServerCallSite(fiber);
  if (serverState.kind === 'hit' || serverState.kind === 'synthetic') return serverState.location;

  const clientState = classifyOwnClientCallSite(fiber);
  if (clientState.kind === 'hit' || clientState.kind === 'synthetic') return clientState.location;

  // Neither side produced a hit or a synthetic-boundary hit. If either side still has an
  // unresolved (cold) frame, this fiber is not settled yet — report "still warming"
  // (`undefined`) rather than a false definitive miss.
  if (serverState.kind === 'cold' || clientState.kind === 'cold') return undefined;
  return null; // both sides definitively settled (a miss, or no frames of that kind at all)
}

/** Check if a fiber has server chunk frames that are not yet resolved.
 * Returns false if all frames are already cached (even as null), avoiding
 * stuck pending clicks when no future serverSourceMapResult can arrive. */
export function hasUnresolvedServerFrames(fiber: Fiber): boolean {
  let c: Fiber | null = fiber;
  while (c !== null) {
    if (c._debugStack) {
      for (const frame of extractServerChunkFrames(c._debugStack)) {
        const key = `${frame.filePath}:${frame.line}:${frame.col}`;
        if (!serverSourceMapCache.has(key)) return true;
      }
      break;
    }
    c = (c.return as typeof c | undefined) ?? null;
  }
  return false;
}

/**
 * Classify `fiber`'s OWN server chunk frames per the `OwnCallSiteState` contract
 * documented above `classifyOwnClientCallSite` — a SINGLE scan for the same reason: two
 * separate lookups (the pre-existing `selectNonSyntheticCachedLocation` skip, which
 * folds "every settled frame resolved to the synthetic wrapper" into `found: false` by
 * design, plus a second scan for a synthetic hit) have an ordering hazard when a
 * fiber's frames mix a synthetic-wrapper hit with an unresolvable-miss frame: whichever
 * one the FIRST lookup's short-circuit sees first wins, silently losing the other
 * signal depending on frame order — review flagged this as an untested gap on this
 * exact fix. Server frames have no internal-frame filter, matching
 * `resolveOwnServerSourceMap` (which never filtered them either).
 */
function classifyOwnServerCallSite(fiber: Fiber): OwnCallSiteState {
  // See classifyOwnClientCallSite's identical comment: no `_debugStack` = zero frames of
  // any kind = 'empty', not 'cold' (nothing to ever warm).
  if (!fiber._debugStack) return { kind: 'empty' };
  let syntheticHit: SourceLocation | null = null;
  let sawMiss = false;
  let sawCold = false;
  for (const frame of extractServerChunkFrames(fiber._debugStack)) {
    const cached = serverSourceMapCache.get(`${frame.filePath}:${frame.line}:${frame.col}`);
    if (cached === undefined) {
      // See classifyOwnClientCallSite's identical comment (HYP-1220 review finding): do
      // not bail immediately — a later frame on this fiber may still be a real hit.
      sawCold = true;
      continue;
    }
    if (cached === null) {
      sawMiss = true; // definitive per-frame miss — keep scanning other frames
      continue;
    }
    if (isSyntheticPreviewPath(cached.fileName)) {
      syntheticHit ??= cached; // keep the FIRST synthetic hit; keep scanning for a real one
      continue;
    }
    return { kind: 'hit', location: cached }; // real hit — highest priority, stop
  }
  if (sawCold) return { kind: 'cold' }; // no hit found and at least one frame still warming
  if (syntheticHit) return { kind: 'synthetic', location: syntheticHit };
  if (sawMiss) return { kind: 'miss' };
  // Zero server frames were ever seen on this fiber (the common case for a Vite-only
  // client fiber, which never has `.next/` frames at all) — see `classifyOwnClientCallSite`'s
  // identical 'empty' comment for why this must stay distinct from 'cold'.
  return { kind: 'empty' };
}

/**
 * Look up server source map cache for the first matching server chunk frame, walking
 * the return chain. This is the async server-map fallback consumed by
 * `resolveClickLocal` / `retryPendingClick` (RSC / React 19 pending click): a clicked
 * element must never resolve to the synthetic `__canvas_preview__` entry. (HYP-424 / HYP-429)
 *
 * Boundary fix (HYP-1220, same shape as `resolveViaClientSourceMap`): before this fix,
 * a fiber whose frames settled to ONLY the synthetic wrapper was indistinguishable from
 * "nothing resolved yet, keep walking to the ancestor" — that let resolution silently
 * climb PAST `__canvas_preview__.tsx` to whatever renders it (a real, editable,
 * non-synthetic file). `classifyOwnServerCallSite` above distinguishes `'synthetic'`
 * (stop, return it — `resolveCallSiteTarget`'s `recoverNonSyntheticSourceLocation`
 * recovers the real component source) from genuine `'cold'` (keep climbing, exactly as
 * before this fix) and `'miss'` (stop, matching the pre-existing "a definitive miss
 * stops the search" contract, which `selectNonSyntheticCachedLocation` also still
 * upholds for `resolveOwnServerSourceMap`'s unrelated own-fiber-only usage above).
 */
export function resolveViaServerSourceMap(fiber: Fiber): SourceLocation | null {
  let current: Fiber | null = fiber;
  while (current !== null) {
    const state = classifyOwnServerCallSite(current);
    if (state.kind === 'hit' || state.kind === 'synthetic') return state.location;
    if (state.kind === 'miss') return null;
    // 'cold' → walk to ancestor.
    current = (current.return as typeof current | undefined) ?? null;
  }
  return null;
}
