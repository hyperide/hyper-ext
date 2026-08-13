/**
 * Preview Panel App — React entry point for the preview webview.
 *
 * Replaces ~250 lines of inline JS from PreviewPanel._getHtmlForWebview().
 * Manages iframe preview, overlay rendering, and context menu.
 */

import {
  ComponentErrorOverlay,
  LoadingOverlay,
  NoComponentOverlay,
  NonPreviewableFileOverlay,
} from '@shared/components/overlays';
import { AddressBar } from '@shared/components/preview-chrome';
import { IconBrush, IconLayoutGrid, IconPointer } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CanvasElementContextMenu } from '@/components/CanvasElementContextMenu';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import {
  createSharedDispatch,
  useCanvasMode,
  useEngineMode,
  useSharedEditorStateSync,
} from '@/lib/platform/shared-editor-state';
import type { PlatformMessage } from '@/lib/platform/types';
import { selectDimensionTabs } from '../services/support-dimensions';
import { TID } from '../shared/data-testid-map';
import type { UnsupportedProjectError } from '../types';
import { CanvasComponentPicker, hasPickerComponents, shouldShowComponentPicker } from './CanvasComponentPicker';
import { DisconnectedScreen } from './DisconnectedScreen';
import { PreviewLoadErrorOverlay } from './PreviewLoadErrorOverlay';
import { PreviewLoadTimeoutOverlay } from './PreviewLoadTimeoutOverlay';
import { SupportDimensionsTabs } from './SupportDimensionsTabs';
import { useAutoCreateEmptySample } from './useAutoCreateEmptySample';
import { useCanvasInteraction } from './useCanvasInteraction';
import { UnsupportedFrameworkScreen } from './UnsupportedFrameworkScreen';
import { usePreviewBridge } from './usePreviewBridge';

// ============================================================================
// Constants
// ============================================================================

/**
 * How long to wait for the iframe `load` event before assuming the preview is
 * stuck and switching to the recovery UI. Most cold starts (Vite + ts-checker)
 * land well under 5s; webpack-react projects can stretch to 20-40s on second
 * patch cycle (see `DevServerManager` "compiled successfully" notes), but by
 * then the iframe has at least painted SOMETHING — so 10s is the right guard
 * against a truly indefinite hang without false positives on slow first paint.
 */
const PREVIEW_LOAD_TIMEOUT_MS = 10_000;

// ============================================================================
// Main App
// ============================================================================

export function PreviewPanelApp() {
  return (
    <PlatformProvider>
      <PreviewContent />
    </PlatformProvider>
  );
}

export function getPreviewShellScreen(
  devServerRunning: boolean,
  disconnected: boolean,
): 'preview' | 'start' | 'disconnected' {
  if (devServerRunning) return 'preview';
  return disconnected ? 'disconnected' : 'start';
}

/**
 * Latch for the readonly stub's "render succeeded" signal (which gates the
 * "Continue in Readonly" button and the stub's status sentence).
 *
 * Once the preview has rendered successfully ONCE in the current dev-server
 * session, keep it latched true — a transient post-render blip (a component
 * error or no-selection flicker during an iframe reload, common for
 * provider-heavy apps like mantine) must NOT flip the button/sentence back off.
 * Without the latch that flicker reflows the stub and remounts the button, so
 * Playwright's actionability check never settles and `continueBtn.click()` hangs
 * to the test timeout (HYP-782 readonly-stub hang). Resets when the dev server
 * goes down (`devServerRunning` false) so a fresh session re-proves the render.
 */
export function nextRenderProvenLatch(
  prev: boolean,
  signals: { devServerRunning: boolean; componentError: boolean; showNoComponentHint: boolean },
): boolean {
  if (!signals.devServerRunning) return false;
  if (!signals.componentError && !signals.showNoComponentHint) return true;
  return prev;
}

// ============================================================================
// Preview Content
// ============================================================================

