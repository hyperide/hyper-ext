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
import { shouldRetryWithAppWrapper } from '@shared/components/preview-chrome/app-mode-fallback';
import * as vscode from 'vscode';
import { runAppModeActivation } from './webview-preview-panel/app-mode-activation';
import { resetPreviewToAppShell } from './webview-preview-panel/reset-to-app-shell';
import { createLivenessGuard, runGuardedStartupSweep } from './startup-sweep';
import { AIChatPanelProvider } from './AIChatPanelProvider';
import { DiagnosticHub } from './DiagnosticHub';
import {
  createSequencedReroot,
  isActivationStale,
  isFailureSignalForCurrentSelection,
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
import { PostEditDiagnosticWatcher } from './services/PostEditDiagnosticWatcher';
import {
  AUTO_FIX_ACTION,
  buildPostEditAiFixPrompt,
  buildPostEditNotificationMessage,
} from './services/post-edit-diagnostic-notify';
import { buildNonPreviewablePayload, flattenComponentTree } from './preview-panel-non-previewable';
import { normalizeSampleComponentName, PreviewPanel } from './PreviewPanel';
import { isWebviewDisposedError } from './webview-post';
import { RightPanelProvider } from './RightPanelProvider';
import { StateHub } from './StateHub';
import { DevServerManager } from './services/DevServerManager';
import { extractDesignTokens } from './services/DesignTokensService';
import { getPrimitiveRenderableSampleInfo, shouldInjectGeneratedPropsForSelection } from './services/no-props-sample';
import {
  computeCapabilities,
  detectCssSystem,
  detectPackageManager,
  detectProjectType,
  detectRepoType,
  detectUIKit,
  detectUnsupportedProject,
  getPackageScripts,
  readPackageJson,
  resolveRunnableTargets,
} from './services/ProjectDetector';
import { computeSupportDimensionsForRoot, gatherSupportDimensions } from './services/support-dimensions-detect';
import { uiKitToDefaultCssSystem } from '@lib/style-write/ui-kit-default-system';
import { createExtensionSampleGenerator } from './services/SampleAIGenerator';
import { ensureIsolationWrapper } from './services/WrapperGenerator';
import { VSCodeFileIO } from './vscode-file-io';
import { detectPreviewProviders, detectSSRMockConfig } from './extension-provider-detection';
import { applyTamaguiPalette } from './extension-tamagui';
import { registerCommands } from './extension-commands';
import { setupMcpServer } from './extension-mcp-setup';
import { TelemetryService } from './telemetry/TelemetryService';
import { SessionTelemetry } from './telemetry/sessionTelemetry';
import { TelemetryEvents, categorizeErrorMessage } from './telemetry/events';
import { showFirstRunNoticeOnce } from './telemetry/firstRunNotice';

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
// Telemetry (greenfield). Constructed in activate(); no-ops cleanly when keys
// are absent or telemetry is disabled. `session` holds per-session counters,
// heartbeat, and the dissatisfaction heuristics.
let telemetry: TelemetryService | null = null;
let session: SessionTelemetry | null = null;
// Monorepo-aware dev-server start prep (HYP-431). Set by activate() so the
// hypercanvas.startDevServer command (registered in registerCommands, a sibling
// function with no access to activate()'s reroot closures) can resolve a runnable
// sub-project target before launching, and re-root the preview/dev axis to a chosen
// one. Returns 'ready' to proceed, or 'ambiguous' + candidate paths to let the user
// pick. rerootToTarget re-roots to the user's choice after a QuickPick.
let prepareDevServerTargetRef: (() => Promise<{ kind: 'ready' } | { kind: 'ambiguous'; targets: string[] }>) | null =
  null;
let rerootDevServerTargetRef: ((target: string) => Promise<void>) | null = null;
// The live PreviewModeManager, exposed at module scope so deactivate() can best-effort
// revert any @hyperide-managed injection it left in the target app's own source before
// the host tears down (HYP-945). Updated on activation and every workspace reroot.
let activeModeManagerRef: PreviewModeManager | null = null;
// Set at the top of deactivate() so the git-discard re-patch watcher's debounced callback
// does NOT re-inject after deactivate()'s revert has cleaned the target source — the
// watcher's write would otherwise race the shutdown revert and re-dirty the tree (HYP-945).
// Reset on activate() so a re-activation in the same host starts clean.
let isDeactivating = false;
let _prevDiagnosticSinkPath: string | undefined;
let _diagnosticCaptureActive = false;

export function activate(context: vscode.ExtensionContext) {
  const activationStartedAt = Date.now();
  console.log('[HyperIDE] Extension activating...');
  isDeactivating = false; // reset for a re-activation in the same host (HYP-945)

  // Telemetry seam. Constructs safely with NO keys and stays inert when
  // telemetry is disabled — must never throw or block activation.
  try {
    telemetry = new TelemetryService(context);
    session = new SessionTelemetry(telemetry, context);
    // Only surface the privacy notice once telemetry is actually live (enabled AND
    // a backend key is configured). While the feature ships inert (no keys) it
    // sends nothing, so claiming "we collect telemetry" would be inaccurate.
    if (telemetry.isEnabled() && telemetry.hasActiveBackend()) {
      void showFirstRunNoticeOnce(context);
    }
  } catch (err) {
    console.error('[HyperIDE] Telemetry init failed (continuing without it):', err);
    telemetry = null;
    session = null;
  }

  // Telemetry: track VS Code color-theme changes (kind only — no theme name).
  if (telemetry) {
    const tel = telemetry;
    context.subscriptions.push(
      vscode.window.onDidChangeActiveColorTheme((theme) => {
        const kind =
          theme.kind === vscode.ColorThemeKind.Dark
            ? 'dark'
            : theme.kind === vscode.ColorThemeKind.Light
              ? 'light'
              : 'highContrast';
        tel.track(TelemetryEvents.themeChanged, { kind });
      }),
    );
  }

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
    // Telemetry: scrubbed counts only. The stack is hashed (never sent raw); the
    // error NAME is a safe enum-ish token. isForeign is already false here
    // (foreign errors returned above), so we only see our own host errors.
    try {
      session?.incError();
      const errName = reason instanceof Error ? reason.name : 'NonError';
      const stack = reason instanceof Error && reason.stack ? reason.stack : label;
      telemetry?.track(TelemetryEvents.errorUnhandled, {
        kind,
        errorName: errName,
        scrubbedStackHash: telemetry.hash(stack),
        isForeign: false,
      });
      telemetry?.trackError(reason, { where: 'preview', severity: kind === 'uncaughtException' ? 'fatal' : 'error' });
    } catch {
      // telemetry must never affect diagnostics
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
            // HYP-943: an entry later proven to be the expected-transient /test-preview
            // router 404 (retracted from Hyper Logs on preview:renderSucceeded). The sink
            // is append-only, so the retraction is a compensating record — subtract it to
            // keep the reported total in step with what the user actually sees.
            else if (entry.kind === 'diagnosticRetraction') diagnosticEntries = Math.max(0, diagnosticEntries - 1);
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
  // HYP-991 — post-edit diagnostic watcher: after any AST mutation commits, it diffs language-
  // server error diagnostics. `broadcast` drives the on-canvas element highlight; `notifyError`
  // raises a STANDARD platform notification (native warning toast + "Auto fix via AI"), per the
  // CTO UX directive that the message be a native notification, not a custom banner.
  const postEditDiagnosticWatcher = new PostEditDiagnosticWatcher({
    broadcast: (message) => stateHub?.broadcast(message),
    notifyError: (warning) => {
      void vscode.window
        .showWarningMessage(buildPostEditNotificationMessage(warning), AUTO_FIX_ACTION)
        .then((choice) => {
          // aiChatProvider is created just below; this callback only runs after a later edit.
          if (choice === AUTO_FIX_ACTION) aiChatProvider?.sendAIPrompt(buildPostEditAiFixPrompt(warning));
        });
    },
  });
  context.subscriptions.push({ dispose: () => postEditDiagnosticWatcher.dispose() });
  panelRouter = new PanelRouter({
    workspaceRoot,
    stateHub,
    context,
    postEditDiagnosticWatcher,
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

  // HYP-901: write-verify RPC. When a style-write candidate targets a custom component that
  // doesn't forward style/className, the auto-wrap retry candidate uses this to confirm it
  // actually changed something visible before keeping it — the same no-circular-dep wiring as
  // the two providers above. Resolves null → the candidate is kept best-effort, unverified.
  panelRouter.setVerifyComputedStyleProvider(
    (elementId, cssProperties) =>
      previewPanel?.requestComputedStyleSnapshot(elementId, cssProperties) ?? Promise.resolve(null),
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

  // Guards session.activated to a single emit (detection may run more than once).
  let sessionActivatedEmitted = false;
  let detectionSeq = 0;
  // Topology of the last-detected workspace root. The HYP-788 selection hook reads it to
  // decide whether to recompute support dimensions per sub-repo (monorepo) or leave the
  // activation-time pass authoritative (simple repo).
  let workspaceRepoIsSimple = true;
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

        workspaceRepoIsSimple = repoType === 'simple';
        stateHub?.applyUpdate({ projectUIKit: kit });

        const capabilities = computeCapabilities(cssSystem, kit, projectError, projectType, repoType);

        // HYP-788: per-(sub-)repo support breakdown for the dimension tabs. For a SIMPLE
        // repo the workspace root IS the project, so compute it here. For a monorepo the
        // root is not a renderable project (it would mis-classify as "No React components
        // found") — the active sub-repo's dimensions are computed on component selection
        // (refreshSupportDimensions) instead, so leave them absent until then.
        if (repoType === 'simple') {
          const packageManager = await detectPackageManager(root);
          capabilities.supportDimensions = await gatherSupportDimensions(root, pkg, {
            projectType,
            projectError,
            packageManager,
          });
          // Re-check freshness AFTER the added async gather: a newer detection (folder
          // change) may have started while we scanned, and must not be clobbered by this
          // stale run's post (codex P2).
          if (seq !== detectionSeq) return;
        }
        console.log('[HyperIDE] Project capabilities:', JSON.stringify(capabilities));

        // Send capabilities to preview panel (readonly badge, style write guard)
        previewPanel?.notifyCapabilities(capabilities);

        // Send capabilities to inspector panel (readonly inputs)
        rightPanelProvider?.notifyCapabilities(capabilities);

        // Thread the UIKit-derived project default into the write path so a SURFACELESS element (no
        // existing className/style) floors to the project system under Auto/Computed routing instead
        // of a silent inline `style={{}}` (D2 §4.3). On a Tailwind project the edit lands as a Tailwind
        // class — parity with the SaaS batch route, which already carries this from the inspector UIKit.
        //
        // SIMPLE-repo GATE (HYP-983 review, codex P1): `detectUIKit` reads only the workspace-root
        // package.json, but one repo-rooted AstService serves EVERY member of a monorepo. Flooring to
        // the root UIKit would force e.g. Tailwind classes onto a plain-CSS/Tamagui member (wrong
        // system). Only thread the default when the workspace root IS the app (repoType==='simple' —
        // conloca opens at targets/conloca-app, a simple leaf). For a monorepo the default stays UNSET
        // → surfaceless edits floor to inline (safe), pending per-target monorepo-aware detection
        // (HYP-985).
        panelRouter?.setProjectDefaultCssSystem(
          repoType === 'simple' ? uiKitToDefaultCssSystem(capabilities.uiKit) : undefined,
        );

        // Scan project CSS/SCSS for design tokens shown in the Inspector empty state.
        // Errors are swallowed so a scan failure never blocks the capabilities path.
        try {
          const designTokens = extractDesignTokens(root);
          rightPanelProvider?.notifyDesignTokens(designTokens);
        } catch (err) {
          console.warn('[HyperIDE] Design token scan failed:', err);
        }

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

        // Telemetry: emit session.activated once, now that the project shape is
        // known. Only enums/booleans/counts — no paths or names.
        if (session && !sessionActivatedEmitted) {
          sessionActivatedEmitted = true;
          session.start({
            activationReason: 'onStartupFinished',
            vscodeVersion: vscode.version,
            coldStartMs: Date.now() - activationStartedAt,
            hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
            projectType: projectType ?? 'unknown',
            cssSystem: cssSystem ?? 'unknown',
            uiKit: kit ?? 'unknown',
          });
        }
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

  // Telemetry: feed the AI chat provider a combined sink (host track +
  // webview-origin forward + AI-request counting from the session).
  if (telemetry && session) {
    const tel = telemetry;
    const ses = session;
    aiChatProvider.setTelemetry({
      track: (name, props) => tel.track(name, props),
      trackFromWebview: (name, props) => tel.trackFromWebview(name, props),
      incAiRequest: () => ses.incAiRequest(),
    });
  }

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

  // Telemetry: timestamp of the most recent dev-server 'starting' status, used to
  // compute startupMs when it reaches 'running'.
  let devServerStartingAt: number | null = null;

  // Render-failure app-mode fallback: components for which we already retried a FAILED
  // component-mode render inside the full-app wrapper (componentMissing / non-provider
  // componentError on an app-entry candidate). Once-per-selection latch — if the WRAPPED
  // render also fails the signal re-fires, but this set short-circuits a second retry so the
  // real error surfaces instead of looping. Keyed by the iframe-reported component path.
  // Cleared on component switch (same lifecycle as the two above) so a switch-away-and-back retries.
  const appModeRetryAttempts = new Set<string>();

  // Short-lived in-flight marker for the app-mode candidacy check (the gap between a render-failure
  // signal and its async `isAppEntryCandidate(...)` verdict), mirroring the SaaS hook's
  // `candidacyInFlightPathsRef`. Two rapid missing/error signals for the same path before the first
  // candidacy resolves would otherwise race: the first latches appModeRetryAttempts + starts app-mode;
  // the second sees alreadyTriedWrapper=true, the decision returns false, and it falls through to a
  // concurrent selfHealMissingComponent → ensureComponent WHILE app-mode is rebuilding. This set
  // suppresses only DUPLICATE concurrent signals for one path while a check is in flight — it does NOT
  // permanently block self-heal: it is deleted when the check settles (then/catch), so a genuinely
  // stuck component still reaches self-heal on a LATER signal. Keyed by the iframe-reported path,
  // shared across the missing + non-provider-error branches so a missing+error pair for one path
  // doesn't double-fire. Cleared on component switch (same lifecycle as the latches above).
  const appModeCandidacyInFlight = new Set<string>();

  // Monotonic selection generation for the app-mode activation stale guard (P1-3). Bumped on every
  // ACTUAL component path CHANGE (alongside the latch clears) and captured when a render-failure
  // signal fires. The `isStale` closure checks generation mismatch IN ADDITION to path equality so an
  // in-flight activation from a PRIOR occupancy of the same path (A→B→A) can't commit app-mode for the
  // fresh occupancy — the SaaS hook's `selectionTokenRef` token, mirrored on the ext side.
  let selectionGeneration = 0;
  // The last selected component path the generation was bumped for. A same-path `currentComponent`
  // re-emit (panel resurrection, a repeated `component:open`) must NOT bump the generation — doing so
  // would false-invalidate an in-flight app-mode activation for the SAME, unchanged selection.
  let lastSelectionPath: string | undefined;

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

  // Retry app-mode for an app-entry candidate whose component-mode render FAILED (the render-
  // failure fallback that replaced the rejected upfront engage). Shared by onComponentMissing and
  // the non-provider onComponentError branch. `isStale` cancels at every async boundary so a slow
  // rebuild can't clobber a fresher selection; on a rebuild failure it rolls itself back (guarded
  // so it never clears a newer activation) and stays in component-mode with NO error toast — this
  // is an automatic path, not a user-invoked command, so it degrades silently.
  const retryWithAppModeForEntry = async (previewPath: string, isStale: () => boolean): Promise<void> => {
    if (isStale()) return;
    try {
      await activateAppModeForEntry(previewPath, isStale);
    } catch (err) {
      console.error('[HyperIDE] App-mode fallback failed; staying in component-mode:', err);
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

      // Telemetry: map dev-server status to lifecycle events. startupMs is the
      // time from the first 'starting' to 'running'. No URLs/paths emitted.
      try {
        if (state.status === 'starting') {
          devServerStartingAt = Date.now();
          telemetry?.track(TelemetryEvents.devServerStarted, {});
        } else if (state.status === 'running') {
          telemetry?.track(TelemetryEvents.devServerReady, {
            startupMs: devServerStartingAt ? Date.now() - devServerStartingAt : 0,
          });
          devServerStartingAt = null;
        } else if (state.status === 'error') {
          const raw = (state as { error?: unknown }).error;
          const msg = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : '';
          session?.incError();
          telemetry?.track(TelemetryEvents.devServerFailed, {
            errorCategory: categorizeErrorMessage(msg),
            scrubbedMessageHash: telemetry.hash(msg),
          });
          devServerStartingAt = null;
        }
      } catch {
        // telemetry must never affect dev-server status handling
      }
    });

    // Wire runtime errors from preview iframe to dev server manager + diagnostic hub
    previewPanel.onRuntimeError((error) => {
      devServerManager?.setRuntimeError(error ?? null);
      diagnosticHub?.setRuntimeError(error ?? null);

      // Telemetry: a preview runtime error. Categorize, hash the (scrubbed)
      // message, and flag the blank-preview process-not-defined case separately.
      try {
        if (error) {
          const msg = typeof error.message === 'string' ? error.message : String(error);
          const category = categorizeErrorMessage(msg);
          session?.incError();
          telemetry?.track(TelemetryEvents.previewRenderFailed, {
            errorClass: 'runtimeError',
            errorCategory: category,
            scrubbedMessageHash: telemetry.hash(msg),
          });
          if (category === 'process_not_defined') {
            telemetry?.track(TelemetryEvents.previewBlankDetected, {});
          }
        }
      } catch {
        // telemetry must never affect error handling
      }
    });

    // Wire console capture from preview iframe to diagnostic hub
    previewPanel.onConsoleCapture((entries) => {
      diagnosticHub?.handleConsoleCapture(entries);
    });

    // Self-healing: when the generated preview doesn't have the requested component,
    // re-run ensureComponent so the preview file is regenerated with the missing entry.
    // Retry guard prevents an infinite loop if ensureComponent keeps failing.
    // Do NOT skip UI primitives here: parsed primitives are registry entries even when
    // they lack SampleDefault so in-memory generated props can render them. The defensive
    // fallback below is only for entries that still cannot be rebuilt into the registry.
    // Scan the project for renderable component files to recommend when the opened
    // file is not previewable. Empty list on any failure (panelRouter not ready, no
    // workspace) — the overlay then shows the error without suggestions.
    const listRenderableComponents = async (): Promise<ComponentRecommendation[]> => {
      const tree = await panelRouter?.componentService.scanComponents();
      return tree ? flattenComponentTree(tree) : [];
    };

    // Regenerate the preview file so it includes the missing entry, then re-point the iframe.
    // Extracted so onComponentMissing can branch between this and the app-mode fallback without
    // growing past the function-length budget.
    const selfHealMissingComponent = async (componentPath: string, currentWorkspaceRoot: string): Promise<void> => {
      const count = componentMissingRetries.get(componentPath) ?? 0;
      if (count >= 2) return;
      // Bump the guard SYNCHRONOUSLY before any await — the iframe re-fires
      // _ComponentMissingSignal rapidly, and the async classification below must not
      // launch concurrent self-heal storms (mirrors the HYP-487 providerErrorAttempts guard).
      componentMissingRetries.set(componentPath, count + 1);
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
            // Defensive fallback: a parsed UI primitive should normally be in the
            // registry now, with either Component fallback rendering or synthetic
            // SampleDefault. If it is still absent, treat it as an unrecoverable build
            // miss and stop the self-heal loop.
            vscode.window.showInformationMessage(
              `Hyper Canvas: "${relPath}" could not be added to the preview registry — preview not available.`,
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

    // Self-healing: when the generated preview produced no renderable component, EITHER retry it
    // AS A FULL APP (render-failure fallback, for an app-entry root) OR regenerate the preview file
    // with the missing entry (the leaf self-heal).
    //
    // Ordering — app-mode fallback takes PRECEDENCE over the self-heal for an app-entry candidate:
    // an app-entry root is not a leaf with a SampleDefault, so ensureComponent can't make it
    // renderable as a component — it would only spin to the count>=2 cap. So when the decision says
    // retry-as-app we latch + activate and SKIP the self-heal for this fire; otherwise we fall
    // through to the leaf self-heal unchanged.
    //
    // Termination: the app-mode retry happens at most once per selection (appModeRetryAttempts
    // latch). If the WRAPPED render also reports missing, the latch makes the decision false and we
    // fall through to the self-heal, which is itself capped at count>=2 — so the two guards together
    // guarantee no reload/re-ensure loop.
    //
    // Why there is NO separate blank-render probe: a reviewer worried that a canonical App.tsx
    // owning <BrowserRouter> would render BLANK in component mode (no route matches the preview
    // path) yet emit componentRenderSucceeded, so this failure-fallback would never fire. Not
    // reachable: buildEntry (lib/preview-generator/preview-build-entry.ts) excludes router shells
    // from the component-mode registry — `detectRouterShell(sourceCode) && !allowShell → return null`
    // — and detectRouterShell matches the same shapes as detectPushStateRouterShell. So every
    // app-entry candidate rendered in component mode is excluded → the iframe reports componentMissing
    // (not a blank success) → THIS handler's componentMissing→app-mode fallback engages. No DOM probe.
    previewPanel.onComponentMissing((componentPath) => {
      // Telemetry: a render failed because the requested component wasn't in the
      // preview registry. Path is NEVER emitted — only the categorized class.
      try {
        session?.incError();
        telemetry?.track(TelemetryEvents.previewRenderFailed, {
          errorClass: 'componentMissing',
          errorCategory: 'module_missing',
        });
      } catch {
        // telemetry must never affect self-heal
      }
      const currentWorkspaceRoot = syncWorkspaceRuntime();
      const { componentPath: reportedRepoRelPath, previewComponentPath: relPath } = resolveSelfHealComponentParams({
        componentPath,
        activeWorkspaceRoot: currentWorkspaceRoot,
        repoRoot: workspaceFolderRoot(),
      });
      // Capture BEFORE the async candidacy read so a newer selection landing mid-check is detected.
      const capturedCurrentPath = stateHub?.state.currentComponent?.path;
      const capturedGeneration = selectionGeneration;
      // Bind the SIGNAL to the current selection up front: a late failure from the OLD iframe (mid
      // A→B switch) can still pass the panel sender guard. A mismatch ⇒ stale signal — it belongs to
      // a previous occupancy, so DO NOTHING: neither app-mode (wrong selection never failed) nor the
      // leaf self-heal (it would only spin ensureComponent + bump the retry counter for a component
      // that didn't fail now). The current selection, if it has its own problem, emits its own signal.
      // KNOWN LIMITATION (deferred): the reported path is resolved through the CURRENT active root, so
      // in a monorepo where two targets each own an identically-suffixed path (e.g. both have
      // `src/App.tsx`), a late signal from target A after switching to target B could resolve to B's
      // path and pass this check. Rare (dup-suffix + cross-target reroot + an in-flight signal); a
      // tighter fix would compare the raw preview path or the root captured when the iframe URL issued.
      const signalIsCurrent = isFailureSignalForCurrentSelection(reportedRepoRelPath, capturedCurrentPath);
      if (!signalIsCurrent) return;
      // In-flight candidacy guard (mirrors the SaaS hook): a rapid second missing/error signal for
      // this path before the first candidacy check resolves would see alreadyTriedWrapper=true and
      // fall through to a concurrent selfHealMissingComponent → ensureComponent while app-mode is
      // rebuilding. Suppress the duplicate; the marker is cleared when the check settles, so a later
      // signal still reaches self-heal if the component is genuinely stuck.
      if (appModeCandidacyInFlight.has(componentPath)) return;
      appModeCandidacyInFlight.add(componentPath);
      void previewManager
        .isAppEntryCandidate(relPath)
        .catch(() => false)
        .then((isCandidate) => {
          appModeCandidacyInFlight.delete(componentPath);
          const isStale = (): boolean =>
            isActivationStale({
              capturedGeneration,
              currentGeneration: selectionGeneration,
              capturedPath: capturedCurrentPath,
              currentPath: stateHub?.state.currentComponent?.path,
            });
          // The candidacy read is async — an A→B→A churn can resolve a STALE A result for a fresh A
          // occupancy. Re-check staleness BEFORE latching appModeRetryAttempts: latching for a stale
          // result would poison the fresh occupancy (its real later failure would see
          // alreadyTriedWrapper=true and never retry). A stale result also skips the self-heal — it
          // belongs to a previous occupancy, which already cleared its own state on the switch.
          if (isStale()) return;
          const retry = shouldRetryWithAppWrapper({
            outcome: 'missing',
            isAppEntryCandidate: isCandidate,
            isProviderContextError: false,
            alreadyTriedWrapper: appModeRetryAttempts.has(componentPath),
          });
          if (!retry) {
            // Current selection, genuine non-candidate leaf that's missing → regenerate its preview.
            void selfHealMissingComponent(componentPath, currentWorkspaceRoot);
            return;
          }
          // Latch synchronously before the async activation so a re-fired signal can't double-retry.
          appModeRetryAttempts.add(componentPath);
          void retryWithAppModeForEntry(relPath, isStale);
        })
        .catch((err) => {
          // The `.catch(() => false)` above already coerces the candidacy rejection, so this only
          // fires if the `.then` itself throws — still drop the in-flight marker so a later signal
          // for this path is not permanently suppressed.
          appModeCandidacyInFlight.delete(componentPath);
          console.error('[HyperIDE] componentMissing app-mode candidacy handling failed:', err);
        });
    });

    // HYP-487: auto-recover from a provider-context render error by generating the isolation
    // wrapper. The ErrorBoundary re-fires rapidly, so the providerErrorAttempts latch is set
    // synchronously before the async generate to avoid concurrent AI calls / write storms.
    //
    // P2 selection-binding (this round): bind the crash to the current selection BEFORE generating
    // the wrapper. A late provider error from the OLD iframe after an A→B switch could otherwise
    // generate the isolation wrapper for the current workspace even though B did not fail. Resolve
    // the reported path to its repo-relative form (as the non-provider branch already does) and gate
    // on isFailureSignalForCurrentSelection — a stale signal returns without writing the wrapper.
    const handleProviderContextError = (componentPath: string, currentWorkspaceRoot: string): void => {
      const { componentPath: reportedRepoRelPath } = resolveSelfHealComponentParams({
        componentPath,
        activeWorkspaceRoot: currentWorkspaceRoot,
        repoRoot: workspaceFolderRoot(),
      });
      const currentPath = stateHub?.state.currentComponent?.path;
      if (!isFailureSignalForCurrentSelection(reportedRepoRelPath, currentPath)) return;
      if (providerErrorAttempts.has(componentPath)) return;
      providerErrorAttempts.add(componentPath);
      // ensureIsolationWrapper is a no-op when a wrapper already exists (manual or prior auto-gen),
      // and shows the no-AI-key guidance message when generation is skipped — so the "not already
      // isolated" gate and the fallback both live there.
      void ensureIsolationWrapper(currentWorkspaceRoot, context).catch((err) => {
        console.error('[HyperIDE] componentError auto-wrapper generation failed:', err);
      });
    };

    // Non-provider crash: an app-entry ROOT that failed to render as a component is retried AS A
    // FULL APP (render-failure fallback). A non-candidate leaf that crashes is NOT app-mode's domain
    // — it has no router/provider root to render raw — so it is left to surface its error. Uses the
    // same in-flight candidacy guard as onComponentMissing (shared appModeCandidacyInFlight set) so a
    // missing+error pair for one path can't double-fire a concurrent candidacy check.
    const handleNonProviderError = (componentPath: string, currentWorkspaceRoot: string): void => {
      const { componentPath: reportedRepoRelPath, previewComponentPath: relPath } = resolveSelfHealComponentParams({
        componentPath,
        activeWorkspaceRoot: currentWorkspaceRoot,
        repoRoot: workspaceFolderRoot(),
      });
      const capturedCurrentPath = stateHub?.state.currentComponent?.path;
      const capturedGeneration = selectionGeneration;
      // Bind the crash SIGNAL to the current selection up front — a late error from the OLD iframe
      // (mid A→B switch) must not latch + engage app-mode for the current selection that never crashed.
      if (!isFailureSignalForCurrentSelection(reportedRepoRelPath, capturedCurrentPath)) return;
      if (appModeCandidacyInFlight.has(componentPath)) return;
      appModeCandidacyInFlight.add(componentPath);
      void previewManager
        .isAppEntryCandidate(relPath)
        .catch(() => false)
        .then((isCandidate) => {
          appModeCandidacyInFlight.delete(componentPath);
          const isStale = (): boolean =>
            isActivationStale({
              capturedGeneration,
              currentGeneration: selectionGeneration,
              capturedPath: capturedCurrentPath,
              currentPath: stateHub?.state.currentComponent?.path,
            });
          // The candidacy read is async — an A→B→A churn can resolve a STALE A result for a fresh A
          // occupancy. Re-check staleness BEFORE latching appModeRetryAttempts: latching for a stale
          // result would poison the fresh occupancy (its real later crash would see
          // alreadyTriedWrapper=true and never retry).
          if (isStale()) return;
          const retry = shouldRetryWithAppWrapper({
            outcome: 'error',
            isAppEntryCandidate: isCandidate,
            isProviderContextError: false,
            alreadyTriedWrapper: appModeRetryAttempts.has(componentPath),
          });
          if (!retry) return;
          // Latch synchronously before the async activation so the re-firing ErrorBoundary can't
          // double-retry; a second crash AFTER we entered app-mode is short-circuited by the latch
          // and the real error surfaces (no loop).
          appModeRetryAttempts.add(componentPath);
          void retryWithAppModeForEntry(relPath, isStale);
        })
        .catch((err) => {
          // The `.catch(() => false)` above coerces the candidacy rejection, so this only fires if
          // the `.then` itself throws — still drop the in-flight marker so a later signal for this
          // path is not permanently suppressed.
          appModeCandidacyInFlight.delete(componentPath);
          console.error('[HyperIDE] componentError app-mode candidacy handling failed:', err);
        });
    };

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
      // Telemetry: a component-level render error (ErrorBoundary). Emitted for ALL
      // component errors, not just provider-context ones. Message is hashed.
      try {
        const category = categorizeErrorMessage(error);
        session?.incError();
        telemetry?.track(TelemetryEvents.previewRenderFailed, {
          errorClass: 'componentError',
          errorCategory: category,
          scrubbedMessageHash: telemetry.hash(error),
        });
        if (category === 'process_not_defined') {
          telemetry?.track(TelemetryEvents.previewBlankDetected, {});
        }
      } catch {
        // telemetry must never affect auto-recovery
      }
      const currentWorkspaceRoot = syncWorkspaceRuntime();
      // ORDER: provider-context crash → HYP-487 isolation wrapper (FIRST); else an app-entry-candidate
      // NON-provider crash → full-app retry. Never both for the same signal — a provider-context error
      // dispatches to the wrapper branch and returns before the app-mode branch can run.
      if (isProviderContextError(error)) {
        handleProviderContextError(componentPath, currentWorkspaceRoot);
        return;
      }
      handleNonProviderError(componentPath, currentWorkspaceRoot);
    });

    // Telemetry: preview render succeeded → emit preview.renderSucceeded and the
    // one-shot funnel.firstPreview (componentKind is a coarse bucket, never a path).
    previewPanel.onRenderSucceeded((componentPath) => {
      // HYP-943: a successful render proves the /test-preview router-patch race resolved —
      // retract the expected-transient React Router 404 noise from Hyper Logs (and open the
      // grace window for the iframe's batched console flush). Kept OUTSIDE the telemetry
      // try/catch below: it is user-facing log hygiene, not telemetry.
      diagnosticHub?.notePreviewRenderSucceeded();
      try {
        const componentKind = componentPath ? (isUiPrimitive(componentPath) ? 'primitive' : 'component') : 'unknown';
        session?.onPreviewRenderSucceeded({ componentKind });
      } catch {
        // telemetry must never affect render handling
      }
    });

    // Telemetry: allow-listed webview-origin events (rage/dead/error clicks).
    if (telemetry) previewPanel.setTelemetrySink(telemetry);
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
  activeModeManagerRef = modeManager;

  // Single liveness predicate for every async continuation that could touch the target
  // source after being superseded (HYP-945). Keyed on the MODULE-LEVEL activeModeManagerRef
  // (updated on every activate + reroot, nulled in deactivate) so a stale continuation from
  // a prior activation can't pass after a deactivate→reactivate cycle. See createLivenessGuard.
  const isManagerLive = createLivenessGuard<PreviewModeManager>(
    () => activeModeManagerRef,
    () => isDeactivating,
  );

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
    // A reroot/deactivate may have superseded this manager during the awaits above. Do NOT
    // register watchers for an abandoned root into the shared entryWatcherDisposables array
    // — that would leak cross-root watchers and re-inject into a root nothing owns (HYP-945).
    if (!isManagerLive(mgr)) return;

    let repatchTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRepatch = () => {
      clearTimeout(repatchTimer);
      repatchTimer = setTimeout(async () => {
        // Only re-inject for a still-live manager: a reroot may have evicted this one, or
        // the host may be shutting down (deactivate()'s revert already cleaned the source).
        // Either way a re-patch here would re-dirty an abandoned/torn-down tree (HYP-945).
        // KNOWN RESIDUAL: this is a check-then-act — a reroot/deactivate landing DURING the
        // awaited onComponentSelected below can still momentarily dirty the abandoned root.
        // Pre-existing (onComponentSelected always wrote without a liveness gate); self-heals
        // via the next activation's startup sweep. A full fix needs cancellation inside
        // PreviewModeManager (a larger shared-lib change), tracked as follow-up.
        if (!isManagerLive(mgr)) return;
        // No previewPanel.refresh() — watcher fires on extension's own patch writes too;
        // calling refresh() here resets the iframe mid-setup. HMR handles the reload.
        await mgr.onComponentSelected().catch(() => {});
      }, 300);
    };
    // Cancel a pending debounce when these watchers are disposed (reroot/teardown) so a
    // queued timer can't outlive the manager it belongs to.
    entryWatcherDisposables.push({ dispose: () => clearTimeout(repatchTimer) });

    for (const filePath of [routerFile, entryFile]) {
      if (!filePath) continue;
      const rel = relative(workspaceRootPath, filePath);
      const pattern = new vscode.RelativePattern(workspaceRootPath, rel);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, true, false, true);
      watcher.onDidChange(scheduleRepatch);
      entryWatcherDisposables.push(watcher);
    }
  };
  // Startup stale-injection sweep (HYP-945): a prior session may have crashed between
  // an @hyperide-managed router/entry patch and the canvas-preview swap, leaving the
  // target app's own tracked source dirty. Nothing owns that injection now (we just
  // activated), so revert it — the reliable backstop for a hard crash/kill where no
  // teardown revert ran. The sweep MUST complete before ANY watcher comes online:
  // startWatching()'s FSWatch and the re-patch watcher both react to injection state,
  // and the re-patch watcher re-injects whenever the marker disappears (git-discard
  // recovery), so if either were live during the sweep it could read the sweep's own
  // revert write as a discard and re-inject, churning the file right back to dirty.
  // Order per manager: sweep → startWatching → re-patch watcher. The liveness guard drops
  // the watcher (re)start when a reroot has superseded this manager mid-sweep, or the host
  // began shutting down (HYP-945 P2) — see runGuardedStartupSweep.
  const startupSweep = (mgr: PreviewModeManager, rootPath: string): void => {
    void runGuardedStartupSweep(
      mgr,
      () => isManagerLive(mgr),
      // Return the promise (don't void it) so the helper awaits + catches an async
      // rejection from watcher construction after setupEntryFileWatcher's first await.
      () => setupEntryFileWatcher(rootPath, mgr),
    );
  };
  startupSweep(modeManager, activeWorkspaceRoot);

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

    // Dispose the OLD workspace's re-patch watchers AND mode watcher FIRST, then revert
    // its injection (HYP-945). Order matters: if the old re-patch watcher were still
    // live, it would read the old manager's own revert write as a git-discard and
    // re-inject into a workspace we're about to abandon — stranding it dirty forever
    // (no future teardown or sweep owns that root again). Best-effort — never blocks.
    for (const d of entryWatcherDisposables) d.dispose();
    entryWatcherDisposables = [];
    modeManager.stopWatching();
    void modeManager.revertManagedInjections();
    activeWorkspaceRoot = targetRoot;
    previewManager = createPreviewFileManager(activeWorkspaceRoot);
    modeManager = createPreviewModeManager(activeWorkspaceRoot);
    activeModeManagerRef = modeManager;
    // Sweep the newly-rooted workspace, then start its watchers — same ordering
    // rationale as activation (sweep before any watcher goes live).
    startupSweep(modeManager, activeWorkspaceRoot);

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
    rightPanelProvider?.notifyDesignTokens([]);
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

  // HYP-788: recompute the support-dimension tabs for the active monorepo sub-repo on
  // component selection. The activation-time pass fills supportDimensions for SIMPLE repos
  // (a monorepo root is not a renderable project); for monorepos the per-sub-repo
  // dimensions are computed here. We resolve the SAME runnable root the preview pipeline
  // uses (resolveRunnableProjectRoot) — NOT the owning package — so a shared-library
  // component (no dev script of its own) is classified against the consuming app that
  // actually renders it, instead of wrongly showing an "unknown bundler" block and
  // regressing HYP-441/HYP-443 (codex P1). Additive: only supportDimensions is updated, so
  // the readonly/cssSystem state from activation is untouched. A sequence guard drops a
  // stale resolve that finishes after a newer selection (codex P1 — mirrors the preview
  // reroot's createSequencedReroot race fix).
  let lastSupportDimRoot: string | null = null;
  let supportDimSeq = 0;
  const refreshSupportDimensions = async (componentPath: string): Promise<void> => {
    if (workspaceRepoIsSimple) return; // simple repo: the activation-time pass is authoritative
    const seq = ++supportDimSeq;
    const repoRoot = workspaceFolderRoot();
    const absComponent = isAbsolute(componentPath) ? componentPath : join(repoRoot, componentPath);
    const activeRoot = await resolveRunnableProjectRoot(repoRoot, absComponent, vsCodeIO);

    // No runnable sub-repo (root-owned / non-renderable selection): clear any stale
    // sub-repo tabs so they don't linger over an unrelated selection, then stop.
    if (activeRoot === repoRoot) {
      if (seq === supportDimSeq) {
        previewPanel?.updateSupportDimensions([]);
        lastSupportDimRoot = repoRoot;
      }
      return;
    }
    if (activeRoot === lastSupportDimRoot) return;

    const dims = await computeSupportDimensionsForRoot(activeRoot);
    if (seq !== supportDimSeq) return; // a newer selection superseded this resolve
    // Cache only when the merge actually applied — if base capabilities aren't ready yet
    // (activation detection still in flight) the update is dropped, so leave the cache
    // unset and let the next selection retry.
    if (previewPanel?.updateSupportDimensions(dims)) lastSupportDimRoot = activeRoot;
  };
  // stateHub.onChange returns an unsubscribe function (not a Disposable) — wrap it so the
  // subscription is cleaned up on deactivate, mirroring the unsubFlush usage above.
  context.subscriptions.push({
    dispose: stateHub.onChange((_state, patch) => {
      const componentPath = patch.currentComponent?.path;
      if (componentPath) {
        void refreshSupportDimensions(componentPath).catch((err) =>
          console.warn('[HyperIDE] support-dimension refresh failed:', err),
        );
      }
    }),
  });

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

  // AI-powered sample generator (uses extension's API key config). Pass the workspace-folder
  // root so framework detection (HYP-795) runs against the project, matching the server which
  // detects at the project root.
  const sampleGenerator = createExtensionSampleGenerator(context, {
    getProjectRoot: () => getWorkspaceRoot() ?? workspaceRoot,
  });

  // Auto-inject UUIDs and parse component structure when currentComponent changes.
  // Serial queue prevents race conditions on rapid component switching:
  // each new switch cancels the previous ensureSample/ensureComponent chain.
  let previewAbortController: AbortController | null = null;

  const unsubStateChange = stateHub.onChange((_state, patch) => {
    // A `currentComponent: null` patch (e.g. PreviewPanel.setWorkspaceRoot clearing the selection)
    // resets the path tracker so a later RE-selection of the same path still counts as a real change
    // and bumps the generation — otherwise `A → null → A` would keep the old generation and let a
    // stale activation from the first A survive isActivationStale.
    if (patch.currentComponent !== undefined && !patch.currentComponent?.path) {
      lastSelectionPath = undefined;
    }
    if (patch.currentComponent?.path) {
      // Bump the selection generation on the SYNCHRONOUS selection edge — BEFORE the async
      // reroot below — so any in-flight app-mode activation from a PRIOR occupancy is invalidated
      // immediately (P1-3 / A→B→A reroot-gap race). The bump used to live in handleComponentSelected,
      // but that runs INSIDE resolveAndRerootToComponent(...).then(...) — i.e. AFTER the async reroot.
      // During an A→B→A switch the reroot gap meant the generation wasn't bumped yet, so a stale A
      // activation could still pass isActivationStale() and commit app-mode for the fresh A. The path
      // flips synchronously on selection (the reroot is downstream), so bumping here — on EVERY
      // selection edge — invalidates any in-flight activation from a prior occupancy at once. Every
      // path that reaches handleComponentSelected first passes through this edge, so the generation is
      // always bumped before any failure handler captures it. Bump ONLY on an actual path change: a
      // same-path re-emit (panel resurrection, repeated component:open) must not invalidate an
      // in-flight activation for the same unchanged selection.
      const componentPath = patch.currentComponent.path;
      if (componentPath !== lastSelectionPath) {
        selectionGeneration += 1;
        lastSelectionPath = componentPath;
      }
      // Re-root the pipeline to the monorepo sub-project that owns this component
      // before computing any paths (HYP-420). The component path from the Explorer
      // is relative to the VS Code workspace folder (repo root); resolve the abs
      // path against the repo root, then re-root so the dev server / entry patch /
      // __canvas_preview__ run inside the sub-project. For single-package projects
      // this resolves back to the workspace root — a no-op.
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
    appModeRetryAttempts.clear();
    appModeCandidacyInFlight.clear();
    // NOTE: the selectionGeneration bump does NOT live here — it is done on the SYNCHRONOUS selection
    // edge in the stateHub.onChange handler (before the async reroot), so an in-flight app-mode
    // activation from a prior A→B→A occupancy is invalidated during the reroot gap, before this
    // (post-reroot) handler runs. See the bump-site comment in unsubStateChange for the race.
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
    // registry so the iframe can find it — call ensureComponent below, skip the
    // ensureSample mutation, and use in-memory generated props only for primitives
    // that have neither authored SampleDefault nor a synthetic compound scaffold.
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
    const primitiveSampleInfoPromise = isPrimitive
      ? readFile(absComponentPath, 'utf8')
          // Compound-sibling detection (buildContainerSampleJsxBody) matches on the REAL
          // component identifier (e.g. `Card` → looks for `CardHeader`/`CardContent`), same as
          // preview-build-entry.ts uses. Passing sampleComponentName here would search for
          // siblings of the normalized SCAFFOLD name instead — a no-op for already-valid PascalCase
          // names, but a silent miss for anything normalizeSampleComponentName had to rewrite,
          // which would make a real compound primitive look like it has no compound scaffold and
          // redundantly inject flat generated props on top of it (review finding, HYP-915).
          .then((sourceCode) => getPrimitiveRenderableSampleInfo(sourceCode, componentName))
          .catch(() => undefined)
      : Promise.resolve(undefined);

    ensureSamplePromise
      .then(async (sampleResult) => {
        if (ac.signal.aborted) return;
        // Feature #210 — "try first, then ask" via IN-MEMORY generated props.
        // Unlike the old source-mutation path, this is NOT gated on
        // autoSampleGeneration — generated values are injected at render through the
        // preview bridge and never written to disk, so they survive `git checkout`
        // between E2E specs. Posting happens BEFORE ensureComponent (which writes the
        // preview file and triggers the iframe render) so the webview global is set
        // when the component first renders.
        // componentService is repo-rooted → parse the prop schema with the
        // repo-relative componentPath. The iframe keys generated props by the
        // sub-project-relative path (HYP-420) — the same value that lands in the
        // `?component=` URL and the preview registry — so pass relativePath as the
        // previewKey; keying by componentPath would make the iframe lookup miss.
        const props = await panelRouter?.componentService.getComponentDefinitions(componentPath);
        const primitiveSampleInfo = await primitiveSampleInfoPromise;
        if (previewPanel && shouldInjectGeneratedPropsForSelection(sampleResult, props, primitiveSampleInfo)) {
          await previewPanel.injectGeneratedSampleProps(componentPath, relativePath);
        }
        // 2. Ensure component is registered in __canvas_preview__.tsx (deterministic).
        // For UI primitives this registers plain components and bakes syntheticSampleDefault
        // into the registry when compound synthesis is available.
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
        // App-mode is NO LONGER engaged proactively here. Static router-shape detection
        // (isAppEntryCandidate) proves router SHAPE, not render FAILURE — a router-owning root can
        // still render usable UI as a plain component — so the upfront engage was rejected (the CTO
        // asked: engage app-mode only when the render does NOT work without it). App-mode is now a
        // pure render-failure FALLBACK driven by the componentMissing / componentError runtime
        // signals (see onComponentMissing / onComponentError below). A file that renders fine as a
        // component stays in component-mode.
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
  if (telemetry) leftPanelProvider.setTelemetry(telemetry);

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
  if (telemetry) rightPanelProvider.setTelemetry(telemetry);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RightPanelProvider.viewType, rightPanelProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Aggregate both side panels' visibility → the canvas component picker (#92). The picker is the
  // ONLY way to pick a component when both the Explorer and the Inspector are hidden, so the
  // PreviewPanel needs the combined signal. Each provider notifies on resolve + on every toggle.
  const recomputeSidePanelsHidden = (): void => {
    const explorerVisible = leftPanelProvider?.visible ?? false;
    const inspectorVisible = rightPanelProvider?.visible ?? false;
    previewPanel?.setSidePanelsHidden(!explorerVisible && !inspectorVisible);
  };
  leftPanelProvider.onVisibilityChange(recomputeSidePanelsHidden);
  rightPanelProvider.onVisibilityChange(recomputeSidePanelsHidden);

  // Register commands
  registerCommands(context, workspaceRoot, {
    telemetry,
    session,
    previewPanel,
    devServerManager,
    diagnosticHub,
    aiChatProvider,
    rightPanelProvider,
    leftPanelProvider,
    logsProvider,
    stateHub,
    panelRouter,
    // Live getter, NOT `mcpServer` by value: setupMcpServer() runs below, AFTER this
    // call, so a snapshot here would be permanently null (regressed setupMcp in #383).
    getMcpServer: () => mcpServer,
    prepareDevServerTargetRef,
    rerootDevServerTargetRef,
    getWorkspaceRoot,
    getActiveProjectRoot: () => activeWorkspaceRoot,
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

  // Telemetry safety net: if project detection never resolved (no workspace,
  // detector error), still emit session.activated once so we don't lose the
  // activation entirely. Runs after the microtask queue so the detection path
  // wins the race when it does resolve.
  setTimeout(() => {
    if (session && !sessionActivatedEmitted) {
      sessionActivatedEmitted = true;
      session.start({
        activationReason: 'onStartupFinished',
        vscodeVersion: vscode.version,
        coldStartMs: Date.now() - activationStartedAt,
        hasWorkspace: Boolean(vscode.workspace.workspaceFolders?.length),
        projectType: 'unknown',
      });
    }
  }, 3000).unref?.();

  console.log('[HyperIDE] Extension activated successfully');
}

export async function deactivate() {
  console.log('[HyperIDE] Extension deactivating...');
  // Flip BEFORE the revert so the re-patch watcher's debounced callback can't re-inject
  // over the shutdown revert (HYP-945).
  isDeactivating = true;

  // Revert any @hyperide-managed injection still applied to the target app's own
  // tracked source so a graceful shutdown never leaves the client repo dirty
  // (HYP-945). Best-effort and byte-identical via the manager's pre-injection
  // snapshots; the startup sweep is the backstop if this is skipped. Time-boxed so a
  // slow/hung FS can't eat the ~4s deactivate budget the telemetry flush below needs —
  // a local revert is normally tens of ms; on timeout the startup sweep still cleans up.
  if (activeModeManagerRef) {
    const mgr = activeModeManagerRef;
    activeModeManagerRef = null;
    try {
      await Promise.race([
        mgr.revertManagedInjections(),
        new Promise<void>((resolve) => setTimeout(resolve, 1500).unref?.()),
      ]);
    } catch (err) {
      console.error('[HyperIDE] Managed-injection revert on deactivate failed:', err);
    }
  }

  // Telemetry: emit session.ended (+ errorThenQuit check), flush, and shut down.
  // Run FIRST so the flush has the full ~4s deactivate budget. Best-effort.
  try {
    session?.end('deactivate');
    if (telemetry) {
      await telemetry.flush();
      await telemetry.dispose();
    }
  } catch (err) {
    console.error('[HyperIDE] Telemetry teardown failed:', err);
  } finally {
    telemetry = null;
    session = null;
  }

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
