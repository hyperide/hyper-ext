import type { OverlayElementResolver } from '@shared/canvas-interaction/types';
import { IconTerminal2 } from '@tabler/icons-react';
import cn from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { AnnotationsLayerPortal } from './components/AnnotationsLayerPortal';
import { useElementResolver } from './hooks/useElementResolver';
import { useCanvasModeSync } from './hooks/useCanvasModeSync';
import { useDeferredMount } from './hooks/useDeferredMount';
import { useComponentChangeReset } from './hooks/useComponentChangeReset';
import { useEngineModeSync } from './hooks/useEngineModeSync';
import { useExternalFileChangeListener, useGitStatusListener } from './hooks/useWindowListeners';
import { useIDEHandlers } from './hooks/useIDEHandlers';
import { useIframeScrollTracking } from './hooks/useIframeScrollTracking';
import { useModeHandlers } from './hooks/useModeHandlers';
import { useViewportHandlers } from './hooks/useViewportHandlers';
import Toolbar from '@/components/Toolbar';
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
import { Button } from '@/components/ui/button';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useDiagnosticSync } from '@/hooks/useDiagnosticSync';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNodePodDiagnosticSync } from '@/hooks/useNodePodDiagnosticSync';
import { useRightSidebarWidth } from '@/hooks/useRightSidebarWidth';
import {
  useCanvasEngine,
  useCanvasStore,
  useHoveredId,
  useHoveredItemIndex,
  useSelectedIds,
  useSelectedItemIndices,
} from '@/lib/canvas-engine';

import { useProjectRuntime } from '@/lib/project-runtime';
import { loadPersistedState, savePersistedState } from '@/lib/storage';
import { useAuthStore } from '@/stores/authStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useEditorStore } from '@/stores/editorStore';

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
import { useLogsPanelState } from './components/hooks/useLogsPanelState';
import { useOffscreenIndicators } from './components/hooks/useOffscreenIndicators';
import { useOverlayMapCondHighlightComponents } from './components/hooks/useOverlayMapCondHighlightComponents';
import { usePanelManagement } from './components/hooks/usePanelManagement';
import type { ProjectData } from './components/hooks/useProjectControl';
import { useSelectionOverlays } from './components/hooks/useSelectionOverlays';
import { useViewportControls } from './components/hooks/useViewportControls';
import { IframeFailed } from './components/IframeFailed';
import { LogsPanel } from './components/LogsPanel';
import { NoComponentsOverlay } from './components/NoComponentsOverlay';
import { PendingCommentInputOverlay } from './components/PendingCommentInputOverlay';
import { PreviewSetupOverlay } from './components/PreviewSetupOverlay';
import { ProjectStartOverlay } from './components/ProjectStartOverlay';
import { SizeSelectionDialog } from './components/SizeSelectionDialog';

