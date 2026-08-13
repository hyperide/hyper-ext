/**
 * Preview Panel App — React entry point for the preview webview.
 *
 * Replaces ~250 lines of inline JS from PreviewPanel._getHtmlForWebview().
 * Manages iframe preview, overlay rendering, and context menu.
 */

import { LoadingOverlay, NoComponentOverlay } from '@shared/components/overlays';
import { IconBrush, IconLayoutGrid, IconLayoutSidebar, IconPointer } from '@tabler/icons-react';
import cn from 'clsx';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasElementContextMenu } from '@/components/CanvasElementContextMenu';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import {
  createSharedDispatch,
  useCanvasMode,
  useEngineMode,
  useSharedEditorState,
  useSharedEditorStateSync,
} from '@/lib/platform/shared-editor-state';
import type { PlatformMessage } from '@/lib/platform/types';
import { TID } from '../shared/data-testid-map';
import type { UnsupportedProjectError } from '../types';
import { DisconnectedScreen } from './DisconnectedScreen';
import { PreviewLoadErrorOverlay } from './PreviewLoadErrorOverlay';
import { PreviewLoadTimeoutOverlay } from './PreviewLoadTimeoutOverlay';
import { PropsForm } from './PropsForm';
import { UnsupportedFrameworkScreen } from './UnsupportedFrameworkScreen';
import { useCanvasInteraction } from './useCanvasInteraction';
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
    projectError,
    projectCapabilities,
    componentError,
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

  // Readonly mode: when CSS system is unsupported for editing but preview renders.
  // User must click "Continue in Readonly" to dismiss the stub and see the preview.
  const [readonlyDismissed, setReadonlyDismissed] = useState(false);
  const isReadonly = projectCapabilities?.readonly === true;

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

  // Unsupported project — full blocking screen. Two flavours:
  //  - 'framework': no supported bundler/framework → compatibility table (HYP-442,
  //    replaces the old warning toast).
  //  - 'react-native': renders only after a fix (react-native-web) → fix button.
  if (projectError) {
    if (projectError.type === 'framework') {
      return <UnsupportedFrameworkScreen message={projectError.message} />;
    }
    const handleFix = () => {
      canvas.sendEvent({ type: 'command:fixUnsupportedProject' });
    };
    return <UnsupportedProjectScreen error={projectError} onFix={handleFix} />;
  }

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
          onCreateSample={(sampleName: string, propValues?: Record<string, unknown>) => {
            canvas.sendEvent({
              type: 'errorBoundary:createSample',
              componentPath: componentError.componentPath,
              sampleName,
              propValues,
            } as unknown as import('@/lib/platform/types').PlatformMessage);
          }}
          onConfigureAIKey={() => {
            canvas.sendEvent({
              type: 'errorBoundary:configureAIKey',
            } as unknown as import('@/lib/platform/types').PlatformMessage);
          }}
          onClose={clearComponentError}
        />
      )}

      {showNoComponentHint && <NoComponentOverlay variant="no-selection" />}

      <ModeToolbar canvas={canvas} />

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
      {isReadonly && !readonlyDismissed && (
        <ReadonlyStubScreen
          cssSystem={projectCapabilities?.cssSystem ?? 'unknown'}
          projectType={projectCapabilities?.projectType}
          renderSucceeded={devServerRunning && !componentError && !showNoComponentHint}
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
// Component Error Overlay (shown over iframe when ErrorBoundary catches)
// ============================================================================

/** Per-component prop values cache — persists across component switches, cleared on sample creation */
const propsCache = new Map<string, Record<string, unknown>>();

interface ComponentErrorOverlayProps {
  componentPath: string;
  errorSeq?: number;
  error: string;
  propsSchema?: import('./PropsForm').SimplePropInfo[] | null;
  /**
   * Required props the auto-sample generator could not satisfy (feature #210).
   * Highlighted in the overlay as "needs attention".
   */
  unsatisfiedProps?: string[];
  onCreateSample: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAIKey: () => void;
  onClose: () => void;
}

/**
 * Compute the overlay's "needs attention" list, kept CONSISTENT with the editable
 * Props panel: never flag a prop the user can't act on.
 *
 * The raw candidates are the union of (a) required props the auto-sample generator
 * couldn't satisfy and (b) prop names regex-scraped out of the runtime error. (b)
 * can name props that don't exist in the prop schema (e.g. `name` scraped from a
 * `reading 'name'` crash), for which PropsForm renders NO field. We drop those.
 *
 * The editable field set mirrors PropsForm: when a schema is present (even empty)
 * the fields come from the schema; otherwise from the extracted prop names.
 */
export function computeAttentionProps(input: {
  unsatisfiedProps: readonly string[];
  extractedProps: readonly string[];
  propsSchema: import('./PropsForm').SimplePropInfo[] | null | undefined;
}): string[] {
  const { unsatisfiedProps, extractedProps, propsSchema } = input;
  const editableFieldNames = new Set(propsSchema ? propsSchema.map((p) => p.name) : extractedProps);
  const candidates = [...new Set([...unsatisfiedProps, ...extractedProps])];
  return candidates.filter((name) => editableFieldNames.has(name));
}

/**
 * Extract prop names from common React error messages.
 * - "Cannot read properties of undefined (reading 'likes')" → ['likes']
 * - "Cannot read properties of null (reading 'name')" → ['name']
 * - "tweet is not defined" → ['tweet']
 * - "props.title is not a function" → ['title']
 * - Multiple "reading 'x'" in one message → all extracted
 */
function extractPropsFromError(errorMsg: string): string[] {
  // "Cannot read properties of undefined/null (reading 'propName')"
  const readingMatches = [...errorMsg.matchAll(/reading '(\w+)'/g)];
  if (readingMatches.length > 0) {
    return [...new Set(readingMatches.map((m) => m[1]))];
  }

  // "someVar is not defined" / "someVar is undefined"
  const undefinedMatch = errorMsg.match(/(\w+) is (?:not defined|undefined)/);
  if (undefinedMatch) return [undefinedMatch[1]];

  // "props.X is not a function" / "Cannot read X of undefined"
  const propsDotMatch = errorMsg.match(/props\.(\w+)/);
  if (propsDotMatch) return [propsDotMatch[1]];

  return [];
}

function ComponentErrorOverlay({
  componentPath,
  error,
  propsSchema,
  unsatisfiedProps,
  onCreateSample,
  onConfigureAIKey,
  onClose,
}: ComponentErrorOverlayProps) {
  const componentName =
    componentPath
      .split('/')
      .pop()
      ?.replace(/\.tsx?$/, '') ?? componentPath;

  const extractedProps = useMemo(() => extractPropsFromError(error), [error]);
  // Feature #210 — props that need the user's attention: the union of props the
  // auto-sample generator couldn't satisfy and prop names parsed out of the actual
  // render error. Filtered to props that have an editable field, so the
  // "needs attention" list stays consistent with the Props panel (HYP-453).
  const attentionProps = useMemo(
    () => computeAttentionProps({ unsatisfiedProps: unsatisfiedProps ?? [], extractedProps, propsSchema }),
    [unsatisfiedProps, extractedProps, propsSchema],
  );
  const cachedValues = useMemo(() => propsCache.get(componentPath), [componentPath]);
  const propValuesRef = useRef<Record<string, unknown>>(cachedValues ?? {});
  const [allRequiredFilled, setAllRequiredFilled] = useState(false);
  const [sampleCreated, setSampleCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [sampleName, setSampleName] = useState('SampleDefault');

  const [hasAnyProps, setHasAnyProps] = useState(false);

  // Listen for sample deletion from file watcher.
  // This message arrives from the VS Code extension host over the webview channel,
  // whose origin is the opaque vscode-webview://<session-id> — origin-string
  // comparison is meaningless here, so we validate by message shape instead.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'errorOverlay:sampleDeleted') {
        setSampleCreated(false);
      }
    };
    // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview host channel (opaque vscode-webview:// origin); validated by message shape
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handlePropsChange = useCallback(
    (values: Record<string, unknown>) => {
      propValuesRef.current = values;
      propsCache.set(componentPath, values);
      const hasFilled = Object.values(values).some((v) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim() !== '';
        if (Array.isArray(v)) return v.length > 0;
        return true;
      });
      setHasAnyProps(hasFilled);
    },
    [componentPath],
  );

  const handleCreateSample = useCallback(() => {
    const filled = Object.entries(propValuesRef.current).filter(([, v]) => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });
    onCreateSample(sampleName, filled.length > 0 ? Object.fromEntries(filled) : undefined);
    propsCache.delete(componentPath);
    // Auto-close overlay for SampleDefault — preview will re-render with the sample
    if (sampleName === 'SampleDefault') {
      onClose();
    } else {
      setSampleCreated(true);
    }
  }, [onCreateSample, sampleName, componentPath, onClose]);

  const sampleCountRef = useRef(1);
  const handleCreateNew = useCallback(() => {
    sampleCountRef.current += 1;
    setSampleCreated(false);
    setAllRequiredFilled(false);
    setHasAnyProps(false);
    setSampleName(`Sample${sampleCountRef.current}`);
    propValuesRef.current = {};
    setFormKey((k) => k + 1);
  }, []);

  const hasProps = (propsSchema && propsSchema.length > 0) || extractedProps.length > 0;

  return (
    <div data-testid={TID.preview.componentErrorOverlay} style={errorOverlayBackdropStyle}>
      <div style={errorOverlayCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={errorOverlayTitleStyle}>{componentName}</h3>
          {sampleCreated && (
            <button type="button" onClick={onClose} style={errorOverlayCloseButtonStyle} title="Close">
              &times;
            </button>
          )}
        </div>
        <p style={errorOverlaySubtitleStyle}>
          {attentionProps.length > 0
            ? 'Auto-generated sample props were not enough to render this component.'
            : 'This component requires props to render.'}
        </p>

        {attentionProps.length > 0 && (
          <p data-testid={TID.preview.componentErrorAttentionProps} style={errorOverlayAttentionStyle}>
            Needs attention:{' '}
            {attentionProps.map((name, i) => (
              <span key={name}>
                {i > 0 ? ', ' : ''}
                <code style={errorOverlayAttentionCodeStyle}>{name}</code>
              </span>
            ))}
          </p>
        )}

        {hasProps && (
          <>
            <PropsForm
              propsSchema={propsSchema ?? null}
              extractedPropNames={extractedProps}
              onChange={handlePropsChange}
              onAllRequiredFilled={setAllRequiredFilled}
              resetKey={formKey}
              initialValues={cachedValues}
            />
            <p style={errorOverlayHintStyle}>
              Fill props here, edit them in the code editor, or combine both approaches.
            </p>
          </>
        )}

        {!hasProps && (
          <p style={errorOverlayNoPropsHintStyle}>
            Could not detect required prop names from the error. The sample file will include a TODO placeholder.
          </p>
        )}

        {sampleCountRef.current > 1 && (
          <div style={sampleNameRowStyle}>
            <label htmlFor="sample-name" style={sampleNameLabelStyle}>
              Name
            </label>
            <input
              id="sample-name"
              type="text"
              value={sampleName}
              onChange={(e) => setSampleName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="SampleDefault"
              style={sampleNameInputStyle}
            />
          </div>
        )}

        {sampleCreated ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? errorOverlayPrimaryButtonStyle : errorOverlaySecondaryButtonStyle}
              onClick={handleCreateSample}
            >
              Update Sample
            </button>
            <button type="button" onClick={handleCreateNew} style={errorOverlayLinkButtonStyle}>
              Create New...
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? errorOverlayPrimaryButtonStyle : errorOverlaySecondaryButtonStyle}
              onClick={handleCreateSample}
            >
              {hasAnyProps ? 'Create Sample' : 'Create Empty Sample'}
            </button>
            <span style={{ color: 'var(--vscode-descriptionForeground, #666)', fontSize: 12 }}>or</span>
            <button
              type="button"
              data-testid={TID.preview.componentErrorConfigureAI}
              style={allRequiredFilled ? errorOverlaySecondaryButtonStyle : errorOverlayPrimaryButtonStyle}
              onClick={onConfigureAIKey}
            >
              Configure AI Key
            </button>
          </div>
        )}

        <p style={errorOverlayAIHintStyle}>
          <button type="button" onClick={onConfigureAIKey} style={errorOverlayAIHintLinkStyle}>
            Configure an AI provider
          </button>{' '}
          to auto-generate sample files with realistic data.
        </p>
      </div>
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