function PreviewContent() {
  const canvas = usePlatformCanvas();
  useSharedEditorStateSync(canvas);

  // Callback refs — trigger hook re-runs when elements mount/unmount
  // (useRef won't work because iframe conditionally renders based on devServerRunning)
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const iframeCallbackRef = useCallback((el: HTMLIFrameElement | null) => setIframeEl(el), []);
  const overlayCallbackRef = useCallback((el: HTMLDivElement | null) => setOverlayEl(el), []);

  const { contextMenu, clearContextMenu, updateState } = useCanvasInteraction(iframeEl, overlayEl, canvas);

  const {
    devServerRunning,
    disconnected,
    previewUrl,
    showNoComponentHint,
    componentGroups,
    sidePanelsHidden,
    selectComponent,
    projectError,
    projectCapabilities,
    componentError,
    unsupportedFile,
    selectRecommendation,
    appMode,
    navigateAppRoute,
    clearComponentError,
    handleStartDevServer,
    autoStart,
    handleAutoStartChange,
    handleOpenAutoStartSettings,
  } = usePreviewBridge({
    iframeEl,
    canvas,
    onStateUpdate: updateState,
  });

  // Create a sample for the errored component (host writes the sample file).
  // Shared by the overlay's "Create Sample" button and the auto-create hook below.
  const createSample = useCallback(
    (componentPath: string, sampleName: string, propValues?: Record<string, unknown>) => {
      canvas.sendEvent({ type: 'errorBoundary:createSample', componentPath, sampleName, propValues });
    },
    [canvas],
  );

  // HYP-649: when the errored component truly has no props (schema resolved to []
  // and the error names none), skip the overlay and silently create an empty
  // SampleDefault. The created sample re-renders and the error clears via the
  // retryRender path. No-op while componentError is null.
  useAutoCreateEmptySample({
    componentPath: componentError?.componentPath ?? '',
    error: componentError?.error,
    errorSeq: componentError?.errorSeq,
    propsSchema: componentError?.propsSchema,
    hasSample: componentError?.hasSample,
    onCreateSample: useCallback(
      (sampleName: string, propValues?: Record<string, unknown>) =>
        componentError && createSample(componentError.componentPath, sampleName, propValues),
      [componentError, createSample],
    ),
  });

  // Readonly mode: when CSS system is unsupported for editing but preview renders.
  // User must click "Continue in Readonly" to dismiss the stub and see the preview.
  const [readonlyDismissed, setReadonlyDismissed] = useState(false);
  const isReadonly = projectCapabilities?.readonly === true;
  // The readonly stub is a full-surface overlay; while it covers the preview the
  // canvas is non-interactive. Both the stub render and the mode-HUD suppression
  // (see shouldShowModeToolbar) derive from this single condition so they stay in
  // lockstep — the HUD must be hidden exactly when the stub is up (HYP-782).
  const readonlyStubVisible = isReadonly && !readonlyDismissed;

  // Latched "the preview proved it renders" signal for the readonly stub. Gating
  // the Continue button AND the stub's status sentence on the LIVE signal lets a
  // transient post-render blip (componentError / no-selection during a
  // provider-heavy iframe reload) reflow the stub and remount the button, so
  // `click()` never settles and the readonly e2e hangs to timeout. Latch it once
  // true (reset on dev-server-down) so the affordance is stable once the render
  // is proven. Deliberate tradeoff: a SUSTAINED post-render error also stays
  // latched (the latch can't distinguish a reload blip from a permanent break),
  // so the sentence may read "rendered successfully" during a lasting error — the
  // user can still Continue and reach the live (broken) preview, which beats a
  // perpetually-unclickable stub. Depend on the derived boolean (not the
  // componentError object) so the effect doesn't re-run on identity churn during
  // exactly the reload it is smoothing; lazy initial value avoids a first-paint
  // mount→unmount→mount of the button.
  const hasComponentError = componentError != null;
  const [readonlyRenderProven, setReadonlyRenderProven] = useState(() =>
    nextRenderProvenLatch(false, { devServerRunning, componentError: hasComponentError, showNoComponentHint }),
  );
  useEffect(() => {
    setReadonlyRenderProven((prev) =>
      nextRenderProvenLatch(prev, { devServerRunning, componentError: hasComponentError, showNoComponentHint }),
    );
  }, [devServerRunning, hasComponentError, showNoComponentHint]);

  // Track iframe load state so we can show the shared LoadingOverlay while the
  // dev server / preview HTML is fetching. Without this, the iframe shows a
  // bare blank/dev-server-default screen until first paint, which the user
  // perceives as an indefinite "Loading…" hang.
  const iframeSrc = !showNoComponentHint && previewUrl ? previewUrl : undefined;
  const [iframeLoaded, setIframeLoaded] = useState(false);
  // After PREVIEW_LOAD_TIMEOUT_MS without an iframe `load` event, surface a
  // recovery UI (retry + open output panel) instead of leaving the user on
  // an indefinite spinner.
  const [iframeLoadTimedOut, setIframeLoadTimedOut] = useState(false);
  // Set when the iframe `error` event fires (network failure, dev server
  // crash mid-load, blocked resource that aborts the document). Without this
  // state the error decayed into a `previewError` console.error inside
  // `PreviewPanel.ts` that the user never saw — Task 4 wires it to a
  // visible recovery overlay instead.
  const [iframeError, setIframeError] = useState<string | null>(null);
  // Bumped by the retry button to force the iframe to remount (via `key`)
  // and reload the same `previewUrl` from scratch. We don't mutate the URL
  // itself because the dev server doesn't need a cache-buster — the entire
  // <iframe> element is recreated, which guarantees a fresh fetch.
  const [retryNonce, setRetryNonce] = useState(0);
  // Reset the loading state when src changes — covers both the initial load
  // and explicit URL navigations. Component switches over postMessage do not
  // change src and therefore do not flip the spinner back on. Retry is also
  // a reset trigger so the spinner reappears while the new iframe loads.
  // biome-ignore lint/correctness/useExhaustiveDependencies: iframeSrc + retryNonce are the triggers
  useEffect(() => {
    setIframeLoaded(false);
    setIframeLoadTimedOut(false);
    setIframeError(null);
  }, [iframeSrc, retryNonce]);

  // Watchdog: while the loading overlay is up, start a 10s timer that flips
  // the panel into the timeout/error state if the iframe never reports load.
  // The timer is cleared when the iframe loads, when a component error or
  // iframe `error` event overrides the loading shell, or when we already
  // timed out (so we don't restart it). Retry is observed indirectly: the
  // reset effect above flips iframeLoadTimedOut back to false, which re-runs
  // this effect.
  useEffect(() => {
    if (!iframeSrc || iframeLoaded || componentError || iframeLoadTimedOut || iframeError) return;
    const id = setTimeout(() => setIframeLoadTimedOut(true), PREVIEW_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [iframeSrc, iframeLoaded, componentError, iframeLoadTimedOut, iframeError]);

  const handleIframeLoad = useCallback(() => {
    setIframeLoaded(true);
    setIframeLoadTimedOut(false);
    setIframeError(null);
    canvas.sendEvent({ type: 'previewLoaded' });
  }, [canvas]);

  const handleIframeError = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
      const message = (e.nativeEvent as ErrorEvent).message || 'iframe load error';
      // Surface the error in the webview UI — without this the only signal
      // was a console.error in the extension host, which the user can't
      // see. Keep the canvas event for downstream telemetry/listeners.
      setIframeError(message);
      canvas.sendEvent({
        type: 'previewError',
        error: message,
      });
    },
    [canvas],
  );

  const handleRetry = useCallback(() => {
    setRetryNonce((n) => n + 1);
  }, []);

  const handleOpenOutput = useCallback(() => {
    canvas.sendEvent({
      type: 'command:execute',
      command: 'hypercanvas.showDevServerOutput',
    } as unknown as PlatformMessage);
  }, [canvas]);

  // Fix action for an auto-fixable needs-setup dimension (react-native-web). Only the
  // framework dimension currently carries a fixLabel; the tabs render the button solely
  // for dimensions that have one, so this maps to the existing fix command.
  const handleDimensionFix = useCallback(() => {
    canvas.sendEvent({ type: 'command:fixUnsupportedProject' });
  }, [canvas]);

  // Auto Fix (HYP-917): even when the extension genuinely cannot render this project, route
  // the blocking/unsupported screen's prompt to the AI agent the STANDARD way — the same
  // `ai:openChat` event the diagnostics panel's Auto Fix button and the SaaS editor already
  // use (see webview/App.tsx, PanelRouter.ts, AIChatPanelProvider.ts). No new plumbing.
  const handleAutoFixPrompt = useCallback(
    (prompt: string) => {
      canvas.sendEvent({ type: 'ai:openChat', prompt });
    },
    [canvas],
  );

  // HYP-788/911: per-(sub-)repo support breakdown for the currently-open repo or the
  // active monorepo sub-repo. This is the authoritative unsupported surface when the host
  // provides supportDimensions (falls back to the legacy single-message screens below only
  // when absent — older host — or when nothing is blocking). It does NOT invent a new
  // screen for the common framework-unsupported case: SupportDimensionsTabs embeds the
  // SAME legacy compatibility table as UnsupportedFrameworkScreen for that dimension, and
  // only ADDS a tab bar on top when there's more than one blocking dimension (HYP-913).
  const supportTabs = selectDimensionTabs(projectCapabilities?.supportDimensions ?? []);
  if (supportTabs.length > 0) {
    return (
      <SupportDimensionsTabs dimensions={supportTabs} onFix={handleDimensionFix} onAutoFix={handleAutoFixPrompt} />
    );
  }

  // Unsupported project — full blocking screen. Two flavours:
  //  - 'framework': no supported bundler/framework → compatibility table (HYP-442,
  //    replaces the old warning toast).
  //  - 'react-native': renders only after a fix (react-native-web) → fix button.
  if (projectError) {
    if (projectError.type === 'framework') {
      return <UnsupportedFrameworkScreen message={projectError.message} onAutoFix={handleAutoFixPrompt} />;
    }
    const handleFix = () => {
      canvas.sendEvent({ type: 'command:fixUnsupportedProject' });
    };
    return <UnsupportedProjectScreen error={projectError} onFix={handleFix} />;
  }

  // Canvas component picker: when no component is selected AND both side panels are hidden, surface
  // the available component list centered in the canvas so a component can be picked with no panel
  // open (bug #92). When a panel is open the list is reachable there, so the bare hint stays.
  const showComponentPicker = shouldShowComponentPicker({
    showNoComponentHint,
    sidePanelsHidden,
    hasComponents: hasPickerComponents(componentGroups),
  });

  const shellScreen = getPreviewShellScreen(devServerRunning, disconnected);

  // Dev server stopped after a successful connection — dedicated disconnected
  // shell (shared ConnectionErrorOverlay + Start Dev Server action) instead of
  // relying on a transient blend of banner + stale iframe content.
  if (shellScreen === 'disconnected') {
    return <DisconnectedScreen onStart={handleStartDevServer} />;
  }

  // Dev server not running before any successful connection — show initial start screen.
  if (shellScreen === 'start') {
    return (
      <StartDevServerScreen
        onStart={handleStartDevServer}
        autoStart={autoStart}
        onAutoStartChange={handleAutoStartChange}
        onOpenSettings={handleOpenAutoStartSettings}
      />
    );
  }

  return (
    <div data-testid={TID.preview.surface} style={surfaceStyle}>
      {isReadonly && readonlyDismissed && <ReadonlyBadge cssSystem={projectCapabilities.cssSystem} />}
      {appMode && (
        <div style={addressBarRowStyle}>
          <AddressBar
            value={appMode.currentRoute}
            suggestions={appMode.routeSuggestions}
            onNavigate={navigateAppRoute}
            testId={TID.preview.addressBar}
          />
        </div>
      )}
      <div style={wrapperStyle}>
        <iframe
          // Remount on retry — recreating the element forces a fresh fetch
          // without poking at the URL or relying on iframe.contentWindow
          // APIs that may not exist before first load.
          key={`${iframeSrc ?? 'none'}-${retryNonce}`}
          ref={iframeCallbackRef}
          data-testid={TID.preview.iframe}
          title="Component Preview"
          style={{
            ...iframeStyle,
            display: showNoComponentHint ? 'none' : undefined,
          }}
          src={iframeSrc}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
        <div ref={overlayCallbackRef} style={overlayStyle} />
        {iframeSrc && !iframeLoaded && !componentError && !iframeLoadTimedOut && !iframeError && <LoadingOverlay />}
        {iframeSrc && !componentError && !iframeError && iframeLoadTimedOut && (
          <PreviewLoadTimeoutOverlay onRetry={handleRetry} onOpenOutput={handleOpenOutput} />
        )}
        {iframeSrc && !componentError && iframeError && (
          <PreviewLoadErrorOverlay error={iframeError} onRetry={handleRetry} onOpenOutput={handleOpenOutput} />
        )}
      </div>

      {componentError && (
        <ComponentErrorOverlay
          componentPath={componentError.componentPath}
          errorSeq={componentError.errorSeq}
          error={componentError.error}
          propsSchema={componentError.propsSchema}
          unsatisfiedProps={componentError.unsatisfiedProps}
          onCreateSample={(sampleName: string, propValues?: Record<string, unknown>) =>
            createSample(componentError.componentPath, sampleName, propValues)
          }
          onConfigureAIKey={() => {
            canvas.sendEvent({ type: 'errorBoundary:configureAIKey' });
          }}
          onGeneratePreviewWrapper={() => {
            canvas.sendEvent({ type: 'errorBoundary:generatePreviewWrapper' });
          }}
          onClose={clearComponentError}
        />
      )}

      {unsupportedFile && (
        <NonPreviewableFileOverlay
          filePath={unsupportedFile.filePath}
          reason={unsupportedFile.reason}
          recommendations={unsupportedFile.recommendations}
          onSelect={selectRecommendation}
        />
      )}

      {showNoComponentHint &&
        (showComponentPicker && componentGroups ? (
          <CanvasComponentPicker groups={componentGroups} onPick={selectComponent} />
        ) : (
          <NoComponentOverlay variant="no-selection" />
        ))}

      {/* Hide the floating mode HUD while the readonly stub covers the surface —
          otherwise the z-[1000] HUD floats over the stub's Continue button and
          intercepts its pointer events, wedging the user at the stub (HYP-782). */}
      {shouldShowModeToolbar({ isReadonly, readonlyDismissed }) && <ModeToolbar canvas={canvas} />}

      <CanvasElementContextMenu
        selectedIds={contextMenu ? [contextMenu.elementId] : []}
        externalTarget={contextMenu ? { type: 'design-element', x: contextMenu.x, y: contextMenu.y } : null}
        onExternalClose={clearContextMenu}
      />

      {/* Readonly mode overlay: shown OVER the preview, not instead of it.
          The preview renders normally underneath. The stub shows the framework
          compatibility table. The "Continue in Readonly" button only appears
          when the preview has loaded successfully with no errors — so the user
          sees proof that the preview works before choosing readonly mode. */}
      {readonlyStubVisible && (
        <ReadonlyStubScreen
          cssSystem={projectCapabilities?.cssSystem ?? 'unknown'}
          projectType={projectCapabilities?.projectType}
          renderSucceeded={readonlyRenderProven}
          onContinueReadonly={() => setReadonlyDismissed(true)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StartDevServerScreen({
  onStart,
  autoStart,
  onAutoStartChange,
  onOpenSettings,
}: {
  onStart: () => void;
  autoStart: boolean;
  onAutoStartChange: (value: boolean) => void;
  onOpenSettings: () => void;
}) {
  return (
    <div style={centerScreenStyle}>
      <h2 style={headingStyle}>Hyper Preview</h2>
      <p style={subtextStyle}>Start the dev server to see your components</p>
      <button type="button" data-testid={TID.preview.startServerButton} style={buttonStyle} onClick={onStart}>
        Start Dev Server
      </button>
      <label style={autoStartLabelStyle}>
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(e) => onAutoStartChange(e.target.checked)}
          style={{ marginRight: 6, cursor: 'pointer' }}
        />
        Start server automatically
      </label>
      <button type="button" style={settingsLinkStyle} onClick={onOpenSettings}>
        Open in Settings: Hyper Canvas › Auto-start
      </button>
    </div>
  );
}

// ============================================================================
// Readonly Stub — shown for CSS systems that can render but not edit
// ============================================================================

const SUPPORTED_CSS_TABLE: Array<{ name: string; key: string; supported: boolean }> = [
  { name: 'Tailwind CSS', key: 'tailwind', supported: true },
  { name: 'CSS Modules', key: 'cssmodules', supported: true },
  { name: 'styled-components', key: 'styled-components', supported: true },
  { name: 'Emotion', key: 'emotion', supported: true },
  { name: 'Tamagui', key: 'tamagui', supported: true },
  { name: 'shadcn/ui', key: 'shadcn', supported: true },
  { name: 'DaisyUI', key: 'daisyui', supported: true },
  { name: 'MUI (Material UI)', key: 'mui', supported: false },
  { name: 'Ant Design', key: 'antd', supported: false },
  { name: 'Chakra UI', key: 'chakra', supported: false },
  { name: 'Mantine', key: 'mantine', supported: false },
  { name: 'Fluent UI', key: 'fluentui', supported: false },
  { name: 'NextUI', key: 'nextui', supported: false },
  { name: 'Vanilla Extract', key: 'vanilla-extract', supported: false },
  { name: 'Panda CSS', key: 'pandacss', supported: false },
  { name: 'UnoCSS', key: 'unocss', supported: false },
  { name: 'StyleX', key: 'stylex', supported: false },
];

const PROJECT_TYPE_LABELS: Record<string, string> = {
  vite: 'Vite',
  nextjs: 'Next.js',
  cra: 'CRA',
  remix: 'Remix',
  webpack: 'webpack',
  bun: 'Bun',
  unknown: 'Unknown bundler',
};

/**
 * Full-surface readonly stub overlay (`position:absolute inset:0 z-900`). It paints
 * over the whole preview, so any bottom-floating chrome (the z-[1000] mode HUD, future
 * toolbars) MUST self-hide while this is shown — otherwise it floats above the stub and
 * intercepts the Continue button's pointer events, wedging the user (HYP-782). The mode
 * HUD is gated via `shouldShowModeToolbar`; add the same gate to any new floating chrome.
 */
function ReadonlyStubScreen({
  cssSystem,
  projectType,
  renderSucceeded,
  onContinueReadonly,
}: {
  cssSystem: string;
  projectType?: string;
  renderSucceeded: boolean;
  onContinueReadonly: () => void;
}) {
  const projectLabel = projectType ? (PROJECT_TYPE_LABELS[projectType] ?? projectType) : 'Unknown bundler';
  return (
    <div
      data-testid="hyper-preview-readonly-stub"
      style={{
        ...centerScreenStyle,
        position: 'absolute',
        inset: 0,
        zIndex: 900,
        background: 'rgba(30, 30, 30, 0.95)',
      }}
    >
      <div style={warningIconStyle}>🔒</div>
      <h2 style={headingStyle}>Readonly mode</h2>
      <p style={{ ...subtextStyle, maxWidth: 480, marginBottom: 4 }}>
        Visual editing is not available — <strong>{projectLabel}</strong> does not support AST-based style writes. The
        CSS framework <strong>{cssSystem}</strong> is compatible; editing will work once the project uses a supported
        bundler (Vite, webpack, Next.js).
        {renderSucceeded
          ? ' Preview rendered successfully — you can inspect computed styles in readonly mode.'
          : ' Waiting for preview to render...'}
      </p>

      <table style={{ margin: '12px 0', borderCollapse: 'collapse', fontSize: 12, color: '#ccc' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 12px', borderBottom: '1px solid #555' }}>CSS Framework</th>
            <th style={{ textAlign: 'center', padding: '4px 12px', borderBottom: '1px solid #555' }}>Editing</th>
          </tr>
        </thead>
        <tbody>
          {SUPPORTED_CSS_TABLE.map((row) => {
            const isDetected = row.key === cssSystem;
            return (
              <tr key={row.name} style={{ opacity: row.supported ? 1 : 0.6 }}>
                <td
                  style={{
                    padding: '3px 12px',
                    fontWeight: isDetected ? 700 : 400,
                    color: isDetected ? '#fff' : undefined,
                  }}
                >
                  {row.name}
                </td>
                <td style={{ textAlign: 'center', padding: '3px 12px' }}>{row.supported ? '✅' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {renderSucceeded && (
        <button
          type="button"
          data-testid="hyper-preview-continue-readonly"
          style={buttonStyle}
          onClick={onContinueReadonly}
        >
          Continue in Readonly
        </button>
      )}
    </div>
  );
}

function ReadonlyBadge({ cssSystem }: { cssSystem: string }) {
  return (
    <div
      data-testid="hyper-preview-readonly-badge"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1000,
        background: 'rgba(255, 170, 0, 0.9)',
        color: '#000',
        padding: '4px 10px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        pointerEvents: 'none',
      }}
    >
      READONLY — {cssSystem}
    </div>
  );
}

// ============================================================================
// Unsupported Project Screen (React Native without react-native-web)
// ============================================================================

function UnsupportedProjectScreen({ error, onFix }: { error: UnsupportedProjectError; onFix: () => void }) {
  const label = error.type === 'react-native' ? 'React Native / Tamagui' : error.type;
  return (
    <div data-testid={TID.preview.unsupportedRoot} style={centerScreenStyle}>
      <div style={warningIconStyle}>⚠</div>
      <h2 style={headingStyle}>Unsupported project type: {label}</h2>
      <p style={{ ...subtextStyle, maxWidth: 420 }}>{error.message}</p>
      <button type="button" data-testid={TID.preview.unsupportedFixButton} style={buttonStyle} onClick={onFix}>
        {error.fixLabel}
      </button>
    </div>
  );
}

// ============================================================================
// Mode Toolbar (floating at bottom of preview, matching SaaS Toolbar)
// ============================================================================

type ToolbarMode = 'board' | 'interact' | 'design';

const TOOLBAR_BUTTONS: {
  mode: ToolbarMode;
  icon: typeof IconLayoutGrid;
  boardOnly?: boolean;
}[] = [
  { mode: 'board', icon: IconLayoutGrid, boardOnly: true },
  { mode: 'interact', icon: IconPointer },
  { mode: 'design', icon: IconBrush },
];

/**
 * Whether the floating mode HUD should render.
 *
 * The HUD is `fixed bottom-8 ... z-[1000]`; the readonly stub is a full-surface
 * `position:absolute inset:0 z-900` overlay. With the HUD on top of the stub it
 * floats OVER the stub's "Continue in Readonly" button and intercepts its pointer
 * events (Playwright: "subtree intercepts pointer events"), so the Continue click
 * never lands — a real user is wedged at the stub (HYP-782). While the stub covers
 * the surface the canvas is non-interactive (nothing to point/board/design at), so
 * the HUD must not render. Once the user clicks Continue (`readonlyDismissed`) the
 * preview is interactive again and the HUD returns.
 */
export function shouldShowModeToolbar({
  isReadonly,
  readonlyDismissed,
}: {
  isReadonly: boolean;
  readonlyDismissed: boolean;
}): boolean {
  const readonlyStubVisible = isReadonly && !readonlyDismissed;
  return !readonlyStubVisible;
}

function ModeToolbar({ canvas }: { canvas: ReturnType<typeof usePlatformCanvas> }) {
  const engineMode = useEngineMode();
  const canvasMode = useCanvasMode();
  const dispatch = useMemo(() => createSharedDispatch(canvas), [canvas]);

  const isBoardMode = canvasMode === 'multi';
  const activeMode: ToolbarMode = isBoardMode ? 'board' : (engineMode as ToolbarMode);

  const handleModeChange = useCallback(
    (mode: ToolbarMode) => {
      if (mode === 'board') {
        dispatch({ engineMode: 'design', canvasMode: 'multi' });
      } else if (mode === 'interact') {
        dispatch({
          engineMode: 'interact',
          canvasMode: 'single',
          selectedIds: [],
          hoveredId: null,
        });
      } else {
        dispatch({ engineMode: 'design', canvasMode: 'single' });
      }
    },
    [dispatch],
  );

  // The preview's app-vs-isolated scope is chosen automatically — there is no manual
  // button. Three automatic paths decide it:
  //   - app-entry files (router/provider root) auto-engage app-mode in extension.ts
  //     (isAppEntryCandidate -> activateAppModeForEntry), rendering the full app wrapper.
  //   - a leaf component that crashes on a missing provider context auto-generates the
  //     isolation wrapper via the HYP-487 onComponentError recovery path.
  //   - everything else renders in the app shell (full-app) by default.
  // The `preview:setScope` message / onScopeChange handler stay for those automatic paths
  // and the chrome-detected "Generate wrapper" prompt; only the manual toggle was removed.
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 h-12 px-2 bg-popover rounded-[14px] shadow-[0_2px_4px_rgba(0,0,0,0.15),0_2px_16px_rgba(0,0,0,0.15)] border border-border z-[1000]">
      {TOOLBAR_BUTTONS.map(({ mode, icon: Icon, boardOnly }) => {
        const isActive = activeMode === mode;
        const isDisabled = boardOnly && canvasMode === 'single';
        return (
          <button
            type="button"
            key={mode}
            data-testid={TID.preview.toolbarMode(mode)}
            onClick={() => handleModeChange(mode)}
            disabled={isDisabled}
            className={cn(
              'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
              isActive && 'bg-primary',
              !isActive && !isDisabled && 'hover:bg-accent',
              isDisabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <Icon className={cn('w-6 h-6', isActive && 'text-white')} stroke={1.5} />
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Inline styles (VS Code CSS variables, no Tailwind needed)
// ============================================================================

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  // Fill the surface BELOW the address-bar row (flex column). minHeight:0 lets the
  // iframe shrink within the flex parent instead of overflowing.
  flex: 1,
  minHeight: 0,
};

// App-mode address-bar row: a normal-flow toolbar at the TOP of the surface that
// reflows the iframe DOWN (it must NOT float over / cover the previewed app). The
// surface is a flex column, so this row takes its own height and the iframe wrapper
// fills the rest. Centered, capped at the AddressBar's own max-width (420).
const addressBarRowStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  justifyContent: 'center',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 16px',
};

const surfaceStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'visible',
  // Column layout so the app-mode address bar sits ABOVE the iframe and pushes it
  // down rather than overlapping it (HYP app-preview: "адресная строка не перекрывала").
  display: 'flex',
  flexDirection: 'column',
};

const iframeStyle: React.CSSProperties = {
  border: 'none',
  width: '100%',
  height: '100%',
  background: 'var(--vscode-editor-background, #1e1e1e)',
};

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 10,
};

const centerScreenStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  background: 'var(--vscode-editor-background)',
  color: 'var(--vscode-editor-foreground)',
  fontFamily: 'var(--vscode-font-family)',
  textAlign: 'center',
  padding: 20,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 16,
  fontWeight: 500,
};

const subtextStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: 13,
  opacity: 0.8,
};

const buttonStyle: React.CSSProperties = {
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const autoStartLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginTop: 16,
  fontSize: 12,
  opacity: 0.75,
  cursor: 'pointer',
  userSelect: 'none',
};

const settingsLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #4e94ce)',
  fontSize: 11,
  cursor: 'pointer',
  marginTop: 6,
  padding: 0,
  textDecoration: 'underline',
};

const warningIconStyle: React.CSSProperties = {
  fontSize: 36,
  marginBottom: 12,
  color: 'var(--vscode-editorWarning-foreground, #e5a100)',
  lineHeight: 1,
};
