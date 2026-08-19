/**
 * Retry controller for a click deferred while source maps warm (HYP-971 / HYP-1220).
 *
 * Extracted out of `iframe-interaction.ts` so the TTL-fallback timer logic — the part
 * Codex flagged as a genuine gap on PR #717 — is unit-testable in isolation. That host file
 * installs a `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` shim and DOM listeners at import time,
 * which makes importing it directly in a test heavy/unreliable; this module has no such
 * side effects and takes its TIMER/CLOCK/CALLBACK dependencies (`now`, `scheduleTimer`,
 * `clearTimer`, `onResolved`, the warm callbacks) as injected `ctx`, which is what the tests in
 * this module's test file exercise directly. `resolveCallSiteTarget`, `getFiberFromDOM`,
 * `getItemIndexFromDOM`, `isEditableSourcePath`, and `isSyntheticPreviewPath` are hard imports,
 * NOT injected — this module is a retry/TTL scheduler wrapped around the real resolution
 * pipeline, not a full reimplementation of it behind a mockable seam.
 */
import { resolveCallSiteTarget } from '@shared/canvas-interaction/resolve-source';
import { isEditableSourcePath } from '@shared/element-tracing/editable-source';
import { type Fiber, getFiberFromDOM } from '@shared/element-tracing/fiber-internals';
import { isSyntheticPreviewPath } from '@shared/element-tracing/synthetic-preview';
import type { SourceLocation } from '@shared/element-tracing/types';
import { getItemIndexFromDOM } from './iframe-utils';

