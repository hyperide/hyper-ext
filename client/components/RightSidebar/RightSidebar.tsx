import { IconChevronDown, IconCode, IconPointer } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import type { CanvasEngine } from '@/lib/canvas-engine';
import {
	usePlatformAst,
	usePlatformCanvas,
	usePlatformContext,
	useGoToCode,
	useOpenAIChat,
	useElementStyleData,
} from '@/lib/platform';
import { useSharedEditorState } from '@/lib/platform/shared-editor-state';
import { useEditorStore } from '@/stores/editorStore';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/utils/authFetch';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import { TailwindAdapter } from '@/lib/canvas-engine/adapters/TailwindAdapter';
import { TamaguiAdapter } from '@/lib/canvas-engine/adapters/TamaguiAdapter';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import { SetupTailwindButton } from '../SetupTailwindButton';
import { Input } from '../ui/input';

import type {
	PositionType,
	LayoutType,
	StrokeItem,
	EffectItem,
	RightSidebarProps,
} from './types';
import {
	parseHexWithAlpha,
	mapShadowSizeToValues,
	findNodeById,
	positionToCss,
	cssToPosition,
} from './utils';
import { useStyleSync } from './hooks/useStyleSync';
import {
	HeaderSection,
	ViewControlsSection,
	StateSelectorSection,
	PositionSection,
	MarginSection,
	FillSection,
	LayoutSection,
	AppearanceSection,
	StrokeSection,
	EffectsSection,
	CommentsSectionContainer,
} from './sections';
import type { FillMode } from '../ui/fill-picker';

// ============================================================================
// Compatibility hooks — work in both SaaS and VS Code
// ============================================================================

/**
 * Get selected IDs from engine (SaaS) or shared editor state (VS Code).
 * Both hooks always run — no conditional hook violation.
 */
function useSelectionCompat(engine: CanvasEngine | null): string[] {
	const [engineIds, setEngineIds] = useState<string[]>([]);
	const sharedIds = useSharedEditorState((s) => s.selectedIds);

	useEffect(() => {
		if (!engine) return;
		setEngineIds(engine.getSelection().selectedIds);
		return engine.events.on('selection:change', (event) => {
			setEngineIds([...event.selectedIds]);
		});
	}, [engine]);

	return engine ? engineIds : sharedIds;
}

/**
 * Get component file path from engine (SaaS) or shared editor state (VS Code).
 */
function useComponentPathCompat(engine: CanvasEngine | null): string | null {
	const sharedComponent = useSharedEditorState((s) => s.currentComponent);

	if (engine) {
		return (engine.getRoot().metadata?.filePath as string) ?? null;
	}

	return sharedComponent?.path ?? null;
}

// ============================================================================
// Main Component
// ============================================================================

