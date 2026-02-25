import { useState, useEffect, useRef, useCallback, type RefObject } from 'react';
import {
	type PanelImperativeHandle,
	type Layout,
	useGroupRef,
} from 'react-resizable-panels';

interface PanelContentFlags {
	hasRawPagesContent: boolean;
	hasRawComponentsContent: boolean;
	hasElementsContent: boolean;
	hasTestsContent: boolean;
}

interface UseSidebarPanelLayoutParams {
	defaultLayout: Layout | undefined;
	contentFlags: PanelContentFlags;
	isPushPopoverOpen: boolean;
	componentsLoaded: boolean;
}

export function useSidebarPanelLayout({
	defaultLayout,
	contentFlags,
	isPushPopoverOpen,
	componentsLoaded,
}: UseSidebarPanelLayoutParams) {
	const { hasRawPagesContent, hasRawComponentsContent, hasElementsContent, hasTestsContent } =
		contentFlags;

	// Panel refs
	const groupRef = useGroupRef();
	const pagesPanelRef = useRef<PanelImperativeHandle>(null);
	const componentsPanelRef = useRef<PanelImperativeHandle>(null);
	const elementsTreePanelRef = useRef<PanelImperativeHandle>(null);
	const testsPanelRef = useRef<PanelImperativeHandle>(null);
	const sourceControlPanelRef = useRef<PanelImperativeHandle>(null);

	// Internal refs
	const userManuallyCollapsed = useRef(new Set<string>());

	// Collapsed states
	const [pagesCollapsed, setPagesCollapsed] = useState(
		() => defaultLayout?.pages !== undefined && defaultLayout.pages <= 24,
	);
	const [componentsCollapsed, setComponentsCollapsed] = useState(
		() =>
			defaultLayout?.components !== undefined && defaultLayout.components <= 24,
	);
	const [elementsTreeCollapsed, setElementsTreeCollapsed] = useState(
		() =>
			defaultLayout?.['elements-tree'] !== undefined &&
			defaultLayout['elements-tree'] <= 24,
	);
	const [testsCollapsed, setTestsCollapsed] = useState(
		() => defaultLayout?.tests !== undefined && defaultLayout.tests <= 24,
	);
	const [sourceControlCollapsed, setSourceControlCollapsed] = useState(false);

	// Track manual collapse/expand in toggle clicks
	const handleUserToggle = useCallback(
		(
			panelId: string,
			animatedToggle: () => void,
			panelRef: RefObject<PanelImperativeHandle | null>,
		) => {
			if (panelRef.current?.isCollapsed()) {
				userManuallyCollapsed.current.delete(panelId);
			} else {
				userManuallyCollapsed.current.add(panelId);
			}
			animatedToggle();
		},
		[],
	);

	// Generic resize end handler — updates collapsed state for adjacent panels.
	// Only tracks user-collapsed state for panels that actually have content,
	// so force-collapsed panels (maxSize="24px") don't get falsely recorded.
	const contentFlagsRef = useRef(contentFlags);
	contentFlagsRef.current = contentFlags;

	const handleResizeEnd = useCallback((panelIds: string[]) => {
		const panelMap: Record<
			string,
			{
				ref: RefObject<PanelImperativeHandle | null>;
				setCollapsed: (v: boolean) => void;
			}
		> = {
			'source-control': {
				ref: sourceControlPanelRef,
				setCollapsed: setSourceControlCollapsed,
			},
			pages: { ref: pagesPanelRef, setCollapsed: setPagesCollapsed },
			components: {
				ref: componentsPanelRef,
				setCollapsed: setComponentsCollapsed,
			},
			'elements-tree': {
				ref: elementsTreePanelRef,
				setCollapsed: setElementsTreeCollapsed,
			},
			tests: { ref: testsPanelRef, setCollapsed: setTestsCollapsed },
		};

		const contentByPanel: Record<string, boolean> = {
			pages: contentFlagsRef.current.hasRawPagesContent,
			components: contentFlagsRef.current.hasRawComponentsContent,
			'elements-tree': contentFlagsRef.current.hasElementsContent,
			tests: contentFlagsRef.current.hasTestsContent,
		};

		for (const id of panelIds) {
			const config = panelMap[id];
			if (!config) continue;
			const size = config.ref.current?.getSize().inPixels ?? 0;
			config.setCollapsed(size <= 24);
			// Only track user intent for panels that have content —
			// force-collapsed panels (no content) shouldn't be marked
			if (id !== 'source-control' && contentByPanel[id]) {
				if (size <= 24) userManuallyCollapsed.current.add(id);
				else userManuallyCollapsed.current.delete(id);
			}
		}
	}, []);

	// Expand source control when push popover opens
	useEffect(() => {
		if (isPushPopoverOpen) {
			setSourceControlCollapsed(false);
		}
	}, [isPushPopoverOpen]);

	// Unified auto-layout: expand panels with content, collapse empty ones, redistribute space
	useEffect(() => {
		if (!componentsLoaded) return;
		if (!groupRef.current) return;

		const panelConfigs = [
			{
				id: 'pages',
				hasContent: hasRawPagesContent,
				ref: pagesPanelRef,
				setCollapsed: setPagesCollapsed,
			},
			{
				id: 'components',
				hasContent: hasRawComponentsContent,
				ref: componentsPanelRef,
				setCollapsed: setComponentsCollapsed,
			},
			{
				id: 'elements-tree',
				hasContent: hasElementsContent,
				ref: elementsTreePanelRef,
				setCollapsed: setElementsTreeCollapsed,
			},
			{
				id: 'tests',
				hasContent: hasTestsContent,
				ref: testsPanelRef,
				setCollapsed: setTestsCollapsed,
			},
		];

		const toExpand = panelConfigs.filter(
			(p) => p.hasContent && !userManuallyCollapsed.current.has(p.id),
		);
		const toCollapse = panelConfigs.filter((p) => !p.hasContent);

		// Check if anything actually needs to change
		let needsChange = false;
		for (const p of toExpand) {
			if (p.ref.current?.isCollapsed()) {
				needsChange = true;
				break;
			}
		}
		if (!needsChange) {
			for (const p of toCollapse) {
				if (p.ref.current && !p.ref.current.isCollapsed()) {
					needsChange = true;
					break;
				}
			}
		}
		if (!needsChange) return;

		// Collapse empty panels
		for (const p of toCollapse) {
			p.setCollapsed(true);
			if (p.ref.current && !p.ref.current.isCollapsed()) {
				p.ref.current.collapse();
			}
		}

		// Expand panels with content (that user didn't manually collapse)
		for (const p of toExpand) {
			p.setCollapsed(false);
			if (p.ref.current?.isCollapsed()) {
				p.ref.current.expand();
			}
		}

		// Redistribute space evenly via setLayout
		if (toExpand.length > 0) {
			requestAnimationFrame(() => {
				const currentLayout = groupRef.current?.getLayout();
				if (!currentLayout) return;

				const newLayout = { ...currentLayout };

				// Source control keeps its current size
				let reservedPercent = newLayout['source-control'] || 0;

				// Each collapsed panel gets a small percentage for its 24px header
				const collapsedPercent =
					toCollapse.length > 0 && toCollapse[0].ref.current
						? toCollapse[0].ref.current.getSize().asPercentage
						: 2;

				for (const p of toCollapse) {
					newLayout[p.id] = collapsedPercent;
					reservedPercent += collapsedPercent;
				}

				// Panels user manually collapsed keep their collapsed size too
				const manuallyCollapsedNotEmpty = panelConfigs.filter(
					(p) =>
						p.hasContent && userManuallyCollapsed.current.has(p.id),
				);
				for (const p of manuallyCollapsedNotEmpty) {
					const pctNow =
						p.ref.current?.getSize().asPercentage ??
						collapsedPercent;
					newLayout[p.id] = pctNow;
					reservedPercent += pctNow;
				}

				const availablePercent = 100 - reservedPercent;
				const equalPercent = availablePercent / toExpand.length;

				for (const p of toExpand) {
					newLayout[p.id] = equalPercent;
				}

				groupRef.current?.setLayout(newLayout);
			});
		}
	}, [
		componentsLoaded,
		hasRawPagesContent,
		hasRawComponentsContent,
		hasElementsContent,
		hasTestsContent,
		isPushPopoverOpen,
	]);

	return {
		// Panel refs
		groupRef,
		pagesPanelRef,
		componentsPanelRef,
		elementsTreePanelRef,
		testsPanelRef,
		sourceControlPanelRef,

		// Collapsed state
		pagesCollapsed,
		componentsCollapsed,
		elementsTreeCollapsed,
		testsCollapsed,
		sourceControlCollapsed,
		setSourceControlCollapsed,

		// Setters for useAnimatedPanelCollapse
		setPagesCollapsed,
		setComponentsCollapsed,
		setElementsTreeCollapsed,
		setTestsCollapsed,

		// Handlers
		handleUserToggle,
		handleResizeEnd,
	};
}