export interface PendingClickRetryContext {
  pendingClickElement: { current: HTMLElement | null };
  pendingClickTimestamp: { value: number };
  ttlMs: number;
  renderedComponentPath: () => string | null;
  /** Combines client + server source-map resolution for the fiber (own-fiber + ancestor walk). */
  resolveSource: (fiber: Fiber) => SourceLocation | null;
  mapOwnFiberSource: (fiber: Fiber) => SourceLocation | null;
  warmServerChunkFrames: (fiber: Fiber) => void;
  warmFiberChunkFrames: (fiber: Fiber) => void;
  onResolved: (result: { element: HTMLElement; source: SourceLocation; itemIndex: number }) => void;
  now?: () => number;
  scheduleTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PendingClickRetryController {
  /** Re-attempt resolving the current pending click, if any. Idempotent when nothing is pending. */
  retry(): void;
  /**
   * Arm the TTL fallback timer for whatever is CURRENTLY in `ctx.pendingClickElement`, without
   * running a resolution attempt. Call this from any OTHER code path that sets
   * `ctx.pendingClickElement.current` directly (bypassing `retry()`) and then kicks off warm
   * calls that might turn out to be no-ops (Codex P2, HYP-1220 PR #717) — e.g.
   * `resolveClickLocal`'s own initial deferral in `iframe-resolver.ts`. No-op when nothing is
   * pending or a timer is already armed (same dedupe as the internal callers).
   */
  armFallback(): void;
  /**
   * Cancel any armed fallback timer. Exists for test teardown hygiene (a fake-timer test can
   * leak a handle across cases); production has no call site for it today because the whole
   * iframe script's module state — this controller included — is destroyed by the browser on
   * every navigation/reload, which is the only way iframe-interaction.ts itself goes away.
   */
  dispose(): void;
}

/**
 * Creates a retry controller for `ctx.pendingClickElement`. Call `retry()` reactively from
 * warm-cache-completion callbacks (as before); this controller ADDITIONALLY arms a TTL-bound
 * fallback timer whenever `retry()` (or `armFallback()`) leaves the click still pending, so a
 * genuinely no-op warm-retry — every frame for this fiber already cached, so
 * `warmServerChunkFrames`/`warmFiberChunkFrames` short-circuit with no future callback — still
 * gets a guaranteed retry at the TTL deadline instead of leaving `pendingClickElement.current`
 * stuck forever (which silently blocks `onEmptyClick`'s "a pending click is in flight" guard).
 *
 * The timer is per-CONTROLLER, not per-click: if a NEW pending click replaces the one a timer
 * was armed for (any writer overwriting `ctx.pendingClickElement`/`ctx.pendingClickTimestamp`
 * directly, e.g. `resolveClickLocal`'s own defer), `armFallback`'s dedupe (`fallbackTimer !==
 * null`) means the new click does NOT get its own fresh timer — it rides the OLD one's
 * deadline. That old timer still fires (now early, relative to the new click's TTL window),
 * `retry()` sees the new click as not-yet-expired, and — if still unresolved — re-arms a
 * correctly-timed timer for it. Net effect: the new click's cleanup is still GUARANTEED and
 * still happens close to its own TTL (bounded by the extra head start the old timer had), just
 * not exactly at `newTimestamp + ttlMs`. It never re-strands. See the "replaced pending click"
 * test in this module's test file for the exact bound.
 */
export function createPendingClickRetry(ctx: PendingClickRetryContext): PendingClickRetryController {
  const now = ctx.now ?? Date.now;
  const scheduleTimer = ctx.scheduleTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
  const clearTimer = ctx.clearTimer ?? ((handle: unknown) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]));
  let fallbackTimer: unknown = null;

  function clearFallbackTimer(): void {
    if (fallbackTimer !== null) {
      clearTimer(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function scheduleFallback(): void {
    if (!ctx.pendingClickElement.current) return; // nothing pending — armFallback() called stray
    if (fallbackTimer !== null) return; // already armed for this pending click
    const remainingMs = Math.max(0, ctx.ttlMs - (now() - ctx.pendingClickTimestamp.value));
    // +1ms so the fallback fires strictly AFTER the TTL deadline — retry()'s own `> ttlMs`
    // check at the top must see the window as expired, not equal, when it re-enters.
    fallbackTimer = scheduleTimer(() => {
      fallbackTimer = null;
      try {
        retry();
      } catch (err) {
        // An exception inside retry() (e.g. a torn-down DOM node mid-resolution) must not
        // silently re-strand the ref with NO fallback timer left to recover it — that would
        // defeat the entire guarantee this controller exists to provide. Fail closed: clear
        // the pending click so `onEmptyClick`'s guard isn't blocked forever, then rethrow so
        // the error is still surfaced (not swallowed).
        ctx.pendingClickElement.current = null;
        throw err;
      }
    }, remainingMs + 1);
  }

  // Returns void, not a "still pending?" flag: this function OWNS clearing
  // `ctx.pendingClickElement`/the fallback timer on the resolved path itself (see the
  // comment on the `onResolved` call below for why the ORDER of that clear matters), so
  // `retry()` never needs to inspect a return value to decide whether to clear.
  function resolveNonTerminal(fiber: Fiber, pending: HTMLElement): void {
    const source = ctx.resolveSource(fiber);
    if (!source) {
      scheduleFallback(); // still warming — keep pending, but guarantee a TTL-bound retry
      return;
    }
    const directItemIndex = getItemIndexFromDOM(pending);
    const target = resolveCallSiteTarget(source, fiber, ctx.renderedComponentPath(), directItemIndex, ctx.mapOwnFiberSource);

    // Mirrors resolveClickLocal's post-resolution guards (HYP-1220): never commit a
    // node_modules internal or the synthetic __canvas_preview__ wrapper. A non-editable/
    // synthetic result here means the call-site walk hasn't reached an editable ancestor
    // yet — warm once more and keep the click pending. Those warm calls can be no-ops when
    // every frame for this fiber is already cached (Codex P2, HYP-1220 PR #717) — scheduleFallback
    // is what guarantees this doesn't leave the click pending forever in that case.
    if (!isEditableSourcePath(target.source.fileName) || isSyntheticPreviewPath(target.source.fileName)) {
      ctx.warmServerChunkFrames(fiber);
      ctx.warmFiberChunkFrames(fiber);
      scheduleFallback();
      return;
    }

    // Clear BEFORE invoking onResolved (which posts hypercanvas:elementClick to the parent
    // webview) — matches the pre-extraction code's ordering (`pendingClickElementRef.current
    // = null` ran before `window.parent.postMessage`). Clearing first also means any
    // synchronous re-entry `onResolved` might trigger (e.g. a listener that calls `retry()`
    // again) sees "nothing pending" instead of racing this same click a second time.
    ctx.pendingClickElement.current = null;
    clearFallbackTimer();
    ctx.onResolved({ element: pending, source: target.source, itemIndex: target.itemIndex });
  }

  function retry(): void {
    const pending = ctx.pendingClickElement.current;
    if (!pending) return;
    if (now() - ctx.pendingClickTimestamp.value > ctx.ttlMs) {
      ctx.pendingClickElement.current = null;
      clearFallbackTimer();
      return;
    }
    const fiber = getFiberFromDOM(pending);
    if (!fiber) {
      ctx.pendingClickElement.current = null;
      clearFallbackTimer();
      return;
    }
    resolveNonTerminal(fiber, pending);
  }

  return { retry, armFallback: scheduleFallback, dispose: clearFallbackTimer };
}
