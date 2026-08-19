/**
 * @file Regression test for the Codex P2 finding on PR #717 (HYP-1220): a warm-retry that
 * resolves to a non-editable/synthetic source while every frame for the fiber is ALREADY
 * cached calls `warmServerChunkFrames`/`warmFiberChunkFrames` as pure no-ops (no fetch, no
 * future callback) — so without a TTL-bound fallback, `pendingClickElement.current` stays
 * set forever and silently blocks `onEmptyClick`'s "a click is pending" guard.
 *
 * Uses an injected fake clock/timer (no real `setTimeout` wall-clock waits) so the "bounded
 * time" assertion is deterministic and fast.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type { Fiber } from '@shared/element-tracing/fiber-internals';
import type { SourceLocation } from '@shared/element-tracing/types';
import { createPendingClickRetry, type PendingClickRetryController } from '../iframe-pending-click-retry';

// Every test registers its controller here so `afterEach` can call `dispose()` — real teardown
// hygiene (an armed-but-not-yet-fired fake timer must not leak into the next test), and gives
// `dispose()` an actual caller (it otherwise has none in this file, which a reviewer flagged
// as speculative API surface).
let activeController: PendingClickRetryController | null = null;
afterEach(() => {
  activeController?.dispose();
  activeController = null;
});

/** Minimal fiber with no `.return` ancestor — resolveCallSiteTarget's ancestor walk is a no-op. */
function makeLeafFiber(): Fiber {
  return {
    tag: 5,
    type: 'div',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugStack: null,
    _debugOwner: null,
  } as unknown as Fiber;
}

function attachFiber(fiber: Fiber): HTMLElement {
  return { __reactFiber$test: fiber } as unknown as HTMLElement;
}

/** Deterministic fake clock + timer queue, standing in for Date.now/setTimeout/clearTimeout. */
function makeFakeClock() {
  let currentTime = 0;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; cb: () => void }>();
  return {
    now: () => currentTime,
    scheduleTimer: (cb: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { fireAt: currentTime + ms, cb });
      return id;
    },
    clearTimer: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pendingTimerCount: () => timers.size,
    /** Advance time and fire every timer whose deadline has passed (including ones armed mid-fire). */
    advance(ms: number): void {
      currentTime += ms;
      let firedSomething = true;
      while (firedSomething) {
        firedSomething = false;
        for (const [id, timer] of timers) {
          if (timer.fireAt <= currentTime) {
            timers.delete(id);
            timer.cb();
            firedSomething = true;
            break;
          }
        }
      }
    },
  };
}

const NON_EDITABLE_SOURCE: SourceLocation = {
  fileName: 'node_modules/@acme/ui/dist/button.js',
  line: 10,
  column: 2,
};
const EDITABLE_SOURCE: SourceLocation = {
  fileName: 'src/components/Feed.tsx',
  line: 42,
  column: 8,
};
const TTL_MS = 5000;

