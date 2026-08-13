/**
 * Session-scoped telemetry orchestration.
 *
 * WHAT: bundles the per-session state that `extension.ts` would otherwise hold as
 * a pile of module-level `let`s — counters (command/ai/render/error), the
 * heartbeat timer, the funnel-firstPreview one-shot, and the
 * `DissatisfactionDetector` — behind a small API. Keeps `activate()` /
 * `deactivate()` edits tight and the logic unit-reachable.
 * HOW REACHED: constructed in `activate()` right after `TelemetryService`,
 * disposed in `deactivate()`. Methods are called from the wired seams (command
 * wrapper, AI bridge, preview/devServer callbacks, process-error handler).
 * INVARIANT: all timing uses `Date.now()` here (real session clock); the pure
 * `DissatisfactionDetector` it owns takes injected timestamps so IT stays
 * deterministic. Never throws — every public method is best-effort.
 * PII RULE: counters and enums only; no paths/source ever reach these props.
 */

import type * as vscode from 'vscode';
import { DissatisfactionDetector, type EmittedEvent } from './dissatisfaction';
import { TelemetryEvents } from './events';
import type { TelemetryService } from './TelemetryService';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FUNNEL_FIRST_PREVIEW_KEY = 'hypercanvas.telemetry.firstPreviewEmitted';

export class SessionTelemetry {
  private readonly telemetry: TelemetryService;
  private readonly context: vscode.ExtensionContext;
  private readonly detector = new DissatisfactionDetector();
  private readonly startedAt = Date.now();

  private commandCount = 0;
  private aiRequestCount = 0;
  private previewRenderCount = 0;
  private errorCount = 0;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatAt = Date.now();

  constructor(telemetry: TelemetryService, context: vscode.ExtensionContext) {
    this.telemetry = telemetry;
    this.context = context;
  }

  /** Forward the events a heuristic produced to the telemetry sink. */
  private emitAll(events: EmittedEvent[]): void {
    for (const ev of events) this.telemetry.track(ev.name, ev.props);
  }

  // --- counters ----------------------------------------------------------

  incCommand(): void {
    this.commandCount += 1;
  }

  incAiRequest(): void {
    this.aiRequestCount += 1;
  }

  incError(): void {
    this.errorCount += 1;
    this.detector.onError(Date.now());
  }

  // --- dissatisfaction passthroughs (real clock) -------------------------

  onApply(key: string): void {
    this.detector.onApply(key, Date.now());
  }

  onUndo(): void {
    this.emitAll(this.detector.onUndo(Date.now()));
  }

  onInvoke(key: string): void {
    this.emitAll(this.detector.onInvoke(key, Date.now()));
  }

  onSuccess(key: string): void {
    this.detector.onSuccess(key);
  }

  // --- preview render success + funnel -----------------------------------

  /** Record a successful preview render; fires funnel.firstPreview once/machine. */
  onPreviewRenderSucceeded(props: { renderMs?: number; componentKind?: string } = {}): void {
    this.previewRenderCount += 1;
    this.telemetry.track(TelemetryEvents.previewRenderSucceeded, this.cleanNumbers(props));
    this.maybeEmitFirstPreview(true);
  }

  private maybeEmitFirstPreview(succeeded: boolean): void {
    const already = this.context.globalState.get<boolean>(FUNNEL_FIRST_PREVIEW_KEY, false);
    if (already) return;
    void this.context.globalState.update(FUNNEL_FIRST_PREVIEW_KEY, true);
    this.telemetry.track(TelemetryEvents.funnelFirstPreview, {
      msSinceActivate: Date.now() - this.startedAt,
      succeeded,
    });
  }

  private cleanNumbers(props: Record<string, number | string | undefined>): Record<string, number | string> {
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v !== undefined) out[k] = v;
    }
    return out;
  }

  // --- lifecycle ---------------------------------------------------------

  /** Emit session.activated and start the heartbeat timer. */
  start(activatedProps: Record<string, string | number | boolean>): void {
    this.telemetry.track(TelemetryEvents.sessionActivated, activatedProps);
    this.heartbeatTimer = setInterval(() => this.emitHeartbeat(), HEARTBEAT_INTERVAL_MS);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  private emitHeartbeat(): void {
    const now = Date.now();
    this.telemetry.track(TelemetryEvents.sessionHeartbeat, {
      activeMs: now - this.lastHeartbeatAt,
      focused: true,
    });
    this.lastHeartbeatAt = now;
  }

  /**
   * Emit session.ended + run the error-then-quit check. Returns after tracking;
   * the caller flushes/disposes the underlying TelemetryService.
   */
  end(endReason: string): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.emitAll(this.detector.onSessionEnd(Date.now()));
    this.telemetry.track(TelemetryEvents.sessionEnded, {
      durationMs: Date.now() - this.startedAt,
      commandCount: this.commandCount,
      aiRequestCount: this.aiRequestCount,
      previewRenderCount: this.previewRenderCount,
      errorCount: this.errorCount,
      endReason,
    });
  }
}