function ModeToolbar({ canvas }: { canvas: ReturnType<typeof usePlatformCanvas> }) {
  const engineMode = useEngineMode();
  const canvasMode = useCanvasMode();
  const dispatch = useMemo(() => createSharedDispatch(canvas), [canvas]);
  const previewScope = useSharedEditorState((s) => s.previewScope ?? 'full-app');
  const isIsolated = previewScope === 'component-only';

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

  const handleScopeToggle = useCallback(() => {
    canvas.sendEvent({
      type: 'preview:setScope',
      scope: isIsolated ? 'full-app' : 'component-only',
    });
  }, [canvas, isIsolated]);

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
      <div className="w-px h-6 bg-border mx-1" />
      <button
        type="button"
        data-testid={TID.preview.toolbarScope}
        title={
          isIsolated
            ? 'Isolated — component only (click for In app)'
            : 'In app — component in full app context (click for Isolated)'
        }
        onClick={handleScopeToggle}
        className={cn(
          'flex items-center gap-1 h-8 px-2 rounded-md text-xs transition-colors',
          isIsolated && 'bg-primary text-primary-foreground',
          !isIsolated && 'hover:bg-accent text-muted-foreground hover:text-foreground',
        )}
      >
        <IconLayoutSidebar className="w-4 h-4" stroke={1.5} />
        {isIsolated ? 'Isolated' : 'In app'}
      </button>
    </div>
  );
}

