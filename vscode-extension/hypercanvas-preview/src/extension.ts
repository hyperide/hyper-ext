/**
 * HyperIDE Preview Extension
 *
 * Standalone VS Code extension for visual React component editing.
 * Works completely locally — no remote backend dependency.
 *
 * Features:
 * - Local dev server management
 * - AST-based code manipulation
 * - Component discovery and parsing
 * - Local storage for compositions
 * - AI integration with user's API key
 */

import { appendFileSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  type ComponentRecommendation,
  ensureSample,
  isUiPrimitive,
  PreviewFileManager,
  PreviewModeManager,
  parseExistingPreview,
} from '@lib/preview-generator';
import { resolveRunnableProjectRoot } from '@lib/preview-generator/monorepo-root';
import { buildNeedsPatchPrompt } from '@lib/preview-generator/needs-patch-prompt';
import type { RouteSuggestion } from '@lib/preview-generator/route-heuristics';
import type { SharedEditorState } from '@lib/types';
import * as vscode from 'vscode';
import { runAppModeActivation } from './webview-preview-panel/app-mode-activation';
import { resetPreviewToAppShell } from './webview-preview-panel/reset-to-app-shell';
import { AIChatPanelProvider } from './AIChatPanelProvider';
import { DiagnosticHub } from './DiagnosticHub';
import {
  createSequencedReroot,
  isForeignExtensionError,
  isProviderContextError,
  resolveComponentIdentifier,
  resolveSelfHealComponentParams,
  serializeRejectionReason,
} from './extension-utils';
import { LeftPanelProvider } from './LeftPanelProvider';
import { LogsPanelProvider } from './LogsPanelProvider';
import { HyperMcpServer } from './mcp/HyperMcpServer';
import { PanelRouter } from './PanelRouter';
import { buildNonPreviewablePayload, flattenComponentTree } from './preview-panel-non-previewable';
import { normalizeSampleComponentName, PreviewPanel } from './PreviewPanel';
import { isWebviewDisposedError } from './webview-post';
import { RightPanelProvider } from './RightPanelProvider';
import { StateHub } from './StateHub';
import { DevServerManager } from './services/DevServerManager';
import { shouldInjectGeneratedProps } from './services/no-props-sample';
import {
  computeCapabilities,
  detectCssSystem,
  detectProjectType,
  detectRepoType,
  detectUIKit,
  detectUnsupportedProject,
  getPackageScripts,
  readPackageJson,
  resolveRunnableTargets,
} from './services/ProjectDetector';
import { createExtensionSampleGenerator } from './services/SampleAIGenerator';
import { ensureIsolationWrapper } from './services/WrapperGenerator';
import { VSCodeFileIO } from './vscode-file-io';
import { detectPreviewProviders, detectSSRMockConfig } from './extension-provider-detection';
import { applyTamaguiPalette } from './extension-tamagui';
import { registerCommands } from './extension-commands';
import { setupMcpServer } from './extension-mcp-setup';

// Global references
let mcpServer: HyperMcpServer | null = null;
let previewPanel: PreviewPanel | null = null;
let devServerManager: DevServerManager | null = null;
let logsProvider: LogsPanelProvider | null = null;
let aiChatProvider: AIChatPanelProvider | null = null;
let leftPanelProvider: LeftPanelProvider | null = null;
let rightPanelProvider: RightPanelProvider | null = null;
let stateHub: StateHub | null = null;
let panelRouter: PanelRouter | null = null;
let diagnosticHub: DiagnosticHub | null = null;
let diagnosticsChannel: vscode.OutputChannel | null = null;
// Monorepo-aware dev-server start prep (HYP-431). Set by activate() so the
// hypercanvas.startDevServer command (registered in registerCommands, a sibling
// function with no access to activate()'s reroot closures) can resolve a runnable
// sub-project target before launching, and re-root the preview/dev axis to a chosen
// one. Returns 'ready' to proceed, or 'ambiguous' + candidate paths to let the user
// pick. rerootToTarget re-roots to the user's choice after a QuickPick.
let prepareDevServerTargetRef: (() => Promise<{ kind: 'ready' } | { kind: 'ambiguous'; targets: string[] }>) | null =
  null;
let rerootDevServerTargetRef: ((target: string) => Promise<void>) | null = null;
let _prevDiagnosticSinkPath: string | undefined;
let _diagnosticCaptureActive = false;