export default function RightSidebar({
	onOpenSettings,
	viewport,
	onZoomChange,
	onFitToContent,
	activeInstanceId = null,
	canvasMode = 'single',
	instanceSize,
	onInstanceSizeChange,
	// Project UI kit data (passed from CanvasEditor)
	projectUIKit = 'none',
	activeProjectId = null,
	activeProjectName = null,
	publicDirExists = false,
}: RightSidebarProps) {
	const engine = useCanvasEngineOptional();
	const canvas = usePlatformCanvas();
	const platformContext = usePlatformContext();
	const isVSCode = platformContext === 'vscode-webview';

	const selectedIds = useSelectionCompat(engine);
	const componentPath = useComponentPathCompat(engine);

	const { openFile, showComments, setShowComments, isReadonly: editorStoreReadonly } = useEditorStore();
	const isReadonly = isVSCode ? false : editorStoreReadonly;

	// AST operations (platform-aware: authFetch in browser, canvasRPC in VS Code)
	const astOps = usePlatformAst();
	const goToCode = useGoToCode();
	const openAIChat = useOpenAIChat();

	// Create style adapter based on UI kit
	const styleAdapter: StyleAdapter = useMemo(() => {
		return projectUIKit === 'tamagui'
			? new TamaguiAdapter(astOps)
			: new TailwindAdapter(astOps);
	}, [projectUIKit, astOps]);

	// Current state modifier for Tailwind (hover, focus, etc.)
	const [currentState, setCurrentState] = useState<string | undefined>(
		undefined,
	);

	// Read element style data (browser: engine+DOM, VS Code: RPC)
	const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
	const [styleRefreshKey, setStyleRefreshKey] = useState(0);
	const {
		parsedStyles,
		childrenType,
		textContent: dataTextContent,
		tagType,
		loading,
		childrenLocation,
	} = useElementStyleData({
		elementId: selectedId,
		componentPath,
		canvas,
		engine,
		styleAdapter,
		activeInstanceId,
		refreshKey: styleRefreshKey,
	});

	// Apply state filter to parsedStyles
	const effectiveParsed: Partial<ParsedStyles> = useMemo(() => {
		if (!parsedStyles) return {};
		if (!currentState) return parsedStyles;

		const stateKey = currentState.replace(/-([a-z])/g, (_, letter: string) =>
			letter.toUpperCase(),
		) as keyof ParsedStyles;
		return (parsedStyles[stateKey] as Partial<ParsedStyles>) || {};
	}, [parsedStyles, currentState]);

	// AI error fallback: when style sync fails, open AI chat with error context
	const handleSyncError = useCallback(
		(styles: Record<string, string>, error: string) => {
			const styleDesc = Object.entries(styles)
				.map(([k, v]) => `${k}: ${v}`)
				.join(', ');
			openAIChat({
				prompt: `Style update failed for element "${selectedIds[0] ?? 'unknown'}" in ${componentPath ?? 'unknown file'}.\n\nAttempted styles: ${styleDesc}\nError: ${error}\n\nPlease fix the issue or apply these styles manually.`,
				forceNewChat: true,
			});
		},
		[openAIChat, selectedIds, componentPath],
	);

	// Style sync hook
	const { syncStyleChange, syncTextChange, isStyleSyncing } = useStyleSync({
		selectedIds,
		filePath: componentPath,
		styleAdapter,
		astOps,
		currentState,
		engine,
		onSyncError: handleSyncError,
	});

	// Position state
	const [selectedPosition, setSelectedPosition] =
		useState<PositionType>('static');
	const [posTop, setPosTop] = useState('');
	const [posRight, setPosRight] = useState('');
	const [posBottom, setPosBottom] = useState('');
	const [posLeft, setPosLeft] = useState('');

	// Margin state
	const [marginTop, setMarginTop] = useState('');
	const [marginRight, setMarginRight] = useState('');
	const [marginBottom, setMarginBottom] = useState('');
	const [marginLeft, setMarginLeft] = useState('');
	const [marginLinked, setMarginLinked] = useState(false);

	// Layout state
	const [selectedLayout, setSelectedLayout] = useState<LayoutType>('layout');
	const [clipContent, setClipContent] = useState(true);
	const [width, setWidth] = useState('');
	const [height, setHeight] = useState('');

	// Padding state
	const [paddingTop, setPaddingTop] = useState('');
	const [paddingRight, setPaddingRight] = useState('');
	const [paddingBottom, setPaddingBottom] = useState('');
	const [paddingLeft, setPaddingLeft] = useState('');

	// Flex/Grid layout state
	const [gap, setGap] = useState('');
	const [justifyContent, setJustifyContent] = useState('');
	const [alignItems, setAlignItems] = useState('');

	// Grid-specific layout state
	const [columnGap, setColumnGap] = useState('');
	const [rowGap, setRowGap] = useState('');
	const [gridJustifyItems, setGridJustifyItems] = useState('');
	const [gridAlignItems, setGridAlignItems] = useState('');
	const [gridCols, setGridCols] = useState('');
	const [gridRows, setGridRows] = useState('');

	// Color state
	const [backgroundColor, setBackgroundColor] = useState('');
	const [textColor, setTextColor] = useState('');
	const [fillOpacity, setFillOpacity] = useState('');
	const [opacity, setOpacity] = useState('');
	const [fillMode, setFillMode] = useState<FillMode>('color');
	const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

	// Border radius state
	const [borderRadius, setBorderRadius] = useState('');

	// Stroke state
	const [strokes, setStrokes] = useState<StrokeItem[]>([]);

	// Effects state
	const [effects, setEffects] = useState<EffectItem[]>([]);

	// Text content state
	const [textContent, setTextContent] = useState('');
	const [isTextFromProps, setIsTextFromProps] = useState(false);
	const debouncedTextSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Root ref for wheel event handling
	const rootRef = useRef<HTMLDivElement>(null);

	// Keyboard handler for numeric inputs (ArrowUp/Down)
	const handleNumericKeyDown = useCallback(
		(
			e: React.KeyboardEvent<HTMLInputElement>,
			currentValue: string,
			setValue: (value: string) => void,
			styleKey?: string,
		) => {
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
				return;
			}

			e.preventDefault();

			const isUnitless =
				styleKey === 'opacity' ||
				styleKey === 'gridTemplateColumns' ||
				styleKey === 'gridTemplateRows';
			const trimmed = currentValue.replace(' Auto', '').trim();
			const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(.*)$/);

			if (!match) {
				const increment = e.key === 'ArrowUp' ? 1 : -1;
				const step = e.shiftKey || e.altKey ? 10 : 1;
				let newNum = increment * step;

				if (styleKey === 'opacity') {
					newNum = Math.max(0, Math.min(100, newNum));
				}

				const newValue = isUnitless ? `${newNum}` : `${newNum}px`;
				setValue(newValue);
				if (styleKey) syncStyleChange(styleKey, newValue);
				return;
			}

			const num = Number.parseFloat(match[1]);
			const unit = match[2] || (isUnitless ? '' : 'px');

			const increment = e.key === 'ArrowUp' ? 1 : -1;
			const step = e.shiftKey || e.altKey ? 10 : 1;
			let newNum = num + increment * step;

			if (styleKey === 'opacity') {
				newNum = Math.max(0, Math.min(100, newNum));
			}

			const newValue = `${newNum}${unit}`;
			setValue(newValue);
			if (styleKey) syncStyleChange(styleKey, newValue);
		},
		[syncStyleChange],
	);

	// Position handlers
	const handlePositionChange = useCallback(
		(pos: PositionType) => {
			setSelectedPosition(pos);
			syncStyleChange('position', positionToCss(pos));
		},
		[syncStyleChange],
	);

	const handlePositionValueChange = useCallback(
		(key: 'top' | 'right' | 'bottom' | 'left', value: string) => {
			const setters = {
				top: setPosTop,
				right: setPosRight,
				bottom: setPosBottom,
				left: setPosLeft,
			};
			setters[key](value);
			syncStyleChange(key, value);
		},
		[syncStyleChange],
	);

	// Margin handlers
	const handleMarginChange = useCallback(
		(key: string, value: string) => {
			const setters: Record<string, (v: string) => void> = {
				marginTop: setMarginTop,
				marginRight: setMarginRight,
				marginBottom: setMarginBottom,
				marginLeft: setMarginLeft,
			};
			setters[key]?.(value);
			syncStyleChange(key, value);
		},
		[syncStyleChange],
	);

	// Layout change handler
	const handleLayoutChange = useCallback(
		async (layoutType: LayoutType) => {
			if (selectedIds.length === 0 || !selectedIds[0]) {
				return;
			}

			const selectedElementId = selectedIds[0];

			if (!componentPath) {
				console.error('[RightSidebar] No file path found');
				return;
			}

			try {
				setSelectedLayout(layoutType);
				await styleAdapter.changeLayout(selectedElementId, componentPath, layoutType);
				setStyleRefreshKey((k) => k + 1);
			} catch (error) {
				console.error('[RightSidebar] Failed to change layout:', error);
			}
		},
		[selectedIds, componentPath, styleAdapter],
	);

	// Width/Height handlers
	const handleWidthChange = useCallback(
		(value: string) => {
			setWidth(value);
			syncStyleChange('width', value.replace(' Auto', ''));
		},
		[syncStyleChange],
	);

	const handleHeightChange = useCallback(
		(value: string) => {
			setHeight(value);
			syncStyleChange('height', value.replace(' Auto', ''));
		},
		[syncStyleChange],
	);

	const handleWidthBlur = useCallback(() => {
		const cleanWidth = width.replace(' Auto', '');
		const num = Number.parseFloat(cleanWidth);
		if (!Number.isNaN(num) && !cleanWidth.includes('px')) {
			const newValue = `${num}px`;
			setWidth(newValue);
			syncStyleChange('width', newValue);
		}
	}, [width, syncStyleChange]);

	const handleHeightBlur = useCallback(() => {
		const cleanHeight = height.replace(' Auto', '');
		const num = Number.parseFloat(cleanHeight);
		if (!Number.isNaN(num) && !cleanHeight.includes('px')) {
			const newValue = `${num}px`;
			setHeight(newValue);
			syncStyleChange('height', newValue);
		}
	}, [height, syncStyleChange]);

	// Padding handler
	const handlePaddingChange = useCallback((key: string, value: string) => {
		const setters: Record<string, (v: string) => void> = {
			paddingTop: setPaddingTop,
			paddingRight: setPaddingRight,
			paddingBottom: setPaddingBottom,
			paddingLeft: setPaddingLeft,
		};
		setters[key]?.(value);
	}, []);

	// Setup Tailwind handler (works in both SaaS and VS Code)
	const handleSetupTailwind = useCallback(() => {
		openAIChat({
			prompt:
				'Install and configure TailwindCSS in this project. Add tailwindcss to devDependencies, create tailwind.config.js file, and add TailwindCSS directives to the main CSS file.',
			forceNewChat: true,
		});
	}, [openAIChat]);

	// Text content handler
	const handleTextContentChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const value = e.target.value;
			setTextContent(value);

			if (debouncedTextSyncRef.current) {
				clearTimeout(debouncedTextSyncRef.current);
			}

			debouncedTextSyncRef.current = setTimeout(() => {
				syncTextChange(value);
			}, 300);
		},
		[syncTextChange],
	);

	// Go to text in code editor (SaaS only)
	const handleGoToTextCode = useCallback(async () => {
		if (selectedIds.length === 0 || !componentPath || !engine) {
			return;
		}

		const goToSelectedId = selectedIds[0];

		try {
			// Get element and children location from server
			const response = await authFetch(
				`/api/get-element-location?filePath=${encodeURIComponent(componentPath)}&uniqId=${encodeURIComponent(goToSelectedId)}`,
			);

			if (!response.ok) {
				toast({
					variant: 'destructive',
					title: 'Navigation Error',
					description: 'Could not find element location in code',
				});
				return;
			}

			const data = await response.json();

			if (!data.success || !data.location) {
				toast({
					variant: 'destructive',
					title: 'Navigation Error',
					description: 'Could not find element location in code',
				});
				return;
			}

			// Use childrenLocation if available, otherwise fall back to element location
			const targetLocation = data.childrenLocation || data.location;

			// Read file content
			const fileResponse = await authFetch(
				`/api/read-file?path=${encodeURIComponent(componentPath)}`,
			);

			if (!fileResponse.ok) {
				return;
			}

			const fileData = await fileResponse.json();

			// Switch to code mode
			engine.setMode('code');

			// Open file in editor
			openFile(componentPath, fileData.content);

			// Dispatch navigation event after React updates
			requestAnimationFrame(() => {
				window.dispatchEvent(
					new CustomEvent('monaco-goto-position', {
						detail: {
							line: targetLocation.line,
							column: targetLocation.column,
							endLine: targetLocation.endLine,
							endColumn: targetLocation.endColumn,
							filePath: componentPath,
						},
					}),
				);
			});
		} catch (error) {
			console.error('[Go to Text Code] Error:', error);
			toast({
				variant: 'destructive',
				title: 'Navigation Error',
				description: 'Failed to navigate to code',
			});
		}
	}, [selectedIds, componentPath, engine, openFile]);

	// Go to text in code editor (VS Code — uses childrenLocation from RPC)
	const handleGoToTextCodeVSCode = useCallback(() => {
		if (!componentPath || !childrenLocation) return;
		goToCode(componentPath, childrenLocation.line, childrenLocation.column);
	}, [componentPath, childrenLocation, goToCode]);

	// ========================================================================
	// Populate UI state from parsedStyles
	// ========================================================================

	useEffect(() => {
		if (!selectedId || !parsedStyles) {
			// Reset all values
			setSelectedPosition('static');
			setPosTop('');
			setPosRight('');
			setPosBottom('');
			setPosLeft('');
			setWidth('');
			setHeight('');
			setMarginTop('');
			setMarginRight('');
			setMarginBottom('');
			setMarginLeft('');
			setPaddingTop('');
			setPaddingRight('');
			setPaddingBottom('');
			setPaddingLeft('');
			setGap('');
			setJustifyContent('');
			setAlignItems('');
			setColumnGap('');
			setRowGap('');
			setGridJustifyItems('');
			setGridAlignItems('');
			setGridCols('');
			setGridRows('');
			setBackgroundColor('');
			setTextColor('');
			setBorderRadius('');
			setOpacity('');
			setClipContent(false);
			setSelectedLayout('layout');
			setStrokes([]);
			setEffects([]);
			setTextContent('');
			setIsTextFromProps(false);
			return;
		}

		const ep = effectiveParsed;

		// Update position
		setSelectedPosition(cssToPosition(ep.position || 'static'));
		setPosTop(ep.top || '');
		setPosRight(ep.right || '');
		setPosBottom(ep.bottom || '');
		setPosLeft(ep.left || '');

		// Update dimensions
		setWidth(ep.width || '');
		setHeight(ep.height || '');

		// Update margin
		setMarginTop(ep.marginTop || '');
		setMarginRight(ep.marginRight || '');
		setMarginBottom(ep.marginBottom || '');
		setMarginLeft(ep.marginLeft || '');

		// Update padding
		setPaddingTop(ep.paddingTop || '');
		setPaddingRight(ep.paddingRight || '');
		setPaddingBottom(ep.paddingBottom || '');
		setPaddingLeft(ep.paddingLeft || '');

		// Update flex/grid
		setGap(ep.gap || '');
		setJustifyContent(ep.justifyContent || '');
		setAlignItems(ep.alignItems || '');

		// Update grid-specific
		setColumnGap(ep.columnGap || '');
		setRowGap(ep.rowGap || '');
		setGridJustifyItems(ep.justifyItems || '');
		setGridAlignItems(ep.alignItems || '');
		setGridCols(ep.gridTemplateColumns || '');
		setGridRows(ep.gridTemplateRows || '');

		// Update colors
		if (ep.backgroundColor) {
			const { color, opacity: parsedFillOpacity } = parseHexWithAlpha(
				ep.backgroundColor,
			);
			setBackgroundColor(color);
			setFillOpacity(parsedFillOpacity ?? '100');
		} else {
			setBackgroundColor('');
			setFillOpacity('');
		}
		setOpacity(ep.opacity || '');
		setBackgroundImage(ep.backgroundImage || null);

		if (ep.color) {
			const { color } = parseHexWithAlpha(ep.color);
			setTextColor(color);
		} else {
			setTextColor('');
		}

		// Update border radius
		setBorderRadius(ep.borderRadius || '');

		// Update overflow
		if (
			ep.overflow === 'hidden' ||
			ep.overflow === 'scroll' ||
			ep.overflow === 'auto'
		) {
			setClipContent(true);
		} else {
			setClipContent(false);
		}

		// Update layout
		setSelectedLayout(ep.layoutType || 'layout');

		// Update strokes
		const hasAnyBorder =
			(ep.borderWidth &&
				ep.borderWidth !== '0' &&
				ep.borderWidth !== '0px') ||
			(ep.borderTopWidth &&
				ep.borderTopWidth !== '0') ||
			(ep.borderRightWidth &&
				ep.borderRightWidth !== '0') ||
			(ep.borderBottomWidth &&
				ep.borderBottomWidth !== '0') ||
			(ep.borderLeftWidth &&
				ep.borderLeftWidth !== '0');

		if (hasAnyBorder) {
			const borderWidth =
				ep.borderWidth ||
				ep.borderTopWidth ||
				ep.borderRightWidth ||
				ep.borderBottomWidth ||
				ep.borderLeftWidth ||
				'1px';

			setStrokes([
				{
					id: '1',
					visible: true,
					color: ep.borderColor || '#000000',
					opacity: '100',
					width: borderWidth.replace('px', ''),
					style:
						(ep.borderStyle as StrokeItem['style']) || 'solid',
					sides: {
						top:
							!!ep.borderWidth ||
							!!ep.borderTopWidth,
						right:
							!!ep.borderWidth ||
							!!ep.borderRightWidth,
						bottom:
							!!ep.borderWidth ||
							!!ep.borderBottomWidth,
						left:
							!!ep.borderWidth ||
							!!ep.borderLeftWidth,
					},
				},
			]);
		} else {
			setStrokes([]);
		}

		// Update effects
		const newEffects: EffectItem[] = [];
		if (ep.shadow && ep.shadow !== 'none') {
			const hasArbitraryValues =
				ep.shadowX ||
				ep.shadowY ||
				ep.shadowBlur ||
				ep.shadowSpread;
			const isPreset =
				!hasArbitraryValues &&
				['sm', 'default', 'md', 'lg', 'xl', '2xl', 'inner'].includes(
					ep.shadow,
				);

			const values = hasArbitraryValues
				? {
						x: ep.shadowX,
						y: ep.shadowY,
						blur: ep.shadowBlur,
						spread: ep.shadowSpread,
					}
				: mapShadowSizeToValues(
						ep.shadow === 'inner'
							? 'default'
							: ep.shadow,
						ep.shadow === 'inner'
							? 'inner-shadow'
							: 'drop-shadow',
					);

			let color = '#000000';
			let shadowOpacity = '100';
			if (ep.shadowColor?.match(/^#[0-9a-fA-F]{8}$/)) {
				color = ep.shadowColor.slice(0, 7);
				const alpha = Number.parseInt(
					ep.shadowColor.slice(7, 9),
					16,
				);
				shadowOpacity = Math.round((alpha / 255) * 100).toString();
			} else if (ep.shadowColor) {
				color = ep.shadowColor;
				shadowOpacity = ep.shadowOpacity || '100';
			}

			newEffects.push({
				id: '1',
				visible: true,
				type:
					ep.shadow === 'inner' ? 'inner-shadow' : 'drop-shadow',
				x: values.x,
				y: values.y,
				blur: values.blur,
				spread: values.spread,
				color,
				opacity: shadowOpacity,
				preset: isPreset ? ep.shadow : undefined,
			});
		}
		if (ep.blur && ep.blur !== 'none') {
			newEffects.push({
				id: '2',
				visible: true,
				type: 'blur',
				value: ep.blur,
				color: '#000000',
				opacity: '100',
			});
		}
		setEffects(newEffects);

		// Update text content
		setTextContent(dataTextContent);
		// In browser mode, text from DOM (no childrenType) is "from props"
		setIsTextFromProps(engine !== null && !childrenType && !!dataTextContent);
	}, [selectedId, parsedStyles, effectiveParsed, dataTextContent, childrenType, engine]);

	// Auto-reset unsupported values when UI kit is Tamagui
	useEffect(() => {
		if (projectUIKit !== 'tamagui') return;

		if (selectedPosition === 'sticky') {
			setSelectedPosition('static');
		}
		if (selectedLayout === 'grid') {
			setSelectedLayout('row');
		}
		setEffects((prev) =>
			prev.filter((e) => e.type !== 'inner-shadow' && e.type !== 'blur'),
		);
	}, [projectUIKit, selectedPosition, selectedLayout]);

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

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (debouncedTextSyncRef.current) {
				clearTimeout(debouncedTextSyncRef.current);
			}
		};
	}, []);

	// Get frame type for display
	const getFrameType = useCallback(() => {
		// VS Code mode: use tagType from style data
		if (!engine) {
			return tagType === 'div' ? 'Frame (div)' : tagType || 'Frame';
		}

		// SaaS mode: look up in engine AST/registry
		const ids = engine.getSelection().selectedIds;
		const instance = ids.length > 0
			? engine.getInstance(ids[0]) ?? null
			: null;

		if (ids.length > 0 && !instance) {
			const lookupId = ids[0];
			const root = engine.getRoot();

			if (root.metadata?.astStructure) {
				const foundNode = findNodeById(root.metadata.astStructure, lookupId);
				if (foundNode) {
					return foundNode.type === 'div' ? 'Frame (div)' : foundNode.type;
				}
			}

			const rootChildren = root.children || [];
			for (const childId of rootChildren) {
				const inst = engine.getInstance(childId);
				if (inst?.metadata?.astStructure) {
					const foundNode = findNodeById(
						inst.metadata.astStructure,
						lookupId,
					);
					if (foundNode) {
						return foundNode.type === 'div' ? 'Frame (div)' : foundNode.type;
					}
				}
			}

			return 'Frame';
		}

		if (!instance) {
			return 'Frame';
		}

		const componentDef = engine.registry.get(instance.type);
		if (componentDef) {
			return componentDef.label;
		}

		return instance.type;
	}, [engine, tagType]);

	return (
		<div
			data-uniq-id="442cbdd6-8543-4489-b0c5-a6de4aa5b92f"
			ref={rootRef}
			className="h-full w-full border-l border-border bg-background overflow-y-auto overflow-x-hidden relative z-20"
		>
			{/* SaaS-only sections */}
			{!isVSCode && (
				<HeaderSection
					data-uniq-id="91a5165a-f357-45d0-aff9-9ac153b2a603"
					onOpenSettings={onOpenSettings}
					projectId={activeProjectId}
					projectName={activeProjectName}
				/>
			)}
			{!isVSCode && (
				<ViewControlsSection
					data-uniq-id="7c70db2f-ae92-4b8c-afb0-ae1ba75c8f21"
					viewport={canvasMode === 'multi' ? viewport : undefined}
					onZoomChange={canvasMode === 'multi' ? onZoomChange : undefined}
					onFitToContent={canvasMode === 'multi' ? onFitToContent : undefined}
					instanceSize={instanceSize}
					onInstanceSizeChange={onInstanceSizeChange}
				/>
			)}
			{!isVSCode && showComments && (
				<CommentsSectionContainer
					projectId={activeProjectId ?? undefined}
					componentPath={componentPath ?? undefined}
					onClose={() => setShowComments(false)}
				/>
			)}

			{/* No selection */}
			{selectedIds.length === 0 && (
				<div className="px-4 py-16 text-center flex flex-col items-center gap-3">
					<IconPointer className="w-8 h-8 text-muted-foreground/50" stroke={1.5} />
					<p className="text-sm font-medium text-foreground">
						{componentPath ? 'No element selected' : 'No component open'}
					</p>
					<p className="text-xs text-muted-foreground">
						{componentPath
							? 'Click an element in the tree to inspect its styles'
							: 'Open a component from the Explorer panel'}
					</p>
				</div>
			)}

			{selectedIds.length > 1 && (
				<div
					data-uniq-id="36ec40bb-5b54-4829-88b2-2f8bde3d8aa1"
					className="px-4 py-8 text-center"
				>
					<p
						data-uniq-id="745d80f1-b662-4a2b-a181-87a3f6bb70a0"
						className="text-sm text-muted-foreground mb-2"
					>
						Multiple elements selected
					</p>
					<p
						data-uniq-id="09788d85-8ba2-47bb-869d-b8300a576eb4"
						className="text-xs text-muted-foreground"
					>
						Select a single element to edit its properties
					</p>
				</div>
			)}

			{/* Loading (VS Code RPC) — only on first load, not on element switch */}
			{selectedIds.length === 1 && loading && !parsedStyles && (
				<div className="px-4 py-8 text-center">
					<p className="text-xs text-muted-foreground">Reading styles...</p>
				</div>
			)}

			{selectedIds.length === 1 && parsedStyles &&
				(canvasMode !== 'multi' || activeInstanceId) && (
					<>
						{/* Frame type */}
						<div className="px-4 py-3 border-b border-border max-w-sidebar-section overflow-hidden">
							<div className="flex items-center gap-1.5">
								<span className="text-sm font-semibold text-foreground">
									{getFrameType()}
								</span>
								<IconChevronDown className="w-3 h-3" stroke={1.5} />
							</div>
						</div>

						{/* Text Content */}
						{childrenType !== 'jsx' && (
							<div className={`px-4 py-3 border-b border-border max-w-sidebar-section overflow-hidden ${isReadonly ? 'opacity-50 pointer-events-none' : ''}`}>
								<div className="flex items-center gap-1">
									<div className="flex-1 min-w-0 min-h-6 px-2 bg-muted rounded flex items-center gap-1">
										{(childrenType === 'expression' ||
											childrenType === 'expression-complex') && (
											<span className="text-[11px] text-muted-foreground font-mono">
												{'{}'}
											</span>
										)}
										<Input
											type="text"
											value={textContent}
											onChange={handleTextContentChange}
											disabled={isReadonly}
											className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 font-mono"
											placeholder={
												childrenType === 'expression' ||
												childrenType === 'expression-complex'
													? 'Expression'
													: 'Text content'
											}
										/>
									</div>
									{/* Go to code button */}
									{isVSCode ? (
										childrenLocation && (
											<button
												type="button"
												onClick={handleGoToTextCodeVSCode}
												className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-transparent"
												title="Go to code"
											>
												<IconCode className="w-4 h-4 text-foreground" stroke={1.5} />
											</button>
										)
									) : (
										<button
											type="button"
											onClick={handleGoToTextCode}
											className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0 bg-transparent"
											title="Go to code"
										>
											<IconCode className="w-4 h-4 text-foreground" stroke={1.5} />
										</button>
									)}
								</div>
								{isTextFromProps && (
									<div className="w-sidebar-content mt-2 px-2 py-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded text-[10px] text-amber-800 dark:text-amber-400">
										⚠️ Text is passed dynamically.
										{activeInstanceId
											? ' To edit instance props click the badge.'
											: ' Editing may broke jsx'}
									</div>
								)}
							</div>
						)}

						{/* State Selector */}
						{projectUIKit === 'tailwind' && (
							<StateSelectorSection
								currentState={currentState}
								onStateChange={setCurrentState}
							/>
						)}

						{/* Editing sections - disabled for readonly */}
						<div className={isReadonly ? 'opacity-50 pointer-events-none' : ''}>
							{/* Position Section */}
							{projectUIKit !== 'none' && (
								<PositionSection
									selectedPosition={selectedPosition}
									posValues={{
										top: posTop,
										right: posRight,
										bottom: posBottom,
										left: posLeft,
									}}
									projectUIKit={projectUIKit}
									onPositionChange={handlePositionChange}
									onPositionValueChange={handlePositionValueChange}
									onPositionKeyDown={handleNumericKeyDown}
								/>
							)}

							{projectUIKit === 'none' && !isVSCode && (
								<SetupTailwindButton onSetupClick={handleSetupTailwind} />
							)}

							{/* Margin Section */}
							{projectUIKit !== 'none' && (
								<MarginSection
									marginTop={marginTop}
									marginRight={marginRight}
									marginBottom={marginBottom}
									marginLeft={marginLeft}
									marginLinked={marginLinked}
									onMarginChange={handleMarginChange}
									onMarginLinkedToggle={() => setMarginLinked(!marginLinked)}
									onNumericKeyDown={handleNumericKeyDown}
								/>
							)}

							{/* Layout Section */}
							{projectUIKit !== 'none' && (
								<LayoutSection
									selectedLayout={selectedLayout}
									width={width}
									height={height}
									gap={gap}
									justifyContent={justifyContent}
									alignItems={alignItems}
									columnGap={columnGap}
									rowGap={rowGap}
									gridJustifyItems={gridJustifyItems}
									gridAlignItems={gridAlignItems}
									gridCols={gridCols}
									gridRows={gridRows}
									paddingTop={paddingTop}
									paddingRight={paddingRight}
									paddingBottom={paddingBottom}
									paddingLeft={paddingLeft}
									clipContent={clipContent}
									projectUIKit={projectUIKit}
									isStyleSyncing={isStyleSyncing}
									onLayoutChange={handleLayoutChange}
									onWidthChange={handleWidthChange}
									onHeightChange={handleHeightChange}
									onWidthBlur={handleWidthBlur}
									onHeightBlur={handleHeightBlur}
									onGapChange={setGap}
									onJustifyContentChange={setJustifyContent}
									onAlignItemsChange={setAlignItems}
									onColumnGapChange={setColumnGap}
									onRowGapChange={setRowGap}
									onGridJustifyItemsChange={setGridJustifyItems}
									onGridAlignItemsChange={setGridAlignItems}
									onGridColsChange={setGridCols}
									onGridRowsChange={setGridRows}
									onPaddingChange={handlePaddingChange}
									onClipContentChange={setClipContent}
									onNumericKeyDown={handleNumericKeyDown}
									syncStyleChange={syncStyleChange}
								/>
							)}

							{/* Appearance Section */}
							{projectUIKit !== 'none' && (
								<AppearanceSection
									opacity={opacity}
									borderRadius={borderRadius}
									onOpacityChange={setOpacity}
									onBorderRadiusChange={setBorderRadius}
									onNumericKeyDown={handleNumericKeyDown}
									syncStyleChange={syncStyleChange}
								/>
							)}

							{/* Fill Section */}
							{projectUIKit !== 'none' && (
								<FillSection
									backgroundColor={backgroundColor}
									fillOpacity={fillOpacity}
									backgroundImage={backgroundImage}
									textColor={textColor}
									fillMode={fillMode}
									projectUIKit={projectUIKit}
									publicDirExists={publicDirExists}
									activeProjectId={activeProjectId}
									onBackgroundColorChange={setBackgroundColor}
									onFillOpacityChange={setFillOpacity}
									onBackgroundImageChange={setBackgroundImage}
									onTextColorChange={setTextColor}
									onFillModeChange={setFillMode}
									syncStyleChange={syncStyleChange}
								/>
							)}

							{/* Stroke Section */}
							{projectUIKit !== 'none' && (
								<StrokeSection
									strokes={strokes}
									onStrokesChange={setStrokes}
									syncStyleChange={syncStyleChange}
								/>
							)}

							{/* Effects Section */}
							{projectUIKit === 'tailwind' && (
								<EffectsSection
									effects={effects}
									onEffectsChange={setEffects}
									syncStyleChange={syncStyleChange}
								/>
							)}
						</div>
					</>
				)}
		</div>
	);
}

export const SampleDefault = () => {
	return (
		<MemoryRouter>
			<div style={{ height: '100vh', display: 'flex' }}>
				{/* Mock the CanvasEngine provider */}
				<div style={{ flex: 1 }}>
					{/* This would normally be wrapped in CanvasEngineProvider */}
					<RightSidebar
						onOpenSettings={() => {}}
						viewport={{ panX: 1200, panY: 800, zoom: 1 }}
						onZoomChange={() => {}}
						onFitToContent={() => {}}
						activeInstanceId="instance-1"
						canvasMode="single"
						instanceSize={{ width: 1200, height: 800 }}
						onInstanceSizeChange={() => {}}
					/>
				</div>
			</div>
		</MemoryRouter>
	);
};

import { MemoryRouter } from 'react-router-dom';