// ============================================================================
// Inline styles (VS Code CSS variables, no Tailwind needed)
// ============================================================================

const wrapperStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
};

const surfaceStyle: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'visible',
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

// ============================================================================
// Component Error Overlay styles
// ============================================================================

const errorOverlayBackdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0, 0, 0, 0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
};

const errorOverlayCardStyle: CSSProperties = {
  padding: 32,
  maxWidth: 520,
  width: '90%',
  background: 'var(--vscode-editor-background, #1e1e1e)',
  borderRadius: 12,
  border: '1px solid var(--vscode-widget-border, #333)',
};

const errorOverlayTitleStyle: CSSProperties = {
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  margin: '0 0 4px',
  fontSize: 15,
  fontWeight: 600,
};

const errorOverlaySubtitleStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 12,
  margin: '0 0 20px',
};

const errorOverlayNoPropsHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 12,
  margin: '0 0 16px',
  lineHeight: 1.6,
};

const sampleNameRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
};

const sampleNameLabelStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 12,
  minWidth: 40,
};

const sampleNameInputStyle: CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--vscode-input-background, #1e1e1e)',
  color: 'var(--vscode-input-foreground, #e2e8f0)',
  border: '1px solid var(--vscode-input-border, #444)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

const errorOverlayHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 11,
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const errorOverlayAttentionStyle: CSSProperties = {
  color: 'var(--vscode-editorWarning-foreground, #cca700)',
  fontSize: 12,
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const errorOverlayAttentionCodeStyle: CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  background: 'var(--vscode-textCodeBlock-background, rgba(255,255,255,0.06))',
  padding: '1px 5px',
  borderRadius: 3,
};

const errorOverlayLinkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  textDecoration: 'underline',
};

const errorOverlayCloseButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 20,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 4,
  marginTop: -4,
};

const errorOverlayAIHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 11,
  margin: '12px 0 0',
  lineHeight: 1.5,
};

const errorOverlayAIHintLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
};

const errorOverlayPrimaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--vscode-button-background, #3182ce)',
  color: 'var(--vscode-button-foreground, white)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const errorOverlaySecondaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
  border: '1px solid var(--vscode-textLink-foreground, #a78bfa)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
