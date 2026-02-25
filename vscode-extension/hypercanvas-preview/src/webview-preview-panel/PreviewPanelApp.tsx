/**
 * Preview Panel App — React entry point for the preview webview.
 *
 * Replaces ~250 lines of inline JS from PreviewPanel._getHtmlForWebview().
 * Manages iframe preview, overlay rendering, and context menu.
 */

import { useCallback, useMemo, useState } from 'react';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';
import {
  useSharedEditorStateSync,
  useCanvasMode,
  useEngineMode,
  createSharedDispatch,
} from '@/lib/platform/shared-editor-state';
import { useCanvasInteraction } from './useCanvasInteraction';
import { usePreviewBridge } from './usePreviewBridge';
import { CanvasElementContextMenu } from '@/components/CanvasElementContextMenu';
import { IconLayoutGrid, IconPointer, IconBrush } from '@tabler/icons-react';
import cn from 'clsx';

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

  const { contextMenu, clearContextMenu, updateState } =
    useCanvasInteraction(iframeEl, overlayEl, canvas);

  const {
    devServerRunning,
    previewUrl,
    showNoComponentHint,
    handleStartDevServer,
  } = usePreviewBridge({
    iframeEl,
    canvas,
    onStateUpdate: updateState,
  });

  const handleIframeLoad = useCallback(() => {
    canvas.sendEvent({ type: 'previewLoaded' } as never);
  }, [canvas]);

  const handleIframeError = useCallback(
    (e: React.SyntheticEvent<HTMLIFrameElement, Event>) => {
      canvas.sendEvent({
        type: 'previewError',
        error: (e.nativeEvent as ErrorEvent).message || 'iframe load error',
      } as never);
    },
    [canvas],
  );

  // Dev server not running — show start button
  if (!devServerRunning) {
    return <StartDevServerScreen onStart={handleStartDevServer} />;
  }

  return (
    <>
      <div style={wrapperStyle}>
        <iframe
          ref={iframeCallbackRef}
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

      {showNoComponentHint && <NoComponentHint />}

      <ModeToolbar canvas={canvas} />

      <CanvasElementContextMenu
        selectedIds={contextMenu ? [contextMenu.elementId] : []}
        externalTarget={
          contextMenu
            ? { type: 'design-element', x: contextMenu.x, y: contextMenu.y }
            : null
        }
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
      <button style={buttonStyle} onClick={onStart}>
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

// ============================================================================
// Mode Toolbar (floating at bottom of preview, matching SaaS Toolbar)
// ============================================================================

type ToolbarMode = 'board' | 'interact' | 'design';

const TOOLBAR_BUTTONS: { mode: ToolbarMode; icon: typeof IconLayoutGrid; boardOnly?: boolean }[] = [
  { mode: 'board', icon: IconLayoutGrid, boardOnly: true },
  { mode: 'interact', icon: IconPointer },
  { mode: 'design', icon: IconBrush },
];

function ModeToolbar({ canvas }: { canvas: ReturnType<typeof usePlatformCanvas> }) {
  const engineMode = useEngineMode();
  const canvasMode = useCanvasMode();
  const dispatch = useMemo(() => createSharedDispatch(canvas), [canvas]);

  const isBoardMode = canvasMode === 'multi';
  const activeMode: ToolbarMode = isBoardMode ? 'board' : engineMode as ToolbarMode;

  const handleModeChange = useCallback((mode: ToolbarMode) => {
    if (mode === 'board') {
      dispatch({ engineMode: 'design', canvasMode: 'multi' });
    } else if (mode === 'interact') {
      dispatch({ engineMode: 'interact', canvasMode: 'single', selectedIds: [], hoveredId: null });
    } else {
      dispatch({ engineMode: 'design', canvasMode: 'single' });
    }
  }, [dispatch]);

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 h-12 px-2 bg-background rounded-[14px] shadow-[0_2px_4px_rgba(0,0,0,0.15),0_2px_16px_rgba(0,0,0,0.15)] border border-border z-[1000]">
      {TOOLBAR_BUTTONS.map(({ mode, icon: Icon, boardOnly }) => {
        const isActive = activeMode === mode;
        const isDisabled = boardOnly && canvasMode === 'single';
        return (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            disabled={isDisabled}
            className={cn(
              'w-8 h-8 rounded-md flex items-center justify-center transition-colors',
              isActive && 'bg-[#4597F7]',
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
  height: '100%',
};

const iframeStyle: React.CSSProperties = {
  border: 'none',
  width: '100%',
  height: '100%',
  background: '#fff',
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

