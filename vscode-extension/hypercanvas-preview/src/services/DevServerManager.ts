/**
 * Dev Server Manager - manages local dev server for user projects
 *
 * Starts/stops the dev server as a child process.
 * Detects project type and runs appropriate dev command.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import * as net from 'node:net';
import * as vscode from 'vscode';
import { ERROR_PATTERNS, SUCCESS_PATTERNS } from '../../../../shared/fix-session';
import type { RuntimeError } from '../../../../shared/runtime-error';
import type { DevServerState, DevServerStatus } from '../types';
import { PreviewProxy } from './PreviewProxy';
import { detectPackageManager, getPackageScripts, getProjectInfo } from './ProjectDetector';

const MAX_LOG_ENTRIES = 200;
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

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
  private _onStatusChangeListeners: Array<(state: DevServerState) => void> = [];

  // Log buffer and error detection
  private _logs: LogEntry[] = [];
  private _hasErrors = false;
  private _onLogsUpdateListeners: Array<(logs: LogEntry[], hasErrors: boolean) => void> = [];
  private _onError: ((errorLines: string) => void) | null = null;

  // Preview proxy and runtime errors
  private _previewProxy: PreviewProxy | null = null;
  private _runtimeError: RuntimeError | null = null;
  private _onRuntimeErrorChangeListeners: Array<(error: RuntimeError | null) => void> = [];

  // Recompile gate — webpack-only. Armed by PreviewModeManager BEFORE it AST-rewrites
  // the entry file. Forces _waitForReady() / consumers to wait for a FRESH
  // "compiled successfully" message that arrives AFTER the patch was written, instead
  // of accepting the stale pre-patch one. Without this gate, the iframe can request
  // /test-preview during webpack's second compile (20–40s) and time out at 30s.
  private _recompileGate: {
    promise: Promise<void>;
    resolve: () => void;
    armedAt: number;
  } | null = null;

  constructor(projectPath: string) {
    this._projectPath = projectPath;
    this._outputChannel = vscode.window.createOutputChannel('HyperIDE Dev Server');
  }

  /**
   * Set callback for status changes
   */
  onStatusChange(callback: (state: DevServerState) => void): void {
    this._onStatusChangeListeners.push(callback);
  }

  /**
   * Add listener for log updates (real-time push to webview)
   */
  onLogsUpdate(callback: (logs: LogEntry[], hasErrors: boolean) => void): void {
    this._onLogsUpdateListeners.push(callback);
  }

  /**
   * Set callback for new errors detected
   */
  onError(callback: (errorLines: string) => void): void {
    this._onError = callback;
  }

  /**
   * Add listener for runtime error changes (from iframe error overlays)
   */
  onRuntimeErrorChange(callback: (error: RuntimeError | null) => void): void {
    this._onRuntimeErrorChangeListeners.push(callback);
  }

  /**
   * Set runtime error detected from iframe preview
   */
  setRuntimeError(error: RuntimeError | null): void {
    this._runtimeError = error;
    for (const cb of this._onRuntimeErrorChangeListeners) cb(error);
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
    for (const cb of this._onLogsUpdateListeners) cb(this._logs, this._hasErrors);
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
    await this._syncProjectPathWithWorkspace();

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

      // Determine dev command — truthiness check on scripts[devScript] is intentional:
      // getPackageScripts returns Record<string, string>, so truthy ≡ key exists with value
      let devScript = projectInfo.devCommand;
      if (!scripts[devScript]) {
        // Fallback to available scripts
        if (scripts.dev) devScript = 'dev';
        else if (scripts.start) devScript = 'start';
        else {
          throw new Error('No dev or start script found in package.json');
        }
      }

      // Find free port — prefer VS Code setting, fall back to project default
      const configuredPort = vscode.workspace.getConfiguration('hypercanvas.preview').get<number>('defaultPort');
      const startPort = configuredPort ?? projectInfo.defaultPort;
      this._port = await this._findFreePort(startPort);

      // Start preview proxy for script injection (error detection)
      this._previewProxy = new PreviewProxy(this._port, this._projectPath);
      await this._previewProxy.start();
      console.log(`[HyperIDE] PreviewProxy started on port ${this._previewProxy.port}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

      console.log(
        `[HyperIDE] DevServer: ${packageManager} run ${devScript} (port ${this._port}) in ${this._projectPath}`,
      ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      this._outputChannel.appendLine(`[DevServer] Starting ${packageManager} run ${devScript}`);
      this._outputChannel.appendLine(`[DevServer] Project: ${this._projectPath}`);
      this._outputChannel.appendLine(`[DevServer] Port: ${this._port}`);

      // Build command based on package manager
      const command = this._buildCommand(packageManager, devScript);

      // Pass --port via CLI for frameworks that support it.
      // Env vars PORT/VITE_PORT alone are not reliable (Vite ignores them).
      if (projectInfo.type === 'vite' || projectInfo.type === 'remix') {
        command.args.push('--', '--port', String(this._port));
      } else if (projectInfo.type === 'nextjs') {
        command.args.push('--', '-p', String(this._port));
      } else if (projectInfo.type === 'webpack') {
        command.args.push('--', '--port', String(this._port));
      }
      // CRA reads PORT env var — no CLI flag needed

      // Spawn process
      // nosemgrep: spawn-shell-true -- dev server requires shell for npm/pnpm/yarn scripts
      const child = spawn(command.cmd, command.args, {
        cwd: this._projectPath,
        env: {
          ...process.env,
          PORT: String(this._port),
          // For Vite
          VITE_PORT: String(this._port),
        },
        detached: process.platform !== 'win32',
        shell: true, // nosemgrep: spawn-shell-true -- dev server requires shell for npm/pnpm/yarn scripts
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._process = child;

      const isCurrentProcess = () => this._process === child;

      // Handle stdout
      child.stdout?.on('data', (data: Buffer) => {
        if (!isCurrentProcess()) return;
        const text = data.toString();
        // Strip ANSI escape codes for message detection — Vite 8 (rolldown)
        // wraps output in color codes that can split keywords across chunks.
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(text);
        this._appendLog(text);

        // Detect when server is ready
        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stdout');
          this._updateStatus('running');
        }

        this._maybeResolveRecompileGate(clean);
      });

      // Handle stderr — many servers (Vite 8, Next.js) write to stderr
      child.stderr?.on('data', (data: Buffer) => {
        if (!isCurrentProcess()) return;
        const text = data.toString();
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(text);
        this._appendLog(text);

        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stderr');
          this._updateStatus('running');
        }

        this._maybeResolveRecompileGate(clean);
      });

      // Handle process exit
      child.on('exit', (code) => {
        if (!isCurrentProcess()) return;
        console.log(`[HyperIDE] DevServer process exited with code ${code}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        this._outputChannel.appendLine(`[DevServer] Process exited with code ${code}`);
        this._process = null;
        this._port = null;
        this._stopProxy();
        this._updateStatus('stopped');
      });

      // Handle process error
      child.on('error', (error) => {
        if (!isCurrentProcess()) return;
        console.error('[HyperIDE] DevServer process error:', error.message);
        this._outputChannel.appendLine(`[DevServer] Process error: ${error.message}`);
        this._updateStatus('error', error.message);
      });

      // Wait for server to be ready (with timeout)
      await this._waitForReady(30000);

      return this.getState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HyperIDE] Dev server failed:', errorMessage);
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
    // Capture to local — this._process may be nullified by the exit handler
    // between the guard and the async operations below
    const proc = this._process;
    if (proc) {
      this._outputChannel.appendLine('[DevServer] Stopping server...');
    }

    this._process = null;
    this._port = null;
    this._stopProxy();

    if (proc) {
      // Wait for process to exit (with timeout)
      await new Promise<void>((resolve) => {
        let exited = false;
        const timeout = setTimeout(() => {
          // Force kill if still running
          if (!exited) {
            this._killProcessTree(proc, 'SIGKILL');
          }
          resolve();
        }, 5000);

        proc.once('exit', () => {
          exited = true;
          clearTimeout(timeout);
          resolve();
        });

        // Try graceful shutdown first
        this._killProcessTree(proc, 'SIGTERM');
      });
    }

    if (this._process === null) {
      this._updateStatus('stopped');
    }
  }

  /**
   * Restart the dev server
   */
  async restart(): Promise<DevServerState> {
    await this.stop();
    return this.start();
  }

  /**
   * Switch the managed project root.
   *
   * VS Code can reuse the same extension host when a different folder is opened
   * in the current window. In that case the old dev server must not be reused
   * for the new workspace.
   */
  async setProjectPath(projectPath: string): Promise<void> {
    if (projectPath === this._projectPath) return;
    await this.stop();
    this._projectPath = projectPath;
    this._logs = [];
    this._hasErrors = false;
    this.setRuntimeError(null);
    for (const cb of this._onLogsUpdateListeners) cb(this._logs, this._hasErrors);
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
  // VS Code calls dispose() synchronously during deactivation and does not await
  // the return value, so making this async would not improve cleanup reliability
  dispose(): void {
    void this.stop();
    this._outputChannel.dispose();
  }

  /**
   * Switch between App Shell and Isolated mode. Delegated from PreviewModeManager.
   */
  setIsolatedMode(isolated: boolean): void {
    this._previewProxy?.setIsolatedMode(isolated);
  }

  /**
   * Arm the recompile gate (webpack-only). PreviewModeManager calls this BEFORE
   * AST-rewriting the entry file when the framework is webpack/parcel. Subsequent
   * `awaitRecompile()` callers block until a NEW `compiled successfully` line is
   * observed AFTER this call. Calling again replaces the existing gate.
   */
  armRecompileGate(): void {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    // If a previous gate was armed and never resolved, drop it — the new patch
    // supersedes the old one. Resolve the old gate so any awaiters unblock; they
    // will read the fresh state after the new patch lands.
    this._recompileGate?.resolve();
    this._recompileGate = { promise, resolve, armedAt: Date.now() };
    console.log('[HyperIDE] DevServer recompile gate armed');
  }

  /**
   * Await pending recompile gate, if any. No-op when no gate is armed. Used by
   * preview-side code that must not load the iframe URL until webpack finishes
   * the SECOND compile (the post-patch one).
   */
  async awaitRecompile(): Promise<void> {
    if (!this._recompileGate) return;
    await this._recompileGate.promise;
  }

  /**
   * Inspect a clean log chunk for a fresh `compiled successfully` line and resolve
   * the armed gate if the line is observed AFTER the gate was armed. Lines that
   * predate the arming timestamp are ignored — they belong to the pre-patch compile.
   *
   * Note: timestamps are checked against Date.now() at the moment the chunk is
   * received, not the line's own timestamp (we don't have one). Since stdout/stderr
   * chunks land within milliseconds of being emitted, this is good enough.
   */
  private _maybeResolveRecompileGate(text: string): void {
    const gate = this._recompileGate;
    if (!gate) return;
    if (Date.now() < gate.armedAt) return; // can't happen with monotonic Date.now, but defensive
    // Match the same set of markers we accept for initial server-ready
    // detection. After PreviewModeManager writes a route/entry file, the dev
    // server recompiles and emits one of these markers — webpack writes
    // "compiled successfully", Remix/Vite writes "page reload" or "hmr
    // update", Next.js writes "Compiled in" or "Ready in". Matching only the
    // webpack phrase missed the Remix/Vite/Next clusters and caused 90s
    // setupPreview hangs on those projects (HYP-363 cluster).
    if (!this._isRecompileReadyMessage(text)) return;
    console.log('[HyperIDE] DevServer recompile gate released');
    this._recompileGate = null;
    gate.resolve();
  }

  private _isRecompileReadyMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('compiled successfully') || // webpack/CRA
      lower.includes('compiled in') || // Next.js post-HMR "Compiled in 200ms"
      lower.includes('compiled client') || // Next.js post-HMR
      lower.includes('hmr update') || // Vite "[vite] hmr update"
      lower.includes('page reload') || // Vite/Remix "[vite] page reload"
      lower.includes('rebuilt in') || // esbuild
      (lower.includes('ready') && lower.includes('ms')) // Vite "ready in N ms" after restart
    );
  }

  private async _syncProjectPathWithWorkspace(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || workspaceRoot === this._projectPath) return;
    await this.setProjectPath(workspaceRoot);
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

  private _killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== 'win32' && proc.pid) {
      try {
        process.kill(-proc.pid, signal);
        return;
      } catch {
        // Fall back to killing the direct child below.
      }
    }

    proc.kill(signal);
  }

  /**
   * Public wait-for-ready: resolves once the dev server is `running` AND any armed
   * recompile gate has been released. Use this from preview/iframe loading paths
   * that must not race with a webpack post-patch second compile.
   *
   * If the server is already running and no gate is armed, returns immediately.
   * If a gate is armed (regardless of running state), blocks until release.
   */
  async waitForReady(timeoutMs = 90_000): Promise<void> {
    if (this._status !== 'running') {
      await this._waitForReady(timeoutMs);
    }
    await this.awaitRecompile();
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

      // Check if port is accepting connections — capture port to a local variable
      // to avoid a race where the exit handler nullifies this._port between the
      // truthiness check and the async _isPortOpen call
      const port = this._port;
      if (port && (await this._isPortOpen(port))) {
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

      // Use 'localhost' instead of '127.0.0.1' — modern systems resolve
      // localhost to IPv6 ::1, and Vite/Next.js bind to localhost by default.
      // Hardcoding 127.0.0.1 caused "Server failed to start" on any dev
      // server that binds to IPv6.
      socket.connect(port, 'localhost');
    });
  }

  /**
   * Check if output text indicates the dev server is ready to accept connections.
   * Covers Vite, Next.js, webpack-dev-server, Remix, CRA, and generic patterns.
   */
  private _isServerReadyMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('ready') || // Vite "ready in", Next.js "Ready in"
      text.includes('Local:') || // Vite "Local: http://..."
      text.includes('localhost:') || // webpack-dev-server "Loopback: http://localhost:"
      text.includes('Started') || // Generic
      lower.includes('compiled successfully') || // webpack/CRA
      lower.includes('compiled client') || // Next.js "Compiled client and server"
      lower.includes('listening on') || // Generic servers
      text.includes('Loopback:') // webpack-dev-server
    );
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
      // Both checks are needed independently: isSuccess clears _hasErrors even for non-error lines.
      // Short-circuiting on isError would skip success detection for error-free log lines.
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

    // Trim to max size — slicing a 200-entry array is negligible; threshold-based
    // trimming adds complexity for no measurable gain at this scale
    if (this._logs.length > MAX_LOG_ENTRIES) {
      this._logs = this._logs.slice(-MAX_LOG_ENTRIES);
    }

    if (newEntries.length > 0) {
      for (const cb of this._onLogsUpdateListeners) cb(newEntries, this._hasErrors);

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

    for (const cb of this._onStatusChangeListeners) cb(state);
  }
}
