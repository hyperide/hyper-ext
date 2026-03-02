/**
 * DiagnosticHub — aggregates diagnostic data from DevServerManager,
 * PreviewPanel (runtime errors), and console capture messages.
 * Broadcasts diagnostic:* messages through PanelRouter to all webview panels.
 *
 * Pattern follows StateHub: register panels, broadcast updates.
 */

import type * as vscode from 'vscode';
import type { DiagnosticLogEntry, DiagnosticState } from '../../../shared/diagnostic-types';
import { DIAGNOSTIC_LOG_LIMIT } from '../../../shared/diagnostic-types';
import type { RuntimeError } from '../../../shared/runtime-error';
import type { LogEntry } from './services/DevServerManager';
import { DiagnosticPersistenceService } from './services/DiagnosticPersistenceService';

export class DiagnosticHub {
  private _panels = new Map<string, vscode.Webview>();
  private _logs: DiagnosticLogEntry[] = [];
  private _runtimeError: RuntimeError | null = null;
  private _buildStatus: DiagnosticState['buildStatus'] = 'idle';
  private _isConnected = false;
  private _persistence: DiagnosticPersistenceService | null = null;

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
    const logEntries: DiagnosticLogEntry[] = entries.map((e) => ({
      line: e.args.join(' '),
      timestamp: e.timestamp,
      source: 'console' as const,
      isError: e.level === 'error',
      level: e.level as DiagnosticLogEntry['level'],
    }));

    this._appendLogs(logEntries);
    this._broadcast({ type: 'diagnostic:log', entries: logEntries });
  }

  /**
   * Set runtime error (from preview panel).
   */
  setRuntimeError(error: RuntimeError | null): void {
    this._runtimeError = error;
    this._broadcast({ type: 'diagnostic:runtimeError', error });
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

    const serverLogs = this._logs.filter((l) => l.source === 'server').slice(-50);
    if (serverLogs.length > 0) {
      parts.push(
        `Server logs (last ${serverLogs.length}):\n\`\`\`\n${serverLogs.map((l) => l.line).join('\n')}\n\`\`\``,
      );
    }

    const consoleLogs = this._logs.filter((l) => l.source === 'console').slice(-30);
    if (consoleLogs.length > 0) {
      parts.push(
        `Console output (last ${consoleLogs.length}):\n\`\`\`\n${consoleLogs.map((l) => `[${l.level ?? 'log'}] ${l.line}`).join('\n')}\n\`\`\``,
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
  }

  private _broadcast(message: Record<string, unknown>): void {
    for (const [, webview] of this._panels) {
      webview.postMessage(message);
    }
  }
}
