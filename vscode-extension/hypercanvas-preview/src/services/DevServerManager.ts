/**
 * Dev Server Manager - manages local dev server for user projects
 *
 * Starts/stops the dev server as a child process.
 * Detects project type and runs appropriate dev command.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { ERROR_PATTERNS, SUCCESS_PATTERNS } from '../../../../shared/log-patterns';
import type { RuntimeError } from '../../../../shared/runtime-error';
import type { DevServerState, DevServerStatus } from '../types';
import { findFreePort, probeOpen } from './netProbe';
import { PreviewProxy } from './PreviewProxy';
import { detectPackageManager, getPackageScripts, getProjectInfo } from './ProjectDetector';

const MAX_LOG_ENTRIES = 200;
// Strips all ANSI/VT escape sequences: CSI (ESC[...final), OSC (ESC]...BEL/ST), and bare ESC+char.
// CSI pattern covers color codes AND terminal mode sequences like \x1b[?2004h that Bun emits.
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[A-Z\\[\]^_@]/g;
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

// Explicit dev-server lifecycle edges (HYP-370 Phase 2). The DevServerStatus enum
// (types.ts) is the de facto state; this table makes it a guarded machine instead of
// a passively-set field. Idempotent self-loops (to === from) are handled by transition()
// and are always legal, so they are not listed here.
//   stopped|error -> starting   start() begins a spawn
//   starting      -> running     stdout/stderr ready or _waitForReady port poll
//   starting      -> error       spawn 'error' event / start() catch
//   running       -> error       process 'error' event after it was serving
//   stopped       -> error       startup crash: the dev command exits during
//                                _waitForReady() (exit handler sets `stopped`),
//                                then start()'s catch surfaces the failure as `error`
//                                with the message — without this edge the UI would
//                                silently lose the failure state/message.
//   starting|running|error -> stopped   exit handler / stop()
const LEGAL_TRANSITIONS: Record<DevServerStatus, readonly DevServerStatus[]> = {
  stopped: ['starting', 'error'],
  starting: ['running', 'error', 'stopped'],
  running: ['error', 'stopped'],
  error: ['starting', 'stopped'],
};

export interface LogEntry {
  line: string;
  timestamp: number;
  isError: boolean;
}

export function appendScriptCliArgs(command: { args: string[] }, packageManager: PackageManager, args: string[]): void {
  if (packageManager === 'npm') {
    command.args.push('--', ...args);
    return;
  }
  command.args.push(...args);
}

/**
 * True when a dev/start script already pins its own port via a CLI `--port`/`-p` flag
 * (e.g. `vite dev --port 3000`, `next -p 4000`). In that case our injected `--port`
 * would be a redundant second port that only confuses the user, so we skip injecting it
 * and discover the real bound port from stdout (_maybeUpdatePortFromOutput).
 *
 * Only the CLI flag counts — env vars (`PORT=`, `VITE_PORT=`) are not reliable pins:
 * Vite ignores them, and an inline `PORT=…` assignment in the script overrides whatever
 * env we set anyway, so they never require suppressing our `--port` injection.
 */
export function devScriptDeclaresPort(script: string): boolean {
  return /--port[=\s]+\d/.test(script) || /(?:^|\s)-p[=\s]+\d/.test(script);
}

export function shouldRepairDependencies(errorMessage: string, logs: LogEntry[]): boolean {
  const text = `${errorMessage}\n${logs.map((entry) => entry.line).join('\n')}`.toLowerCase();
  return (
    text.includes('cannot find native binding') ||
    text.includes('optional dependencies') ||
    text.includes('@rolldown/binding') ||
    text.includes('@rollup/rollup-') ||
    (text.includes('node_modules') && text.includes('module_not_found') && text.includes('binding'))
  );
}

export function buildInstallCommand(packageManager: PackageManager): { cmd: string; args: string[] } {
  switch (packageManager) {
    case 'bun':
      return { cmd: 'bun', args: ['install'] };
    case 'pnpm':
      return { cmd: 'pnpm', args: ['install', '--force'] };
    case 'yarn':
      return { cmd: 'yarn', args: ['install'] };
    default:
      return { cmd: 'npm', args: ['install'] };
  }
}

export class DevServerManager {
  private _process: ChildProcess | null = null;
  private _port: number | null = null;
  private _status: DevServerStatus = 'stopped';
  private _error: string | undefined;
  private _projectPath: string;
  // True once setProjectPath has explicitly pinned the project path (e.g. to a monorepo
  // sub-project for a selected component, HYP-420). When set, start() must NOT reset the
  // path back to the VS Code workspace folder via _syncProjectPathWithWorkspace — the
  // repo root often has no dev/start script and would fail to launch.
  private _projectPathPinned = false;
  private _outputChannel: vscode.OutputChannel;
  private _onStatusChangeListeners: Array<(state: DevServerState) => void> = [];

