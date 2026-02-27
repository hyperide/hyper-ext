import { IconCloudOff } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from 'zustand';
import type { RuntimeError } from '@/../../shared/runtime-error';
import type { ViewportState } from '@/../../shared/types/canvas';
import { DEFAULT_VIEWPORT } from '@/../../shared/types/canvas';
import AIAgentChat from '@/components/AIAgentChat';
import { AnnotationsLayer } from '@/components/annotations';
import { CanvasElementContextMenu } from '@/components/CanvasElementContextMenu';
import { CodeServerIDE } from '@/components/CodeServerIDE';
import { CondEditPopup } from '@/components/CondEditPopup';
import type { CondBoundary } from '@/components/CondOverlay';
import { useComments } from '@/components/comments';
import { ComponentNavigatorPanel, InsertInstancePanel } from '@/components/FloatingPanels';
import IframeCanvas from '@/components/IframeCanvas';
import { InstanceEditPopup } from '@/components/InstanceEditPopup';
import LeftSidebar from '@/components/LeftSidebar';
import { MapEditPopup } from '@/components/MapEditPopup';
import type { MapBoundary } from '@/components/MapOverlay';
import RightSidebar from '@/components/RightSidebar';
import { useProjectUIKit } from '@/components/RightSidebar/hooks/useProjectUIKit';
import Toolbar, { type Tool } from '@/components/Toolbar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  useCanvasEngine,
  useCanvasStore,
  useHoveredId,
  useHoveredItemIndex,
  useSelectedIds,
  useSelectedItemIndices,
} from '@/lib/canvas-engine';
import { getPreviewIframe } from '@/lib/dom-utils';
import { loadPersistedState, savePersistedState } from '@/lib/storage';
import { useAuthStore } from '@/stores/authStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGitStore } from '@/stores/gitStore';
import { authFetch } from '@/utils/authFetch';
import { CommentStickersOverlay } from './components/CommentStickersOverlay';
import { ConfigErrorOverlay } from './components/ConfigErrorOverlay';
import { useBezelOverlays } from './components/hooks/useBezelOverlays';
import { useCanvasComments } from './components/hooks/useCanvasComments';
import { useCanvasComposition } from './components/hooks/useCanvasComposition';
import { useCanvasResizeHandlers } from './components/hooks/useCanvasResizeHandlers';
import { useCommentHandlers } from './components/hooks/useCommentHandlers';
import { useComponentAutoLoad } from './components/hooks/useComponentAutoLoad';
import { useCondMapSave } from './components/hooks/useCondMapSave';
import { useDrawingState } from './components/hooks/useDrawingState';
import { useElementInteraction } from './components/hooks/useElementInteraction';
import { useGatewayErrorHandling } from './components/hooks/useGatewayErrorHandling';
import { useHotkeysSetup } from './components/hooks/useHotkeysSetup';
import { useIframeLoadTracking } from './components/hooks/useIframeLoadTracking';
import { useInstanceInteraction } from './components/hooks/useInstanceInteraction';
import { useInstanceOperations } from './components/hooks/useInstanceOperations';
import { useInstanceOverlays } from './components/hooks/useInstanceOverlays';
import { useInstancePositioning } from './components/hooks/useInstancePositioning';
import { useOffscreenIndicators } from './components/hooks/useOffscreenIndicators';
import { useOverlayMapCondHighlightComponents } from './components/hooks/useOverlayMapCondHighlightComponents';
import { usePanelManagement } from './components/hooks/usePanelManagement';
import { type ProjectData, useProjectControl } from './components/hooks/useProjectControl';
import { useProjectSSE } from './components/hooks/useProjectSSE';
import { useSelectionOverlays } from './components/hooks/useSelectionOverlays';
import { useViewportControls } from './components/hooks/useViewportControls';
import { IframeFailed } from './components/IframeFailed';
import { LogsPanel } from './components/LogsPanel';
import { NoComponentsOverlay } from './components/NoComponentsOverlay';
import { PendingCommentInputOverlay } from './components/PendingCommentInputOverlay';
import { ProjectStartOverlay } from './components/ProjectStartOverlay';
import { SizeSelectionDialog } from './components/SizeSelectionDialog';

type Props = {
  onOpenSettings: () => void;
};

/**
 * Portal component that renders annotations layer with fixed positioning
 * relative to the canvas container bounds.
 * Uses pointer-events: none on container, auto only on SVG children.
 */
