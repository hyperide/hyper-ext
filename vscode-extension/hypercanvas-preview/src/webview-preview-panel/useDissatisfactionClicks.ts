/**
 * Webview dissatisfaction click detector (rage / error clicks).
 *
 * WHAT: a tiny, self-contained tracker for two frustration signals inside the
 * preview-panel webview:
 *   - rageClick:  >= RAGE_THRESHOLD clicks on the SAME target within RAGE_WINDOW_MS.
 *   - errorClick: a click that lands within ERROR_WINDOW_MS after a runtime error.
 * It posts a `telemetry:event` to the extension host via the canvas bridge (the
 * same channel `runtime:error` uses); the host gates + forwards to PostHog.
 * HOW REACHED: instantiated by `useCanvasInteraction`. `recordClick(targetId)` is
 * called on each canvas element-click; `noteError()` is called when a runtime
 * error arrives. No SDK is shipped to the webview — only postMessage.
 * INVARIANT: emits scalars only (target id token, counts, windows, a boolean).
 * Target ids are opaque element ids, never file paths or source.
 * PII RULE: never include DOM text, source, or paths.
 *
 * deadClick (a click with no resulting state change) is NOT implemented here: it
 * requires correlating each click against a subsequent state mutation, which is
 * invasive in this hook and prone to false positives. Shipped: rageClick +
 * errorClick. TODO(deadClick) HYP-840: wire reliably once a state-change signal is
 * threaded in without flakiness.
 */

import { useCallback, useRef } from 'react';

const RAGE_THRESHOLD = 3;
const RAGE_WINDOW_MS = 1000;
const ERROR_WINDOW_MS = 3000;

/**
 * Minimal event sink — the canvas bridge's `sendEvent`. `telemetry:event` is an
 * extension-only message NOT in the shared `PlatformMessage` union, so the
 * generic is parameterized over the telemetry shape (the same out-of-band
 * bridging pattern `runtime:error` uses). The host message router validates the
 * event name against the allow-list.
 * @public
 */
export interface TelemetryEventMessage {
  type: 'telemetry:event';
  name: string;
  props: Record<string, string | number | boolean>;
}
export interface ClickTelemetrySink {
  sendEvent(event: TelemetryEventMessage): void;
}

interface RageState {
  target: string;
  count: number;
  windowStart: number;
  fired: boolean;
}

/**
 * Opaque, stable hash of a click target id. Canvas element ids are source
 * nodeRefs of the form `fileName:line:column` (see iframe-interaction.ts), which
 * would leak a filename + source location if emitted raw. The host PII scrubber
 * only drops values containing a slash, so a basename ref like `Button.tsx:12:4`
 * would slip through. We therefore hash the target in the WEBVIEW before it is
 * ever posted — a non-crypto djb2 digest is enough to keep targets
 * distinguishable for aggregation without revealing the source location.
 */
export function hashTarget(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) {
    h = (h * 33) ^ value.charCodeAt(i);
  }
  // Unsigned 32-bit, base36 — short, opaque, stable.
  return (h >>> 0).toString(36);
}

export function useDissatisfactionClicks(sink: ClickTelemetrySink | null) {
  const rage = useRef<RageState | null>(null);
  const lastErrorAt = useRef<number | null>(null);

  const post = useCallback(
    (name: string, props: Record<string, string | number | boolean>) => {
      sink?.sendEvent({ type: 'telemetry:event', name, props });
    },
    [sink],
  );

  /** Mark that a runtime error just occurred (drives error-click detection). */
  const noteError = useCallback(() => {
    lastErrorAt.current = Date.now();
  }, []);

  /** Record a canvas element click. Emits rage/error events when tripped. */
  const recordClick = useCallback(
    (targetId: string | null | undefined) => {
      const now = Date.now();
      // Hash the raw nodeRef (`fileName:line:column`) in the webview BEFORE it is
      // used as a prop or a rage-state key — the raw form would leak a filename +
      // source location, and a basename ref like `Button.tsx:12:4` slips past the
      // host PII scrubber (which only drops slash-bearing values).
      const target = targetId && targetId.length > 0 ? hashTarget(targetId) : 'unknown';

      // error-click: did a runtime error happen just before this click?
      if (lastErrorAt.current !== null && now - lastErrorAt.current <= ERROR_WINDOW_MS) {
        post('dissatisfaction.errorClick', { target, precededError: true });
      }

      // rage-click: same target, rapid repeats.
      const state = rage.current;
      if (!state || state.target !== target || now - state.windowStart > RAGE_WINDOW_MS) {
        rage.current = { target, count: 1, windowStart: now, fired: false };
        return;
      }
      state.count += 1;
      if (state.count >= RAGE_THRESHOLD && !state.fired) {
        state.fired = true;
        post('dissatisfaction.rageClick', {
          target,
          clickCount: state.count,
          windowMs: now - state.windowStart,
        });
      }
    },
    [post],
  );

  return { recordClick, noteError };
}
