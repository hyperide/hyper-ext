import { useState, useMemo, useEffect, useRef } from 'react';
import {
	IconChevronDown,
	IconPlus,
	IconSearch,
	IconComponents,
	IconRefresh,
	IconTestPipe,
	IconPlayerPlayFilled,
	IconListTree,
} from '@tabler/icons-react';
import { useStore } from 'zustand';
import { Panel, Group as PanelGroup, useDefaultLayout } from 'react-resizable-panels';
import { panelLayoutStorage } from '@/lib/storage';
import { ResizeHandle } from './ui/resize-handle';
import ElementsTree, { TreeNode } from './ElementsTree';
import SidebarHeader from './SidebarHeader';
import { TestGenerationModal } from './TestGenerationModal';
import { SourceControlSection } from './SourceControlSection';
import { TestRunnerModal } from './TestRunnerModal';
import {
	useCanvasEngine,
	useChildren,
	useSelectedIds,
	useCanvasEngineContext,
} from '@/lib/canvas-engine';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { Input } from '@/components/ui/input';
import cn from 'clsx';
import { authFetch } from '@/utils/authFetch';
import { useGitStore } from '@/stores/gitStore';
import { useAnimatedPanelCollapse } from '@/hooks/useAnimatedPanelCollapse';
import { useSidebarPanelLayout } from '@/hooks/useSidebarPanelLayout';
import { ComponentGroupList } from './ComponentGroupList';
import type {
	ComponentListItem as ComponentInfo,
	ComponentGroup,
	ComponentsData,
} from '../../lib/component-scanner/types';

interface LeftSidebarProps {
	onElementPosition?: (id: string, y: number) => void;
	onHoverElement?: (id: string | null) => void;
	hoveredId?: string | null;
	onOpenPanel?: (id: string) => void;
	projectPath?: string;
	onCreatePage?: () => void;
	onCreateComponent?: () => void;
}