  // Log buffer and error detection
  private _logs: LogEntry[] = [];
  private _hasErrors = false;
  private _onLogsUpdateListeners: Array<(logs: LogEntry[], hasErrors: boolean) => void> = [];
  private _onError: ((errorLines: string) => void) | null = null;

  // Preview proxy and runtime errors
  private _previewProxy: PreviewProxy | null = null;
  private _pendingIsolatedMode = false; // setIsolatedMode() may arrive before proxy exists
  private _runtimeError: RuntimeError | null = null;
  private _onRuntimeErrorChangeListeners: Array<(error: RuntimeError | null) => void> = [];

  // Port auto-detection — set once per start() when dev server stdout reveals
  // the actual bound port (e.g. "http://localhost:3000"). Resets on each start().
  private _portDetected = false;

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
    return this._buildState();
  }

  /**
   * True while a recompile gate is armed (post-patch, pre fresh "compiled
   * successfully") AND the server is still serving. Guarded by `running` so a gate
   * that outlives a stop/crash (the gate is only cleared on success or re-arm, not
   * on exit) never reports an incoherent `{ status: 'stopped', recompiling: true }`.
   * "Mid-recompile" only means anything while running.
   */
  private get _recompiling(): boolean {
    return this._recompileGate !== null && this._status === 'running';
  }

  /** Single source of truth for the published DevServerState shape. */
  private _buildState(): DevServerState {
    // Return proxy URL if available (for script injection), otherwise direct URL
    const proxyUrl = this._previewProxy?.url;
    return {
      status: this._status,
      port: this._port ?? undefined,
      url: proxyUrl ?? (this._port ? `http://localhost:${this._port}` : undefined),
      error: this._error,
      recompiling: this._recompiling,
    };
  }

  /** Build the current state and push it to every onStatusChange listener. */
  private _publishState(): void {
    const state = this._buildState();
    for (const cb of this._onStatusChangeListeners) cb(state);
  }

  /**
   * Start the dev server
   */
  async start(dependencyRepairAttempted = false): Promise<DevServerState> {
    await this._syncProjectPathWithWorkspace();

    if (this._status === 'running') {
      return this.getState();
    }

    if (this._status === 'starting') {
      return this.getState();
    }

    this.transition('starting');

    // Reset logs and port detection on new start
    this._logs = [];
    this._hasErrors = false;
    this._portDetected = false;

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
      // Apply isolated mode that may have been set before proxy was created
      // (PreviewModeManager.startWatching() fires before dev server starts)
      if (this._pendingIsolatedMode) {
        this._previewProxy.setIsolatedMode(true);
      }
      await this._previewProxy.start();
      console.log(`[HyperIDE] PreviewProxy started on port ${this._previewProxy.port}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

      console.log(
        `[HyperIDE] DevServer: ${packageManager} run ${devScript} (port ${this._port}) in ${this._projectPath}`,
      ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      this._outputChannel.appendLine(`[DevServer] Starting ${packageManager} run ${devScript}`);
      this._outputChannel.appendLine(`[DevServer] Project: ${this._projectPath}`);
      // Skip injecting our CLI --port when the dev script already pins its own via a
      // CLI flag (`vite dev --port 3000`, `next -p 4000`). A second --port is a
      // confusing phantom; the real bound port is discovered from stdout
      // (_maybeUpdatePortFromOutput). The PORT/VITE_PORT env below stays set but is
      // harmless (Vite ignores it, and an inline PORT= in the script overrides ours).
      const scriptDeclaresPort = devScriptDeclaresPort(scripts[devScript] ?? '');
      this._outputChannel.appendLine(
        scriptDeclaresPort
          ? '[DevServer] Port: declared by dev script (auto-detected from output)'
          : `[DevServer] Port: ${this._port}`,
      );

      // Build command based on package manager
      const command = this._buildCommand(packageManager, devScript);

      // Pass --port via CLI for frameworks that support it.
      // Env vars PORT/VITE_PORT alone are not reliable (Vite ignores them).
      if (!scriptDeclaresPort) {
        if (projectInfo.type === 'vite' || projectInfo.type === 'remix') {
          appendScriptCliArgs(command, packageManager, ['--port', String(this._port)]);
        } else if (projectInfo.type === 'nextjs') {
          appendScriptCliArgs(command, packageManager, ['-p', String(this._port)]);
        } else if (projectInfo.type === 'webpack') {
          appendScriptCliArgs(command, packageManager, ['--port', String(this._port)]);
        }
        // CRA reads PORT env var — no CLI flag needed
      }

      // Spawn process
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
        // Strip ANSI escape codes — Vite 8 (rolldown) wraps output in color
        // codes that pollute the VS Code output channel and split keywords.
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up

        this._maybeUpdatePortFromOutput(clean);

        // Detect when server is ready
        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stdout');
          this.transition('running');
        }

        this._maybeResolveRecompileGate(clean);
      });

      // Handle stderr — many servers (Vite 8, Next.js) write to stderr
      child.stderr?.on('data', (data: Buffer) => {
        if (!isCurrentProcess()) return;
        const text = data.toString();
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up

        this._maybeUpdatePortFromOutput(clean);

        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stderr');
          this.transition('running');
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
        this.transition('stopped');
      });

      // Handle process error
      child.on('error', (error) => {
        if (!isCurrentProcess()) return;
        console.error('[HyperIDE] DevServer process error:', error.message);
        this._outputChannel.appendLine(`[DevServer] Process error: ${error.message}`);
        this.transition('error', error.message);
      });

      // Wait for server to be ready (with timeout).
      // 90s: Remix/Next.js cold compile on a loaded Docker shard can take 60s+
      // before the port becomes accessible. 30s was too tight and caused
      // spurious "Server startup timeout" failures in CI.
      await this._waitForReady(90_000);

      return this.getState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HyperIDE] Dev server failed:', errorMessage);
      this._outputChannel.appendLine(`[DevServer] Failed to start: ${errorMessage}`);

      if (!dependencyRepairAttempted && shouldRepairDependencies(errorMessage, this._logs)) {
        try {
          await this.stop();
          const packageManager = await detectPackageManager(this._projectPath);
          await this._repairDependencies(packageManager);
          return this.start(true);
        } catch (repairError) {
          const repairMessage = repairError instanceof Error ? repairError.message : 'Unknown dependency repair error';
          this._outputChannel.appendLine(`[DevServer] Dependency repair failed: ${repairMessage}`);
        }
      }

      this._stopProxy();
      this.transition('error', errorMessage);
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

    // Unblock any awaitRecompile() callers — server is stopping so recompile will never land.
    this._recompileGate?.resolve();
    this._recompileGate = null;

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
      this.transition('stopped');
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
    // Explicit external set (e.g. monorepo sub-project reroot) pins the path so a later
    // start() won't sync it back to the workspace folder via _syncProjectPathWithWorkspace.
    this._projectPathPinned = true;
    await this._applyProjectPath(projectPath);
  }

  /** Switch the project path and reset project-scoped state. Does not change the pin. */
  private async _applyProjectPath(projectPath: string): Promise<void> {
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
  dispose(): void {
    // Chain _outputChannel.dispose() after stop() so the async stop() path
    // (process exit handler, stdout/stderr callbacks) doesn't call appendLine
    // on an already-disposed channel.
    void this.stop().finally(() => this._outputChannel.dispose());
  }

  /**
   * Switch between App Shell and Isolated mode. Delegated from PreviewModeManager.
   */
  setIsolatedMode(isolated: boolean): void {
    this._pendingIsolatedMode = isolated;
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
    // HYP-370 Phase 3: surface the recompiling sub-state so consumers react
    // (status stays `running`; only `recompiling` flips to true).
    this._publishState();
  }

  /**
   * Await pending recompile gate, if any. No-op when no gate is armed. Used by
   * preview-side code that must not load the iframe URL until webpack finishes
   * the SECOND compile (the post-patch one).
   */
  async awaitRecompile(timeoutMs = 300_000): Promise<void> {
    if (!this._recompileGate) return;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timerId = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([this._recompileGate.promise, timeoutPromise]);
    clearTimeout(timerId);
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
    // HYP-370 Phase 3: gate cleared — `recompiling` flips back to false.
    this._publishState();
  }

  private _isRecompileReadyMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('compiled successfully') || // webpack/CRA success
      lower.includes('compiled with') || // webpack/CRA finish with errors/warnings — still done
      lower.includes('compiled in') || // Next.js post-HMR "Compiled in 200ms"
      lower.includes('compiled client') || // Next.js post-HMR
      lower.includes('hmr update') || // Vite "[vite] hmr update"
      lower.includes('page reload') || // Vite/Remix "[vite] page reload"
      lower.includes('rebuilt in') || // esbuild
      /ready in \d+\s*ms/i.test(text) // Vite "ready in N ms" after restart
    );
  }

  private async _syncProjectPathWithWorkspace(): Promise<void> {
    // Respect an explicitly pinned path (monorepo sub-project, HYP-420) — never reset
    // it to the workspace folder, which may lack a runnable dev/start script. Use
    // _applyProjectPath (not setProjectPath) so this automatic sync never sets the pin.
    if (this._projectPathPinned) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || workspaceRoot === this._projectPath) return;
    await this._applyProjectPath(workspaceRoot);
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
   * Find a free port starting from default. Delegates to the shared IPv6-aware
   * net-probe util so the bind and the liveness probe agree on the same surface
   * (127.0.0.1 AND ::1), instead of disagreeing on an IPv6-only bind.
   */
  private _findFreePort(startPort: number): Promise<number> {
    return findFreePort(startPort);
  }

  /**
   * Build command based on package manager
   */
  private _buildCommand(packageManager: PackageManager, script: string): { cmd: string; args: string[] } {
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

  private async _repairDependencies(packageManager: PackageManager): Promise<void> {
    const command = buildInstallCommand(packageManager);
    this._outputChannel.appendLine(`[DevServer] Repairing dependencies with ${command.cmd} ${command.args.join(' ')}`);
    this._appendLog(`[HyperIDE] Repairing dependencies with ${command.cmd} ${command.args.join(' ')}\n`);

    await new Promise<void>((resolve, reject) => {
      // nosemgrep: spawn-shell-true -- package-manager commands may resolve through shell shims/corepack
      const child = spawn(command.cmd, command.args, {
        cwd: this._projectPath,
        env: {
          ...process.env,
          CI: 'true',
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up
      });

      child.on('error', (error) => reject(error));
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command.cmd} ${command.args.join(' ')} exited with code ${code}`));
      });
    });
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
    await this.awaitRecompile(timeoutMs);
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
        this.transition('running');
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Server startup timeout');
  }

  /**
   * Check if port is accepting connections. Delegates to the shared net-probe
   * util, which connects to both 127.0.0.1 and ::1 so a dev server bound to
   * either loopback family is detected (previously this connected to
   * 'localhost' while _findFreePort bound '127.0.0.1', disagreeing on an
   * IPv6-only bind).
   */
  private _isPortOpen(port: number): Promise<boolean> {
    return probeOpen(port);
  }

  /**
   * Parse the actual bound port from a dev server startup line and update the
   * proxy target when it differs from the assigned port.
   *
   * Some dev servers (Bun.serve, custom scripts) ignore the PORT env var and
   * bind to a hardcoded port. This method reads the port from output lines like
   * "http://localhost:3000" or "Local: http://127.0.0.1:5173" and silently
   * corrects the proxy target so requests reach the server. Called once per
   * start(), subsequent calls are no-ops once _portDetected is set.
   *
   * Requires the http:// scheme so debugger lines ("Debugger listening on
   * ws://127.0.0.1:9229") are never mistaken for dev-server ports.
   */
  private _maybeUpdatePortFromOutput(text: string): void {
    if (this._portDetected || !this._previewProxy) return;
    const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})/);
    if (!match) return;
    const detectedPort = Number(match[1]);
    if (!Number.isFinite(detectedPort) || detectedPort <= 0 || detectedPort > 65535) return;
    this._portDetected = true;
    if (detectedPort === this._port) return;
    const msg = `[DevServer] Port auto-corrected: ${this._port} → ${detectedPort} (server ignored PORT env var)`;
    console.log(`[HyperIDE] DevServer bound to port ${detectedPort} (assigned ${this._port}), correcting proxy target`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    this._outputChannel.appendLine(msg);
    this._port = detectedPort;
    this._previewProxy.setTargetPort(detectedPort);
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
      const cleanLine = line.replace(ANSI_ESCAPE_PATTERN, '');
      const isError = ERROR_PATTERNS.some((pattern) => pattern.test(cleanLine));
      // Both checks are needed independently: isSuccess clears _hasErrors even for non-error lines.
      // Short-circuiting on isError would skip success detection for error-free log lines.
      const isSuccess = SUCCESS_PATTERNS.some((pattern) => pattern.test(cleanLine));
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
        this._onError?.(errorEntries.map((e) => e.line.replace(ANSI_ESCAPE_PATTERN, '')).join('\n'));
      }
    }
  }

  /**
   * Guarded status transition (HYP-370 Phase 2). Consults LEGAL_TRANSITIONS and
   * applies + publishes the new status only for legal edges. Idempotent self-loops
   * (to === from) are always legal — this preserves today's always-fire behavior
   * (e.g. stop() of a fresh instance re-publishing `stopped`). Illegal cross-state
   * jumps are no-ops: the status is left unchanged and onStatusChange is NOT fired.
   *
   * Returns true if the transition was applied, false if rejected. All status-setting
   * sites route through here; _updateStatus stays the set+notify primitive it calls.
   */
  private transition(to: DevServerStatus, error?: string): boolean {
    const from = this._status;
    if (to !== from && !LEGAL_TRANSITIONS[from].includes(to)) {
      console.warn(`[HyperIDE] DevServer rejected illegal status transition: ${from} -> ${to}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      return false;
    }
    this._updateStatus(to, error);
    return true;
  }

  /**
   * Update status and notify listeners
   */
  private _updateStatus(status: DevServerStatus, error?: string): void {
    this._status = status;
    this._error = error;
    this._publishState();
  }
}