type Props = {
  onOpenSettings: () => void;
};

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

  useCanvasModeSync(canvasMode, setBoardModeActive, setActiveDesignInstanceId);

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
  const {
    meta,
    loadComponent,
    parseError,
    previewSetup,
    setPreviewSetup,
    needsPatchPrompt,
    currentSampleName,
    setCurrentSampleName,
  } = useComponentMeta();

  // Reparse with new sampleName when active design instance changes
  useEffect(() => {
    if (!activeDesignInstanceId || !meta?.relativeFilePath) return;
    if (activeDesignInstanceId === currentSampleName) return;
    setCurrentSampleName(activeDesignInstanceId);
    loadComponent(meta.relativeFilePath, activeDesignInstanceId);
  }, [activeDesignInstanceId, meta?.relativeFilePath, currentSampleName, setCurrentSampleName, loadComponent]);

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
  const { accessToken, user } = useAuthStore();
  const serverOffline = useConnectionStore((s) => s.status !== 'connected');

  // Project runtime — selects Docker or NodePod based on user flag + framework
  const runtime = useProjectRuntime(activeProject, user, {
    accessToken,
    setActiveProject,
    setIsStarting,
    setProjectRole,
  });

  // Convert NodePod runtime error string to RuntimeError shape for LogsPanel
  const nodePodRuntimeError = useMemo(
    (): RuntimeError | null =>
      runtime.mode === 'nodepod' && runtime.error
        ? { type: 'RuntimeError', message: runtime.error, framework: 'vite', fullText: runtime.error }
        : null,
    [runtime.mode, runtime.error],
  );

  // Keep isStarting in sync with runtime status (NodePod sets status, not isStarting directly)
  useEffect(() => {
    if (runtime.mode === 'nodepod') {
      setIsStarting(runtime.status === 'starting');
    }
  }, [runtime.mode, runtime.status]);

  // Tell ConnectionStatus we're running a NodePod virtual server
  useEffect(() => {
    useConnectionStore.getState().setNodePodRunning(runtime.mode === 'nodepod' && runtime.status === 'running');
    return () => {
      useConnectionStore.getState().setNodePodRunning(false);
    };
  }, [runtime.mode, runtime.status]);

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

  // Right sidebar effective width (also sets CSS variable for ConnectionStatus badge)
  const rightSidebarWidth = useRightSidebarWidth(isCodeEditorMode, sidebarsHidden, commentsSidebarWidth);

  // Smart deferred mounting: prioritize component based on initial mode
  // Both components stay mounted after first mount to enable fast switching
  const initialModeRef = useRef(mode);
  const [codeServerReady, setCodeServerReady] = useState(mode === 'code');
  const [iframeReady, setIframeReady] = useState(mode !== 'code');

  // Deferred mount of secondary component after primary is loaded
  useDeferredMount({
    activeProjectStatus: activeProject?.status,
    isCodeEditorMode,
    iframeReady,
    codeServerReady,
    setIframeReady,
    setCodeServerReady,
    isAIChatDocked,
    setIsAIChatDocked,
  });

  // Track iframe load events to trigger overlay recomputation
  const { iframeLoadedCounter, instancesReadyCounter, triggerIframeReload } = useIframeLoadTracking({
    enabled:
      !!activeProject &&
      (activeProject.status === 'running' || (runtime.mode === 'nodepod' && runtime.status === 'running')) &&
      !isCodeEditorMode,
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

  const { isLogsPanelOpen, isLogsPanelCollapsed, handleLogsDismiss, handleExpandLogs, handleToggleLogs } =
    useLogsPanelState({ hasGatewayError, runtimeError: runtimeError || nodePodRuntimeError, parseErrorAsRuntimeError });

  // Docker diagnostic sync (no-op when projectId is undefined = NodePod mode)
  const { clear: dockerLogsClear } = useDiagnosticSync({
    projectId: runtime.mode === 'docker' ? activeProject?.id : undefined,
    containerStatus: activeProject?.status,
    runtimeError: runtimeError || parseErrorAsRuntimeError,
    proxyError: gatewayErrorMessage,
  });

  // NodePod diagnostic sync (no-op when enabled = false)
  const { clear: nodePodLogsClear } = useNodePodDiagnosticSync({
    enabled: runtime.mode === 'nodepod',
    logs: runtime.logs,
    runtimeStatus: runtime.status,
    runtimeError: runtime.error,
  });

  const logsClear = runtime.mode === 'nodepod' ? nodePodLogsClear : dockerLogsClear;

  const { handleIframeErrorChange, handleIDEActiveFileChange } = useIDEHandlers({
    setIframeError,
    setActiveFile,
  });

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
    selectedItemIndices,
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

  useEngineModeSync(engine, setMode);

  useGitStatusListener(activeProject?.path);

  const { handleSingleModeBadgeClick, handleToolbarModeChange, handleGoToVisual } = useModeHandlers({
    engine,
    isBoardModeActive,
    isCodeEditorMode,
    mode,
    setActiveDesignInstanceId,
    setActiveBoardInstance,
    setBoardModeActive,
    setEditingInstanceId,
    setEditPopupOpen,
    savePersistedState,
    loadComponent,
  });

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

  const { resetZoomToTopLeftInstance, handleFitToContent } = useViewportHandlers({
    viewport,
    setViewport,
    canvasContainerRef,
    isBoardModeActive,
  });

  useComponentChangeReset(meta?.relativeFilePath, setActiveDesignInstanceId, setActiveBoardInstance);

  useIframeScrollTracking(iframeScrollRef, iframeLoadedCounter, activeProject?.status);

  useExternalFileChangeListener(engine);

  // Build OverlayElementResolver from the active tracer (fiber-based DOM lookup).
  const elementResolver: OverlayElementResolver | undefined = useElementResolver(iframeLoadedCounter, engine);

  // Selection overlays (hover + selection rectangles + empty container placeholders) via RAF
  useSelectionOverlays({
    enabled:
      !!activeProject &&
      (activeProject.status === 'running' || (runtime.mode === 'nodepod' && runtime.status === 'running')) &&
      !isCodeEditorMode &&
      !isAddingComment,
    overlayContainerRef,
    hoveredId,
    hoveredItemIndex,
    selectedIds,
    selectedItemIndices,
    activeDesignInstanceId,
    viewportZoom: viewport.zoom,
    iframeLoadedCounter,
    editorMode: mode,
    onPlaceholderClick: handleOpenPanel,
    elementResolver,
  });

  return (
    <CanvasElementContextMenu
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
      <div className="h-screen bg-muted overflow-hidden flex relative">
        {/* Left Sidebar - hidden in code mode (code-server has its own explorer) */}
        {!sidebarsHidden && !isCodeEditorMode && (
          <>
            <div style={{ width: leftSidebarWidth, flexShrink: 0 }}>
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
        <div className="flex-1 min-w-0">
          <div className="h-full relative">
            <div
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
                    onDismiss={() => setConfigErrorDismissed(true)}
                    onOpenSettings={onOpenSettings}
                  />
                ) : activeProject && (runtime.status === 'running' || runtime.hasBeenRunning) ? (
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
                        <IframeCanvas
                          componentPath={meta.relativeFilePath}
                          serverOffline={serverOffline}
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
                          overrideSrc={runtime.previewUrl ?? undefined}
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
                  ) : previewSetup && previewSetup !== 'ok' ? (
                    <PreviewSetupOverlay
                      status={previewSetup}
                      needsPatchPrompt={needsPatchPrompt}
                      onDismiss={() => setPreviewSetup(null)}
                    />
                  ) : parseError ? (
                    <div className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900">
                      <div className="text-center max-w-md">
                        <div className="text-destructive text-4xl mb-4">⚠</div>
                        <p className="text-sm text-destructive font-medium mb-2">Failed to parse component</p>
                        <p className="text-xs text-muted-foreground mb-4 break-words">{parseError}</p>
                        <Button variant="outline" size="sm" onClick={handleRetryLoad}>
                          Retry
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
                        <p className="text-sm text-slate-400">Loading component...</p>
                      </div>
                    </div>
                  )
                ) : activeProject && (activeProject.status === 'error' || runtime.status === 'error') ? (
                  <div className="h-full flex flex-col bg-slate-100 dark:bg-slate-900">
                    <div className="flex-1 flex items-center justify-center">
                      <IframeFailed
                        activeProject={activeProject}
                        setIsStarting={setIsStarting}
                        setActiveProject={setActiveProject}
                        onOpenSettings={onOpenSettings}
                        runtimeError={runtime.error}
                        onRetry={runtime.restart}
                      />
                    </div>
                  </div>
                ) : (
                  <ProjectStartOverlay
                    project={activeProject}
                    isStarting={isStarting}
                    onRestart={runtime.restart}
                    onStart={runtime.start}
                    pollStatus={runtime.pollStatus}
                  />
                )}
              </div>

              {/* Only show panels in design/interact mode */}
              {!isCodeEditorMode && panelOpenForId && (
                <ComponentNavigatorPanel
                  onClose={handleClosePanel}
                  elementY={elementY}
                  onComponentClick={handleComponentClick}
                  selectedComponentType={selectedComponentType}
                  onSelectComponent={setSelectedComponentType}
                />
              )}
              {!isCodeEditorMode && showInsertPanel && selectedComponentType && (
                <InsertInstancePanel
                  onClose={handleClosePanel}
                  elementY={elementY}
                  selectedComponentType={selectedComponentType}
                  componentFilePath={selectedComponentFilePath}
                />
              )}
              <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-3 z-[1000]">
                <Toolbar
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
                {!isCodeEditorMode &&
                  isLogsPanelCollapsed &&
                  (hasGatewayError || runtimeError || parseErrorAsRuntimeError) && (
                    <button
                      type="button"
                      onClick={handleExpandLogs}
                      className="h-12 w-12 bg-background rounded-[14px] shadow-[0_2px_4px_rgba(0,0,0,0.15),0_2px_16px_rgba(0,0,0,0.15)] border border-border flex items-center justify-center"
                      title="Show logs"
                    >
                      <IconTerminal2 className="w-5 h-5 text-destructive" stroke={1.5} />
                    </button>
                  )}
              </div>

              {/* Selection overlay container - for design/interact mode (NOT transformed) */}
              {/* Always render to keep ref stable, hide via CSS when not needed */}
              <div
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
              <div ref={portalContainerRef} />

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
                  boundary={editingCondBoundary}
                  portalContainer={portalContainerRef.current}
                  onClose={() => setEditingCondBoundary(null)}
                  onSave={handleCondSave}
                />
              )}

              {/* MapEditPopup - only in design/interact mode */}
              {!isCodeEditorMode && editingMapBoundary && portalContainerRef.current && (
                <MapEditPopup
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
              !isLogsPanelCollapsed &&
              (hasGatewayError ||
                runtimeError ||
                parseErrorAsRuntimeError ||
                nodePodRuntimeError ||
                isLogsPanelOpen ||
                (runtime.mode === 'nodepod' && runtime.status !== 'idle')) &&
              activeProject?.id && (
                <LogsPanel
                  projectId={activeProject.id}
                  runtimeError={runtimeError || parseErrorAsRuntimeError || nodePodRuntimeError}
                  height={logsHeight}
                  onHeightChange={setLogsHeight}
                  onDismiss={handleLogsDismiss}
                  onClear={logsClear}
                />
              )}
          </div>
        </div>

        {/* Right sidebar for design/interact mode - shows docked AI chat or RightSidebar */}
        {!isCodeEditorMode && !sidebarsHidden && (
          <div className="flex-shrink-0" style={{ width: rightSidebarWidth }}>
            <div className="flex-1 flex flex-col h-full">
              {isAIChatDocked && isAIChatOpen ? null : ( // Spacer content is empty — AI chat renders as fixed overlay
                // Regular RightSidebar
                <RightSidebar
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
                    const instanceWithSize = Object.values(instances).find(
                      (inst): inst is typeof inst & { width: number; height: number } =>
                        !!(inst?.width && inst?.height),
                    );
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
            isLogsPanelOpen={isLogsPanelOpen}
            onToggleLogs={handleToggleLogs}
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
