/**
 * Left Panel App — Activity Bar sidebar content
 *
 * Shows Pages, Components (atoms/composites), Tests, and Elements Tree.
 * Uses PlatformProvider + SharedEditorState for cross-panel sync.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PlatformProvider,
  usePlatformCanvas,
  useGoToCode,
  canvasRPC,
} from '@/lib/platform';
import {
  useSharedEditorStateSync,
  useSelectedIds,
  useHoveredId,
  useSharedEditorState,
  createSharedDispatch,
} from '@/lib/platform/shared-editor-state';
import type { CanvasAdapter } from '@/lib/platform/types';
import ElementsTree, { type TreeNode } from '@/components/ElementsTree';
import type {
  ComponentGroup,
  ComponentListItem,
  ComponentsData,
  TestGroup,
} from '@lib/component-scanner/types';

type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

// ============================================================================
// Main App
// ============================================================================

export function LeftPanelApp() {
  return (
    <PlatformProvider>
      <LeftPanelContent />
    </PlatformProvider>
  );
}

function LeftPanelContent() {
  const canvas = usePlatformCanvas();
  useSharedEditorStateSync(canvas);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <ComponentGroupsPanel canvas={canvas} />
      <ElementsTreeSection canvas={canvas} />
    </div>
  );
}

// ============================================================================
// Component Groups Panel
// ============================================================================

function ComponentGroupsPanel({ canvas }: { canvas: CanvasAdapter }) {
  const [data, setData] = useState<ComponentsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [setupReason, setSetupReason] = useState<SetupReason | null>(null);
  const currentComponent = useSharedEditorState((s) => s.currentComponent);
  const dispatch = useMemo(() => createSharedDispatch(canvas), [canvas]);

  const loadComponents = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSetupReason(null);
    try {
      const result = await canvasRPC<ComponentsData>(
        canvas,
        { type: 'component:listGroups', requestId: crypto.randomUUID() },
        'component:response',
      );
      if (result.success && result.data) {
        setData(result.data);
        const msg = result as { needsSetup?: boolean; setupReason?: SetupReason };
        if (msg.needsSetup) {
          setSetupReason(msg.setupReason ?? 'empty-scan');
        }
      } else {
        setError(result.error || 'Failed to load components');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [canvas]);

  useEffect(() => {
    loadComponents();
  }, [loadComponents]);

  // Load tests when active component changes
  useEffect(() => {
    if (!currentComponent?.path) {
      setTestGroups([]);
      return;
    }
    canvasRPC<TestGroup[]>(
      canvas,
      { type: 'component:tests', requestId: crypto.randomUUID(), componentPath: currentComponent.path },
      'component:response',
    ).then((result) => {
      if (result.success && result.data) {
        setTestGroups(result.data);
      } else {
        setTestGroups([]);
      }
    }).catch(() => setTestGroups([]));
  }, [canvas, currentComponent?.path]);

  const handleComponentClick = useCallback(
    (component: ComponentListItem) => {
      dispatch({ currentComponent: { name: component.name, path: component.path } });
    },
    [dispatch],
  );

  const filterGroups = useCallback(
    (groups: ComponentGroup[]) => {
      if (!searchQuery) return groups;
      const q = searchQuery.toLowerCase();
      return groups
        .map((group) => ({
          ...group,
          components: group.components.filter(
            (c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q),
          ),
        }))
        .filter((group) => group.components.length > 0);
    },
    [searchQuery],
  );

  if (loading) {
    return (
      <div className="p-3 text-xs text-muted-foreground">
        Loading components...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <p className="text-xs text-destructive mb-2">{error}</p>
        <button
          onClick={loadComponents}
          className="text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  if (setupReason) {
    return <SetupHint reason={setupReason} canvas={canvas} onRetry={loadComponents} />;
  }

  const filteredPages = filterGroups(data.pageGroups);
  const filteredAtoms = filterGroups(data.atomGroups);
  const filteredComposites = filterGroups(data.compositeGroups);
  const hasPages = filteredPages.length > 0;
  const hasComponents = filteredAtoms.length > 0 || filteredComposites.length > 0;

  return (
    <div className="flex flex-col border-b border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase text-muted-foreground tracking-wider">
          Components
        </span>
        <button
          onClick={loadComponents}
          className="text-muted-foreground hover:text-foreground"
          title="Refresh"
        >
          <RefreshIcon />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pb-1.5">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="w-full h-6 px-2 text-xs rounded bg-input border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="overflow-y-auto max-h-[50vh] pb-1">
        {/* Pages Section */}
        {hasPages && (
          <CollapsibleSection label="Pages" count={countComponents(filteredPages)}>
            <ComponentGroupListInline
              groups={filteredPages}
              activeComponentPath={currentComponent?.path ?? null}
              onComponentClick={handleComponentClick}
            />
          </CollapsibleSection>
        )}

        {/* Components Section */}
        {hasComponents && (
          <CollapsibleSection label="Components" count={countComponents(filteredAtoms) + countComponents(filteredComposites)}>
            {filteredAtoms.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-4 py-0.5">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Atoms</span>
                </div>
                <ComponentGroupListInline
                  groups={filteredAtoms}
                  activeComponentPath={currentComponent?.path ?? null}
                  onComponentClick={handleComponentClick}
                />
              </>
            )}
            {filteredComposites.length > 0 && (
              <>
                <div className="flex items-center gap-1 px-4 py-0.5 mt-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Composites</span>
                </div>
                <ComponentGroupListInline
                  groups={filteredComposites}
                  activeComponentPath={currentComponent?.path ?? null}
                  onComponentClick={handleComponentClick}
                />
              </>
            )}
          </CollapsibleSection>
        )}

        {/* Tests Section */}
        {testGroups.length > 0 && (
          <CollapsibleSection label="Tests" count={testGroups.reduce((sum, g) => sum + g.tests.length, 0)}>
            <TestGroupsList groups={testGroups} />
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Component Group List (inline, simplified for VS Code — no loading per item)
// ============================================================================

function ComponentGroupListInline({
  groups,
  activeComponentPath,
  onComponentClick,
}: {
  groups: ComponentGroup[];
  activeComponentPath: string | null;
  onComponentClick: (component: ComponentListItem) => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.dirPath} className="flex flex-col">
          <div className="flex items-center gap-1 px-4">
            <span className="text-[10px] text-muted-foreground opacity-70">~</span>
            <span className="text-[11px] text-muted-foreground">{group.dirPath}</span>
          </div>
          <div className="flex flex-col">
            {group.components.map((component) => {
              const isActive = activeComponentPath === component.path;
              return (
                <button
                  key={component.path}
                  onClick={() => onComponentClick(component)}
                  className={`flex items-center gap-1.5 px-6 py-0.5 text-xs text-left truncate ${
                    isActive
                      ? 'bg-blue-500/20 border-l-2 border-blue-500 text-foreground font-medium'
                      : 'text-foreground hover:bg-muted'
                  }`}
                  title={component.path}
                >
                  <span className="truncate">{component.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

// ============================================================================
// Test Groups List
// ============================================================================

function TestGroupsList({ groups }: { groups: TestGroup[] }) {
  const goToCode = useGoToCode();
  const currentComponent = useSharedEditorState((s) => s.currentComponent);

  const handleTestClick = useCallback(
    (group: TestGroup, test: { line: number }) => {
      goToCode(group.relativePath, test.line, 0);
    },
    [goToCode],
  );

  const getTestTypeLabel = (type: TestGroup['type']): string => {
    switch (type) {
      case 'unit': return 'Unit Tests';
      case 'e2e': return 'E2E Tests';
      case 'variants': return 'Variants';
    }
  };

  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.relativePath} className="flex flex-col">
          <div className="flex items-center gap-1 px-4 py-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {getTestTypeLabel(group.type)}
            </span>
            <span className="text-[10px] text-muted-foreground">({group.tests.length})</span>
          </div>
          <div className="flex flex-col">
            {group.tests.map((test) => (
              <button
                key={`${group.relativePath}:${test.line}`}
                onClick={() => handleTestClick(group, test)}
                className="flex items-center gap-1.5 px-6 py-0.5 text-xs text-left hover:bg-muted truncate text-foreground"
                title={`${group.relativePath}:${test.line}`}
              >
                <span className="text-muted-foreground">L{test.line}</span>
                <span className="truncate">{test.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Collapsible Section
// ============================================================================

function CollapsibleSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full px-3 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronIcon collapsed={collapsed} />
        <span>{label}</span>
        <span className="ml-auto text-[10px]">{count}</span>
      </button>
      {!collapsed && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

// ============================================================================
// Elements Tree Section
// ============================================================================

function ElementsTreeSection({ canvas }: { canvas: CanvasAdapter }) {
  const selectedIds = useSelectedIds();
  const hoveredId = useHoveredId();
  const astStructure = useSharedEditorState((s) => s.astStructure);
  const dispatch = useMemo(() => createSharedDispatch(canvas), [canvas]);
  const goToCode = useGoToCode();
  const currentComponent = useSharedEditorState((s) => s.currentComponent);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelect = useCallback(
    (id: string, _event: React.MouseEvent) => {
      dispatch({ selectedIds: [id] });
    },
    [dispatch],
  );

  const handleHover = useCallback(
    (id: string | null) => {
      dispatch({ hoveredId: id });
    },
    [dispatch],
  );

  const handleFunctionNavigate = useCallback(
    (loc: { line: number; column: number }) => {
      if (currentComponent?.path) {
        goToCode(currentComponent.path, loc.line, loc.column);
      }
    },
    [goToCode, currentComponent?.path],
  );

  const tree = (astStructure as TreeNode[] | null) ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase text-muted-foreground tracking-wider">
          Elements
        </span>
      </div>

      {tree.length > 0 && (
        <div className="px-2 pb-1.5">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search elements..."
            className="w-full h-6 px-2 text-xs rounded bg-input border border-border text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {tree.length > 0 ? (
          <ElementsTree
            tree={tree}
            selectedElements={selectedIds}
            hoveredElement={hoveredId}
            onSelectElement={handleSelect}
            onHoverElement={handleHover}
            searchQuery={searchQuery}
            onFunctionNavigate={handleFunctionNavigate}
          />
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            {currentComponent
              ? 'No elements parsed yet'
              : 'Select a component to see its elements'}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Setup Hint (onboarding when no components found)
// ============================================================================

function SetupHint({
  reason,
  canvas,
  onRetry,
}: {
  reason: SetupReason;
  canvas: CanvasAdapter;
  onRetry: () => void;
}) {
  const sendCommand = useCallback(
    (command: string, args?: string[]) => {
      canvas.sendEvent({ type: 'command:execute', command, args } as never);
    },
    [canvas],
  );

  return (
    <div className="flex flex-col gap-3 p-4 text-xs">
      <p className="font-medium text-foreground">No components found</p>

      {reason === 'no-ai-config' && (
        <p className="text-muted-foreground leading-relaxed">
          Configure AI to auto-detect your project structure, or set component paths manually.
        </p>
      )}
      {reason === 'empty-scan' && (
        <p className="text-muted-foreground leading-relaxed">
          Auto-detection found no components. Try setting paths manually.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {reason === 'no-ai-config' && (
          <button
            onClick={() => sendCommand('workbench.action.openSettings', ['hypercanvas.ai'])}
            className="w-full px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            Configure AI Settings
          </button>
        )}
        <button
          onClick={() => sendCommand('hypercanvas.openProjectStructure')}
          className="w-full px-3 py-1.5 text-xs rounded border border-border text-foreground hover:bg-muted"
        >
          Set Paths Manually
        </button>
        <button
          onClick={onRetry}
          className="text-xs text-primary hover:underline mt-1"
        >
          Retry scan
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function countComponents(groups: ComponentGroup[]): number {
  return groups.reduce((sum, g) => sum + g.components.length, 0);
}

// ============================================================================
// Icons
// ============================================================================

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
    </svg>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
