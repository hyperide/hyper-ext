import type { SourceLocation } from '@shared/element-tracing/types';
import { useRef } from 'react';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useElementTracer } from '@/hooks/useElementTracer';
import { useTracerSelectionSync } from '@/hooks/useTracerSelectionSync';
import { useCanvasEngine } from '@/lib/canvas-engine';
import type { RuntimeError } from '../../shared/runtime-error';
import type { CanvasMode } from '../../shared/types/canvas';
import {
  useIframeCanvas,
  useIframeEventHandlers,
  useIframeRuntimeErrors,
  useIframeStyles,
} from './iframe-canvas-hooks';

interface IframeCanvasProps {
  componentPath: string;
  iframeLoadedCounter?: number;
  boardModeActive?: boolean;
  activeInstanceId?: string | null;
  instanceSizes?: Record<string, { width?: number; height?: number }>;
  editorMode?: 'design' | 'interact' | 'code';
  isAddingComment?: boolean;
  onElementClick?: (
    nodeRef: string | null,
    element: HTMLElement,
    event: MouseEvent,
    itemIndex: number,
    source: SourceLocation,
  ) => void;
  onElementHover?: (
    nodeRef: string | null,
    element: HTMLElement | null,
    itemIndex: number | null,
    source: SourceLocation | null,
  ) => void;
  onLoadingChange?: (loading: boolean) => void;
  onCanvasModeChange?: (mode: CanvasMode) => void;
  onEmptyClick?: () => void;
  onOtherInstanceClick?: (instanceId: string) => void;
  onAddComment?: (position: { x: number; y: number }, elementId: string | null, instanceId: string | null) => void;
  serverOffline?: boolean;
  onGatewayError?: (hasError: boolean, errorMessage?: string) => void;
  onRuntimeError?: (error: RuntimeError | null) => void;
  onErrorChange?: (error: string | null, retryCount: number) => void;
  overrideSrc?: string;
}

export default function IframeCanvas({
  componentPath,
  boardModeActive,
  activeInstanceId,
  instanceSizes,
  iframeLoadedCounter,
  editorMode,
  isAddingComment,
  onElementClick,
  onElementHover,
  onLoadingChange,
  onCanvasModeChange,
  onEmptyClick,
  onOtherInstanceClick,
  onAddComment,
  serverOffline,
  onGatewayError,
  onRuntimeError,
  onErrorChange,
  overrideSrc,
}: IframeCanvasProps) {
  const { meta } = useComponentMeta();
  const engine = useCanvasEngine();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { tracer, clickRetryQueue } = useElementTracer({
    iframe: iframeRef.current,
    projectId: meta?.projectId ?? '',
    enabled: meta?.projectId != null,
    loadCounter: iframeLoadedCounter,
    componentPath,
  });

  const { setPendingSelection } = useTracerSelectionSync({ tracer, engine, clickRetryQueue });

  const { loading, previewReady, canvasMode, canvasComposition, iframeSize } = useIframeCanvas({
    projectId: meta?.projectId,
    componentPath,
    onCanvasModeChange,
    onErrorChange,
    onGatewayError,
    onLoadingChange,
    serverOffline,
    overrideSrc,
    iframeLoadedCounter,
    iframeRef,
  });

  useIframeEventHandlers({
    iframeRef,
    engine,
    tracer,
    clickRetryQueue,
    setPendingSelection,
    canvasMode,
    activeInstanceId,
    boardModeActive,
    isAddingComment,
    overrideSrc,
    onElementClick,
    onElementHover,
    onEmptyClick,
    onOtherInstanceClick,
    onAddComment,
    iframeLoadedCounter,
    instanceSizes,
    editorMode,
  });

  useIframeStyles({
    iframeRef,
    previewReady,
    editorMode,
    boardModeActive,
    canvasMode,
    overrideSrc,
    iframeLoadedCounter,
  });

  useIframeRuntimeErrors({
    iframeRef,
    onRuntimeError,
    iframeLoadedCounter,
    overrideSrc,
  });

  if (!meta?.projectId) {
    return (
      <div className="relative w-full h-full bg-white dark:bg-slate-950">
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900">
          <div className="text-center">
            <p className="text-destructive mb-2">No active project</p>
            <p className="text-sm text-muted-foreground">Please select a project first</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="IframeCanvas"
      className="relative"
      style={{
        overflow: 'visible',
        background: 'transparent',
        pointerEvents: boardModeActive ? 'none' : 'auto',
        width: canvasMode === 'multi' ? 'fit-content' : '100%',
        height: canvasMode === 'multi' ? 'fit-content' : '100%',
      }}
    >
      <iframe
        id="preview-iframe"
        ref={iframeRef}
        src={
          previewReady
            ? (() => {
                if (overrideSrc) return overrideSrc;
                const baseUrl = `/project-preview/${meta.projectId}/test-preview`;
                const params = new URLSearchParams();
                params.set('component', componentPath);
                if (canvasMode === 'multi') {
                  params.set('mode', 'multi');
                }
                return `${baseUrl}?${params.toString()}`;
              })()
            : 'about:blank'
        }
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        // @ts-expect-error allowtransparency is non-standard but needed for transparent background
        allowtransparency="true"
        className={iframeSize ? 'border-0' : 'w-full h-full border-0'}
        style={{
          width: iframeSize?.width,
          height: iframeSize?.height,
          overflow: 'visible',
          pointerEvents: boardModeActive ? 'none' : 'auto',
          background: 'transparent',
          colorScheme: 'normal',
        }}
        title="Component Preview"
      />
    </div>
  );
}
