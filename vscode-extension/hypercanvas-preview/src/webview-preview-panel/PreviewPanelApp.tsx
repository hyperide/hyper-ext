/**
 * Preview Panel App — React entry point for the preview webview.
 *
 * Replaces ~250 lines of inline JS from PreviewPanel._getHtmlForWebview().
 * Manages iframe preview, overlay rendering, and context menu.
 */

import { IconBrush, IconLayoutGrid, IconLayoutSidebar, IconPointer } from '@tabler/icons-react';
import cn from 'clsx';
import { type CSSProperties, useCallback, useMemo, useRef, useState } from 'react';
import { CanvasElementContextMenu } from '@/components/CanvasElementContextMenu';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import {
  createSharedDispatch,
  useCanvasMode,
  useEngineMode,
  useSharedEditorState,
  useSharedEditorStateSync,
} from '@/lib/platform/shared-editor-state';
import { TID } from '../shared/data-testid-map';
import type { UnsupportedProjectError } from '../types';
import { PropsForm } from './PropsForm';
import { useCanvasInteraction } from './useCanvasInteraction';
import { usePreviewBridge } from './usePreviewBridge';

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
    componentError,
    handleStartDevServer,
  } = usePreviewBridge({
    iframeEl,
    canvas,
    onStateUpdate: updateState,
  });

  const handleIframeLoad = useCallback(() => {
    canvas.sendEvent({ type: 'previewLoaded' });
  }, [canvas]);

  const handleIframeError = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
      canvas.sendEvent({
        type: 'previewError',
        error: (e.nativeEvent as ErrorEvent).message || 'iframe load error',
      });
    },
    [canvas],
  );

  // Unsupported project type (React Native / Tamagui without react-native-web)
  if (projectError) {
    const handleFix = () => {
      canvas.sendEvent({ type: 'command:fixUnsupportedProject' });
    };
    return <UnsupportedProjectScreen error={projectError} onFix={handleFix} />;
  }

  // Dev server not running — show start button (with reconnecting banner if was connected)
  if (!devServerRunning) {
    return (
      <>
        {disconnected && <ReconnectingBanner />}
        <StartDevServerScreen onStart={handleStartDevServer} />
      </>
    );
  }

  return (
    <>
      <div style={wrapperStyle}>
        <iframe
          ref={iframeCallbackRef}
          data-testid={TID.preview.iframe}
          title="Component Preview"
          style={{
            ...iframeStyle,
            display: showNoComponentHint ? 'none' : undefined,
          }}
          src={!showNoComponentHint && previewUrl ? previewUrl : undefined}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
        />
        <div ref={overlayCallbackRef} style={overlayStyle} />
      </div>

      {componentError && (
        <ComponentErrorOverlay
          componentPath={componentError.componentPath}
          error={componentError.error}
          propsSchema={componentError.propsSchema}
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
        />
      )}

      {showNoComponentHint && <NoComponentHint />}

      <ModeToolbar canvas={canvas} />

      <CanvasElementContextMenu
        selectedIds={contextMenu ? [contextMenu.elementId] : []}
        externalTarget={contextMenu ? { type: 'design-element', x: contextMenu.x, y: contextMenu.y } : null}
        onExternalClose={clearContextMenu}
      />
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StartDevServerScreen({ onStart }: { onStart: () => void }) {
  return (
    <div style={centerScreenStyle}>
      <h2 style={headingStyle}>Hyper Preview</h2>
      <p style={subtextStyle}>Start the dev server to see your components</p>
      <button type="button" data-testid={TID.preview.startServerButton} style={buttonStyle} onClick={onStart}>
        Start Dev Server
      </button>
    </div>
  );
}

function NoComponentHint() {
  return (
    <div style={{ ...centerScreenStyle, ...absoluteFillStyle }}>
      <h2 style={headingStyle}>No component selected</h2>
      <p style={subtextStyle}>Open a .tsx or .jsx file to preview it</p>
    </div>
  );
}

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
// Reconnecting Banner (shown when dev server disconnects)
// ============================================================================

function ReconnectingBanner() {
  return (
    <div data-testid="hyper-preview-reconnecting" style={reconnectingBannerStyle}>
      Dev server disconnected
    </div>
  );
}

// ============================================================================
// Component Error Overlay (shown over iframe when ErrorBoundary catches)
// ============================================================================

interface ComponentErrorOverlayProps {
  componentPath: string;
  error: string;
  propsSchema?: import('./PropsForm').SimplePropInfo[] | null;
  onCreateSample: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAIKey: () => void;
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
  onCreateSample,
  onConfigureAIKey,
}: ComponentErrorOverlayProps) {
  const componentName =
    componentPath
      .split('/')
      .pop()
      ?.replace(/\.tsx?$/, '') ?? componentPath;

  const extractedProps = useMemo(() => extractPropsFromError(error), [error]);
  const propValuesRef = useRef<Record<string, unknown>>({});
  const [allRequiredFilled, setAllRequiredFilled] = useState(false);
  const [sampleCreated, setSampleCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [sampleName, setSampleName] = useState('SampleDefault');

  const [hasAnyProps, setHasAnyProps] = useState(false);

  const handlePropsChange = useCallback((values: Record<string, unknown>) => {
    propValuesRef.current = values;
    const hasFilled = Object.values(values).some((v) => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });
    setHasAnyProps(hasFilled);
  }, []);

  const handleCreateSample = useCallback(() => {
    const filled = Object.entries(propValuesRef.current).filter(([, v]) => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });
    onCreateSample(sampleName, filled.length > 0 ? Object.fromEntries(filled) : undefined);
    setSampleCreated(true);
  }, [onCreateSample, sampleName]);

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
        <h3 style={errorOverlayTitleStyle}>{componentName}</h3>
        <p style={errorOverlaySubtitleStyle}>This component requires props to render.</p>

        {hasProps && (
          <>
            <PropsForm
              propsSchema={propsSchema ?? null}
              extractedPropNames={extractedProps}
              onChange={handlePropsChange}
              onAllRequiredFilled={setAllRequiredFilled}
              resetKey={formKey}
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

        {sampleCreated ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? errorOverlayPrimaryButtonStyle : errorOverlaySecondaryButtonStyle}
              onClick={handleCreateSample}
            >
              {hasAnyProps ? 'Update Sample' : 'Update Empty Sample'}
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

const absoluteFillStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
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

const reconnectingBannerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  padding: '8px 16px',
  background: 'var(--vscode-editorWarning-foreground, #e5a100)',
  color: '#fff',
  fontSize: 12,
  fontFamily: 'var(--vscode-font-family)',
  textAlign: 'center',
  zIndex: 1001,
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

const errorOverlayLinkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
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
