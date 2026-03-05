import cn from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { Panel, Group as PanelGroup, useDefaultLayout } from 'react-resizable-panels';
// SaaS-only imports — conditionally used when engine is available
import { useComponentMetaOptional } from '@/contexts/ComponentMetaContext';
import { useAnimatedPanelCollapse } from '@/hooks/useAnimatedPanelCollapse';
import { useSidebarPanelLayout } from '@/hooks/useSidebarPanelLayout';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformContext } from '@/lib/platform';
import { panelLayoutStorage } from '@/lib/storage';
import { useGitStore } from '@/stores/gitStore';
import SidebarHeader from '../SidebarHeader';
import { SourceControlSection } from '../SourceControlSection';
import { TestGenerationModal } from '../TestGenerationModal';
import { TestRunnerModal } from '../TestRunnerModal';
import { ResizeHandle } from '../ui/resize-handle';
import {
  useComponentNavigation,
  useComponentsData,
  useElementSelection,
  useElementsTree,
  useFunctionNavigate,
  useTestGroups,
} from './hooks';
import { ComponentsSection, ElementsTreeSection, PagesSection, TestsSection } from './sections';
import type { LeftSidebarProps } from './types';

export default function LeftSidebar({
  onElementPosition,
  onHoverElement,
  hoveredId,
  onOpenPanel,
  onCreatePage,
  onCreateComponent,
}: LeftSidebarProps) {
  const engine = useCanvasEngineOptional();
  const isVSCode = usePlatformContext() === 'vscode-webview';

  // SaaS-only: ComponentMeta context (provides meta, loadComponent, etc.)
  // In VS Code these are handled by compat hooks internally
  const saasComponentMeta = useComponentMetaOptional();
  const meta = saasComponentMeta?.meta ?? null;
  const isPushPopoverOpen = useGitStore().isPushPopoverOpen;

  // --- Compat hooks ---

  const {
    data: components,
    loading: isLoadingComponents,
    reload: loadComponents,
    loadedOnce: componentsLoadedOnce,
    setupReason,
  } = useComponentsData();

  const saasActiveComponentPath = engine
    ? (() => {
        const root = engine.getRoot();
        const filePath = root.metadata?.relativeFilePath;
        return (typeof filePath === 'string' ? filePath : null) || meta?.relativeFilePath || null;
      })()
    : null;

  const componentNav = useComponentNavigation(
    engine && saasComponentMeta
      ? {
          activeComponentPath: saasActiveComponentPath,
          loadComponent: saasComponentMeta.loadComponent,
          loadingComponent: saasComponentMeta.loadingComponent,
        }
      : null,
  );

  const currentComponentPath = engine ? meta?.relativeFilePath : (componentNav.activePath ?? undefined);

  const {
    testGroups,
    isLoading: isLoadingTests,
    reload: reloadTests,
  } = useTestGroups(currentComponentPath, meta?.projectId);

  const elementsTree = useElementsTree(meta?.componentName);

  const {
    selectedIds,
    hoveredId: selectionHoveredId,
    handleSelect,
    handleHover,
  } = useElementSelection(elementsTree, onHoverElement);

  const handleFunctionNavigate = useFunctionNavigate(currentComponentPath);

  // --- Local UI state ---

  const { defaultLayout, onLayoutChange } = useDefaultLayout({
    groupId: 'left-sidebar-panels',
    storage: panelLayoutStorage,
  });

  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [isRunnerModalOpen, setIsRunnerModalOpen] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const rootRef = useRef<HTMLDivElement>(null);

  // Content checks
  const hasPagesContent = components.pageGroups.some((g) => g.components.length > 0);
  const hasComponentsContent =
    components.atomGroups.some((g) => g.components.length > 0) ||
    components.compositeGroups.some((g) => g.components.length > 0);
  const hasElementsContent = elementsTree.length > 0;
  const hasTestsContent = testGroups.length > 0;

  // Panel layout hook
  const layout = useSidebarPanelLayout({
    defaultLayout,
    contentFlags: {
      hasRawPagesContent: hasPagesContent,
      hasRawComponentsContent: hasComponentsContent,
      hasElementsContent,
      hasTestsContent,
    },
    isPushPopoverOpen,
    componentsLoaded: componentsLoadedOnce,
  });

  const {
    groupRef,
    pagesPanelRef,
    componentsPanelRef,
    elementsTreePanelRef,
    testsPanelRef,
    sourceControlPanelRef,
    pagesCollapsed,
    componentsCollapsed,
    elementsTreeCollapsed,
    testsCollapsed,
    sourceControlCollapsed,
    handleUserToggle,
    handleResizeEnd,
  } = layout;

  // Animated panel collapse hooks
  const sourceControlPanel = useAnimatedPanelCollapse(sourceControlPanelRef, {
    onCollapseStart: () => layout.setSourceControlCollapsed(true),
    onExpandStart: () => layout.setSourceControlCollapsed(false),
  });
  const pagesPanel = useAnimatedPanelCollapse(pagesPanelRef, {
    canExpand: hasPagesContent,
    onCollapseStart: () => layout.setPagesCollapsed(true),
    onExpandStart: () => layout.setPagesCollapsed(false),
  });
  const componentsPanel = useAnimatedPanelCollapse(componentsPanelRef, {
    canExpand: hasComponentsContent,
    onCollapseStart: () => layout.setComponentsCollapsed(true),
    onExpandStart: () => layout.setComponentsCollapsed(false),
  });
  const elementsTreePanel = useAnimatedPanelCollapse(elementsTreePanelRef, {
    canExpand: hasElementsContent,
    onCollapseStart: () => layout.setElementsTreeCollapsed(true),
    onExpandStart: () => layout.setElementsTreeCollapsed(false),
  });
  const testsPanel = useAnimatedPanelCollapse(testsPanelRef, {
    canExpand: hasTestsContent,
    onCollapseStart: () => layout.setTestsCollapsed(true),
    onExpandStart: () => layout.setTestsCollapsed(false),
  });

  // Prevent scroll propagation
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    el.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <div
      className={cn('h-full border-r border-border bg-background flex flex-col whitespace-nowrap relative z-20', {
        'select-none': isShiftPressed,
      })}
      ref={rootRef}
    >
      {/* SaaS-only: SidebarHeader and Design Name */}
      {!isVSCode && (
        <>
          <SidebarHeader />
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">{meta?.componentName || 'Untitled'}</span>
            <p className="text-xs text-muted-foreground mt-1">
              {meta?.projectName || meta?.repoPath?.split('/').pop() || 'No project'}
            </p>
          </div>
        </>
      )}

      {/* Resizable panels */}
      <PanelGroup
        orientation="vertical"
        id="left-sidebar-panels"
        className="flex-1"
        defaultLayout={defaultLayout}
        onLayoutChange={onLayoutChange}
        groupRef={groupRef}
      >
        {/* Source Control — SaaS only */}
        <Panel
          id="source-control"
          panelRef={sourceControlPanelRef}
          defaultSize={isPushPopoverOpen ? '30%' : '0px'}
          minSize={isPushPopoverOpen ? '24px' : '0px'}
          maxSize={isPushPopoverOpen ? undefined : '0px'}
          collapsible
          collapsedSize={isPushPopoverOpen ? '24px' : '0px'}
        >
          {isPushPopoverOpen && !isVSCode && (
            <SourceControlSection
              collapsed={sourceControlCollapsed}
              onToggleCollapse={sourceControlPanel.toggle}
              isCodeMode={false}
            />
          )}
        </Panel>
        <ResizeHandle
          onPointerUp={() => {
            if (isPushPopoverOpen) handleResizeEnd(['source-control', 'pages']);
          }}
        />

        {/* Pages */}
        <Panel
          id="pages"
          panelRef={pagesPanelRef}
          defaultSize="20%"
          minSize={hasPagesContent ? '60px' : '24px'}
          maxSize={hasPagesContent ? undefined : '24px'}
          collapsible
          collapsedSize="24px"
        >
          <PagesSection
            collapsed={pagesCollapsed}
            hasContent={hasPagesContent}
            groups={components.pageGroups}
            activePath={componentNav.activePath}
            loadingComponent={componentNav.loadingComponent}
            onComponentClick={componentNav.onComponentClick}
            onToggle={() => handleUserToggle('pages', pagesPanel.toggle, pagesPanelRef)}
            onCreatePage={onCreatePage}
            isVSCode={isVSCode}
          />
        </Panel>
        <ResizeHandle onPointerUp={() => handleResizeEnd(['pages', 'components'])} />

        {/* Components */}
        <Panel
          id="components"
          panelRef={componentsPanelRef}
          defaultSize="25%"
          minSize={hasComponentsContent ? '60px' : '24px'}
          maxSize={hasComponentsContent ? undefined : '24px'}
          collapsible
          collapsedSize="24px"
        >
          <ComponentsSection
            collapsed={componentsCollapsed}
            hasContent={hasComponentsContent}
            atomGroups={components.atomGroups}
            compositeGroups={components.compositeGroups}
            activePath={componentNav.activePath}
            loadingComponent={componentNav.loadingComponent}
            onComponentClick={componentNav.onComponentClick}
            onToggle={() => handleUserToggle('components', componentsPanel.toggle, componentsPanelRef)}
            onReload={loadComponents}
            isReloading={isLoadingComponents}
            onCreateComponent={onCreateComponent}
            isVSCode={isVSCode}
            setupReason={setupReason}
          />
        </Panel>
        <ResizeHandle onPointerUp={() => handleResizeEnd(['components', 'elements-tree'])} />

        {/* Elements Tree */}
        <Panel
          id="elements-tree"
          panelRef={elementsTreePanelRef}
          defaultSize="25%"
          minSize={hasElementsContent ? '60px' : '24px'}
          maxSize={hasElementsContent ? undefined : '24px'}
          collapsible
          collapsedSize="24px"
        >
          <ElementsTreeSection
            collapsed={elementsTreeCollapsed}
            hasContent={hasElementsContent}
            tree={elementsTree}
            selectedIds={selectedIds}
            hoveredId={selectionHoveredId ?? hoveredId ?? null}
            onSelectElement={handleSelect}
            onHoverElement={handleHover}
            onOpenPanel={onOpenPanel}
            onElementPosition={onElementPosition}
            onFunctionNavigate={handleFunctionNavigate}
            onToggle={() => handleUserToggle('elements-tree', elementsTreePanel.toggle, elementsTreePanelRef)}
          />
        </Panel>
        <ResizeHandle onPointerUp={() => handleResizeEnd(['elements-tree', 'tests'])} />

        {/* Tests */}
        <Panel
          id="tests"
          panelRef={testsPanelRef}
          defaultSize="20%"
          minSize={hasTestsContent ? '60px' : '24px'}
          maxSize={hasTestsContent ? undefined : '24px'}
          collapsible
          collapsedSize="24px"
        >
          <TestsSection
            collapsed={testsCollapsed}
            hasContent={hasTestsContent}
            testGroups={testGroups}
            isLoading={isLoadingTests}
            currentComponentPath={currentComponentPath}
            onToggle={() => handleUserToggle('tests', testsPanel.toggle, testsPanelRef)}
            onGenerateTests={() => setIsTestModalOpen(true)}
            onRunTests={() => setIsRunnerModalOpen(true)}
          />
        </Panel>
      </PanelGroup>

      {/* Test Generation Modal */}
      {currentComponentPath && (
        <TestGenerationModal
          isOpen={isTestModalOpen}
          onClose={() => {
            setIsTestModalOpen(false);
            reloadTests();
          }}
          projectId={meta?.projectId}
          componentPath={currentComponentPath}
          types={['unit', 'e2e', 'variants']}
        />
      )}

      {/* Test Runner Modal */}
      {meta?.projectId && testGroups.length > 0 && (
        <TestRunnerModal
          isOpen={isRunnerModalOpen}
          onClose={() => setIsRunnerModalOpen(false)}
          projectId={meta.projectId}
          testPaths={testGroups.map((g) => g.relativePath)}
        />
      )}
    </div>
  );
}
