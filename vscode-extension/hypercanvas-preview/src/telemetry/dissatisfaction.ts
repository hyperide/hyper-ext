/**
 * Host-side dissatisfaction heuristics — a pure, unit-testable state machine.
 *
 * WHAT: detects three frustration signals from the stream of host events and
 * returns the events that should be emitted (it never emits directly — the
 * caller forwards the returned event names to `TelemetryService.track`):
 *   - quickUndo:      an accept/apply followed by an undo within `quickUndoMs`.
 *   - retryLoop:      >= `retryThreshold` identical re-invocations of the same
 *                     key with no success in between, inside `retryWindowMs`.
 *   - errorThenQuit:  an error occurred within `errorThenQuitMs` before session
 *                     end (checked explicitly at deactivate).
 * HOW REACHED: `extension.ts` / `extension-commands.ts` feed it via the small
 * methods below (`onApply`, `onUndo`, `onInvoke`, `onSuccess`, `onError`,
 * `onSessionEnd`). All timestamps are injected (`now` arg) so tests are
 * deterministic — no `Date.now()` inside.
 * INVARIANT: pure logic, no vscode/posthog imports, no wall-clock reads. Carries
 * only counters/timestamps/opaque keys — never user content. The caller is
 * responsible for passing already-scrubbed keys (e.g. a commandId enum, not a
 * file path).
 * PII RULE: keys passed in MUST be enums/ids, never paths or source.
 */

import { TelemetryEvents, type TelemetryProps } from './events';

export interface DissatisfactionThresholds {
  /** Max ms between an accept/apply and an undo to count as a quick-undo. */
  quickUndoMs: number;
  /** Re-invocation count within the window that trips a retry loop. */
  retryThreshold: number;
  /** Window in which repeated invocations are counted. */
  retryWindowMs: number;
  /** Max ms between the last error and session end to count as error-then-quit. */
  errorThenQuitMs: number;
}

export const DEFAULT_DISSATISFACTION_THRESHOLDS: DissatisfactionThresholds = {
  quickUndoMs: 5000,
  retryThreshold: 3,
  retryWindowMs: 30000,
  errorThenQuitMs: 10000,
};

/** A telemetry event the heuristic decided to emit. */
export interface EmittedEvent {
  name: string;
  props: TelemetryProps;
}

interface RetryState {
  count: number;
  windowStart: number;
  lastFired: boolean;
}

/**
 * Tracks frustration signals across a session. Construct one per activation.
 * Every input method returns the events to emit (usually `[]`).
 */
export class DissatisfactionDetector {
  private readonly thresholds: DissatisfactionThresholds;
  private lastApplyAt: number | null = null;
  private lastApplyKey: string | null = null;
  private lastErrorAt: number | null = null;
  private readonly retry = new Map<string, RetryState>();

  constructor(thresholds: DissatisfactionThresholds = DEFAULT_DISSATISFACTION_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  /** Record an AI/canvas accept-or-apply action that an undo could reverse. */
  onApply(key: string, now: number): void {
    this.lastApplyAt = now;
    this.lastApplyKey = key;
  }

  /**
   * Record an undo. If it lands within `quickUndoMs` of the last apply, emit a
   * quickUndo event. The apply is consumed so a second undo does not re-fire.
   */
  onUndo(now: number): EmittedEvent[] {
    if (this.lastApplyAt === null) return [];
    const elapsed = now - this.lastApplyAt;
    const key = this.lastApplyKey ?? 'unknown';
    this.lastApplyAt = null;
    this.lastApplyKey = null;
    if (elapsed <= this.thresholds.quickUndoMs && elapsed >= 0) {
      return [{ name: TelemetryEvents.dissatisfactionQuickUndo, props: { action: key, elapsedMs: elapsed } }];
    }
    return [];
  }

  /**
   * Record an invocation of `key` (commandId / 'ai-regenerate'). Returns a
   * retryLoop event once the count reaches the threshold inside the window.
   * A window older than `retryWindowMs` resets the counter.
   */
  onInvoke(key: string, now: number): EmittedEvent[] {
    const state = this.retry.get(key);
    if (!state || now - state.windowStart > this.thresholds.retryWindowMs) {
      this.retry.set(key, { count: 1, windowStart: now, lastFired: false });
      return [];
    }
    state.count += 1;
    if (state.count >= this.thresholds.retryThreshold && !state.lastFired) {
      state.lastFired = true;
      return [
        {
          name: TelemetryEvents.dissatisfactionRetryLoop,
          props: { key, count: state.count, windowMs: now - state.windowStart },
        },
      ];
    }
    return [];
  }

  /** A successful outcome for `key` clears its retry counter (loop broken). */
  onSuccess(key: string): void {
    this.retry.delete(key);
  }

  /** Record that an error occurred (for the error-then-quit check at end). */
  onError(now: number): void {
    this.lastErrorAt = now;
  }

  /**
   * Called once at session end. Emits errorThenQuit when the last error was
   * recent enough to plausibly have driven the user out.
   */
  onSessionEnd(now: number): EmittedEvent[] {
    if (this.lastErrorAt === null) return [];
    const elapsed = now - this.lastErrorAt;
    if (elapsed <= this.thresholds.errorThenQuitMs && elapsed >= 0) {
      return [{ name: TelemetryEvents.dissatisfactionErrorThenQuit, props: { sinceErrorMs: elapsed } }];
    }
    return [];
  }
}