describe('createPendingClickRetry — TTL fallback timer (Codex P2, HYP-1220 PR #717)', () => {
  it('clears a stuck pending click within the TTL window when the warm-retry no-ops forever', () => {
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: element };
    const pendingClickTimestamp = { value: clock.now() };
    const resolved: unknown[] = [];
    let warmCallCount = 0;

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      // Source resolves successfully (not "still cold") — but to a non-editable path, so
      // resolveCallSiteTarget's walk (no ancestors here) keeps it non-editable.
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      // Models the no-op cache-hit scenario: warming is "kicked off" but every frame is
      // already cached, so neither of these ever triggers another retry() callback.
      warmServerChunkFrames: () => {
        warmCallCount++;
      },
      warmFiberChunkFrames: () => {
        warmCallCount++;
      },
      onResolved: (r) => resolved.push(r),
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    // Simulate the ONE reactive callback that got this far (e.g. a source map landing) —
    // after this, nothing external will ever call retry() again in the bug scenario.
    controller.retry();

    expect(warmCallCount).toBe(2);
    expect(pendingClickElement.current).toBe(element); // still pending — deferred, not resolved
    expect(clock.pendingTimerCount()).toBe(1); // fallback timer armed instead of leaking forever

    // Advance to just before the TTL deadline: still pending, no premature clear.
    clock.advance(TTL_MS - 100);
    expect(pendingClickElement.current).toBe(element);

    // Cross the TTL deadline — the fallback timer must fire on its own, with NO external
    // caller ever invoking retry() again.
    clock.advance(200);

    expect(pendingClickElement.current).toBeNull();
    expect(resolved).toHaveLength(0); // never resolved to a bad selection — just cleaned up
    expect(clock.pendingTimerCount()).toBe(0); // no leaked timer after cleanup
  });

  it('dedupes: repeated retry() calls on the same still-pending click arm only one timer', () => {
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: element };
    const pendingClickTimestamp = { value: clock.now() };

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.retry();
    controller.retry();
    controller.retry();

    expect(clock.pendingTimerCount()).toBe(1); // no overlapping-timer leak on re-entry
  });

  it('clears the pending click and resolves normally once the source becomes editable', () => {
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: element };
    const pendingClickTimestamp = { value: clock.now() };
    const resolved: Array<{ element: HTMLElement; source: SourceLocation; itemIndex: number }> = [];
    let pendingWasClearedBeforeOnResolved = false;

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: (r) => {
        // The ref must already be cleared BY THE TIME onResolved fires (matches the
        // pre-extraction code, which cleared before posting) — not merely cleared
        // eventually after this callback returns.
        pendingWasClearedBeforeOnResolved = pendingClickElement.current === null;
        resolved.push(r);
      },
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.retry();

    expect(pendingWasClearedBeforeOnResolved).toBe(true);
    expect(pendingClickElement.current).toBeNull();
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.source).toEqual(EDITABLE_SOURCE);
    expect(clock.pendingTimerCount()).toBe(0); // no dangling fallback timer on the success path
  });

  it('still-cold (resolveSource returns null) also arms a TTL-bound fallback, not just the non-editable branch', () => {
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: element };
    const pendingClickTimestamp = { value: clock.now() };
    const resolved: unknown[] = [];

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => null, // "still warming" forever in this test — never resolves
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: (r) => resolved.push(r),
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.retry();
    expect(clock.pendingTimerCount()).toBe(1); // fallback armed on the `!source` branch too

    clock.advance(TTL_MS + 1);

    expect(pendingClickElement.current).toBeNull();
    expect(resolved).toHaveLength(0);
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it('retry() with the TTL already expired on entry clears immediately without arming a timer', () => {
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: element };
    // Timestamp already TTL_MS+1 in the past relative to clock.now() at call time below.
    const pendingClickTimestamp = { value: 0 };

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    clock.advance(TTL_MS + 1);
    controller.retry();

    expect(pendingClickElement.current).toBeNull();
    expect(clock.pendingTimerCount()).toBe(0); // TTL-expiry branch returns before any scheduleFallback
  });

  it('retry() when the element has no attached fiber clears the pending ref without arming a timer', () => {
    const clock = makeFakeClock();
    const elementWithNoFiber = {} as HTMLElement; // no __reactFiber$... property
    const pendingClickElement = { current: elementWithNoFiber };
    const pendingClickTimestamp = { value: clock.now() };

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.retry();

    expect(pendingClickElement.current).toBeNull();
    expect(clock.pendingTimerCount()).toBe(0);
  });

  it('armFallback() lets an EXTERNAL setter (resolveClickLocal-style) arm the same TTL guarantee without going through retry()', () => {
    // Models iframe-resolver.ts's `deferToWarmRetry`: something OTHER than this controller
    // writes `pendingClickElement.current` directly, then calls `armFallback()` — never
    // `retry()`. Regression coverage for the finding that the FIRST deferral (resolveClickLocal's
    // still-synthetic guard) was previously ungated and could strand the ref with no timer at all.
    const clock = makeFakeClock();
    const element = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: null as HTMLElement | null };
    const pendingClickTimestamp = { value: 0 };

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    // Nothing pending yet — armFallback() must be a no-op, not throw or arm a stray timer.
    controller.armFallback();
    expect(clock.pendingTimerCount()).toBe(0);

    // External setter writes the pending click directly (bypassing retry()/resolveNonTerminal).
    pendingClickElement.current = element;
    pendingClickTimestamp.value = clock.now();
    controller.armFallback();

    expect(clock.pendingTimerCount()).toBe(1);

    clock.advance(TTL_MS + 1);

    expect(pendingClickElement.current).toBeNull(); // the fallback timer alone cleaned it up
  });

  it('a pending click REPLACED while a fallback timer is still armed still converges — bounded, not stuck', () => {
    // The fallback timer is per-CONTROLLER, not per-click (see createPendingClickRetry's doc).
    // Click A arms a timer for its own deadline; before it fires, click B directly overwrites
    // `pendingClickElement`/`pendingClickTimestamp` (as `deferToWarmRetry` does) and calls
    // `armFallback()` again — which no-ops (a timer is already armed, for A). The OLD timer
    // still fires at A's (earlier) deadline; `retry()` re-checks against B's FRESH timestamp,
    // sees it not yet expired, and — since B is still unresolved — re-arms a correctly-timed
    // timer for B. B still converges, just bounded by A's head start rather than exactly at
    // `B's timestamp + TTL`.
    const clock = makeFakeClock();
    const elementA = attachFiber(makeLeafFiber());
    const elementB = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: elementA };
    const pendingClickTimestamp = { value: clock.now() };

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => NON_EDITABLE_SOURCE,
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.retry(); // arms A's timer, deadline at TTL_MS + 1
    expect(clock.pendingTimerCount()).toBe(1);

    // Some time later, B replaces A as the pending click (still well before A's deadline).
    clock.advance(1000);
    pendingClickElement.current = elementB;
    pendingClickTimestamp.value = clock.now();
    controller.armFallback(); // no-op — A's timer is still armed

    expect(clock.pendingTimerCount()).toBe(1); // still exactly one timer, not stacked
    expect(pendingClickElement.current).toBe(elementB); // not stuck: B is live and pending

    // Cross A's ORIGINAL deadline (B's own TTL window has NOT expired yet: B has only been
    // pending for TTL_MS - 1000ms at this point). A's stale timer fires, re-checks B, finds it
    // still unresolved, and re-arms — B is NOT dropped.
    clock.advance(TTL_MS + 1 - 1000);
    expect(pendingClickElement.current).toBe(elementB); // still correctly pending, not stuck
    expect(clock.pendingTimerCount()).toBe(1); // re-armed for B, not left timer-less

    // B's own deadline (from ITS OWN timestamp) now passes — must still converge.
    clock.advance(1000);
    expect(pendingClickElement.current).toBeNull(); // B was cleaned up — never stuck
  });

  it('an exception inside the fallback callback still clears the ref instead of re-stranding it', () => {
    // A self-fired fallback timer for the SAME click it was armed for always lands exactly at
    // that click's own TTL deadline, so retry() takes the "already expired" branch and never
    // reaches resolveSource at all — no exception possible there. The throw-during-resolution
    // path is only reachable via the "replaced click" scenario (previous test): the OLD timer
    // fires early relative to the NEW click's fresher timestamp, so retry() does NOT
    // short-circuit on TTL and actually calls resolveSource for the new click.
    const clock = makeFakeClock();
    const elementA = attachFiber(makeLeafFiber());
    const elementB = attachFiber(makeLeafFiber());
    const pendingClickElement = { current: elementA };
    const pendingClickTimestamp = { value: clock.now() };
    const boom = new Error('resolveCallSiteTarget exploded (e.g. torn-down DOM node)');

    const controller = createPendingClickRetry({
      pendingClickElement,
      pendingClickTimestamp,
      ttlMs: TTL_MS,
      renderedComponentPath: () => null,
      resolveSource: () => {
        throw boom;
      },
      mapOwnFiberSource: () => null,
      warmServerChunkFrames: () => {},
      warmFiberChunkFrames: () => {},
      onResolved: () => {},
      now: clock.now,
      scheduleTimer: clock.scheduleTimer,
      clearTimer: clock.clearTimer,
    });
    activeController = controller;

    controller.armFallback(); // arms A's timer WITHOUT calling resolveSource yet
    expect(clock.pendingTimerCount()).toBe(1);

    // B replaces A well before A's deadline — B's timestamp is fresher.
    clock.advance(1000);
    pendingClickElement.current = elementB;
    pendingClickTimestamp.value = clock.now();
    controller.armFallback(); // no-op — A's timer is still armed

    // A's stale timer fires. B is NOT yet expired (fresher timestamp), so retry() proceeds
    // past the TTL check into resolveNonTerminal → resolveSource(fiber) → throws. The timer
    // body's try/catch must clear the ref before rethrowing.
    expect(() => clock.advance(TTL_MS + 1 - 1000)).toThrow(boom);
    expect(pendingClickElement.current).toBeNull(); // fail-closed, not re-stranded
  });
});