export function activate(context: vscode.ExtensionContext) {
  console.log('[HyperIDE] Extension activating...');

  // Initialize right-panel input-focus guard to false so the keybinding
  // `!hypercanvas.rightPanelInputFocused` condition is defined from the start.
  void vscode.commands.executeCommand('setContext', 'hypercanvas.rightPanelInputFocused', false);

  // Catch unhandled rejections and uncaught exceptions inside the extension
  // host process. Extension host is shared across all installed extensions, so
  // foreign-extension errors are filtered out via isForeignExtensionError.
  // Events are written to the 'HyperIDE Diagnostics' output channel (always)
  // and optionally to HYPERIDE_DIAGNOSTIC_ERROR_SINK (a file path) so E2E
  // harnesses and debug sessions can tail the structured log.
  diagnosticsChannel = vscode.window.createOutputChannel('HyperIDE Diagnostics');
  context.subscriptions.push(diagnosticsChannel);
  const ch = diagnosticsChannel;

  const logProcessError = (kind: 'unhandledRejection' | 'uncaughtException', reason: unknown) => {
    if (isForeignExtensionError(reason)) return;
    const serialized = serializeRejectionReason(reason);
    const label = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    ch.appendLine(`[HyperIDE] ${kind}: ${label}`);
    if (reason instanceof Error && reason.stack) {
      ch.appendLine(reason.stack);
    }
    // Also emit to console so Playwright window.on('console') can detect these in E2E tests.
    const consoleLabel = kind === 'unhandledRejection' ? 'Unhandled rejection' : 'Uncaught exception';
    console.error(`[HyperIDE] ${consoleLabel} in extension host:`, label);
    const sinkPath = process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
    if (sinkPath) {
      try {
        appendFileSync(sinkPath, `${JSON.stringify({ ts: Date.now(), kind, reason: serialized })}\n`);
      } catch {
        // best effort — never crash extension host on logging failure
      }
    }
  };

  const unhandledHandler = (reason: unknown) => logProcessError('unhandledRejection', reason);
  // Log and swallow — do NOT re-throw. The extension host is a shared Node.js
  // process; re-throwing inside an uncaughtException handler terminates the
  // entire host, taking all other extensions down with it.
  const uncaughtHandler = (error: unknown) => {
    logProcessError('uncaughtException', error);
  };
  process.on('unhandledRejection', unhandledHandler);
  process.on('uncaughtException', uncaughtHandler);
  context.subscriptions.push({
    dispose: () => {
      process.off('unhandledRejection', unhandledHandler);
      process.off('uncaughtException', uncaughtHandler);
    },
  });

  // Diagnostic capture commands — registered before workspace guard so they work
  // even when no folder is open (the process error handlers above are also pre-guard).
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.startDiagnosticCapture', async () => {
      if (_diagnosticCaptureActive) {
        void vscode.window.showWarningMessage(
          'Diagnostic capture already active. Stop the current one before starting a new one.',
        );
        return;
      }
      // Set flag before the first await so a second concurrent invocation is blocked
      // even while the input box is open (double-trigger, keybinding repeat, etc.).
      _diagnosticCaptureActive = true;
      const defaultPath = join(homedir(), `.hyperide-diagnostics-${Date.now()}.log`);
      const filePath = await vscode.window.showInputBox({
        prompt: 'Path for diagnostic capture output (NDJSON)',
        value: defaultPath,
        validateInput: (v: string) => (v.trim().length === 0 ? 'Path cannot be empty' : undefined),
      });
      if (!filePath) {
        _diagnosticCaptureActive = false;
        return;
      }
      const trimmedPath = resolve(filePath.trim());
      try {
        await mkdir(dirname(trimmedPath), { recursive: true });
        appendFileSync(trimmedPath, '');
      } catch (err) {
        _diagnosticCaptureActive = false;
        void vscode.window.showErrorMessage(`Cannot write to diagnostic sink path: ${(err as Error).message}`);
        return;
      }
      _prevDiagnosticSinkPath = process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
      process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = trimmedPath;
      void vscode.window.showInformationMessage(
        "Diagnostic capture active. Reproduce the bug, then run 'Stop Diagnostic Capture' to finish.",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.stopDiagnosticCapture', async () => {
      if (!_diagnosticCaptureActive) {
        void vscode.window.showWarningMessage('No active diagnostic capture session.');
        return;
      }
      // env var was set by startDiagnosticCapture; could only be missing if something
      // external cleared it between start and stop — treat as empty string (no file).
      const sinkPath = process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK ?? '';
      // Stop capture: restore the previous sink path (e.g. E2E harness path) rather
      // than deleting the key entirely, so the harness stays functional for the rest
      // of the worker session.
      if (_prevDiagnosticSinkPath !== undefined) {
        process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = _prevDiagnosticSinkPath;
      } else {
        delete process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
      }
      _prevDiagnosticSinkPath = undefined;
      _diagnosticCaptureActive = false;

      if (!sinkPath) {
        void vscode.window.showWarningMessage(
          'Diagnostic capture stopped, but the sink path was externally cleared — no log data was recorded.',
        );
        return;
      }

      let rejections = 0;
      let exceptions = 0;
      let diagnosticEntries = 0;
      let fileExists = false;
      try {
        const content = await readFile(sinkPath, 'utf8');
        fileExists = true;
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as { kind?: string };
            if (entry.kind === 'unhandledRejection') rejections++;
            else if (entry.kind === 'uncaughtException') exceptions++;
            else if (entry.kind === 'diagnosticEntry') diagnosticEntries++;
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // file may not exist if no errors occurred
      }

      void vscode.window.showInformationMessage(
        `Diagnostic capture stopped. Rejections: ${rejections}, exceptions: ${exceptions}, log errors: ${diagnosticEntries}.`,
      );

      if (fileExists && rejections + exceptions + diagnosticEntries > 0) {
        try {
          const doc = await vscode.workspace.openTextDocument(sinkPath);
          await vscode.window.showTextDocument(doc, { preview: true });
        } catch {
          // ignore if file cannot be opened
        }
      }
    }),
  );

  // Get workspace root
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) {
    console.log('[HyperIDE] No workspace folder open');
    return;
  }

  console.log(`[HyperIDE] Workspace root: ${workspaceRoot}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  devServerManager = new DevServerManager(workspaceRoot);

  // Create StateHub and PanelRouter for cross-panel coordination
  stateHub = new StateHub();
  panelRouter = new PanelRouter({
    workspaceRoot,
    stateHub,
    context,
  });

  // Create preview panel instance
  previewPanel = new PreviewPanel(context.extensionUri, workspaceRoot, stateHub, panelRouter, context);

  // HYP-544: live write-time className RPC. The inspector color write (right-panel webview,
  // no preview iframe of its own) routes ast:updateStyles through PanelRouter with an empty
  // domClasses; PanelRouter asks the preview-panel for the element's live applied className
  // and awaits it so the DOM-anchored twMerge escalation anchors on reality. Wired here
  // (not a PanelRouter → PreviewPanel ctor dependency) to avoid a circular reference,
  // mirroring the onScreenshot wiring. Resolves null → write degrades to static AST behavior.
  panelRouter.setLiveClassNameProvider(
    (elementId, itemIndex) => previewPanel?.requestLiveClassName(elementId, itemIndex) ?? Promise.resolve(null),
  );

  // HYP-544 Phase 3: empirical color-probe provider. When a color edit's source can't be statically
  // resolved, PanelRouter asks the preview-panel iframe which candidate token actually drives the
  // element's color (off-screen-clone verification). Wired here for the same no-circular-dep reason
  // as the live-className provider. Resolves [] → write degrades to the static AST / §7 floor.
  panelRouter.setColorProbeProvider(
    (request) => previewPanel?.requestProbeColorCandidates(request) ?? Promise.resolve([]),
  );

  // Register serializer for cross-restart persistence
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(PreviewPanel.viewType, {
      async deserializeWebviewPanel(panel: vscode.WebviewPanel) {
        previewPanel?.restorePanel(panel);
      },
    }),
  );

  // Register Logs panel (bottom panel)
  logsProvider = new LogsPanelProvider(context.extensionUri, workspaceRoot, context);

  // Register AI Chat panel (secondary sidebar)
  aiChatProvider = new AIChatPanelProvider(context.extensionUri, workspaceRoot, context, stateHub);

  // Wire ai:openChat from any panel → AI Chat panel
  panelRouter.setOnOpenAIChat((prompt) => {
    aiChatProvider?.sendAIPrompt(prompt);
  });

  // Wire ai:openChat from Logs panel → AI Chat panel
  logsProvider.setOnOpenAIChat((prompt) => {
    aiChatProvider?.sendAIPrompt(prompt);
  });

  let detectionSeq = 0;
  const runProjectDetection = (root: string): void => {
    const seq = ++detectionSeq;
    // HYP-588: capture the panel's screen-decision token BEFORE awaiting the
    // detectors. If a direct screen decision lands while detection is in flight
    // (fix command clears the RN screen after installing react-native-web,
    // selection posts a framework screen, workspace reset), the token moves on
    // and setReactNativeUnsupported below discards this run's stale result.
    const screenDecisionToken = previewPanel?.screenDecisionToken ?? 0;
    readPackageJson(root)
      .then(async (pkg) => {
        const kit = await detectUIKit(root, pkg);
        const cssSystem = await detectCssSystem(root, pkg);
        const projectType = await detectProjectType(root);
        const repoType = await detectRepoType(root);
        const projectError = await detectUnsupportedProject(root, pkg);
        if (seq !== detectionSeq) return;

        stateHub?.applyUpdate({ projectUIKit: kit });

        const capabilities = computeCapabilities(cssSystem, kit, projectError, projectType, repoType);
        console.log('[HyperIDE] Project capabilities:', JSON.stringify(capabilities));

        // Send capabilities to preview panel (readonly badge, style write guard)
        previewPanel?.notifyCapabilities(capabilities);

        // Send capabilities to inspector panel (readonly inputs)
        rightPanelProvider?.notifyCapabilities(capabilities);

        // Scope this background detector to its OWN react-native error channel.
        // detectUnsupportedProject only ever returns a 'react-native' error (or
        // null), so posting its null result via notifyUnsupportedProject would
        // clobber a selection-driven 'framework' compat screen back to blank —
        // the very screen HYP-442 added (race: this async detector can finish
        // AFTER the selection path posts the framework screen). setReactNativeUnsupported
        // clears only a stale RN screen and never touches a 'framework' one, while
        // still clearing the RN screen when switching from an RN to a supported project.
        // The screenDecisionToken (captured above) additionally drops the whole
        // result when ANY newer direct screen decision raced this run (HYP-588).
        previewPanel?.setReactNativeUnsupported(projectError ?? null, screenDecisionToken);
        if (projectError) {
          console.log('[HyperIDE] Unsupported project detected:', projectError.type);
        }

        // HYP-288: install the project's Tamagui color palette for the MCP color
        // token provider, or reset to Radix for non-Tamagui projects. paletteSeq
        // serializes this against concurrent watcher reloads.
        await applyTamaguiPalette(root, kit === 'tamagui');
      })
      .catch((err) => {
        console.warn('[HyperIDE] Failed to detect project info:', err);
      });
  };

  // Read package.json once and run all detectors against it
  runProjectDetection(workspaceRoot);

  // HYP-288: re-sync the Tamagui palette when the config file changes — a focused
  // palette reload (not a full re-detect, so it won't reset inspector/preview UI
  // mid-session), resolving the CURRENT folder root at fire-time so an edit after
  // a workspace-folder change doesn't reload against the stale root.
  const tamaguiConfigWatcher = vscode.workspace.createFileSystemWatcher('**/tamagui.config.{ts,tsx}');
  const reloadTamaguiPalette = (): Promise<void> =>
    applyTamaguiPalette(getWorkspaceRoot() ?? workspaceRoot, stateHub?.state.projectUIKit === 'tamagui');
  const onTamaguiConfigChange = () => void reloadTamaguiPalette();
  tamaguiConfigWatcher.onDidChange(onTamaguiConfigChange);
  tamaguiConfigWatcher.onDidCreate(onTamaguiConfigChange);
  tamaguiConfigWatcher.onDidDelete(onTamaguiConfigChange);
  context.subscriptions.push(tamaguiConfigWatcher);

  // Flush .hyperide/ to disk on first component open (deferred write).
  // Only unsubscribe after flush actually writes — scan may still be in progress.
  const unsubFlush = stateHub.onChange((_state, patch) => {
    if (patch.currentComponent) {
      panelRouter
        ?.flushStructureStore()
        .then((flushed) => {
          if (flushed) unsubFlush();
        })
        .catch((err) => {
          console.error('[HyperIDE] Failed to flush structure store:', err);
        });
    }
  });

  // Create DiagnosticHub for centralized diagnostic data
  diagnosticHub = new DiagnosticHub(context.globalStorageUri.fsPath);
  diagnosticHub.init().catch((err) => {
    console.error('[HyperIDE] Failed to init DiagnosticHub:', err);
  });

  // Wire DiagnosticHub to logs panel and AI chat
  logsProvider.setDiagnosticHub(diagnosticHub);
  aiChatProvider.setDiagnosticHub(diagnosticHub);

  // Retry counter for componentMissing self-healing — declared at activate() scope so it is
  // accessible both inside if (devServerManager) (onComponentMissing callback) and in the
  // stateHub.onChange callback where it is cleared on component switch. Declaring it after
  // either closure would create a TDZ risk if activate() ever short-circuits.
  const componentMissingRetries = new Map<string, number>();

  // HYP-487: components for which we already auto-attempted isolation-wrapper
  // generation after a provider-context error. The iframe ErrorBoundary re-fires
  // (bumps errorSeq) rapidly, so the guard is set synchronously BEFORE the async
  // generate to avoid launching concurrent AI calls / write storms. Cleared on
  // component switch (same lifecycle as componentMissingRetries) so switching away
  // and back can retry.
  const providerErrorAttempts = new Set<string>();

  // App-mode (app-preview address bar): the sub-project-relative preview path of the
  // entry root currently being previewed AS AN APP, or null when off. Tracked here so a
  // component switch can disable that exact entry on the (possibly re-rooted) preview
  // manager and tell the panel to hide the address bar. The previewAsApp command sets it;
  // teardown on component select / the command itself for a new entry clears the old one.
  let activeAppModeEntry: { previewPath: string; manager: PreviewFileManager } | null = null;

  // Disable any active app-mode entry on its owning manager and hide the address bar.
  // Idempotent: a no-op when app-mode was never on. Used by component-switch teardown
  // and by the previewAsApp command before activating a fresh entry.
  const clearActiveAppMode = (): void => {
    if (activeAppModeEntry) {
      activeAppModeEntry.manager.disableAppEntry(activeAppModeEntry.previewPath);
      activeAppModeEntry = null;
    }
    previewPanel?.clearAppMode();
  };

  // Activate app-mode for an already-resolved entry on the CURRENT previewManager:
  // mark it isAppEntry, rebuild so the preview generates the entry root raw (its own
  // router + providers), then post the `appMode` message + reload the iframe with
  // `&app=1`. Shared by the manual `previewAsApp` command and the auto-app-mode path
  // (component-select detects an app-entry candidate). The caller must have already
  // re-rooted previewManager to the entry's owning sub-project. Throws on rebuild
  // failure so the caller can roll back via clearActiveAppMode.
  //
  // `isStale` (default: never) is re-checked AFTER every async await: the rebuild +
  // recompile + route scan take time, so a newer component selection can land mid-flight.
  // Without the post-await checks the stale activation would finish last and clobber the
  // newer selection's state (codex #2). On a stale detection we roll back and stop.
  const activateAppModeForEntry = async (previewPath: string, isStale: () => boolean = () => false): Promise<void> => {
    // Drop any previous app-mode (possibly on another manager) before marking this one,
    // so only one entry is ever flagged isAppEntry at a time.
    clearActiveAppMode();
    previewManager.enableAppEntry(previewPath);
    // Capture THIS activation's entry by identity. A stale rollback must only clear when
    // activeAppModeEntry is still this exact object — a newer activation (selection B) replaces
    // it, and a global clearActiveAppMode() from the stale A would otherwise tear down B's
    // address bar + entry flag (codex P1). `=== myEntry` is identity, so B's entry is never hit.
    const myEntry = { previewPath, manager: previewManager };
    activeAppModeEntry = myEntry;
    // Route suggestions are scanned mid-sequence (a step) and consumed by the commit; hold them
    // across the await boundary so the commit can post them with the `appMode` message.
    let routeSuggestions: RouteSuggestion[] = [];
    // The stale-guarded await sequence + identity-guarded rollback live in a pure, unit-tested
    // helper (app-mode-activation.ts). The rollback only clears when activeAppModeEntry is STILL
    // this exact object, so a stale rollback never tears down a newer activation (codex P1).
    await runAppModeActivation({
      steps: [
        // Rebuild so the entry is generated with isAppEntry (not excluded as a shell).
        () => previewManager.forceRefreshComponent(previewPath).then(() => undefined),
        async () => {
          // Block until webpack reports a fresh `compiled successfully` so the entry is
          // rebuilt-as-app BEFORE the route scan + commit run. No-op when there is no dev
          // server (same immediate-resolve as the prior `?? Promise.resolve()` fallback).
          if (devServerManager) await devServerManager.awaitRecompile();
        },
        async () => {
          routeSuggestions = await previewManager.getRouteSuggestions();
        },
      ],
      isStale,
      // setAppMode posts the `appMode` message AND reloads the iframe with `&app=1`.
      commit: () => previewPanel?.setAppMode({ entryPreviewPath: previewPath, routeSuggestions, currentRoute: '/' }),
      rollbackIfOwned: () => {
        if (activeAppModeEntry === myEntry) clearActiveAppMode();
      },
    });
  };

  // Auto-engage app-mode when the just-selected component IS a full app-entry wrapper
  // (owns a pushState router) — no manual "preview as app" action needed (Alex's ask:
  // "надо чтобы само работало"). A normal leaf component is left in component-mode by the
  // caller's prior setComponentParam. `isStale` lets a newer selection cancel this one at
  // EVERY async boundary (candidacy read, rebuild, recompile, route scan) so a slow
  // activation can never overwrite a fresher selection's state. On a build failure it
  // rolls back to component-mode (the setComponentParam URL the caller already posted).
  const autoEnterAppModeIfCandidate = async (previewPath: string, isStale: () => boolean): Promise<void> => {
    const isCandidate = await previewManager.isAppEntryCandidate(previewPath).catch(() => false);
    if (!isCandidate || isStale()) return;
    try {
      await activateAppModeForEntry(previewPath, isStale);
    } catch (err) {
      // Rebuild-as-app failed — activateAppModeForEntry already rolled THIS activation back
      // (guarded so it never clears a newer selection). The caller's prior setComponentParam
      // leaves the user in component-mode. No error toast: this is an automatic path, not a
      // user-invoked command, so it must degrade silently.
      console.error('[HyperIDE] Auto app-mode failed; falling back to component-mode:', err);
    }
  };

  if (devServerManager) {
    aiChatProvider.setDevServerManager(devServerManager);

    // Feed DiagnosticHub from DevServerManager (without overwriting single-callback APIs)
    devServerManager.onLogsUpdate((logs) => {
      diagnosticHub?.pushServerLogs(logs);
    });

    devServerManager.onStatusChange((state) => {
      const statusMap: Record<string, 'building' | 'ready' | 'error' | 'idle'> = {
        starting: 'building',
        running: 'ready',
        error: 'error',
        stopped: 'idle',
      };
      diagnosticHub?.setBuildStatus(statusMap[state.status] ?? 'idle');

      // Notify preview panel when dev server stops so the status badge updates
      if (state.status === 'stopped' || state.status === 'error') {
        previewPanel?.notifyDevServerStopped();
      }
    });

    // Wire runtime errors from preview iframe to dev server manager + diagnostic hub
    previewPanel.onRuntimeError((error) => {
      devServerManager?.setRuntimeError(error ?? null);
      diagnosticHub?.setRuntimeError(error ?? null);
    });

    // Wire console capture from preview iframe to diagnostic hub
    previewPanel.onConsoleCapture((entries) => {
      diagnosticHub?.handleConsoleCapture(entries);
    });

    // Self-healing: when the generated preview doesn't have the requested component,
    // re-run ensureComponent so the preview file is regenerated with the missing entry.
    // Retry guard prevents an infinite loop if ensureComponent keeps failing.
    // Do NOT skip UI primitives here: those with SampleDefault — or with a synthesized
    // compound scaffold (Task 2 / Task 3) — must be addable via this path. The
    // diff-before-write check in _initPreviewFile prevents HMR when the generated content
    // is unchanged. Primitives that have neither authored nor synthetic SampleDefault
    // remain filtered out by entryHasRenderableSample and surface the "no sample" toast.
    // Scan the project for renderable component files to recommend when the opened
    // file is not previewable. Empty list on any failure (panelRouter not ready, no
    // workspace) — the overlay then shows the error without suggestions.
    const listRenderableComponents = async (): Promise<ComponentRecommendation[]> => {
      const tree = await panelRouter?.componentService.scanComponents();
      return tree ? flattenComponentTree(tree) : [];
    };

    const handleComponentMissing = async (componentPath: string): Promise<void> => {
      const count = componentMissingRetries.get(componentPath) ?? 0;
      if (count >= 2) return;
      // Bump the guard SYNCHRONOUSLY before any await — the iframe re-fires
      // _ComponentMissingSignal rapidly, and the async classification below must not
      // launch concurrent self-heal storms (mirrors the HYP-487 providerErrorAttempts guard).
      componentMissingRetries.set(componentPath, count + 1);
      const currentWorkspaceRoot = syncWorkspaceRuntime();
      // The iframe signals the PREVIEW (sub-project-relative) path. Resolve BOTH
      // the repo-relative and sub-project-relative forms so the regenerated
      // preview keeps its monorepo prefix — a single-arg setComponentParam would
      // clear it and break subsequent iframe edits (P2 #280, HYP-435).
      const { componentPath: repoRelativePath, previewComponentPath: relPath } = resolveSelfHealComponentParams({
        componentPath,
        activeWorkspaceRoot: currentWorkspaceRoot,
        repoRoot: workspaceFolderRoot(),
      });

      // Fail fast for files that can NEVER converge into a preview — a ReactDOM entry
      // (main.tsx → createRoot(...).render(<App/>)) or a file with no renderable
      // component export. Retrying ensureComponent would just regenerate the same
      // empty registry while the iframe spins on "Generating sample…" forever. Surface
      // a clear error + clickable recommendations in the canvas instead (see
      // previewability.ts / preview-panel-non-previewable.ts).
      const nonPreviewable = await buildNonPreviewablePayload({
        filePath: repoRelativePath,
        readSource: () => vsCodeIO.readFile(join(currentWorkspaceRoot, relPath)).catch(() => null),
        listRenderableComponents,
      });
      if (nonPreviewable) {
        // A router-owning entry (isAppEntryCandidate) previews AS AN APP — auto-app-mode is
        // engaging concurrently and can fire a transient componentMissing during activation.
        // Don't show the non-previewable overlay for it; fall through to the (harmless) retry,
        // which the count>=2 guard caps. A bootstrap that merely mounts <App/> (the bug case)
        // is NOT a candidate, so the overlay still shows for it.
        const isAppEntry = await previewManager.isAppEntryCandidate(relPath).catch(() => false);
        if (!isAppEntry) {
          // Stop the self-heal loop for this file: nothing about it will change.
          componentMissingRetries.set(componentPath, 2);
          previewPanel?.notifyNonPreviewableFile(nonPreviewable);
          return;
        }
      }

      // Capture current component so a stale resolve doesn't snap the preview back
      // if the user switched to a different component while ensureComponent was running.
      const capturedCurrentPath = stateHub?.state.currentComponent?.path;
      try {
        const content = await previewManager.ensureComponent([relPath]);
        if (isUiPrimitive(relPath)) {
          const normalizedRelPath = relPath.replace(/\\/g, '/');
          const entries = parseExistingPreview(content);
          const inRegistry = entries.some((e) => e.componentPath.replace(/\\/g, '/') === normalizedRelPath);
          if (!inRegistry) {
            // Primitive that has neither an authored SampleDefault nor a synthesizable
            // compound scaffold (no shadcn-style nested exports) — entryHasRenderableSample
            // returned false, so it stays filtered out of the registry. Don't call
            // setComponentParam — the same-value React state bail-out would leave the
            // preview stuck on "Loading…" indefinitely. Keep the retry count so repeated
            // _ComponentMissingSignal fires are blocked by the count >= 2 guard.
            vscode.window.showInformationMessage(
              `Hyper Canvas: "${relPath}" has no SampleDefault and its exports don't form a renderable compound — preview not available.`,
            );
            return;
          }
        }
        componentMissingRetries.delete(componentPath);
        if (stateHub?.state.currentComponent?.path === capturedCurrentPath) {
          previewPanel?.setComponentParam(repoRelativePath, relPath);
        }
      } catch (err) {
        console.error('[HyperIDE] componentMissing ensureComponent failed:', err);
      }
    };

    previewPanel.onComponentMissing((componentPath) => {
      void handleComponentMissing(componentPath);
    });

    // HYP-487: auto-recover from provider-context render errors. No-router Vite
    // apps (e.g. conloca-app) patch the entry file to mount the previewed
    // component via its own createRoot, bypassing <App> where the context
    // providers (AuthProvider, FeatureFlagsProvider, …) live. The component's
    // context hooks then throw ("useAuth must be used inside <AuthProvider>")
    // and the preview is blank. When the forwarded error matches the
    // provider-context pattern, auto-generate .hyperide/preview.tsx (the same
    // wrapper the manual scope→component-only toggle produces), which flips the
    // preview into isolated mode so the component renders inside its providers.
    previewPanel.onComponentError((componentPath, error) => {
      if (!isProviderContextError(error)) return;
      // Guard set synchronously BEFORE the async generate — the ErrorBoundary
      // re-fires rapidly, and we must not launch concurrent AI calls. Cleared on
      // component switch (providerErrorAttempts.clear()) so a switch-away-and-back retries.
      if (providerErrorAttempts.has(componentPath)) return;
      providerErrorAttempts.add(componentPath);
      const currentWorkspaceRoot = syncWorkspaceRuntime();
      // ensureIsolationWrapper is a no-op when a wrapper already exists (manual or
      // prior auto-gen), and shows the no-AI-key guidance message when generation
      // is skipped — so the "not already isolated" gate and the fallback both live there.
      void ensureIsolationWrapper(currentWorkspaceRoot, context).catch((err) => {
        console.error('[HyperIDE] componentError auto-wrapper generation failed:', err);
      });
    });
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LogsPanelProvider.viewType, logsProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(AIChatPanelProvider.viewType, aiChatProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  const vsCodeIO = new VSCodeFileIO();

  const createPreviewFileManager = (projectRoot: string): PreviewFileManager => {
    const manager = new PreviewFileManager({
      projectRoot,
      // The monorepo workspace root (the CURRENTLY-opened folder, resolved at call
      // time — not the captured activation-time value, so a workspace-folder change
      // re-roots correctly, codex P2). When projectRoot is a re-rooted app target,
      // this lets buildEntry allow a cross-package library component reached via an
      // in-workspace `..` path while still rejecting any path that escapes the
      // workspace (HYP-443).
      workspaceRoot: getWorkspaceRoot() ?? workspaceRoot,
      io: vsCodeIO,
    });
    // Provider and SSR mock detection run async; ensureComponent/rebuild await both before generating
    manager.setProviderWrapAsync(detectPreviewProviders(projectRoot));
    manager.setSSRMockAsync(detectSSRMockConfig(projectRoot));
    return manager;
  };

  const createPreviewModeManager = (projectRoot: string): PreviewModeManager =>
    new PreviewModeManager({
      projectRoot,
      io: vsCodeIO,
      onModeChange: (isolated) => {
        devServerManager?.setIsolatedMode(isolated);
        previewPanel?.setPreviewScope(isolated ? 'component-only' : 'full-app');
        // Force iframe reload on every mode change.
        // App Shell ↔ Isolated transitions swap what the proxy serves at the same URL.
        // HMR alone is unreliable across entry-point boundaries — a hard reload ensures
        // the iframe fetches fresh content from the proxy in its new mode.
        previewPanel?.refresh();
      },
      onBeforeWebpackEntryPatch: () => {
        // Webpack rewrites the entry file → triggers a 20–40s second compile.
        // Arming the gate here forces iframe loaders to await the post-patch
        // `compiled successfully` instead of racing it. See HYP-363.
        devServerManager?.armRecompileGate();
      },
    });

  let activeWorkspaceRoot = workspaceRoot;
  let previewManager = createPreviewFileManager(activeWorkspaceRoot);
  let modeManager = createPreviewModeManager(activeWorkspaceRoot);
  modeManager.startWatching();

  // Re-patch entry/router file after git-discard removes the @hyperide-managed marker.
  // Watches both the router file (App.tsx for vite-spa-jsx-router) and the entry file
  // (index.tsx/main.tsx for webpack/bun). Debounced to coalesce rapid git-discard events.
  let entryWatcherDisposables: vscode.Disposable[] = [];
  const setupEntryFileWatcher = async (workspaceRootPath: string, mgr: PreviewModeManager) => {
    for (const d of entryWatcherDisposables) d.dispose();
    entryWatcherDisposables = [];

    const [routerFile, entryFile] = await Promise.all([
      mgr.detectRouterFile().catch(() => null),
      mgr.getEntryFilePath().catch(() => null),
    ]);

    let repatchTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRepatch = () => {
      clearTimeout(repatchTimer);
      repatchTimer = setTimeout(async () => {
        // No previewPanel.refresh() — watcher fires on extension's own patch writes too;
        // calling refresh() here resets the iframe mid-setup. HMR handles the reload.
        await mgr.onComponentSelected().catch(() => {});
      }, 300);
    };

    for (const filePath of [routerFile, entryFile]) {
      if (!filePath) continue;
      const rel = relative(workspaceRootPath, filePath);
      const pattern = new vscode.RelativePattern(workspaceRootPath, rel);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, true, false, true);
      watcher.onDidChange(scheduleRepatch);
      entryWatcherDisposables.push(watcher);
    }
  };
  void setupEntryFileWatcher(activeWorkspaceRoot, modeManager);

  // Re-root only the preview/dev axis (file manager, mode manager, dev server) to
  // `targetRoot`. Used for BOTH a workspace-folder change and a monorepo sub-project
  // selection. Deliberately does NOT touch previewPanel.setWorkspaceRoot, astBridge,
  // componentService, or runProjectDetection — those stay repo-rooted so the Explorer
  // accordion spans all sub-projects and AST edits resolve against the repo root
  // (HYP-420; astBridge cannot move without breaking cross-target Explorer).
  // Returns the devServerManager.setProjectPath() promise so callers that start the
  // dev server immediately after re-rooting (the start-before-select path, HYP-431)
  // can await the path switch — setProjectPath stops the old server and only then
  // updates _projectPath, so a non-awaited start() could read the stale repo root and
  // fail with "No dev or start script". Callers that don't start eagerly (workspace
  // reroot, component select) may ignore the return value.
  const rerootPreviewPipeline = (targetRoot: string): Promise<void> => {
    if (targetRoot === activeWorkspaceRoot) return Promise.resolve();

    modeManager.stopWatching();
    activeWorkspaceRoot = targetRoot;
    previewManager = createPreviewFileManager(activeWorkspaceRoot);
    modeManager = createPreviewModeManager(activeWorkspaceRoot);
    modeManager.startWatching();
    void setupEntryFileWatcher(activeWorkspaceRoot, modeManager);

    // Not awaited here on purpose: the promise is returned to the caller, which
    // decides whether to await it (eager dev-server start) or fire-and-forget.
    // (CodeQL flags this as a missing await; it is a false positive.)
    return devServerManager?.setProjectPath(activeWorkspaceRoot) ?? Promise.resolve();
  };

  // Heavy re-root for a genuine VS Code workspace-folder change: in addition to the
  // preview/dev axis, reset the repo-rooted panel/detection/capabilities since the
  // whole project changed.
  const rerootProjectPipeline = (folderRoot: string): void => {
    rerootPreviewPipeline(folderRoot);
    previewPanel?.setWorkspaceRoot(folderRoot);
    rightPanelProvider?.notifyCapabilities(null);
    stateHub?.applyUpdate({ projectUIKit: undefined });
    runProjectDetection(folderRoot);
  };

  // The VS Code workspace folder root last applied. Distinct from activeWorkspaceRoot,
  // which may point at a monorepo sub-project after a component selection (HYP-420).
  // syncWorkspaceRuntime resets the pipeline only on a GENUINE folder change — never
  // on a sub-project reroot — so callers like onSampleCreated / scopeChange don't
  // yank the active sub-project back to the repo root mid-session.
  let lastFolderRoot = workspaceRoot;

  const syncWorkspaceRuntime = (): string => {
    const currentFolderRoot = getWorkspaceRoot() ?? lastFolderRoot;
    if (currentFolderRoot === lastFolderRoot) return activeWorkspaceRoot;
    lastFolderRoot = currentFolderRoot;
    rerootProjectPipeline(currentFolderRoot);
    return activeWorkspaceRoot;
  };

  // The VS Code workspace folder. For a monorepo this is the repo root; the active
  // project root (activeWorkspaceRoot) may be a sub-project under it after a component
  // in that sub-project is selected. Tracked separately so we always resolve a
  // selected component against the repo root, not the previously-focused sub-project.
  const workspaceFolderRoot = (): string => getWorkspaceRoot() ?? workspaceRoot;

  /**
   * For a monorepo, re-root the preview pipeline to the sub-project that should
   * RENDER the selected component (a runnable app target). The owning package may
   * be a shared library (react in peerDeps, no bundler, no dev script) which cannot
   * host a preview; in that case resolveRunnableProjectRoot resolves to a runnable
   * app target instead of flagging "unsupported" (HYP-441). The repo root usually
   * has no dev/start script and no index.html / src entry, so the dev server and
   * entry/router patch must run inside the target (HYP-420). Returns the active
   * project root the preview pipeline should run against.
   */
  // Sequence-aware reroot: resolveRunnableProjectRoot is an async filesystem walk,
  // so when the user rapidly selects components from different monorepo targets an
  // earlier resolve can finish AFTER a newer selection. The reroot of
  // previewManager / modeManager / devServerManager must therefore be gated on the
  // selection sequence — a stale callback must NOT reroot the pipeline to the old
  // sub-project, or subsequent preview generation / dev-server start run in the
  // wrong package (P2 #277). The freshness check lives INSIDE the helper, before
  // the reroot, so the ordering bug (reroot-then-check) cannot recur.
  const resolveAndRerootToComponent = createSequencedReroot({
    resolveRoot: (componentPath) => {
      const repoRoot = workspaceFolderRoot();
      const absComponent = isAbsolute(componentPath) ? componentPath : join(activeWorkspaceRoot, componentPath);
      return resolveRunnableProjectRoot(repoRoot, absComponent, vsCodeIO);
    },
    reroot: (projectRoot) => rerootPreviewPipeline(projectRoot),
  });

  // Resolve the component to preview as an app: the currently-selected one. Returns its
  // sub-project-relative preview path (the ?component= form / preview-registry key) and
  // repo-relative path (astBridge identity), re-rooting the pipeline to the owning target
  // first so previewManager points at the right sub-project. Null when nothing is selected.
  const resolveAppEntryTarget = async (): Promise<{ previewPath: string; repoPath: string } | null> => {
    const componentPath = stateHub?.state.currentComponent?.path;
    if (!componentPath) return null;
    syncWorkspaceRuntime();
    const repoRoot = workspaceFolderRoot();
    const absComponent = isAbsolute(componentPath) ? componentPath : join(repoRoot, componentPath);
    const { stale } = await resolveAndRerootToComponent(absComponent);
    if (stale) return null;
    return {
      previewPath: relative(activeWorkspaceRoot, absComponent),
      repoPath: relative(repoRoot, absComponent),
    };
  };

  // Hyper: Preview as App — render the active entry root AS AN APP (its own router +
  // providers) and show the address bar. Registered here (not in registerCommands) because
  // it closes over previewManager/activeWorkspaceRoot/the reroot helpers, which live in
  // this activate() scope and are reassigned on a monorepo sub-project switch.
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.previewAsApp', async () => {
      const target = await resolveAppEntryTarget();
      if (!target) {
        void vscode.window.showWarningMessage('HyperIDE: select a component first to preview it as an app.');
        return;
      }
      // Gate to real app entries: only a detected SPA root or a router/provider shell can be
      // previewed as an app. Block leaf components so they can't be rendered raw (which would
      // bypass their sample/fallback props).
      const isCandidate = await previewManager.isAppEntryCandidate(target.previewPath).catch(() => false);
      if (!isCandidate) {
        void vscode.window.showWarningMessage(
          'HyperIDE: this file is not an app entry (no router/provider root). Open your App.tsx / routed root to preview as an app.',
        );
        return;
      }
      try {
        // activateAppModeForEntry rolls its own entry back on failure (guarded so it never
        // clears a newer activation), so no clearActiveAppMode() is needed here.
        await activateAppModeForEntry(target.previewPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`HyperIDE: failed to preview as app: ${msg}`);
      }
    }),
  );

  /**
   * Make the dev-server start path monorepo-aware for the start-BEFORE-select gap
   * (HYP-431). The designed flow re-roots the preview/dev axis on component select
   * (resolveAndRerootToComponent). But if a monorepo is opened at the repo ROOT and
   * the dev server is started — or autostart fires — before any component is picked,
   * the active root is still the repo root, which usually has no runnable dev/start
   * script (only a target does), so start() fails with "No dev or start script".
   *
   * Resolve a runnable sub-project target and re-root to it so start() launches the
   * right dev server:
   *   - active root already runnable (post-select, or single-package) → no-op.
   *   - exactly one runnable target → re-root to it (same end-state as selecting a
   *     component in that target, so the designed flow stays consistent).
   *   - multiple runnable targets → DEFER: do not guess which app to boot. The
   *     caller surfaces an actionable message (manual) or skips (autostart).
   *   - no runnable target → no-op; the existing "No dev or start script" error
   *     from start() stands.
   *
   * Returns 'ready' when start may proceed, or 'ambiguous' with the candidate
   * target paths when the caller must defer and ask the user to choose.
   */
  const prepareDevServerTarget = async (): Promise<{ kind: 'ready' } | { kind: 'ambiguous'; targets: string[] }> => {
    // Already rooted at a runnable project (a component was selected, or this is a
    // single-package project) — nothing to resolve. This early-return also keeps the
    // sub-project scan below from ever running for ordinary single-package projects.
    const activeScripts = await getPackageScripts(activeWorkspaceRoot);
    if (activeScripts.dev || activeScripts.start) return { kind: 'ready' };

    // The active root has no runnable script. Scan the conventional workspace dirs for
    // sub-projects that do. We don't gate on detectRepoType here on purpose: it only
    // recognizes array-form `workspaces` (missing the object form `{ packages: [...] }`)
    // and is shared general code — scanning five dirs is cheap and works for every
    // monorepo layout. Empty result ≡ not a (runnable) monorepo → let start()'s error stand.
    const repoRoot = workspaceFolderRoot();
    const targets = await resolveRunnableTargets(repoRoot);
    if (targets.length === 1) {
      // Await the reroot — setProjectPath stops the old server then swaps _projectPath;
      // the caller starts immediately after, so it must not race the path switch.
      await rerootPreviewPipeline(targets[0]);
      return { kind: 'ready' };
    }
    if (targets.length > 1) {
      return { kind: 'ambiguous', targets };
    }
    return { kind: 'ready' }; // no runnable target — existing "No dev or start script" error stands
  };

  // Expose the prep + reroot to the hypercanvas.startDevServer command, which lives
  // in registerCommands (a sibling function without access to these closures).
  prepareDevServerTargetRef = prepareDevServerTarget;
  rerootDevServerTargetRef = (target: string) => rerootPreviewPipeline(target);
  // Both refs are reset in deactivate() so a re-activation in the same host doesn't
  // keep a stale closure over the previous activate()'s state.

  context.subscriptions.push({
    dispose: () => {
      modeManager.stopWatching();
      for (const d of entryWatcherDisposables) d.dispose();
    },
  });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => syncWorkspaceRuntime()));

  // Activate a newly created SampleDefault. Single handler (HYP-548): an earlier
  // duplicate registration force-regenerated the preview but then clobbered the
  // monorepo prefix via a single-arg setComponentParam — both fired on the same
  // event and raced. Consolidated here with the correct repo-relative two-arg call.
  previewPanel.onSampleCreated(async (componentPath) => {
    syncWorkspaceRuntime();
    // componentPath comes from the repo-rooted previewPanel → repo-relative. previewManager
    // is rooted at the active sub-project, so re-derive the sub-project-relative path.
    const repoRoot = workspaceFolderRoot();
    const absComponentPath = isAbsolute(componentPath) ? componentPath : join(repoRoot, componentPath);
    const repoRelativePath = relative(repoRoot, absComponentPath);
    const relativePath = relative(activeWorkspaceRoot, absComponentPath);
    // No isUiPrimitive guard here: onSampleCreated fires only after SampleDefault is written,
    // meaning the primitive is now previewable and must be registered in __canvas_preview__.tsx.
    // Force-regen (not ensureComponent): the component source was just mutated in place, so the
    // preview file must be rewritten bypassing the fast-path that would skip re-reading it.
    await previewManager.forceRefreshComponent(relativePath);
    await devServerManager?.awaitRecompile();
    previewPanel?.setComponentParam(repoRelativePath, relativePath);
    previewPanel?.refresh();
  });

  // Switch the preview back to App Shell (full-app) by deleting the isolation wrapper.
  // The FSWatch in PreviewModeManager picks up the deletion → onWrapperDeleted() →
  // setIsolatedMode(false). resetPreviewToAppShell (a pure, unit-tested helper) is the
  // single source of truth for the component-only → full-app transition — shared by the
  // automatic scope handler and the command-palette "Reset Preview to App Shell" command.
  const resetActivePreviewToAppShell = (): Promise<boolean> =>
    resetPreviewToAppShell(vsCodeIO, join(syncWorkspaceRuntime(), '.hyperide/preview.tsx'));

  // Handle scope changes from the automatic paths (chrome-detected "Generate wrapper"
  // prompt, HYP-487 provider-error recovery): write or delete .hyperide/preview.tsx.
  // The manual toolbar toggle was removed (the choice is automatic now); the forward
  // direction is automatic and the reverse direction is the command below.
  previewPanel.setScopeChangeHandler(async (scope) => {
    if (scope === 'component-only') {
      // Generate + write .hyperide/preview.tsx (unless one already exists —
      // the user may have written it manually). On success the FSWatch in
      // PreviewModeManager picks the file up → onWrapperCreated → setIsolatedMode(true).
      // The no-AI-key fallback message lives inside ensureIsolationWrapper so this
      // path and the HYP-487 auto-recovery path stay consistent.
      await ensureIsolationWrapper(syncWorkspaceRuntime(), context);
    } else {
      await resetActivePreviewToAppShell();
    }
  });

  // Command-palette-only escape hatch back to full-app for users who landed in isolated
  // mode (via the "Generate wrapper" prompt or provider-error auto-recovery) and want out
  // without hand-deleting .hyperide/preview.tsx. Deliberately NOT a visible button or a
  // context menu — the app-vs-isolated choice is automatic; this is the discoverable undo.
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.resetPreviewToAppShell', async () => {
      try {
        const existed = await resetActivePreviewToAppShell();
        void vscode.window.showInformationMessage(
          existed
            ? 'HyperIDE: preview reset to the full app shell.'
            : 'HyperIDE: preview is already in app-shell mode (no isolation wrapper to remove).',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`HyperIDE: failed to reset preview: ${msg}`);
      }
    }),
  );

  // AI-powered sample generator (uses extension's API key config)
  const sampleGenerator = createExtensionSampleGenerator(context);

  // Auto-inject UUIDs and parse component structure when currentComponent changes.
  // Serial queue prevents race conditions on rapid component switching:
  // each new switch cancels the previous ensureSample/ensureComponent chain.
  let previewAbortController: AbortController | null = null;

  const unsubStateChange = stateHub.onChange((_state, patch) => {
    if (patch.currentComponent?.path) {
      // Re-root the pipeline to the monorepo sub-project that owns this component
      // before computing any paths (HYP-420). The component path from the Explorer
      // is relative to the VS Code workspace folder (repo root); resolve the abs
      // path against the repo root, then re-root so the dev server / entry patch /
      // __canvas_preview__ run inside the sub-project. For single-package projects
      // this resolves back to the workspace root — a no-op.
      const componentPath = patch.currentComponent.path;
      const repoRoot = workspaceFolderRoot();
      const absSelectedComponent = isAbsolute(componentPath) ? componentPath : join(repoRoot, componentPath);
      void resolveAndRerootToComponent(absSelectedComponent).then(({ root: currentWorkspaceRoot, stale }) => {
        // The reroot awaits async filesystem checks, so a newer selection may have
        // landed meanwhile. When stale (a newer selection superseded this one),
        // the helper already skipped the pipeline reroot — drop the callback too.
        if (stale) return;
        // Also drop if the current component changed via a non-selection path that
        // never re-invoked the reroot helper (e.g. a workspace switch clearing
        // currentComponent → null), so we don't reopen / navigate to the old file.
        if (stateHub?.state.currentComponent?.path !== componentPath) return;
        handleComponentSelected(patch, absSelectedComponent, currentWorkspaceRoot);
      });
    }
  });

  function handleComponentSelected(
    patch: Partial<SharedEditorState>,
    absSelectedComponent: string,
    currentWorkspaceRoot: string,
  ): void {
    const componentPath = patch.currentComponent?.path ?? absSelectedComponent;
    // Boundary validation (HYP-459): the StateHub bus is open — an external
    // sender (SaaS bridge, MCP, RightPanelProvider component:open, a future
    // client, a raw state patch) may carry a raw filename like `Foo.tsx` in
    // `name`. Re-derive the identifier from the file-path source of truth when
    // `name` looks like a filename, rather than trusting it verbatim.
    // normalizeSampleComponentName stays as defense-in-depth.
    const componentName = resolveComponentIdentifier(patch.currentComponent?.name ?? '', componentPath);
    const sampleComponentName = normalizeSampleComponentName(componentName);

    // Auto-open Preview Panel if not already visible.
    // ViewColumn.Two (not Beside): in single-column E2E setups, ViewColumn.Beside
    // resolves to column 2 which doesn't exist yet — VS Code places the webview
    // off-screen. ViewColumn.Two forces a visible split in any layout.
    previewPanel?.createOrShow(vscode.ViewColumn.Two);

    // Open the component file in the left editor group (ViewColumn.One)
    // so the user can see the code alongside the preview.
    // Uses preview mode (italic tab) — consistent with single-click Explorer UX.
    const absPath = absSelectedComponent;
    // .then(onFulfilled, onRejected) only catches openTextDocument's rejection.
    // showTextDocument can also reject (disposed editor / workspace switch /
    // race with another panel closing all editors), and that rejection
    // becomes an unhandled promise rejection which VS Code surfaces as a
    // ".error" notification toast containing "Unhandled rejection ..." —
    // tripping every preview-render "renders without errors" assertion that
    // greps for /fatal|crash|unhandled/i. Use a trailing .then().catch()
    // chain so both stages funnel into the same handler.
    vscode.workspace
      .openTextDocument(vscode.Uri.file(absPath))
      .then((doc) =>
        vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: true,
          preview: true,
        }),
      )
      .then(undefined, (err) => {
        console.error('[HyperIDE] Failed to open component file:', err);
      });

    // Parse component structure
    const capturedComponentPath = componentPath;
    panelRouter?.componentService
      .parseStructure(capturedComponentPath)
      .then((structure) => {
        if (stateHub?.state.currentComponent?.path === capturedComponentPath) {
          stateHub.applyUpdate({ astStructure: structure });
        }
      })
      .catch((err) => {
        console.error('[HyperIDE] Failed to inject UUIDs / parse structure:', err);
      });

    // Cancel previous ensureSample/ensureComponent chain
    previewAbortController?.abort();
    const ac = new AbortController();
    previewAbortController = ac;
    componentMissingRetries.clear();
    providerErrorAttempts.clear();
    // Clear any standing non-previewable-file overlay: a fresh selection supersedes it.
    // If THIS selection is also non-previewable, onComponentMissing re-posts it.
    previewPanel?.notifyNonPreviewableFile(null);
    // A genuine component switch always exits app-mode: the address bar belongs to the
    // previewed app entry, not to an ordinary component. Disable the previous entry on
    // its owning manager and hide the bar before the normal component-preview pipeline
    // runs (which rebuilds without the isAppEntry flag and posts a plain ?component= URL).
    clearActiveAppMode();

    // Two roots coexist (HYP-420):
    //  - relativePath: relative to the active sub-project root → drives previewManager
    //    (the __canvas_preview__ registry key) and the iframe ?component= URL.
    //  - repoRelativePath: relative to the repo root → the component identity for the
    //    repo-rooted astBridge / componentService and the panel's _currentComponent.
    // For single-package projects the two roots coincide and the paths are equal.
    const absComponentPath = absSelectedComponent;
    const relativePath = relative(currentWorkspaceRoot, absComponentPath);
    const repoRelativePath = relative(workspaceFolderRoot(), absComponentPath);

    // Cross-package library component (HYP-443): the preview pipeline is re-rooted
    // to a runnable app target, but the selected component lives OUTSIDE that target
    // (a shared library sub-package), so `relativePath` escapes with '..'. This is
    // now a fully renderable, editable case — buildEntry allows in-workspace '..'
    // paths and emits a relative import the target's dev server serves (once
    // server.fs.allow covers the workspace, injected in DevServerManager). The
    // registry key, the iframe ?component= URL and the #210 in-memory prop injection
    // all key on `relativePath`, so the '..' path flows through unchanged. No info
    // screen — clear any stale selection-blocking screen.
    previewPanel?.clearSelectionBlockingScreen();

    // UI primitives (shadcn-style ui/<name>.tsx) must NOT have SampleDefault written
    // into their source — keeping the file pristine matters for users who track shadcn
    // updates, and writing a deterministic scaffold into Carousel/Tabs/etc. would lose
    // exports that don't match the suffix allow-list. Instead, preview-file-manager
    // synthesizes a SampleDefault inline inside __canvas_preview__.tsx via
    // syntheticSampleDefault (Task 2). We still need to register the primitive in the
    // registry so the iframe can find it — call ensureComponent below, but skip the
    // ensureSample mutation and the in-memory prop injection (the synthetic compound
    // scaffold already renders shadcn primitives).
    //
    // No unit test covers the !isPrimitive split here — extension.ts is hard to harness
    // in isolation. The behavior is covered by the project-dependent E2E spec
    // `component-load.spec.ts` (sibling repo `ext-test-projects/e2e/`).
    const isPrimitive = isUiPrimitive(relativePath);

    // Skip AI source-file mutation entirely when the harness disables it.
    // E2E tests set hypercanvas.preview.autoSampleGeneration=false so ensureSample
    // doesn't write SampleDefault into the test project's component files —
    // otherwise `git checkout -- .` between specs drops the export, Vite reports
    // "export removed", forces a full reload, and __canvas_preview__.tsx fails to
    // reload mid-transition. NOTE: this gate is for SOURCE-WRITING only. The
    // feature #210 in-memory prop injection below is NOT gated on it — it never
    // touches the source file, so there is nothing for `git checkout` to revert.
    const autoSampleEnabled = vscode.workspace
      .getConfiguration('hypercanvas.preview')
      .get<boolean>('autoSampleGeneration', true);

    const ensureSamplePromise =
      autoSampleEnabled && !isPrimitive
        ? ensureSample({
            io: vsCodeIO,
            absolutePath: absComponentPath,
            componentName: sampleComponentName,
            sampleName: 'SampleDefault',
            generate: sampleGenerator,
          })
        : Promise.resolve({ generated: false, exists: false });

    ensureSamplePromise
      .then(async (sampleResult) => {
        if (ac.signal.aborted) return;
        // Feature #210 — "try first, then ask" via IN-MEMORY generated props.
        // Skip UI primitives (synthetic compound scaffold already renders them and
        // spreading event-like fallback props into them triggers React warnings).
        // Unlike the old source-mutation path, this is NOT gated on
        // autoSampleGeneration — generated values are injected at render through the
        // preview bridge and never written to disk, so they survive `git checkout`
        // between E2E specs. Posting happens BEFORE ensureComponent (which writes the
        // preview file and triggers the iframe render) so the webview global is set
        // when the component first renders.
        if (!isPrimitive) {
          // componentService is repo-rooted → parse the prop schema with the
          // repo-relative componentPath. The iframe keys generated props by the
          // sub-project-relative path (HYP-420) — the same value that lands in the
          // `?component=` URL and the preview registry — so pass relativePath as the
          // previewKey; keying by componentPath would make the iframe lookup miss.
          const props = await panelRouter?.componentService.getComponentDefinitions(componentPath);
          if (previewPanel && shouldInjectGeneratedProps(sampleResult, props)) {
            await previewPanel.injectGeneratedSampleProps(componentPath, relativePath);
          }
        }
        // 2. Ensure component is registered in __canvas_preview__.tsx (deterministic).
        // For UI primitives this is what bakes the syntheticSampleDefault into the registry.
        return previewManager.ensureComponent([relativePath]);
      })
      .then(async () => {
        if (ac.signal.aborted) return 'aborted' as const;
        // 3. Ensure route files + handle mode transitions (App Shell / Isolated)
        const result = await modeManager.onComponentSelected();
        if (result === 'unsupported') {
          // No toast (HYP-442): surface the framework-compatibility screen in the
          // preview panel instead — it's the authoritative, non-redundant place to
          // explain which frameworks HyperIDE supports. The compatibility table
          // lives in the webview (UnsupportedFrameworkScreen) and reads the same
          // shared FRAMEWORK_SUPPORT list (Astro included via shared/framework-support.ts).
          previewPanel?.notifyUnsupportedProject({
            type: 'framework',
            message: 'HyperIDE could not detect a supported framework in this project.',
          });
          return 'unsupported' as const;
        }
        // A non-unsupported outcome means a supported framework was resolved — clear
        // any stale selection-blocking screen left over from a previous selection.
        previewPanel?.clearSelectionBlockingScreen();
        if (result === 'needs-patch') {
          void vscode.window
            .showWarningMessage(
              'HyperIDE: could not find a router or entry file to mount the /test-preview route. ' +
                'Add the route manually or let AI do it.',
              'Auto fix',
              'Dismiss',
            )
            .then(async (choice) => {
              if (choice === 'Auto fix') {
                const prompt = await buildNeedsPatchPrompt(currentWorkspaceRoot, vsCodeIO);
                aiChatProvider?.sendAIPrompt(prompt);
              }
            });
          return 'needs-patch' as const;
        }
        return result;
      })
      .then(async (result) => {
        if (ac.signal.aborted || result === 'aborted' || result === 'unsupported' || result === 'needs-patch') return;
        // 4. If webpack armed the recompile gate (via onBeforeWebpackEntryPatch),
        // wait for the post-patch `compiled successfully` so the iframe doesn't
        // race a half-built bundle. No-op for vite/remix/next.
        await devServerManager?.awaitRecompile();
        if (ac.signal.aborted) return;
        // 5. Update iframe component URL param — ALWAYS, even on the app-mode path.
        // setComponentParam writes _componentState (repoPath + previewPath + sub-project
        // prefix); app-mode's _updatePreviewUrl reads previewPath and appends `&app=1`
        // only when _appModeEntryPreviewPath matches it. Skipping this for the app path
        // would leave the iframe on the PREVIOUS component's URL with no `&app=1` match.
        // _currentComponent stays repo-relative (astBridge identity); the iframe URL uses
        // the sub-project-relative path (the dev server's preview registry key).
        previewPanel?.setComponentParam(repoRelativePath, relativePath);
        if (ac.signal.aborted) return;
        // 6. Auto-app-mode: if the selected file is a full app-entry wrapper (owns a
        // pushState router), ALSO render it AS AN APP — the address bar + the app's own
        // router, no manual toggle. activateAppModeForEntry rebuilds with isAppEntry and
        // reloads the iframe with `&app=1` for the now-current component. A normal
        // component is left in component-mode by the setComponentParam above.
        //
        // The stale guard checks BOTH the abort signal AND the live selected component path.
        // `ac` is only aborted once the NEXT selection's handleComponentSelected runs, which is
        // gated behind its async reroot — so during that gap `ac.signal.aborted` is still false.
        // The StateHub's currentComponent path flips synchronously on selection (the reroot is
        // downstream), so comparing it to this activation's captured path catches a newer
        // selection that landed during the reroot gap and stops A from committing for the old
        // component (final review P1).
        const isAutoAppModeStale = (): boolean =>
          ac.signal.aborted || stateHub?.state.currentComponent?.path !== componentPath;
        await autoEnterAppModeIfCandidate(relativePath, isAutoAppModeStale);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        // A panel torn down mid-chain (workspace switch / tab close / E2E teardown between
        // specs) is a benign webview-lifecycle race, not a real failure: the per-call posters
        // already swallow it and drop the stale panel. Defense-in-depth so any future
        // ensure-chain step that reads a disposed webview can't bleed `Webview is disposed`
        // into the console (and the E2E capture window). Real errors still surface (#72).
        if (isWebviewDisposedError(err)) return;
        console.error('[HyperIDE] Failed to ensure sample/preview:', err);
      });
  }
  context.subscriptions.push({ dispose: unsubStateChange });

  // Auto-reveal Inspector when component insertion UI opens
  const unsubInsertReveal = stateHub.onChange((_state, patch) => {
    if (patch.insertTargetId) {
      vscode.commands.executeCommand('hypercanvas.inspectorView.focus');
    }
  });
  context.subscriptions.push({ dispose: unsubInsertReveal });

  // Register Left Panel (Activity Bar explorer)
  leftPanelProvider = new LeftPanelProvider(context.extensionUri, stateHub, panelRouter);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(LeftPanelProvider.viewType, leftPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register Right Panel (Inspector) — receives leftPanelProvider for component list fallback
  const pr = panelRouter;
  rightPanelProvider = new RightPanelProvider(context.extensionUri, stateHub, panelRouter, leftPanelProvider, () =>
    pr.getComponentGroups(),
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RightPanelProvider.viewType, rightPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands
  registerCommands(context, workspaceRoot, {
    previewPanel,
    devServerManager,
    diagnosticHub,
    aiChatProvider,
    rightPanelProvider,
    leftPanelProvider,
    logsProvider,
    stateHub,
    panelRouter,
    mcpServer,
    prepareDevServerTargetRef,
    rerootDevServerTargetRef,
    getWorkspaceRoot,
  });

  // --- MCP Server for AI Agents ---
  mcpServer = setupMcpServer(context, panelRouter, stateHub, diagnosticHub, workspaceRoot, previewPanel);

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(eye) Hyper Canvas';
  statusBarItem.tooltip = 'Open HyperCanvas Preview';
  statusBarItem.command = 'hypercanvas.openPreview';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Auto-start dev server if configured
  const autoStart = vscode.workspace.getConfiguration('hypercanvas.devServer').get<boolean>('autoStart', false);

  if (autoStart) {
    // Monorepo-aware autostart (HYP-431): resolve a runnable sub-project target
    // before launching. At the repo root of a monorepo there is usually no dev/start
    // script, so a naive .start() would fail before any component is selected.
    prepareDevServerTarget()
      .then((prep) => {
        if (prep.kind === 'ambiguous') {
          // Don't guess which app to boot on autostart — surface an actionable prompt
          // instead of silently dropping the request. The "Select project" button runs
          // the start command, which shows a QuickPick of the runnable targets. Picking
          // a component also works (the active root becomes runnable on select).
          vscode.window
            .showInformationMessage(
              `HyperIDE: ${prep.targets.length} runnable projects found in this monorepo. Choose which dev server to start.`,
              'Select project',
            )
            .then((choice) => {
              if (choice === 'Select project') vscode.commands.executeCommand('hypercanvas.startDevServer');
            });
          return;
        }
        return devServerManager?.start().then((state) => {
          if (state?.status === 'running' && state.url) {
            previewPanel?.setPreviewUrl(state.url);
          }
        });
      })
      .catch((err) => {
        // Without this catch, devServerManager.start() rejecting (port in use,
        // failed package-manager detection, missing scripts) becomes an
        // unhandled rejection that VS Code surfaces as ".error" toast
        // ("Unhandled rejection ..."), tripping every test that asserts no
        // /fatal|crash|unhandled/i in the error toast list.
        console.error('[HyperIDE] Auto-start dev server failed:', err);
      });
  }

  console.log('[HyperIDE] Extension activated successfully');
}

export async function deactivate() {
  console.log('[HyperIDE] Extension deactivating...');

  // Flush deferred .hyperide writes before teardown
  if (panelRouter) {
    await panelRouter.flushStructureStore().catch((err) => {
      console.error('[HyperIDE] Failed to flush structure store on deactivate:', err);
    });
  }

  // Stop dev server if running
  if (devServerManager) {
    devServerManager.dispose();
    devServerManager = null;
  }

  // Drop the start-before-select closures (HYP-431) so a re-activation in the same
  // host doesn't keep a stale closure over the previous activate()'s state.
  prepareDevServerTargetRef = null;
  rerootDevServerTargetRef = null;

  if (mcpServer) {
    mcpServer.dispose();
    mcpServer = null;
  }

  if (panelRouter) {
    panelRouter.dispose();
    panelRouter = null;
  }

  if (diagnosticHub) {
    diagnosticHub.dispose();
    diagnosticHub = null;
  }

  // Reset diagnostic capture state so re-activation in the same process starts clean.
  // Also restore the env var to avoid a stale sink path surviving deactivation.
  if (_diagnosticCaptureActive) {
    if (_prevDiagnosticSinkPath !== undefined) {
      process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = _prevDiagnosticSinkPath;
    } else {
      delete process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
    }
  }
  _diagnosticCaptureActive = false;
  _prevDiagnosticSinkPath = undefined;
  diagnosticsChannel = null;

  if (stateHub) {
    stateHub.dispose();
    stateHub = null;
  }

  console.log('[HyperIDE] Extension deactivated');
}

/**
 * Get workspace root folder
 */
function getWorkspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return null;
  }
  return folders[0].uri.fsPath;
}

/**
 * Register all commands
 */
