/**
 * DiagnosticHub — aggregates diagnostic data from DevServerManager,
 * PreviewPanel (runtime errors), and console capture messages.
 * Broadcasts diagnostic:* messages through PanelRouter to all webview panels.
 *
 * Pattern follows StateHub: register panels, broadcast updates.
 */

import { appendFileSync } from 'node:fs';
import type * as vscode from 'vscode';
import type { DiagnosticLogEntry, DiagnosticState } from '../../../shared/diagnostic-types';
import { DIAGNOSTIC_LOG_LIMIT } from '../../../shared/diagnostic-types';
import type { RuntimeError } from '../../../shared/runtime-error';
import type { LogEntry } from './services/DevServerManager';
import { DiagnosticPersistenceService } from './services/DiagnosticPersistenceService';

// No module-level ERROR_SINK_PATH — read at call time so startDiagnosticCapture
// can set the env var after module load and reach this path.

const ANSI_STRIP = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[A-Z\\[\]^_@]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_STRIP, '');
}

/**
 * The definitive route-miss message React Router emits when the previewed app's OWN router
 * handles our injected /test-preview navigation before the HYP-931 route patch is live
 * (embedded in the ErrorResponse the default ErrorBoundary logs via console.error).
 * Deliberately the ONLY accepted evidence: the boundary preamble prefixes ANY handled
 * error, and status/"Not Found" fields also appear in real app fetch failures — a genuine
 * error that merely mentions /test-preview must never be retracted (review finding).
 */