export default function LeftSidebar({
	onElementPosition,
	onHoverElement,
	hoveredId,
	onOpenPanel,
	projectPath,
	onCreatePage,
	onCreateComponent,
}: LeftSidebarProps) {
	const engine = useCanvasEngine();
	const selectedIds = useSelectedIds();
	const rootChildren = useChildren(engine.getRoot().id);
	const { meta, loadComponent, loadingComponent } = useComponentMeta();
	const { isPushPopoverOpen } = useGitStore();

	// Get update counter to force re-render when metadata changes
	const { store } = useCanvasEngineContext();
	const updateCounter = useStore(store, (state) => state._updateCounter);
	const [components, setComponents] = useState<ComponentsData>({
		atomGroups: [],
		compositeGroups: [],
		pageGroups: [],
	});
	const [isLoadingComponents, setIsLoadingComponents] = useState(false);
	const [componentsLoadedOnce, setComponentsLoadedOnce] = useState(false);

	// Load components list from server
	const loadComponents = () => {
		setIsLoadingComponents(true);
		authFetch('/api/get-components')
			.then((res) => res.json())
			.then((data) => {
				if (data.success) {
					setComponents({
						atomGroups: data.atomGroups || [],
						compositeGroups: data.compositeGroups || [],
						pageGroups: data.pageGroups || [],
					});
					setComponentsLoadedOnce(true);
				}
			})
			.catch((error) => {
				console.error('[LeftSidebar] Failed to load components:', error);
			})
			.finally(() => {
				setIsLoadingComponents(false);
			});
	};

	// Initial load and listen for components_updated window events
	// (SSE is consolidated in useProjectSSE which dispatches window events)
	useEffect(() => {
		loadComponents();

		const handleComponentsUpdated = () => {
			console.log('[LeftSidebar] Components updated via window event');
			loadComponents();
		};

		window.addEventListener('components_updated', handleComponentsUpdated);
		return () => {
			window.removeEventListener('components_updated', handleComponentsUpdated);
		};
	}, []);

	// Active component path (for highlighting in component list)
	const activeComponentPath = (() => {
		const root = engine.getRoot();
		return root.metadata?.relativeFilePath || meta?.relativeFilePath || null;
	})();

	// Helper to check if component is currently loaded
	const isComponentActive = (componentPath: string) => {
		return activeComponentPath === componentPath;
	};

	// Convert engine instances to TreeNode structure
	const elementsTree = useMemo<TreeNode[]>(() => {
		// Helper to extract text from AST node
		const extractTextFromNode = (node: any): string => {
			// Don't extract text from jsx nodes (they have JSX children, not text)
			if (node.childrenType === 'jsx') {
				return '';
			}

			let text = '';

			// Extract text only if childrenType is set (text/expression/expression-complex)
			// This matches RightSidebar logic
			if (
				node.childrenType &&
				node.props?.children &&
				typeof node.props.children === 'string'
			) {
				text += node.props.children;
			}

			// Recursively extract from children nodes
			if (node.children && Array.isArray(node.children)) {
				for (const child of node.children) {
					const childText = extractTextFromNode(child);
					if (childText) {
						text += (text ? ' ' : '') + childText;
					}
				}
			}

			return text.trim();
		};

		// Convert AST node to TreeNode
		const convertASTNodeToTreeNode = (node: any): TreeNode => {
			// Handle function wrapper nodes (type starts with 'fn:')
			// Note: functionItem on children is for navigation metadata only, not for tree display
			if (node.type?.startsWith('fn:')) {
				const fnName = node.functionItem?.functionName || node.type.slice(3);
				return {
					id: node.id,
					type: 'function',
					label: `${fnName}()`,
					name: undefined,
					functionLoc: node.functionItem?.functionLoc,
					children: node.children
						? node.children.map(convertASTNodeToTreeNode)
						: [],
				};
			}

			let label = node.type;
			let treeNodeType: TreeNode['type'] = 'component';

			// For div show frame icon
			if (node.type === 'div') {
				treeNodeType = 'frame';
				if (node.props?.['data-test-id']) {
					label = `div "${node.props['data-test-id']}"`;
				} else {
					// Try to extract text content (including expressions)
					const divText = extractTextFromNode(node);
					if (divText) {
						label = `div "${divText}"`;
					}
				}
			}
			// For button show: button "text" or button [type="..."]
			else if (node.type === 'button') {
				const buttonText = extractTextFromNode(node);
				if (buttonText) {
					label = `button "${buttonText}"`;
				} else {
					const buttonType = node.props?.type || 'submit';
					label = `button [type="${buttonType}"]`;
				}
			}
			// For input show: input [placeholder] or input [type="..."]
			else if (node.type === 'input') {
				if (node.props?.placeholder) {
					label = `input "${node.props.placeholder}"`;
				} else {
					const inputType = node.props?.type || 'text';
					label = `input [type="${inputType}"]`;
				}
			}
			// For custom components (starts with capital letter) show: Component "text"
			else if (/^[A-Z]/.test(node.type)) {
				const componentText = extractTextFromNode(node);
				if (componentText) {
					label = `${node.type} "${componentText}"`;
				}
			}
			// For other HTML elements with data-test-id show: element "test-id"
			else if (node.props?.['data-test-id']) {
				label = `${node.type} "${node.props['data-test-id']}"`;
			}
			// For all other HTML elements, try to extract text content
			else {
				const elementText = extractTextFromNode(node);
				if (elementText) {
					label = `${node.type} "${elementText}"`;
				}
			}

			return {
				id: node.id,
				type: treeNodeType,
				label,
				name: undefined,
				// Don't show children for svg elements
				children:
					node.type === 'svg'
						? []
						: node.children
							? node.children.map(convertASTNodeToTreeNode)
							: [],
			};
		};

		// Convert instance to TreeNode (for registered components, read from metadata.astStructure)
		const convertInstanceToTreeNode = (instanceId: string): TreeNode => {
			const instance = engine.getInstance(instanceId);
			if (!instance) {
				return { id: instanceId, type: 'element', label: 'Unknown' };
			}

			const componentDef = engine.registry.get(instance.type);

			// If instance has AST structure in metadata, use it for the tree
			if (
				instance.metadata?.astStructure &&
				Array.isArray(instance.metadata.astStructure)
			) {
				// For registered components, show the component name at root level
				// and its AST structure as children
				return {
					id: instance.id,
					type: 'component',
					label: componentDef?.label || instance.type,
					name: undefined,
					children: instance.metadata.astStructure.map(
						convertASTNodeToTreeNode,
					),
				};
			}

			// Fallback for instances without AST structure
			return {
				id: instance.id,
				type: 'component',
				label: componentDef?.label || instance.type,
				name: undefined,
				children: [],
			};
		};

		// For iframe components: read AST directly from root metadata
		const root = engine.getRoot();
		if (
			root.metadata?.astStructure &&
			Array.isArray(root.metadata.astStructure)
		) {
			return root.metadata.astStructure.map(convertASTNodeToTreeNode);
		}

		// For registered components: use engine's children
		return rootChildren.map((child) => convertInstanceToTreeNode(child.id));
	}, [rootChildren, engine, meta?.componentName, updateCounter]);

	// Navigate to function definition in code editor
	const handleFunctionNavigate = (loc: { line: number; column: number }) => {
		if (!meta?.relativeFilePath) {
			console.log('[LeftSidebar] Cannot navigate - no file path');
			return;
		}

		console.log('[LeftSidebar] Navigating to function:', { loc, filePath: meta.relativeFilePath });

		// Switch to code mode
		engine.setMode('code');

		// Dispatch navigation event
		requestAnimationFrame(() => {
			window.dispatchEvent(
				new CustomEvent('monaco-goto-position', {
					detail: {
						line: loc.line,
						column: loc.column,
						filePath: meta.relativeFilePath,
					},
				}),
			);
		});
	};

	const handleSelectElement = (elementId: string, event: React.MouseEvent) => {
		console.log('[LeftSidebar] Selecting element:', elementId);

		// Don't select root element - just clear selection
		const rootId = engine.getRoot().id;
		if (elementId === rootId) {
			console.log('[LeftSidebar] Root element clicked, clearing selection');
			engine.clearSelection();
			return;
		}

		// Check if component exists in registry
		const instance = engine.getInstance(elementId);
		console.log(
			'[LeftSidebar] Instance found:',
			instance ? instance.type : 'none (AST node)',
		);

		if (instance && !engine.registry.get(instance.type)) {
			console.log(
				'[LeftSidebar] Component not in registry, clearing selection',
			);
			engine.clearSelection();
			return;
		}

		// Cmd/Ctrl+Click - toggle selection
		if (event.metaKey || event.ctrlKey) {
			const currentSelection = engine.getSelection();
			if (currentSelection.selectedIds.includes(elementId)) {
				console.log('[LeftSidebar] Removing from selection (Cmd+Click)');
				engine.removeFromSelection(elementId);
			} else {
				console.log('[LeftSidebar] Adding to selection (Cmd+Click)');
				engine.addToSelection(elementId);
			}
			return;
		}

		// Shift+Click - select range
		if (event.shiftKey) {
			const currentSelection = engine.getSelection();
			const lastSelectedId =
				currentSelection.selectedIds[currentSelection.selectedIds.length - 1];

			if (lastSelectedId) {
				// Flatten the tree to get ordered list of all element IDs
				const flattenTree = (nodes: TreeNode[]): string[] => {
					const result: string[] = [];
					nodes.forEach((node) => {
						result.push(node.id);
						if (node.children) {
							result.push(...flattenTree(node.children));
						}
					});
					return result;
				};

				const allIds = flattenTree(elementsTree);
				const lastIndex = allIds.indexOf(lastSelectedId);
				const currentIndex = allIds.indexOf(elementId);

				if (lastIndex !== -1 && currentIndex !== -1) {
					const start = Math.min(lastIndex, currentIndex);
					const end = Math.max(lastIndex, currentIndex);
					const rangeIds = allIds.slice(start, end + 1);
					console.log(
						'[LeftSidebar] Selecting range (Shift+Click):',
						rangeIds.length,
						'elements',
					);
					engine.selectMultiple(rangeIds);
					return;
				}
			}
		}

		// Normal click - replace selection
		console.log('[LeftSidebar] Normal click, calling engine.select()');
		engine.select(elementId);
	};
	// Persist panel sizes across page reloads
	const { defaultLayout, onLayoutChange } = useDefaultLayout({
		groupId: 'left-sidebar-panels',
		storage: panelLayoutStorage,
	});

	const [isTestModalOpen, setIsTestModalOpen] = useState(false);
	const [isRunnerModalOpen, setIsRunnerModalOpen] = useState(false);

	// Test groups state
	interface TestInfo {
		name: string;
		line: number;
	}
	interface TestGroup {
		type: 'unit' | 'e2e' | 'variants';
		path: string;
		relativePath: string;
		tests: TestInfo[];
	}
	const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
	const [isLoadingTests, setIsLoadingTests] = useState(false);
	const [expandedTestGroups, setExpandedTestGroups] = useState<Set<string>>(
		new Set(['unit', 'e2e', 'variants']),
	);

	const [pagesSearchVisible, setPagesSearchVisible] = useState(false);
	const [componentsSearchVisible, setComponentsSearchVisible] = useState(false);
	const [elementsSearchVisible, setElementsSearchVisible] = useState(false);

	const [pagesSearchQuery, setPagesSearchQuery] = useState('');
	const [componentsSearchQuery, setComponentsSearchQuery] = useState('');
	const [elementsSearchQuery, setElementsSearchQuery] = useState('');

	const [isShiftPressed, setIsShiftPressed] = useState(false);

	// Track Shift key state to disable text selection during range selection
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Shift') {
				setIsShiftPressed(true);
			}
		};

		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === 'Shift') {
				setIsShiftPressed(false);
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
		};
	}, []);

	// Filter components based on search query
	const filteredAtomGroups = useMemo(() => {
		if (!componentsSearchQuery) return components.atomGroups;

		return components.atomGroups
			.map((group) => ({
				...group,
				components: group.components.filter((comp) =>
					comp.name.toLowerCase().includes(componentsSearchQuery.toLowerCase()),
				),
			}))
			.filter((group) => group.components.length > 0);
	}, [components.atomGroups, componentsSearchQuery]);

	const filteredCompositeGroups = useMemo(() => {
		if (!componentsSearchQuery) return components.compositeGroups;

		return components.compositeGroups
			.map((group) => ({
				...group,
				components: group.components.filter((comp) =>
					comp.name.toLowerCase().includes(componentsSearchQuery.toLowerCase()),
				),
			}))
			.filter((group) => group.components.length > 0);
	}, [components.compositeGroups, componentsSearchQuery]);

	const filteredPageGroups = useMemo(() => {
		if (!pagesSearchQuery) return components.pageGroups;

		return components.pageGroups
			.map((group) => ({
				...group,
				components: group.components.filter((comp) =>
					comp.name.toLowerCase().includes(pagesSearchQuery.toLowerCase()),
				),
			}))
			.filter((group) => group.components.length > 0);
	}, [components.pageGroups, pagesSearchQuery]);



	// Load test groups when component changes
	const loadComponentTests = async () => {
		console.log('[Tests] loadComponentTests called, meta:', {
			relativeFilePath: meta?.relativeFilePath,
			projectId: meta?.projectId,
		});

		if (!meta?.relativeFilePath) {
			console.log('[Tests] No relativeFilePath, skipping');
			return;
		}

		setIsLoadingTests(true);
		try {
			// Build URL - use projectId if available, otherwise rely on absolute path detection
			const params = new URLSearchParams({
				componentPath: meta.relativeFilePath,
			});
			if (meta.projectId) {
				params.set('projectId', meta.projectId);
			}

			const url = `/api/component-tests?${params.toString()}`;
			console.log('[Tests] Fetching:', url);

			const res = await authFetch(url);
			const data = await res.json();
			console.log('[Tests] Response:', data);

			if (data.success && data.groups) {
				setTestGroups(data.groups);
				console.log('[Tests] Loaded groups:', data.groups.length);
			} else {
				setTestGroups([]);
				console.log('[Tests] No groups or error:', data.error);
			}
		} catch (error) {
			console.error('[Tests] Failed to load tests:', error);
			setTestGroups([]);
		} finally {
			setIsLoadingTests(false);
		}
	};

	useEffect(() => {
		loadComponentTests();
	}, [meta?.relativeFilePath, meta?.projectId]);

	const toggleTestGroup = (type: string) => {
		setExpandedTestGroups((prev) => {
			const next = new Set(prev);
			if (next.has(type)) {
				next.delete(type);
			} else {
				next.add(type);
			}
			return next;
		});
	};

	const getTestTypeLabel = (type: string) => {
		switch (type) {
			case 'unit':
				return 'Unit Tests';
			case 'e2e':
				return 'E2E Tests';
			case 'variants':
				return 'Test Variants';
			default:
				return type;
		}
	};

	const rootRef = useRef<HTMLDivElement>(null);

	// Check if sections have content (for conditional rendering)
	const hasPagesContent = filteredPageGroups.length > 0;
	const hasComponentsContent = filteredAtomGroups.length > 0 || filteredCompositeGroups.length > 0;
	const hasElementsContent = elementsTree.length > 0;
	const hasTestsContent = testGroups.length > 0;

	// Raw content checks (not affected by search filters) — used only for auto-layout
	const hasRawPagesContent = components.pageGroups.some((g) => g.components.length > 0);
	const hasRawComponentsContent =
		components.atomGroups.some((g) => g.components.length > 0) ||
		components.compositeGroups.some((g) => g.components.length > 0);

	// Panel layout hook — refs, collapsed states, auto-layout, resize handling
	const layout = useSidebarPanelLayout({
		defaultLayout,
		contentFlags: {
			hasRawPagesContent,
			hasRawComponentsContent,
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

	// Animated panel collapse hooks (after hasXxxContent)
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

	// prevent scroll propagation when scrolling left sidebar
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
			className={cn(
				'h-full border-r border-border bg-background flex flex-col whitespace-nowrap relative z-20',
				{
					'select-none': isShiftPressed,
				},
			)}
			ref={rootRef}
		>
			<SidebarHeader />

			{/* Design Name */}
			<div className="px-4 py-3 border-b border-border">
				<div className="flex items-center gap-3">
					<span className="text-sm font-semibold text-foreground">
						{meta?.componentName || 'Untitled'}
					</span>
					<IconChevronDown className="w-3 h-3" stroke={1.5} />
				</div>
				<p className="text-xs text-muted-foreground mt-1">
					{meta?.projectName ||
						meta?.repoPath?.split('/').pop() ||
						'No project'}
				</p>
			</div>

			{/* Resizable panels */}
			<PanelGroup
				orientation="vertical"
				id="left-sidebar-panels"
				className="flex-1"
				defaultLayout={defaultLayout}
				onLayoutChange={onLayoutChange}
				groupRef={groupRef}
			>
				{/* Source Control Panel - always rendered, hidden via size constraints */}
				<Panel
					id="source-control"
					panelRef={sourceControlPanelRef}
					defaultSize={isPushPopoverOpen ? '30%' : '0px'}
					minSize={isPushPopoverOpen ? '24px' : '0px'}
					maxSize={isPushPopoverOpen ? undefined : '0px'}
					collapsible
					collapsedSize={isPushPopoverOpen ? '24px' : '0px'}
				>
					{isPushPopoverOpen && (
						<SourceControlSection
							collapsed={sourceControlCollapsed}
							onToggleCollapse={sourceControlPanel.toggle}
							isCodeMode={false}
						/>
					)}
				</Panel>
				<ResizeHandle
					onPointerUp={() => {
						if (isPushPopoverOpen) {
							handleResizeEnd(['source-control', 'pages']);
						}
					}}
				/>

				{/* Pages Section */}
				<Panel id="pages" panelRef={pagesPanelRef} defaultSize="20%" minSize={hasPagesContent ? '60px' : '24px'} maxSize={hasPagesContent ? undefined : '24px'} collapsible collapsedSize="24px">
					<div className="h-full overflow-hidden flex flex-col">
						{/* Header */}
						<div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
							<button
								type="button"
								onClick={() => handleUserToggle('pages', pagesPanel.toggle, pagesPanelRef)}
								className="flex items-center gap-1 flex-1"
								disabled={!hasPagesContent}
							>
								<IconChevronDown
									className={cn('w-3 h-3 transition-transform duration-200', {
										'rotate-[-90deg]': pagesCollapsed || !hasPagesContent,
									})}
									stroke={1.5}
								/>
								<span className={cn('text-xs font-semibold', {
									'text-foreground': hasPagesContent,
									'text-muted-foreground': !hasPagesContent,
								})}>
									{hasPagesContent ? 'Pages' : 'No pages'}
								</span>
							</button>
							<div className="flex items-center gap-1.5">
								<button type="button" onClick={(e) => { e.stopPropagation(); onCreatePage?.(); }}>
									<IconPlus className="w-4 h-4" stroke={1.5} />
								</button>
								{hasPagesContent && (
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); setPagesSearchVisible(!pagesSearchVisible); }}
									>
										<IconSearch className="w-4 h-4" stroke={1.5} />
									</button>
								)}
							</div>
						</div>
						{/* Content */}
						{!pagesCollapsed && hasPagesContent && (
							<div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
							{pagesSearchVisible && (
								<div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5 mx-2 mt-2">
									<IconSearch
										className="w-3.5 h-3.5 text-muted-foreground"
										stroke={1.5}
									/>
									<Input
										type="text"
										value={pagesSearchQuery}
										onChange={(e) => setPagesSearchQuery(e.target.value)}
										placeholder="Search pages..."
										className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
									/>
								</div>
							)}
							<div className="flex flex-col px-2">
								<ComponentGroupList
									groups={filteredPageGroups}
									activeComponentPath={activeComponentPath}
									loadingComponentPath={loadingComponent}
									onComponentClick={(c) => loadComponent(c.path)}
								/>
							</div>
						</div>
						)}
					</div>
				</Panel>
				<ResizeHandle
					onPointerUp={() => handleResizeEnd(['pages', 'components'])}
				/>

				{/* Components Panel */}
				<Panel id="components" panelRef={componentsPanelRef} defaultSize="25%" minSize={hasComponentsContent ? '60px' : '24px'} maxSize={hasComponentsContent ? undefined : '24px'} collapsible collapsedSize="24px">
					<div className="h-full overflow-hidden flex flex-col">
						{/* Header - always visible */}
						<div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
							<button
								type="button"
								onClick={() => handleUserToggle('components', componentsPanel.toggle, componentsPanelRef)}
								className="flex items-center gap-1 flex-1"
								disabled={!hasComponentsContent}
							>
								<IconChevronDown
									className={cn('w-3 h-3 transition-transform duration-200', {
										'rotate-[-90deg]': componentsCollapsed || !hasComponentsContent,
									})}
									stroke={1.5}
								/>
								<IconComponents className="w-3.5 h-3.5" stroke={1.5} />
								<span className={cn('text-xs font-semibold', {
									'text-foreground': hasComponentsContent,
									'text-muted-foreground': !hasComponentsContent,
								})}>
									{hasComponentsContent ? 'Components' : 'No components'}
								</span>
							</button>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={(e) => { e.stopPropagation(); loadComponents(); }}
									disabled={isLoadingComponents}
									className={isLoadingComponents ? 'opacity-50' : ''}
								>
									<IconRefresh
										className={cn('w-4 h-4', { 'animate-spin': isLoadingComponents })}
										stroke={1.5}
									/>
								</button>
								<button type="button" onClick={(e) => { e.stopPropagation(); onCreateComponent?.(); }}>
									<IconPlus className="w-4 h-4" stroke={1.5} />
								</button>
								{hasComponentsContent && (
									<button
										type="button"
										onClick={(e) => { e.stopPropagation(); setComponentsSearchVisible(!componentsSearchVisible); }}
									>
										<IconSearch className="w-4 h-4" stroke={1.5} />
									</button>
								)}
							</div>
						</div>
						{/* Content */}
						{!componentsCollapsed && hasComponentsContent && (
						<div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
							{componentsSearchVisible && (
								<div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5 mx-2 mt-2">
									<IconSearch className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
									<Input
										type="text"
										value={componentsSearchQuery}
										onChange={(e) => setComponentsSearchQuery(e.target.value)}
										placeholder="Search components..."
										className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
									/>
								</div>
							)}
							<div className="flex flex-col gap-1 px-2">
								<div className="flex items-center gap-1">
									<IconChevronDown className="w-2 h-2 text-muted-foreground" stroke={1.5} />
									<span className="text-xs font-[510] text-[#7A7A7A]">Atom components</span>
								</div>
								<ComponentGroupList
									groups={filteredAtomGroups}
									activeComponentPath={activeComponentPath}
									loadingComponentPath={loadingComponent}
									onComponentClick={(c) => loadComponent(c.path)}
								/>

								<div className="flex items-center gap-1 mt-2">
									<IconChevronDown className="w-2 h-2 text-muted-foreground" stroke={1.5} />
									<span className="text-xs font-[510] text-[#7A7A7A]">Composite components</span>
								</div>
								<ComponentGroupList
									groups={filteredCompositeGroups}
									activeComponentPath={activeComponentPath}
									loadingComponentPath={loadingComponent}
									onComponentClick={(c) => loadComponent(c.path)}
								/>
							</div>
						</div>
						)}
					</div>
				</Panel>
				<ResizeHandle
					onPointerUp={() => handleResizeEnd(['components', 'elements-tree'])}
				/>

				{/* Elements tree Panel */}
				<Panel id="elements-tree" panelRef={elementsTreePanelRef} defaultSize="25%" minSize={hasElementsContent ? '60px' : '24px'} maxSize={hasElementsContent ? undefined : '24px'} collapsible collapsedSize="24px">
					<div className="h-full overflow-hidden flex flex-col">
						{/* Header */}
						<div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
							<button
								type="button"
								onClick={() => handleUserToggle('elements-tree', elementsTreePanel.toggle, elementsTreePanelRef)}
								className="flex items-center gap-1 flex-1"
								disabled={!hasElementsContent}
							>
								<IconChevronDown
									className={cn('w-3 h-3 transition-transform duration-200', {
										'rotate-[-90deg]': elementsTreeCollapsed || !hasElementsContent,
									})}
									stroke={1.5}
								/>
								<IconListTree className="w-3.5 h-3.5" stroke={1.5} />
								<span className={cn('text-xs font-semibold', {
									'text-foreground': hasElementsContent,
									'text-muted-foreground': !hasElementsContent,
								})}>
									{hasElementsContent ? 'Elements tree' : 'No elements'}
								</span>
							</button>
							{hasElementsContent && (
								<button
									type="button"
									onClick={(e) => { e.stopPropagation(); setElementsSearchVisible(!elementsSearchVisible); }}
								>
									<IconSearch className="w-4 h-4" stroke={1.5} />
								</button>
							)}
						</div>
						{/* Content */}
						{!elementsTreeCollapsed && hasElementsContent && (
						<div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
							{elementsSearchVisible && (
								<div className="h-6 px-2 bg-muted rounded flex items-center gap-1.5 mx-2 mt-2">
									<IconSearch className="w-3.5 h-3.5 text-muted-foreground" stroke={1.5} />
									<Input
										type="text"
										value={elementsSearchQuery}
										onChange={(e) => setElementsSearchQuery(e.target.value)}
										placeholder="Search elements..."
										className="h-auto border-0 bg-transparent !text-[11px] text-foreground placeholder:text-muted-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1"
									/>
								</div>
							)}
							<ElementsTree
								tree={elementsTree}
								selectedElements={selectedIds}
								onSelectElement={handleSelectElement}
								onOpenPanel={onOpenPanel}
								onHoverElement={onHoverElement}
								hoveredElement={hoveredId || null}
								onElementPosition={onElementPosition}
								searchQuery={elementsSearchQuery}
								onFunctionNavigate={handleFunctionNavigate}
							/>
						</div>
						)}
					</div>
				</Panel>
				<ResizeHandle
					onPointerUp={() => handleResizeEnd(['elements-tree', 'tests'])}
				/>

				{/* Tests Panel */}
				<Panel id="tests" panelRef={testsPanelRef} defaultSize="20%" minSize={hasTestsContent ? '60px' : '24px'} maxSize={hasTestsContent ? undefined : '24px'} collapsible collapsedSize="24px">
					<div className="h-full overflow-hidden flex flex-col">
						{/* Header - always visible */}
						<div className="h-6 px-2 flex items-center justify-between bg-muted border-t border-border w-full shrink-0">
							<button
								type="button"
								onClick={() => handleUserToggle('tests', testsPanel.toggle, testsPanelRef)}
								className="flex items-center gap-1 flex-1"
								disabled={!hasTestsContent}
							>
								<IconChevronDown
									className={cn('w-3 h-3 transition-transform duration-200', {
										'rotate-[-90deg]': testsCollapsed || !hasTestsContent,
									})}
									stroke={1.5}
								/>
								<IconTestPipe className="w-3.5 h-3.5" stroke={1.5} />
								<span className={cn('text-xs font-semibold', {
									'text-foreground': hasTestsContent,
									'text-muted-foreground': !hasTestsContent,
								})}>
									{hasTestsContent ? 'Tests' : 'No tests'}
								</span>
							</button>
							<div className="flex items-center gap-1">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										if (!meta?.relativeFilePath) return;
										setIsTestModalOpen(true);
									}}
									disabled={!meta?.relativeFilePath}
									className={cn(
										'w-6 h-6 flex items-center justify-center rounded hover:bg-accent',
										{ 'opacity-50': !meta?.relativeFilePath },
									)}
									title="Generate tests for current component"
								>
									<IconPlus className="w-4 h-4" stroke={1.5} />
								</button>
								{hasTestsContent && (
									<button
										type="button"
										title="Run tests"
										className={cn(
											'w-6 h-6 flex items-center justify-center rounded hover:bg-accent',
											{ 'opacity-50': testGroups.length === 0 },
										)}
										disabled={testGroups.length === 0}
										onClick={(e) => {
											e.stopPropagation();
											if (testGroups.length === 0) return;
											setIsRunnerModalOpen(true);
										}}
									>
										<IconPlayerPlayFilled className="w-3.5 h-3.5" />
									</button>
								)}
							</div>
						</div>
						{/* Content */}
						{!testsCollapsed && (
						<div className="flex-1 overflow-y-auto flex flex-col">
							<div className="flex flex-col px-2 py-1">
								{!meta?.relativeFilePath ? (
									<p className="text-xs text-muted-foreground px-2 py-2">
										Load a component to see tests
									</p>
								) : isLoadingTests ? (
									<div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
										<div className="animate-spin rounded-full h-3 w-3 border-b border-muted-foreground" />
										Loading tests...
									</div>
								) : testGroups.length === 0 ? (
									<p className="text-xs text-muted-foreground px-2 py-2">
										No tests found. Click + to generate.
									</p>
								) : (
									<div className="flex flex-col">
										{testGroups.map((group) => (
											<div key={group.type} className="flex flex-col">
												<button
													type="button"
													onClick={() => toggleTestGroup(group.type)}
													className="h-6 px-2 flex items-center gap-1 hover:bg-accent rounded"
												>
													<IconChevronDown
														className={cn('w-2.5 h-2.5 transition-transform', {
															'rotate-[-90deg]': !expandedTestGroups.has(group.type),
														})}
														stroke={1.5}
													/>
													<span className="text-xs font-medium text-foreground">
														{getTestTypeLabel(group.type)}
													</span>
													<span className="text-xs text-muted-foreground">
														({group.tests.length})
													</span>
												</button>
												{expandedTestGroups.has(group.type) && (
													<div className="flex flex-col pl-4">
														<div className="text-[10px] text-muted-foreground px-2 py-0.5 truncate">
															{group.relativePath}
														</div>
														{group.tests.map((test) => (
															<div
																key={`${group.type}-${test.name}-${test.line}`}
																className="h-5 px-2 flex items-center text-xs text-foreground truncate"
																title={`${test.name} (line ${test.line})`}
															>
																<span className="truncate">{test.name}</span>
															</div>
														))}
													</div>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						</div>
						)}
					</div>
				</Panel>
			</PanelGroup>

		{/* Test Generation Modal */}
			{meta?.relativeFilePath && (
				<TestGenerationModal
					isOpen={isTestModalOpen}
					onClose={() => {
						setIsTestModalOpen(false);
						// Reload tests after modal closes
						loadComponentTests();
					}}
					projectId={meta?.projectId}
					componentPath={meta.relativeFilePath}
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