function AnnotationsLayerPortal({
  containerRef,
  children,
}: {
  containerRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const [bounds, setBounds] = useState({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const rect = container.getBoundingClientRect();
      setBounds({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      });
    };

    updateBounds();

    // Update on resize
    const resizeObserver = new ResizeObserver(updateBounds);
    resizeObserver.observe(container);

    // Update on scroll (window level)
    window.addEventListener('scroll', updateBounds, true);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', updateBounds, true);
    };
  }, [containerRef]);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: bounds.top,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
        zIndex: 45, // Below dialogs (z-50) but above canvas content
        // Container is always pointer-events: none
        // SVG inside controls its own pointer-events
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function CanvasEditor({ onOpenSettings }: Props) {
  // Resize handlers (sidebar, logs)
  const { logsHeight, commentsSidebarWidth, setLogsHeight, setCommentsSidebarWidth } = useCanvasResizeHandlers();

  const [editingCondBoundary, setEditingCondBoundary] = useState<CondBoundary | null>(null);
  const [editingMapBoundary, setEditingMapBoundary] = useState<MapBoundary | null>(null);
  const overlayContainerRef = useRef<HTMLDivElement>(null); // For selection overlays (design/interact mode)
  const instanceOverlayContainerRef = useRef<HTMLDivElement>(null); // For instance overlays (board mode)
  const edgeIndicatorsContainerRef = useRef<HTMLDivElement>(null); // For off-screen indicators (outside transform)
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [_iframeLoading, setIframeLoading] = useState(false);
  const [runtimeError, setRuntimeError] = useState<RuntimeError | null>(null);
  const [iframeError, setIframeError] = useState<{ message: string | null; retryCount: number }>({
    message: null,
    retryCount: 0,
  });

  // Project UI Kit detection (moved from RightSidebar for config error handling)
  // Pass activeProject so hook re-runs when project status changes to 'running'
  const {
    projectUIKit,
    activeProjectId,
    activeProjectName,
    publicDirExists,
    configError: projectConfigError,
  } = useProjectUIKit(activeProject);
  const [configErrorDismissed, setConfigErrorDismissed] = useState(false);
  const [canvasMode, setCanvasMode] = useState<'single' | 'multi'>('single');
  const [activeDesignInstanceId, setActiveDesignInstanceId] = useState<string | null>(null);
  const [activeBoardInstance, setActiveBoardInstance] = useState<string | null>(null);
  const [isBoardModeActive, setBoardModeActive] = useState(
    canvasMode === 'multi' || loadPersistedState().mode === 'board',
  );

  // Sync board mode when canvas mode changes (IframeCanvas detects multi-instance composition)
  // Skip initial render — isBoardModeActive is already initialized from localStorage
  const canvasModeInitRef = useRef(true);
  useEffect(() => {
    if (canvasModeInitRef.current) {
      canvasModeInitRef.current = false;
      return;
    }
    if (canvasMode === 'multi') {
      setBoardModeActive(true);
      setActiveDesignInstanceId(null);
    } else {
      setBoardModeActive(false);
    }
  }, [canvasMode]);

  const [editPopupOpen, setEditPopupOpen] = useState(false);
  const [sidebarsHidden, setSidebarsHidden] = useState(false);

  // Track iframe scroll position for comment sticker repositioning (ref for RAF, no re-render)
  const iframeScrollRef = useRef({ x: 0, y: 0 });

  const [editingInstanceId, setEditingInstanceId] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportState>(DEFAULT_VIEWPORT);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const portalContainerRef = useRef<HTMLDivElement>(null);
  const selectedIds = useSelectedIds();
  const selectedItemIndices = useSelectedItemIndices();
  const hoveredId = useHoveredId();
  const hoveredItemIndex = useHoveredItemIndex();
  const engine = useCanvasEngine();
  const store = useCanvasStore();
  const storeUpdateCounter = useStore(store, (state) => state._updateCounter);
  const { meta, loadComponent, parseError } = useComponentMeta();

  // Convert parseError string to RuntimeError format for LogsPanel
  const parseErrorAsRuntimeError = useMemo((): RuntimeError | null => {
    if (!parseError) return null;
    // Parse line:column from error like "Identifier 'SampleDefault' has already been declared. (381:13)"
    const lineMatch = parseError.match(/\((\d+):(\d+)\)$/);
    return {
      framework: 'vite',
      type: 'ParseError',
      message: parseError,
      line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
      fullText: parseError,
    };
  }, [parseError]);

  const [mode, setMode] = useState<'design' | 'interact' | 'code'>(engine.getMode());

  // Load available components when project is running
  const availableComponents = useComponentAutoLoad({
    activeProjectId: activeProject?.id,
    activeProjectStatus: activeProject?.status,
    currentComponentName: meta?.componentName,
    mode,
    loadComponent,
  });

  const {
    activeFilePath,
    setActiveFile,
    isAddingComment,
    setIsAddingComment,
    selectedCommentId,
    setSelectedCommentId,
    showComments,
    setProjectRole,
    isReadonly,
    // AI Chat state
    isAIChatOpen,
    isAIChatDocked,
    aiChatSidebarWidth,
    aiChatInitialPrompt,
    aiChatForceNewChat,
    setIsAIChatDocked,
    setAIChatSidebarWidth,
    closeAIChat,
    clearAIChatPrompt,
    // Left sidebar width
    leftSidebarWidth,
    setLeftSidebarWidth,
  } = useEditorStore();
  const { accessToken, connectionError } = useAuthStore();

  // Project control (start/stop/restart, auto-start logic)
  const { handleStartProject, handleRestartProject, handleProjectUpdate, wasRunningRef } = useProjectControl({
    activeProject,
    setActiveProject,
    setIsStarting,
    setProjectRole,
  });

  // SSE subscriptions and network status (project stream, file watcher, polling)
  const { sseStatus, isOnline, pollStatus } = useProjectSSE({
    accessToken,
    activeProject,
    setActiveProject,
    handleProjectUpdate,
  });

  // Comments for current component
  const {
    comments,
    createComment,
    refetch: refetchComments,
  } = useComments({
    projectId: meta?.projectId,
    componentPath: meta?.relativeFilePath,
  });

  // Board mode drawing state and annotation operations
  const {
    boardTool,
    setBoardTool,
    drawingStyle,
    effectiveDrawingStyle,
    handleDrawingStyleChange,
    annotations,
    selectedAnnotationIds,
    setSelectedAnnotationIds,
    handleAnnotationsChange,
    handleAnnotationSelectionChange,
    handleDrawingToolComplete,
    annotationOperations,
    annotationStore,
  } = useDrawingState({
    engine,
    projectId: meta?.projectId,
    componentPath: meta?.relativeFilePath,
  });

  const isCodeEditorMode = mode === 'code' && !isBoardModeActive;

  // Smart deferred mounting: prioritize component based on initial mode
  // Both components stay mounted after first mount to enable fast switching
  const initialModeRef = useRef(mode);
  const [codeServerReady, setCodeServerReady] = useState(mode === 'code');
  const [iframeReady, setIframeReady] = useState(mode !== 'code');

  // Deferred mount of secondary component after primary is loaded
  useEffect(() => {
    if (activeProject?.status !== 'running') return;

    // If user switches to code mode before deferred mount - mount immediately
    if (isCodeEditorMode && !codeServerReady) {
      setCodeServerReady(true);
      return;
    }

    // If starting in code mode - mount IDE first, iframe deferred
    if (initialModeRef.current === 'code') {
      setCodeServerReady(true);
      const timer = setTimeout(() => setIframeReady(true), 1000);
      return () => clearTimeout(timer);
    }

    // If starting in design mode - mount iframe first, IDE deferred
    setIframeReady(true);
    const timer = setTimeout(() => setCodeServerReady(true), 1000);
    return () => clearTimeout(timer);
  }, [activeProject?.status, isCodeEditorMode, codeServerReady]);

  // If user switches to design mode before deferred mount - mount immediately
  useEffect(() => {
    if (!isCodeEditorMode && !iframeReady && activeProject?.status === 'running') {
      setIframeReady(true);
    }
  }, [isCodeEditorMode, iframeReady, activeProject?.status]);

  // Auto-undock AI chat when switching to code mode
  useEffect(() => {
    if (isCodeEditorMode && isAIChatDocked) {
      setIsAIChatDocked(false);
    }
  }, [isCodeEditorMode, isAIChatDocked, setIsAIChatDocked]);

  // Track iframe load events to trigger overlay recomputation
  const { iframeLoadedCounter, instancesReadyCounter, triggerIframeReload } = useIframeLoadTracking({
    enabled: !!activeProject && activeProject.status === 'running' && !isCodeEditorMode,
    isBoardModeActive,
    componentName: meta?.componentName,
  });

  // Instance positioning and sizing
  const {
    instances,
    setInstances,
    draggingInstanceRef,
    handleInstanceMove,
    handleInstanceDragEnd,
    handleInstanceDragging,
    handleInstanceSizeChange,
    applyInstanceSizeChange,
    pendingSizeChange,
    setPendingSizeChange,
  } = useInstancePositioning({
    projectId: activeProject?.id,
    componentPath: meta?.relativeFilePath,
    canvasMode,
    comments,
    annotationStore,
    refetchComments,
    instancesReadyCounter,
  });

  // Canvas composition management (load, save, reload)
  useCanvasComposition({
    projectId: meta?.projectId,
    componentPath: meta?.relativeFilePath,
    isBoardModeActive,
    viewport,
    annotationStore,
    setViewport,
    setInstances,
  });

  // Instance operations for board mode (copy, cut, paste, duplicate, delete)
  const {
    handleInstanceEdit,
    handleInstanceCopy,
    handleInstanceCut,
    handleInstancePaste,
    handleInstanceDuplicate,
    handleInstanceDelete,
  } = useInstanceOperations(
    {
      projectId: meta?.projectId,
      componentPath: meta?.relativeFilePath,
      setActiveBoardInstance,
      setInstances,
    },
    {
      editingInstanceId,
      setEditingInstanceId,
      editPopupOpen,
      setEditPopupOpen,
    },
  );

  // Panel management (ComponentNavigator, InsertInstance)
  const {
    elementY,
    panelOpenForId,
    showInsertPanel,
    selectedComponentType,
    selectedComponentFilePath,
    setSelectedComponentType,
    handleClosePanel,
    handleOpenPanel,
    handleComponentClick,
    handleOpenInsertPanel,
    handleCreatePage,
    handleCreateComponent,
    handleElementPosition,
  } = usePanelManagement({
    engine,
    selectedIds,
  });

  // Element interaction (click, hover)
  const { handleElementClick, handleElementHover, handleHoverElement } = useElementInteraction({
    engine,
    selectedCommentId,
    selectedAnnotationIds,
    setSelectedCommentId,
    setSelectedAnnotationIds,
  });

  // Gateway error handling
  const { hasGatewayError, gatewayErrorMessage, handleRetryLoad, handleGatewayError } = useGatewayErrorHandling({
    projectConfigError,
    componentPath: meta?.relativeFilePath,
    loadComponent,
  });

  const handleIframeErrorChange = useCallback((error: string | null, retryCount: number) => {
    setIframeError({ message: error, retryCount });
  }, []);

  // Comment handlers
  const {
    pendingCommentPosition,
    showSizeSelectionForComment,
    setShowSizeSelectionForComment,
    handleAddComment,
    handleBeforeAddComment,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentSelect,
    handleSizeSelectionForComment,
  } = useCommentHandlers({
    engine,
    componentPath: meta?.relativeFilePath,
    canvasMode,
    instances,
    createComment,
    setIsAddingComment,
    setSelectedCommentId,
    applyInstanceSizeChange,
  });

  // Instance interaction handlers
  const {
    handleInstanceSingleClick,
    handleInstanceDoubleClick,
    handleInstanceBadgeClick,
    handleOtherInstanceClick,
    handleEmptyClick,
  } = useInstanceInteraction({
    engine,
    mode,
    canvasMode,
    activeDesignInstanceId,
    isBoardModeActive,
    selectedCommentId,
    setActiveDesignInstanceId,
    setActiveBoardInstance,
    setBoardModeActive,
    setSelectedCommentId,
    setSelectedAnnotationIds,
    setEditingInstanceId,
    setEditPopupOpen,
  });

  // Setup all keyboard hotkeys
  useHotkeysSetup({
    engine,
    selectedIds,
    meta,
    activeDesignInstanceId,
    isBoardModeActive,
    activeBoardInstance,
    isCodeEditorMode,
    iframeLoadedCounter,
    handleInstancePaste,
    handleInstanceDelete,
    handleInstanceDuplicate,
    handleInstanceCopy,
    handleInstanceCut,
    setActiveBoardInstance,
    setSidebarsHidden,
    setIsAddingComment,
    isAddingComment,
    selectedCommentId,
    setSelectedCommentId,
  });

  // RAF loop for updating comment sticker positions during scroll/drag
  useCanvasComments({
    activeProjectStatus: activeProject?.status,
    isCodeEditorMode,
    mode,
    canvasMode,
    iframeScrollRef,
    draggingInstanceRef,
  });

  // Update document title based on mode and active content
  const documentTitle =
    isCodeEditorMode && activeFilePath ? activeFilePath.split('/').pop() || null : meta?.componentName || null;
  useDocumentTitle(documentTitle);

  // Sync mode state with engine
  useEffect(() => {
    const handleModeChange = ({ mode }: { mode: 'design' | 'interact' | 'code' }) => {
      setMode(mode);

      // Clear className analysis cache when entering interact mode
      if (mode === 'interact') {
        authFetch('/api/clear-classname-cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }).catch((error) => {
          console.error('[CanvasEditor] Failed to clear className cache:', error);
        });
      }
    };

    engine.events.on('mode:change', handleModeChange);

    return () => {
      engine.events.off('mode:change', handleModeChange);
    };
  }, [engine]);

  // Setup git status listener (listens to window events from consolidated SSE)
  useEffect(() => {
    if (!activeProject?.path) return;
    return useGitStore.getState().setupGitStatusListener();
  }, [activeProject?.path]);

  // Handle active file change from code-server IDE (for title/preview sync)
  const handleIDEActiveFileChange = useCallback(
    (filePath: string | null) => {
      if (filePath) {
        // Normalize path - remove /app prefix if present
        const normalizedPath = filePath.replace(/^\/app\//, '');
        setActiveFile(normalizedPath);
      }
    },
    [setActiveFile],
  );

  // Handle Go to Visual from code-server IDE (SSE event)
  const handleGoToVisual = useCallback(
    (uniqId: string, elementType: string, filePath: string) => {
      console.log(`[CanvasEditor] Go to Visual: ${uniqId} (${elementType}) in ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

      // Load the component (triggers canvas reload)
      loadComponent(filePath);

      // Switch to design mode after component loads
      // Need to wait for component-loaded event before selecting
      const handleComponentLoaded = () => {
        if (engine.getMode() !== 'design') {
          engine.setMode('design');
        }
        // Small delay to ensure canvas DOM is updated
        setTimeout(() => {
          engine.select(uniqId);
        }, 100);
        window.removeEventListener('component-loaded', handleComponentLoaded);
      };

      window.addEventListener('component-loaded', handleComponentLoaded);
    },
    [engine, loadComponent],
  );

  // Handlers for saving conditional and map expressions
  const { handleCondSave, handleMapSave } = useCondMapSave({
    editingCondBoundary,
    editingMapBoundary,
    engine,
  });

  // Direct DOM rendering of overlays with requestAnimationFrame
  useOverlayMapCondHighlightComponents(
    activeProject,
    mode,
    overlayContainerRef,
    engine,
    setEditingMapBoundary,
    setEditingCondBoundary,
    meta,
    iframeLoadedCounter,
    storeUpdateCounter,
    viewport,
  );

  // Instance overlays (frames and badges) for multi-instance mode
  useInstanceOverlays({
    boardModeActive: isBoardModeActive,
    activeInstanceId: activeDesignInstanceId,
    selectedInstancesInBoard: selectedIds,
    mode: mode ?? 'interact',
    overlayContainerRef: instanceOverlayContainerRef,
    iframeLoadedCounter,
    projectId: activeProject?.id,
    componentPath: meta?.relativeFilePath,
    onSingleClick: handleInstanceSingleClick,
    onDoubleClick: handleInstanceDoubleClick,
    onBadgeClick: handleInstanceBadgeClick,
    onInstanceMove: handleInstanceMove,
    onInstanceDragging: handleInstanceDragging,
    onInstanceDragEnd: handleInstanceDragEnd,
    viewport,
    instanceSizes: instances,
    iframeScrollRef,
    isReadonly,
  });

  // iPhone bezel overlays for instances with matching size
  useBezelOverlays({
    overlayContainerRef: instanceOverlayContainerRef,
    iframeLoadedCounter,
    instanceSizes: instances,
  });

  // Off-screen instance indicators (arrows on edges) - uses separate container outside transform
  useOffscreenIndicators({
    enabled: isBoardModeActive,
    overlayContainerRef: edgeIndicatorsContainerRef,
    viewport,
    iframeLoadedCounter,
  });

  // Viewport controls (zoom & pan) - only active in multi/board mode
  const { setZoom } = useViewportControls({
    viewport,
    onViewportChange: setViewport,
    containerRef: canvasContainerRef,
    enabled: canvasMode === 'multi',
  });

  // Reset zoom to 100% and pan to show top-left instance (Shift+0)
  const resetZoomToTopLeftInstance = useCallback(() => {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      // Fallback to origin if no iframe
      setViewport({ zoom: 1, panX: 0, panY: 0 });
      return;
    }

    const instanceElements = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');

    if (instanceElements.length === 0) {
      // No instances - reset to origin
      setViewport({ zoom: 1, panX: 0, panY: 0 });
      return;
    }

    // Find top-left instance (minimum x, minimum y)
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;

    for (const element of instanceElements) {
      const htmlElement = element as HTMLElement;
      const left = Number.parseInt(htmlElement.style.left || '0', 10);
      const top = Number.parseInt(htmlElement.style.top || '0', 10);

      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
    }

    // Set zoom to 100% and pan to show top-left instance with padding
    const padding = 40;
    setViewport({
      zoom: 1,
      panX: -minX + padding,
      panY: -minY + padding,
    });
  }, []);

  // Fit to content - calculate zoom to fit all instances
  const handleFitToContent = useCallback(() => {
    if (!isBoardModeActive || !canvasContainerRef.current) return;

    const iframe = getPreviewIframe();
    if (!iframe || !iframe.contentDocument) return;

    const instanceElements = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
    if (instanceElements.length === 0) return;

    // Find bounding box of all instances
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const element of instanceElements) {
      const htmlElement = element as HTMLElement;
      const left = Number.parseInt(htmlElement.style.left || '0', 10);
      const top = Number.parseInt(htmlElement.style.top || '0', 10);
      const rect = htmlElement.getBoundingClientRect();
      const width = rect.width / viewport.zoom; // Divide by current zoom to get actual size
      const height = rect.height / viewport.zoom;

      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;

    const containerRect = canvasContainerRef.current.getBoundingClientRect();
    const padding = 80; // 80px padding around content

    // Calculate zoom to fit
    const zoomX = (containerRect.width - padding * 2) / contentWidth;
    const zoomY = (containerRect.height - padding * 2) / contentHeight;
    const newZoom = Math.min(zoomX, zoomY, 2); // Max 200%

    // Center content
    const newPanX = (containerRect.width - contentWidth * newZoom) / 2 - minX * newZoom;
    const newPanY = (containerRect.height - contentHeight * newZoom) / 2 - minY * newZoom;

    setViewport({
      zoom: newZoom,
      panX: newPanX,
      panY: newPanY,
    });
  }, [isBoardModeActive, viewport.zoom]);

  // Reset instance selection when component changes
  const prevComponentPathRef = useRef(meta?.relativeFilePath);
  useEffect(() => {
    const currentPath = meta?.relativeFilePath;
    if (prevComponentPathRef.current !== currentPath && currentPath !== undefined) {
      setActiveDesignInstanceId(null);
      setActiveBoardInstance(null);
    }
    prevComponentPathRef.current = currentPath;
  }, [meta?.relativeFilePath]);

  // Listen for scroll events in iframe to update comment positions (updates ref, not state - no re-render)
  // biome-ignore lint/correctness/useExhaustiveDependencies: dependencies are triggers to re-attach listener on iframe reload
  useEffect(() => {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) return;

    const doc = iframe.contentDocument;
    const updateScroll = () => {
      iframeScrollRef.current = {
        x: doc.documentElement.scrollLeft || doc.body.scrollLeft || 0,
        y: doc.documentElement.scrollTop || doc.body.scrollTop || 0,
      };
    };

    // Initial sync
    updateScroll();

    // Listen to scroll on both document and body (different browsers)
    doc.addEventListener('scroll', updateScroll, { passive: true });
    doc.body?.addEventListener('scroll', updateScroll, { passive: true });

    return () => {
      doc.removeEventListener('scroll', updateScroll);
      doc.body?.removeEventListener('scroll', updateScroll);
    };
    // Re-attach listener when iframe reloads or project status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeLoadedCounter, activeProject?.status]);

  // Listen for external file changes (AI agent, code-server, Monaco, chokidar) → record in undo/redo history
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.redoSnapshotId !== undefined || detail?.undoSnapshotId !== undefined) {
        engine.recordExternalFileChange(detail);
      }
    };
    window.addEventListener('hypercanvas:externalFileChange', handler);
    return () => window.removeEventListener('hypercanvas:externalFileChange', handler);
  }, [engine]);

  // Selection overlays (hover + selection rectangles) via RAF
  useSelectionOverlays({
    enabled: !!activeProject && activeProject.status === 'running' && !isCodeEditorMode && !isAddingComment,
    overlayContainerRef,
    hoveredId,
    hoveredItemIndex,
    selectedIds,
    selectedItemIndices,
    activeDesignInstanceId,
    viewportZoom: viewport.zoom,
    iframeLoadedCounter,
  });

  // Handle single mode badge click
  const handleSingleModeBadgeClick = useCallback(() => {
    setEditingInstanceId('default');
    setEditPopupOpen(true);
  }, []);

  // Unified handler for Toolbar mode changes
  const handleToolbarModeChange = useCallback(
    (newMode: Tool) => {
      console.log(
        '[CanvasEditor] handleToolbarModeChange:',
        newMode,
        'boardModeActive:',
        isBoardModeActive,
        'currentMode:',
        mode,
      );

      setBoardModeActive(newMode === 'board');

      if (newMode === 'board') {
        // Persist board mode so it survives HMR remounts
        savePersistedState({ mode: 'board' });
        // Enter board mode → clear active instance and board selection
        setActiveDesignInstanceId(null);
        setActiveBoardInstance(null);
        return;
      }

      engine.setMode(newMode);

      if (newMode === 'code') {
        // Code mode doesn't use instances
        setActiveDesignInstanceId(null);
        setActiveBoardInstance(null);
        return;
      }

      // For design/interact modes
      // If coming from code mode or board mode without active instance, select first instance
      if (isCodeEditorMode || isBoardModeActive) {
        // Clear board selection when entering design/interact
        setActiveBoardInstance(null);

        // Need to select first instance before switching mode
        const iframe = getPreviewIframe();
        if (iframe?.contentDocument) {
          const iframeInstances = iframe.contentDocument.querySelectorAll('[data-canvas-instance-id]');
          if (iframeInstances.length > 0) {
            const firstInstanceId = (iframeInstances[0] as HTMLElement).dataset.canvasInstanceId;
            if (firstInstanceId) {
              setActiveDesignInstanceId(firstInstanceId);
            }
          }
        }
      }
    },
    [engine, isBoardModeActive, mode, isCodeEditorMode],
  );

  return (
    <CanvasElementContextMenu
      data-uniq-id="91608c9c-873c-4fb5-bc7e-61af77ef410f"
      selectedIds={selectedIds}
      iframeLoadCounter={iframeLoadedCounter}
      boardModeActive={isBoardModeActive}
      activeDesignInstanceId={activeDesignInstanceId}
      projectId={activeProject?.id}
      onInstanceEdit={handleInstanceEdit}
      onInstanceCopy={handleInstanceCopy}
      onInstanceCut={handleInstanceCut}
      onInstancePaste={handleInstancePaste}
      onInstanceDuplicate={handleInstanceDuplicate}
      onInstanceDelete={handleInstanceDelete}
    >
      <div
        data-uniq-id="d76d68dc-620d-4ad6-b094-ebbf49430d73"
        className="h-screen bg-muted overflow-hidden flex relative"
      >
        {/* Left Sidebar - hidden in code mode (code-server has its own explorer) */}
        {!sidebarsHidden && !isCodeEditorMode && (
          <>
            <div data-uniq-id="6d51b678-1b74-45c1-9612-769b13c121dd" style={{ width: leftSidebarWidth, flexShrink: 0 }}>
              <LeftSidebar
                onElementPosition={handleElementPosition}
                onHoverElement={handleHoverElement}
                hoveredId={hoveredId}
                onOpenPanel={handleOpenPanel}
                onCreatePage={handleCreatePage}
                onCreateComponent={handleCreateComponent}
              />
            </div>

            <DragResizeHandle value={leftSidebarWidth} onChange={setLeftSidebarWidth} minValue={200} maxValue={600} />
          </>
        )}

        {/* Canvas Area */}
        <div data-uniq-id="bf326e7f-4bb4-4243-b74f-dd07fedc06b3" className="flex-1 min-w-0">
          <div className="h-full relative">
            <div
              data-uniq-id="5547cbf1-2eb8-426e-8e66-dfc07966f874"
              ref={canvasContainerRef}
              className="h-full overflow-auto"
              style={{
                touchAction: 'pan-x pan-y',
                overscrollBehaviorX: 'none',
              }}
            >
              {/* Canvas area - visibility-based mode switching for fast toggle */}
              {/* Code mode: CodeServerIDE stays mounted once loaded */}
              {codeServerReady && (
                <div
                  style={{
                    display: isCodeEditorMode ? 'contents' : 'none',
                  }}
                >
                  <CodeServerIDE
                    projectId={activeProject?.id || ''}
                    className="h-full"
                    onActiveFileChange={handleIDEActiveFileChange}
                    onOpenProjectSettings={onOpenSettings}
                    onGoToVisual={handleGoToVisual}
                  />
                </div>
              )}

              {/* Design mode: stays mounted when switching to code */}
              <div
                style={{
                  display: !isCodeEditorMode ? 'contents' : 'none',
                }}
              >
                {projectConfigError && !configErrorDismissed ? (
                  <ConfigErrorOverlay
                    error={projectConfigError.error}
                    projectId={projectConfigError.projectId}
                    onDismiss={() => setConfigErrorDismissed(true)}
                    onOpenSettings={onOpenSettings}
                  />
                ) : activeProject && (activeProject.status === 'running' || wasRunningRef.current) ? (
                  availableComponents.isLoaded &&
                  availableComponents.atoms.length === 0 &&
                  availableComponents.composites.length === 0 ? (
                    <NoComponentsOverlay />
                  ) : meta?.relativeFilePath && iframeReady ? (
                    <>
                      <div
                        style={{
                          // Only use pan&zoom in multi mode - single mode uses fixed size without scaling
                          transform:
                            canvasMode === 'multi'
                              ? `scale(${viewport.zoom}) translate(${viewport.panX / viewport.zoom}px, ${viewport.panY / viewport.zoom}px)`
                              : undefined,
                          transformOrigin: '0 0',
                          // In single mode with custom size, use fixed dimensions; otherwise fill container
                          width:
                            canvasMode === 'multi'
                              ? 'fit-content'
                              : instances.default?.width
                                ? `${instances.default.width}px`
                                : '100%',
                          height:
                            canvasMode === 'multi'
                              ? 'fit-content'
                              : instances.default?.height
                                ? `${instances.default.height}px`
                                : '100%',
                          position: 'relative',
                          zIndex: 1,
                          pointerEvents: isBoardModeActive ? 'none' : 'auto',
                          // Add top padding for badge in single mode
                          paddingTop: canvasMode === 'single' ? '26px' : undefined,
                          // Change cursor when adding comment
                          cursor: isAddingComment ? 'crosshair' : undefined,
                        }}
                      >
                        {/* Single mode badge - above iframe */}
                        {canvasMode === 'single' && (
                          <button
                            type="button"
                            onClick={handleSingleModeBadgeClick}
                            className="absolute top-0 left-0 z-50 px-1 text-[10px] font-semibold text-white bg-blue-500 rounded cursor-pointer hover:bg-blue-600 transition-colors flex items-center gap-1"
                            style={{ margin: '0 0 6px -1px' }}
                          >
                            <span>default</span>
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ flexShrink: 0, opacity: 0.9 }}
                              aria-hidden="true"
                            >
                              <path d="M6 9l6 6l6 -6" />
                            </svg>
                          </button>
                        )}
                        {/* Sync status badge - shows when SSE disconnected or network offline */}
                        {(!isOnline ||
                          sseStatus.projectStream !== 'connected' ||
                          sseStatus.fileWatcher !== 'connected') && (
                          <div className="absolute top-0 right-0 z-50">
                            <Badge variant="destructive" className="flex items-center gap-1.5 animate-pulse">
                              <IconCloudOff className="w-3 h-3" />
                              <span>{!isOnline ? 'Offline' : 'Reconnecting...'}</span>
                            </Badge>
                          </div>
                        )}
                        <IframeCanvas
                          componentPath={meta.relativeFilePath}
                          serverOffline={connectionError}
                          boardModeActive={isBoardModeActive}
                          iframeLoadedCounter={iframeLoadedCounter}
                          activeInstanceId={activeDesignInstanceId}
                          instanceSizes={instances}
                          editorMode={mode}
                          isAddingComment={isAddingComment}
                          onLoadingChange={setIframeLoading}
                          onCanvasModeChange={setCanvasMode}
                          onEmptyClick={handleEmptyClick}
                          onOtherInstanceClick={handleOtherInstanceClick}
                          onElementClick={handleElementClick}
                          onElementHover={handleElementHover}
                          onAddComment={handleAddComment}
                          onGatewayError={handleGatewayError}
                          onRuntimeError={setRuntimeError}
                          onErrorChange={handleIframeErrorChange}
                        />
                        {/* Instance overlay container - inside transform to zoom with content (multi mode) */}
                        {canvasMode === 'multi' && (
                          <div
                            ref={instanceOverlayContainerRef}
                            className="absolute inset-0 pointer-events-none"
                            style={{ zIndex: 50 }}
                          />
                        )}
                      </div>

                      {/* Edge indicators container - outside transform for fixed positioning */}
                      {canvasMode === 'multi' && (
                        <div
                          ref={edgeIndicatorsContainerRef}
                          className="absolute inset-0 pointer-events-none overflow-hidden"
                          style={{ zIndex: 60 }}
                        />
                      )}

                      {/* Iframe error overlay - outside pan&zoom transform so it's always visible */}
                      {iframeError.message && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900 z-10">
                          <div className="text-center max-w-md">
                            <p className="text-destructive mb-2">{iframeError.message}</p>
                            <p className="text-sm text-muted-foreground mb-1">
                              Make sure the project is running and the component exists
                            </p>
                            {iframeError.retryCount > 0 && (
                              <p className="text-xs text-muted-foreground mb-4">
                                Connection attempts: {iframeError.retryCount}/10
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* LogsPanel moved outside scroll container — see below */}
                    </>
                  ) : parseError ? (
                    <div
                      data-uniq-id="d548dedd-3433-477e-80b4-f89cf0e5c4c8"
                      className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900"
                    >
                      <div data-uniq-id="b4549492-9d26-45de-9be0-b717b0564794" className="text-center max-w-md">
                        <div className="text-destructive text-4xl mb-4">⚠</div>
                        <p className="text-sm text-destructive font-medium mb-2">Failed to parse component</p>
                        <p className="text-xs text-muted-foreground mb-4 break-words">{parseError}</p>
                        <Button variant="outline" size="sm" onClick={handleRetryLoad}>
                          Retry
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      data-uniq-id="cda23b91-1234-4567-89ab-cdef01234567"
                      className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900"
                    >
                      <div data-uniq-id="def01234-5678-9abc-def0-123456789abc" className="text-center">
                        <div
                          data-uniq-id="8d81b7cf-1be3-4b11-80fa-3bc882e5446e"
                          className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"
                        />
                        <p data-uniq-id="897d4992-52e1-40b3-b386-39746f9ade79" className="text-sm text-slate-400">
                          Loading component...
                        </p>
                      </div>
                    </div>
                  )
                ) : activeProject?.status === 'error' ? (
                  <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-900">
                    <div className="flex-1 flex items-center justify-center">
                      <IframeFailed
                        {...{
                          activeProject,
                          setIsStarting,
                          setActiveProject,
                          onOpenSettings,
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <ProjectStartOverlay
                    project={activeProject}
                    isStarting={isStarting}
                    onRestart={handleRestartProject}
                    onStart={handleStartProject}
                    pollStatus={pollStatus}
                  />
                )}
              </div>

              {/* Only show panels in design/interact mode */}
              {!isCodeEditorMode && panelOpenForId && (
                <ComponentNavigatorPanel
                  data-uniq-id="fab03afe-f632-4d52-a2ca-ae53392f3ad2"
                  onClose={handleClosePanel}
                  elementY={elementY}
                  onComponentClick={handleComponentClick}
                  selectedComponentType={selectedComponentType}
                  onSelectComponent={setSelectedComponentType}
                />
              )}
              {!isCodeEditorMode && showInsertPanel && selectedComponentType && (
                <InsertInstancePanel
                  data-uniq-id="f215f12f-f95e-47cc-b0ff-016046593f5f"
                  onClose={handleClosePanel}
                  elementY={elementY}
                  selectedComponentType={selectedComponentType}
                  componentFilePath={selectedComponentFilePath}
                />
              )}
              <Toolbar
                data-uniq-id="d984a864-d10e-465b-8747-cc7bb9612f5e"
                mode={isBoardModeActive ? 'board' : (mode ?? 'design')}
                onModeChange={handleToolbarModeChange}
                onResetZoom={resetZoomToTopLeftInstance}
                boardTool={boardTool}
                onBoardToolChange={setBoardTool}
                drawingStyle={effectiveDrawingStyle}
                onDrawingStyleChange={handleDrawingStyleChange}
                canvasMode={canvasMode}
                onBeforeAddComment={handleBeforeAddComment}
                onOpenInsertPanel={handleOpenInsertPanel}
              />

              {/* Selection overlay container - for design/interact mode (NOT transformed) */}
              {/* Always render to keep ref stable, hide via CSS when not needed */}
              <div
                data-uniq-id="ba167233-03de-464b-9242-b0f3a75dd646"
                ref={overlayContainerRef}
                className="fixed inset-0 pointer-events-none z-10"
                style={{
                  display: isCodeEditorMode || isBoardModeActive ? 'none' : undefined,
                }}
              />

              {/* Annotations layer - above instances (z-index: 60) */}
              {/* Uses fixed positioning to ensure it's above overflow:auto container */}
              {isBoardModeActive && canvasContainerRef.current && (
                <AnnotationsLayerPortal containerRef={canvasContainerRef}>
                  <AnnotationsLayer
                    canvasContainerRef={canvasContainerRef}
                    viewport={viewport}
                    activeTool={boardTool}
                    annotations={annotations}
                    instances={instances}
                    drawingStyle={drawingStyle}
                    selectedIds={selectedAnnotationIds}
                    onSelectionChange={handleAnnotationSelectionChange}
                    onEmptyClick={() => engine.clearSelection()}
                    onInstancesSelect={(ids) => {
                      // Select instances via engine (don't clear annotations - marquee can select both)
                      engine.selectMultiple(ids);
                    }}
                    onChange={handleAnnotationsChange}
                    operations={annotationOperations}
                    onToolComplete={handleDrawingToolComplete}
                  />
                </AnnotationsLayerPortal>
              )}

              {/* Portal container for popups */}
              <div data-uniq-id="619bbf5f-ff78-4979-a95d-1cfb079d3ac4" ref={portalContainerRef} />

              {/* Comment stickers - design mode (including board), hide resolved */}
              {mode === 'design' && (
                <CommentStickersOverlay
                  comments={comments}
                  selectedCommentId={selectedCommentId}
                  canvasMode={canvasMode}
                  viewportZoom={viewport.zoom}
                  onCommentSelect={handleCommentSelect}
                />
              )}

              {/* Pending comment input - shown after clicking to add comment (design mode only) */}
              {mode === 'design' && pendingCommentPosition && (
                <PendingCommentInputOverlay
                  position={pendingCommentPosition}
                  canvasMode={canvasMode}
                  viewportZoom={viewport.zoom}
                  onSubmit={handleCommentSubmit}
                  onCancel={handleCommentCancel}
                />
              )}

              {/* CondEditPopup - only in design/interact mode */}
              {!isCodeEditorMode && editingCondBoundary && portalContainerRef.current && (
                <CondEditPopup
                  data-uniq-id="d6f3df7f-c4f1-4c50-ae40-4d0b1b2aeaf0"
                  boundary={editingCondBoundary}
                  portalContainer={portalContainerRef.current}
                  onClose={() => setEditingCondBoundary(null)}
                  onSave={handleCondSave}
                />
              )}

              {/* MapEditPopup - only in design/interact mode */}
              {!isCodeEditorMode && editingMapBoundary && portalContainerRef.current && (
                <MapEditPopup
                  data-uniq-id="1559fcd2-4897-4673-9501-6a9f3bc320d4"
                  boundary={editingMapBoundary}
                  portalContainer={portalContainerRef.current}
                  onClose={() => setEditingMapBoundary(null)}
                  onSave={handleMapSave}
                  projectId={activeProject?.id}
                  componentPath={meta?.relativeFilePath}
                  instanceId={canvasMode === 'single' ? 'default' : activeDesignInstanceId || Object.keys(instances)[0]}
                  onItemsGenerated={() => {
                    // Trigger refresh after items generated
                    triggerIframeReload();
                  }}
                />
              )}

              {/* InstanceEditPopup - for editing multi-instance sampleRenderers or props */}
              <InstanceEditPopup
                data-uniq-id="9aef61b1-4f84-486e-9fef-2d62cdc3ef69"
                isOpen={editPopupOpen}
                onClose={() => setEditPopupOpen(false)}
                instanceId={editingInstanceId}
                projectId={activeProject?.id}
                componentPath={meta?.relativeFilePath}
                componentName={meta?.componentName}
                instanceConfig={editingInstanceId ? instances[editingInstanceId] : undefined}
                isSingleMode={canvasMode === 'single'}
                onSave={() => {
                  // Reload iframe to show updated code via HMR
                  triggerIframeReload();
                  setEditPopupOpen(false);
                }}
                onDelete={() => {
                  // Reload iframe to remove deleted instance
                  triggerIframeReload();
                  setEditPopupOpen(false);
                }}
              />
            </div>

            {/* LogsPanel — outside scroll container so it stays pinned at bottom */}
            {!isCodeEditorMode &&
              (hasGatewayError || runtimeError || parseErrorAsRuntimeError) &&
              activeProject?.id && (
                <LogsPanel
                  projectId={activeProject.id}
                  containerStatus={activeProject.status}
                  projectInfo={{
                    name: activeProject.name,
                    framework: activeProject.framework ?? '',
                    path: activeProject.path ?? '',
                    devCommand: activeProject.devCommand ?? '',
                  }}
                  proxyError={gatewayErrorMessage}
                  runtimeError={runtimeError || parseErrorAsRuntimeError}
                  height={logsHeight}
                  onHeightChange={setLogsHeight}
                />
              )}
          </div>
        </div>

        {/* Right sidebar for design/interact mode - shows docked AI chat or RightSidebar */}
        {!isCodeEditorMode && !sidebarsHidden && (
          <div
            data-uniq-id="a84b6623-bbf3-4e3e-af79-e7b03056ad45"
            className="flex-shrink-0"
            style={{
              width: isAIChatDocked && isAIChatOpen ? aiChatSidebarWidth : showComments ? commentsSidebarWidth : 234,
            }}
          >
            <div className="flex-1 flex flex-col h-full">
              {isAIChatDocked && isAIChatOpen ? // Spacer content is empty — AI chat renders as fixed overlay
              null : (
                // Regular RightSidebar
                <RightSidebar
                  data-uniq-id="0ba37253-0ccd-4e90-be7c-6caf6ccacde2"
                  onOpenSettings={onOpenSettings}
                  viewport={viewport}
                  onZoomChange={setZoom}
                  onFitToContent={handleFitToContent}
                  activeInstanceId={activeDesignInstanceId}
                  onInstanceBadgeClick={handleInstanceBadgeClick}
                  canvasMode={canvasMode}
                  instanceSize={(() => {
                    // In single mode use 'default' instance, in multi mode find any instance with size
                    if (canvasMode === 'single') {
                      const def = instances.default;
                      if (def?.width && def?.height) {
                        return { width: def.width, height: def.height };
                      }
                      return undefined;
                    }
                    // Multi mode: find first instance that has width and height defined
                    const instanceWithSize = Object.values(instances).find((inst) => inst?.width && inst?.height);
                    if (instanceWithSize) {
                      return {
                        width: instanceWithSize.width,
                        height: instanceWithSize.height,
                      };
                    }
                    return undefined;
                  })()}
                  onInstanceSizeChange={handleInstanceSizeChange}
                  projectUIKit={projectUIKit}
                  activeProjectId={activeProjectId}
                  activeProjectName={activeProjectName}
                  publicDirExists={publicDirExists}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {/* Single AI Chat instance — CSS switches between docked and floating */}
      {isAIChatOpen && activeProject?.path && (
        <div
          data-ai-chat-modal
          className={cn(
            'bg-background',
            isAIChatDocked && !isCodeEditorMode && !sidebarsHidden
              ? 'fixed top-0 right-0 bottom-0 border-l border-border z-50'
              : 'fixed bottom-24 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-lg border border-border shadow-xl z-[999]',
          )}
          style={isAIChatDocked && !isCodeEditorMode && !sidebarsHidden ? { width: aiChatSidebarWidth } : undefined}
        >
          <AIAgentChat
            projectPath={activeProject.path}
            projectId={activeProject.id}
            componentPath={meta?.relativeFilePath}
            selectedElementIds={selectedIds}
            initialPrompt={aiChatInitialPrompt}
            forceNewChat={aiChatForceNewChat}
            onPromptSent={clearAIChatPrompt}
            isDocked={isAIChatDocked}
            onDock={() => setIsAIChatDocked(true)}
            onUndock={() => setIsAIChatDocked(false)}
            onClose={closeAIChat}
          />
        </div>
      )}
      {/* Right sidebar resize handle — rendered AFTER AI chat so DOM order wins at same z-50 */}
      {!isCodeEditorMode && !sidebarsHidden && ((isAIChatDocked && isAIChatOpen) || showComments) && (
        <DragResizeHandle
          orientation="vertical"
          value={isAIChatDocked && isAIChatOpen ? aiChatSidebarWidth : commentsSidebarWidth}
          onChange={isAIChatDocked && isAIChatOpen ? setAIChatSidebarWidth : setCommentsSidebarWidth}
          minValue={300}
          maxValue={isAIChatDocked && isAIChatOpen ? 600 : 500}
          inverted
          fixed
          offset={isAIChatDocked && isAIChatOpen ? aiChatSidebarWidth : commentsSidebarWidth}
        />
      )}
      {/* Size change confirmation dialog - shown when comments exist */}
      <AlertDialog open={!!pendingSizeChange} onOpenChange={(open) => !open && setPendingSizeChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change viewport size?</AlertDialogTitle>
            <AlertDialogDescription>
              You have comments on this component. Changing the viewport size may cause comments to appear in unexpected
              positions.
              <br />
              <br />
              <strong>Tip:</strong> Instead of changing size, consider adding another instance with different dimensions
              to compare layouts.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingSizeChange) {
                  applyInstanceSizeChange(pendingSizeChange.width, pendingSizeChange.height);
                  setPendingSizeChange(null);
                }
              }}
            >
              Change size anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Size selection dialog - shown when trying to add comment with Auto size */}
      <SizeSelectionDialog
        open={showSizeSelectionForComment}
        onOpenChange={setShowSizeSelectionForComment}
        onSelectSize={handleSizeSelectionForComment}
      />
    </CanvasElementContextMenu>
  );
}

export const SampleDefault = () => {
  const onOpenSettings = () => {
    console.log('Opening settings dialog');
  };
  return (
    <MemoryRouter>
      <CanvasEditor onOpenSettings={onOpenSettings} />
    </MemoryRouter>
  );
};