// The route-miss URL itself must be /test-preview — `\\?["']` tolerates the JSON-escaped
// form (`…"data":"Error: No route matches URL \"/test-preview\""…`) the capture script
// produces when React Router's ErrorResponse is stringified. The character after
// /test-preview must be a path/query/quote boundary, so a `?component=…` suffix still
// qualifies while a DIFFERENT route's miss with /test-preview merely elsewhere in the
// joined line (e.g. a stack/source URL) does not (review finding).
const PREVIEW_ROUTE_404_RE = /No route matches URL \\?["']\/test-preview(?:[/?#\\"']|$)/;

/**
 * True for the KNOWN expected-transient console error a router-owning app logs while the
 * /test-preview route patch races HMR on preview open (HYP-943, follow-up to HYP-931).
 * Deliberately narrow: console-source red entries whose React Router route-miss message
 * names /test-preview ITSELF as the missed URL — a 404 for any other route is a real app
 * problem and stays red.
 */
export function isExpectedTransientPreviewRoute404(entry: DiagnosticLogEntry): boolean {
  if (entry.source !== 'console' || !entry.isError) return false;
  return PREVIEW_ROUTE_404_RE.test(entry.line);
}

/**
 * Post-render-success grace window for the batched-console race (HYP-943 review finding):
 * the iframe console hook batches entries for 100ms, while componentRenderSucceeded posts
 * immediately — so the transient 404 can arrive AFTER the success-triggered retraction
 * already ran. A matching entry captured within this window after a proven successful
 * swap is provably stale and is dropped at capture time. Kept tight (well above the
 * 100ms batch + bridge hops, far below human re-navigation time) so a genuinely stuck
 * 404 from a NEW preview attempt is never swallowed.
 */
const RENDER_SUCCESS_GRACE_MS = 1000;

/** Max server log entries included in AI diagnostic context */
const SERVER_LOG_AI_CONTEXT_LIMIT = 50;
/** Max console log entries included in AI diagnostic context */
const CONSOLE_LOG_AI_CONTEXT_LIMIT = 30;

export class DiagnosticHub {
  private _panels = new Map<string, vscode.Webview>();
  private _logs: DiagnosticLogEntry[] = [];
  private _runtimeError: RuntimeError | null = null;
  private _buildStatus: DiagnosticState['buildStatus'] = 'idle';
  private _isConnected = false;
  private _persistence: DiagnosticPersistenceService | null = null;
  // Which E2E error-sink path each entry's 'diagnosticEntry' record was appended to.
  // WeakMap keyed by the entry object held in _logs — evicted entries GC away with it.
  private _sinkWrites = new WeakMap<DiagnosticLogEntry, string>();
  // Timestamp of the last preview:renderSucceeded — anchors the grace window that drops
  // a late-flushed (batched) transient /test-preview 404 (HYP-943).
  private _lastRenderSuccessAt = 0;

  constructor(globalStoragePath?: string) {
    if (globalStoragePath) {
      this._persistence = new DiagnosticPersistenceService(globalStoragePath);
    }
  }

  async init(): Promise<void> {
    if (this._persistence) {
      this._logs = await this._persistence.load();
    }
  }

  get state(): DiagnosticState {
    return {
      logs: this._logs,
      runtimeError: this._runtimeError,
      buildStatus: this._buildStatus,
      isConnected: this._isConnected,
    };
  }

  get runtimeError(): RuntimeError | null {
    return this._runtimeError;
  }

  /**
   * Register a webview panel to receive diagnostic broadcasts.
   */
  register(panelId: string, webview: vscode.Webview): void {
    this._panels.set(panelId, webview);
  }

  /**
   * Unregister a panel.
   */
  unregister(panelId: string): void {
    this._panels.delete(panelId);
  }

  /**
   * Send full state to a specific panel (on request).
   */
  sendState(panelId: string): void {
    const webview = this._panels.get(panelId);
    if (webview) {
      webview.postMessage({ type: 'diagnostic:state', state: this.state });
    }
  }

  /**
   * Push server logs (called by extension.ts from DevServerManager callback).
   */
  pushServerLogs(logs: LogEntry[]): void {
    const entries: DiagnosticLogEntry[] = logs.map((l) => ({
      line: l.line,
      timestamp: l.timestamp,
      source: 'server' as const,
      isError: l.isError,
    }));
    this._isConnected = true;
    this._appendLogs(entries);
    // Broadcast to all registered webview panels (logs panel, preview panel, etc.)
    this._broadcast({ type: 'diagnostic:log', entries });
  }

  /**
   * Update build status from DevServerManager state changes.
   */
  setBuildStatus(status: DiagnosticState['buildStatus']): void {
    this._buildStatus = status;
    this._isConnected = status === 'ready' || status === 'building';
    this._broadcast({ type: 'diagnostic:buildStatus', status: this._buildStatus });
  }

  /**
   * Handle console capture message forwarded from preview panel iframe.
   */
  handleConsoleCapture(entries: Array<{ level: string; args: string[]; timestamp: number }>): void {
    const logEntries: DiagnosticLogEntry[] = entries
      .map((e) => ({
        line: e.args.join(' '),
        timestamp: e.timestamp,
        source: 'console' as const,
        isError: e.level === 'error',
        level: e.level as DiagnosticLogEntry['level'],
      }))
      // HYP-943 batched-console race: a transient /test-preview 404 flushed AFTER the
      // success-triggered retraction already ran would otherwise stick forever red.
      .filter((e) => !this._isStaleTransient404WithinGrace(e));
    if (logEntries.length === 0) return;

    this._appendLogs(logEntries);
    this._broadcast({ type: 'diagnostic:log', entries: logEntries });
  }

  /** True when the entry is the known transient 404 arriving inside the post-success grace window. */
  private _isStaleTransient404WithinGrace(entry: DiagnosticLogEntry): boolean {
    return (
      isExpectedTransientPreviewRoute404(entry) && Date.now() - this._lastRenderSuccessAt <= RENDER_SUCCESS_GRACE_MS
    );
  }

  /**
   * Called on `preview:renderSucceeded` (HYP-943): retract already-captured transient
   * /test-preview 404 noise AND open the short grace window that drops the same noise
   * when the iframe's 100ms console batching flushes it after this point.
   */
  notePreviewRenderSucceeded(): boolean {
    this._lastRenderSuccessAt = Date.now();
    return this.retractExpectedTransientPreviewRoute404s();
  }

  /**
   * Set runtime error (from preview panel).
   */
  setRuntimeError(error: RuntimeError | null): void {
    this._runtimeError = error;
    if (error) {
      this._appendLogs([
        {
          line: `Runtime Error (${error.framework}): ${error.type}: ${error.message}`,
          timestamp: Date.now(),
          source: 'console',
          isError: true,
          level: 'error',
        },
      ]);
    }
    this._broadcast({ type: 'diagnostic:runtimeError', error });
  }

  /**
   * Retract the expected-transient /test-preview router-404 noise once the canvas-preview
   * swap has PROVEN it transient (HYP-943). Called on `preview:renderSucceeded` — never at
   * capture time, so a genuinely stuck 404 (route patch never applied — the original
   * HYP-931 symptom) stays red in Hyper Logs. Deliberately NOT scoped per component: the
   * /test-preview route patch is app-level, so ANY successful render through it proves the
   * route mounts — an earlier component's route-miss is stale by then (a component-level
   * failure surfaces as a different error class and is never matched here). Removes matching entries from the in-memory
   * ring buffer AND persisted state, then rebroadcasts the full diagnostic state so every
   * registered panel drops the retracted lines. Returns true when anything was retracted.
   */
  retractExpectedTransientPreviewRoute404s(): boolean {
    const retracted = this._logs.filter((entry) => isExpectedTransientPreviewRoute404(entry));
    if (retracted.length === 0) return false;
    this._logs = this._logs.filter((entry) => !isExpectedTransientPreviewRoute404(entry));
    // Immediate write (not the 2s debounce): a pending debounced save is dropped by
    // dispose(), so a reload right after retraction would resurrect the stale 404.
    // Fire-and-forget by design (this method is sync + returns boolean); the FIFO write
    // chain guarantees ordering and saveNow never rejects, so void the promise explicitly.
    void this._persistence?.saveNow(this._logs);
    // The E2E error sink is append-only — the capture-time 'diagnosticEntry' record cannot
    // be unwritten, so emit a matching retraction record and let the capture counter
    // subtract it (keeps sink totals in step with what the Hyper Logs panel shows).
    // Only for entries whose 'diagnosticEntry' record went to the CURRENTLY active sink:
    // an entry captured before the sink was armed (or into an older sink path) has no
    // record in this file, and a blind retraction would subtract an unrelated real error
    // from the capture count (review finding). The WeakMap is intentionally NOT persisted:
    // after an extension-host reload a restored entry loses its sink attribution and its
    // retraction is skipped — the conservative direction (the sink may overcount an
    // already-retracted transient, but can never hide a real error).
    const sinkPath = process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
    this._appendToErrorSink(
      retracted.filter((entry) => this._sinkWrites.get(entry) === sinkPath),
      'diagnosticRetraction',
    );
    this._broadcast({ type: 'diagnostic:state', state: this.state });
    return true;
  }

  /**
   * Clear all diagnostics.
   */
  clear(): void {
    this._logs = [];
    this._runtimeError = null;
    this._persistence?.clear();
    this._broadcast({ type: 'diagnostic:clear' });
  }

  /**
   * Get formatted AI context string.
   */
  getAIContext(): string {
    const parts: string[] = [];

    if (this._buildStatus !== 'ready' && this._buildStatus !== 'idle') {
      parts.push(`Build status: ${this._buildStatus}`);
    }

    if (this._runtimeError) {
      const e = this._runtimeError;
      parts.push(
        `Runtime Error (${e.framework}): ${e.type}: ${e.message}` +
          (e.file ? `\nFile: ${e.file}${e.line ? `:${e.line}` : ''}` : '') +
          (e.codeframe ? `\n\`\`\`\n${e.codeframe}\n\`\`\`` : ''),
      );
    }

    const serverLogs = this._logs.filter((l) => l.source === 'server').slice(-SERVER_LOG_AI_CONTEXT_LIMIT);
    if (serverLogs.length > 0) {
      parts.push(
        `Server logs (last ${serverLogs.length}):\n\`\`\`\n${serverLogs.map((l) => stripAnsi(l.line)).join('\n')}\n\`\`\``,
      );
    }

    const consoleLogs = this._logs.filter((l) => l.source === 'console').slice(-CONSOLE_LOG_AI_CONTEXT_LIMIT);
    if (consoleLogs.length > 0) {
      parts.push(
        `Console output (last ${consoleLogs.length}):\n\`\`\`\n${consoleLogs.map((l) => `[${l.level ?? 'log'}] ${stripAnsi(l.line)}`).join('\n')}\n\`\`\``,
      );
    }

    return parts.join('\n\n');
  }

  dispose(): void {
    this._persistence?.dispose();
    this._panels.clear();
    this._logs = [];
    this._runtimeError = null;
  }

  private _appendLogs(entries: DiagnosticLogEntry[]): void {
    this._logs = [...this._logs, ...entries];
    if (this._logs.length > DIAGNOSTIC_LOG_LIMIT) {
      this._logs = this._logs.slice(-DIAGNOSTIC_LOG_LIMIT);
    }
    this._persistence?.save(this._logs);

    // Forward error-level entries to the optional E2E error sink so test
    // harnesses see the same failures the user sees in the Hyper Logs panel.
    this._appendToErrorSink(
      entries.filter((e) => e.isError || e.level === 'error'),
      'diagnosticEntry',
    );
  }

  /**
   * Append records for `entries` to the optional E2E error sink (NDJSON, append-only).
   * `kind` is 'diagnosticEntry' for captured errors and 'diagnosticRetraction' for
   * entries later retracted as expected transients (HYP-943) — the capture counter
   * subtracts retractions so sink totals match the Hyper Logs panel. The env var is
   * read at call time so startDiagnosticCapture (set after module load) works.
   */
  private _appendToErrorSink(entries: DiagnosticLogEntry[], kind: 'diagnosticEntry' | 'diagnosticRetraction'): void {
    const sinkPath = process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
    if (!sinkPath || entries.length === 0) return;
    const ndjson = entries
      .map((e) =>
        JSON.stringify({
          ts: e.timestamp,
          kind,
          source: e.source ?? '',
          line: stripAnsi(e.line ?? '').replace(/\n/g, ' '),
        }),
      )
      .join('\n');
    try {
      appendFileSync(sinkPath, `${ndjson}\n`);
      if (kind === 'diagnosticEntry') {
        // Remember which sink each entry's record landed in, so a later retraction
        // (HYP-943) only compensates records that actually exist in the active sink.
        for (const entry of entries) this._sinkWrites.set(entry, sinkPath);
      }
    } catch {
      // Best effort — never crash extension host on logging failure.
    }
  }

  private _broadcast(message: Record<string, unknown>): void {
    for (const [, webview] of this._panels) {
      webview.postMessage(message);
    }
  }
}
