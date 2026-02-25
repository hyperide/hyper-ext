/**
 * Dev Server Manager - manages local dev server for user projects
 *
 * Starts/stops the dev server as a child process.
 * Detects project type and runs appropriate dev command.
 */

import { spawn, ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import * as vscode from 'vscode';
import type { DevServerStatus, DevServerState } from '../types';
import {
  getProjectInfo,
  getPackageScripts,
  detectPackageManager,
} from './ProjectDetector';
import { ERROR_PATTERNS, SUCCESS_PATTERNS } from '../../../../shared/fix-session';
import type { RuntimeError } from '../../../../shared/runtime-error';
import { PreviewProxy } from './PreviewProxy';

const MAX_LOG_ENTRIES = 200;

export interface LogEntry {
  line: string;
  timestamp: number;
  isError: boolean;
}

export class DevServerManager {
  private _process: ChildProcess | null = null;
  private _port: number | null = null;
  private _status: DevServerStatus = 'stopped';
  private _error: string | undefined;
  private _projectPath: string;
  private _outputChannel: vscode.OutputChannel;
  private _onStatusChange: ((state: DevServerState) => void) | null = null;

  // Log buffer and error detection
  private _logs: LogEntry[] = [];
  private _hasErrors = false;
  private _onLogsUpdate: ((logs: LogEntry[], hasErrors: boolean) => void) | null = null;
  private _onError: ((errorLines: string) => void) | null = null;

  // Preview proxy and runtime errors
  private _previewProxy: PreviewProxy | null = null;
  private _runtimeError: RuntimeError | null = null;
  private _onRuntimeErrorChange: ((error: RuntimeError | null) => void) | null = null;

  constructor(projectPath: string) {
    this._projectPath = projectPath;
    this._outputChannel = vscode.window.createOutputChannel('HyperCanvas Dev Server');
  }

  /**
   * Set callback for status changes
   */
  onStatusChange(callback: (state: DevServerState) => void): void {
    this._onStatusChange = callback;
  }

  /**
   * Set callback for log updates (real-time push to webview)
   */
  onLogsUpdate(callback: (logs: LogEntry[], hasErrors: boolean) => void): void {
    this._onLogsUpdate = callback;
  }

  /**
   * Set callback for new errors detected
   */
  onError(callback: (errorLines: string) => void): void {
    this._onError = callback;
  }

  /**
   * Set callback for runtime error changes (from iframe error overlays)
   */
  onRuntimeErrorChange(callback: (error: RuntimeError | null) => void): void {
    this._onRuntimeErrorChange = callback;
  }

  /**
   * Set runtime error detected from iframe preview
   */
  setRuntimeError(error: RuntimeError | null): void {
    this._runtimeError = error;
    this._onRuntimeErrorChange?.(error);
  }

  /**
   * Get current runtime error
   */
  get runtimeError(): RuntimeError | null {
    return this._runtimeError;
  }

  /**
   * Get current log buffer
   */
  getLogs(): LogEntry[] {
    return this._logs;
  }

  /**
   * Whether log buffer contains errors
   */
  get hasErrors(): boolean {
    return this._hasErrors;
  }

  /**
   * Clear log buffer
   */
  clearLogs(): void {
    this._logs = [];
    this._hasErrors = false;
    this._onLogsUpdate?.(this._logs, this._hasErrors);
  }

  /**
   * Get current status
   */
  getState(): DevServerState {
    // Return proxy URL if available (for script injection), otherwise direct URL
    const proxyUrl = this._previewProxy?.url;
    return {
      status: this._status,
      port: this._port ?? undefined,
      url: proxyUrl ?? (this._port ? `http://localhost:${this._port}` : undefined),
      error: this._error,
    };
  }

  /**
   * Start the dev server
   */
  async start(): Promise<DevServerState> {
    if (this._status === 'running') {
      return this.getState();
    }

    if (this._status === 'starting') {
      return this.getState();
    }

    this._updateStatus('starting');

    // Reset logs on new start
    this._logs = [];
    this._hasErrors = false;

    try {
      // Get project info
      const projectInfo = await getProjectInfo(this._projectPath);
      const scripts = await getPackageScripts(this._projectPath);
      const packageManager = await detectPackageManager(this._projectPath);

      // Determine dev command
      let devScript = projectInfo.devCommand;
      if (!scripts[devScript]) {
        // Fallback to available scripts
        if (scripts['dev']) devScript = 'dev';
        else if (scripts['start']) devScript = 'start';
        else {
          throw new Error('No dev or start script found in package.json');
        }
      }

      // Find free port
      this._port = await this._findFreePort(projectInfo.defaultPort);

      // Start preview proxy for script injection (error detection)
      this._previewProxy = new PreviewProxy(this._port);
      await this._previewProxy.start();
      console.log(`[HyperCanvas] PreviewProxy started on port ${this._previewProxy.port}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

      console.log(`[HyperCanvas] DevServer: ${packageManager} run ${devScript} (port ${this._port}) in ${this._projectPath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      this._outputChannel.appendLine(`[DevServer] Starting ${packageManager} run ${devScript}`);
      this._outputChannel.appendLine(`[DevServer] Project: ${this._projectPath}`);
      this._outputChannel.appendLine(`[DevServer] Port: ${this._port}`);

      // Build command based on package manager
      const command = this._buildCommand(packageManager, devScript);

      // Spawn process
      // nosemgrep: spawn-shell-true -- dev server requires shell for npm/pnpm/yarn scripts
      this._process = spawn(command.cmd, command.args, {
        cwd: this._projectPath,
        env: {
          ...process.env,
          PORT: String(this._port),
          // For Vite
          VITE_PORT: String(this._port),
        },
        shell: true, // nosemgrep: spawn-shell-true -- dev server requires shell for npm/pnpm/yarn scripts
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Handle stdout
      this._process.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        this._outputChannel.append(text);
        this._appendLog(text);

        // Detect when server is ready
        if (this._status === 'starting') {
          if (
            text.includes('ready') ||
            text.includes('Local:') ||
            text.includes('localhost:') ||
            text.includes('Started')
          ) {
            this._updateStatus('running');
          }
        }
      });

      // Handle stderr
      this._process.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        console.log('[HyperCanvas] DevServer stderr:', text.trim());
        this._outputChannel.append(text);
        this._appendLog(text);

        // Some servers log to stderr
        if (this._status === 'starting') {
          if (
            text.includes('ready') ||
            text.includes('Local:') ||
            text.includes('localhost:')
          ) {
            this._updateStatus('running');
          }
        }
      });

      // Handle process exit
      this._process.on('exit', (code) => {
        console.log(`[HyperCanvas] DevServer process exited with code ${code}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        this._outputChannel.appendLine(`[DevServer] Process exited with code ${code}`);
        this._process = null;
        this._port = null;
        this._stopProxy();
        this._updateStatus('stopped');
      });

      // Handle process error
      this._process.on('error', (error) => {
        console.error('[HyperCanvas] DevServer process error:', error.message);
        this._outputChannel.appendLine(`[DevServer] Process error: ${error.message}`);
        this._updateStatus('error', error.message);
      });

      // Wait for server to be ready (with timeout)
      await this._waitForReady(30000);

      return this.getState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HyperCanvas] Dev server failed:', errorMessage);
      this._outputChannel.appendLine(`[DevServer] Failed to start: ${errorMessage}`);
      this._stopProxy();
      this._updateStatus('error', errorMessage);
      return this.getState();
    }
  }

  /**
   * Stop the dev server
   */
  async stop(): Promise<void> {
    if (this._process) {
      this._outputChannel.appendLine('[DevServer] Stopping server...');

      // Try graceful shutdown first
      this._process.kill('SIGTERM');

      // Wait for process to exit (with timeout)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if still running
          if (this._process) {
            this._process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this._process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this._process = null;
      this._port = null;
    }

    this._stopProxy();
    this._updateStatus('stopped');
  }

  /**
   * Restart the dev server
   */
  async restart(): Promise<DevServerState> {
    await this.stop();
    return this.start();
  }

  /**
   * Show output channel
   */
  showOutput(): void {
    this._outputChannel.show();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stop();
    this._outputChannel.dispose();
  }

  /**
   * Stop the preview proxy and clear runtime error state
   */
  private _stopProxy(): void {
    if (this._previewProxy) {
      this._previewProxy.stop();
      this._previewProxy = null;
    }
    // Use setter so the callback fires and webview clears the banner
    if (this._runtimeError !== null) {
      this.setRuntimeError(null);
    }
  }

  /**
   * Find a free port starting from default
   */
  private async _findFreePort(startPort: number): Promise<number> {
    const isPortFree = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port, '127.0.0.1');
      });
    };

    let port = startPort;
    while (!(await isPortFree(port))) {
      port++;
      if (port > startPort + 100) {
        throw new Error('Could not find free port');
      }
    }

    return port;
  }

  /**
   * Build command based on package manager
   */
  private _buildCommand(
    packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun',
    script: string,
  ): { cmd: string; args: string[] } {
    switch (packageManager) {
      case 'bun':
        return { cmd: 'bun', args: ['run', script] };
      case 'pnpm':
        return { cmd: 'pnpm', args: ['run', script] };
      case 'yarn':
        return { cmd: 'yarn', args: [script] };
      default:
        return { cmd: 'npm', args: ['run', script] };
    }
  }

  /**
   * Wait for server to be ready
   */
  private async _waitForReady(timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this._status === 'running') {
        return;
      }

      if (this._status === 'error' || this._status === 'stopped') {
        throw new Error('Server failed to start');
      }

      // Check if port is accepting connections
      if (this._port && (await this._isPortOpen(this._port))) {
        this._updateStatus('running');
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Server startup timeout');
  }

  /**
   * Check if port is accepting connections
   */
  private _isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, '127.0.0.1');
    });
  }

  /**
   * Append text to log buffer, split into lines, detect errors
   */
  private _appendLog(text: string): void {
    const now = Date.now();
    const lines = text.split('\n').filter((l) => l.length > 0);
    const newEntries: LogEntry[] = [];

    for (const line of lines) {
      const isError = ERROR_PATTERNS.some((pattern) => pattern.test(line));
      const isSuccess = SUCCESS_PATTERNS.some((pattern) => pattern.test(line));
      const entry: LogEntry = { line, timestamp: now, isError };
      this._logs.push(entry);
      newEntries.push(entry);

      if (isError) {
        this._hasErrors = true;
      }
      if (isSuccess) {
        this._hasErrors = false;
      }
    }

    // Trim to max size
    if (this._logs.length > MAX_LOG_ENTRIES) {
      this._logs = this._logs.slice(-MAX_LOG_ENTRIES);
    }

    if (newEntries.length > 0) {
      this._onLogsUpdate?.(this._logs, this._hasErrors);

      // Notify about new errors
      const errorEntries = newEntries.filter((e) => e.isError);
      if (errorEntries.length > 0) {
        this._onError?.(errorEntries.map((e) => e.line).join('\n'));
      }
    }
  }

  /**
   * Update status and notify listeners
   */
  private _updateStatus(status: DevServerStatus, error?: string): void {
    this._status = status;
    this._error = error;

    const proxyUrl = this._previewProxy?.url;
    const state: DevServerState = {
      status,
      port: this._port ?? undefined,
      url: proxyUrl ?? (this._port ? `http://localhost:${this._port}` : undefined),
      error,
    };

    this._onStatusChange?.(state);
  }
}
