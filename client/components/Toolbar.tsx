import {
	IconArrowUpRight,
	IconBrush,
	IconCode,
	IconFrame,
	IconLayoutGrid,
	IconLetterT,
	IconLineHeight,
	IconLink,
	IconMessageCircle,
	IconPalette,
	IconPhoto,
	IconPointer,
	IconSparkles,
	IconSquarePlus2,
	IconTextSize,
	IconWand,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
// AIAgentChat is now rendered in CanvasEditor for dock support
import Divider from './icons/Divider';
import IconButton from './icons/IconButton';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from './ui/tooltip';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useCanvasEngineContext } from '@/lib/canvas-engine/react/CanvasEngineProvider';
import { authFetch } from '@/utils/authFetch';
import { useSelectedIds } from '@/lib/canvas-engine';
import { useEditorStore } from '@/stores/editorStore';

export type Tool = 'board' | 'interact' | 'design' | 'code';
export type BoardTool = 'select' | 'arrow' | 'text';

export interface DrawingStyle {
	color: string;
	strokeWidth: number;
	fontSize: number;
}

interface ToolbarProps {
	projectPath?: string;
	projectId?: string;
	mode: Tool;
	isBoardModeActive?: boolean;
	onModeChange: (mode: Tool) => void;
	onResetZoom?: () => void;
	// Board mode drawing props
	boardTool?: BoardTool;
	onBoardToolChange?: (tool: BoardTool) => void;
	drawingStyle?: DrawingStyle;
	onDrawingStyleChange?: (style: Partial<DrawingStyle>) => void;
	canvasMode?: 'single' | 'multi';
	// Called before adding comment - returns true to proceed, false to cancel
	onBeforeAddComment?: () => boolean;
	// Called to open InsertInstancePanel for filling props before insertion
	onOpenInsertPanel?: (componentType: string, componentFilePath?: string) => void;
}

interface UIComponents {
	textComponentPath: string | null;
	linkComponentPath: string | null;
	buttonComponentPath: string | null;
	imageComponentPath: string | null;
	containerComponentPath: string | null;
}

export default function Toolbar({
	// projectPath - no longer used, AIAgentChat moved to CanvasEditor
	projectId,
	mode,
	onModeChange,
	onResetZoom,
	boardTool = 'select',
	onBoardToolChange,
	drawingStyle = { color: '#000000', strokeWidth: 3, fontSize: 20 },
	onDrawingStyleChange,
	canvasMode = 'multi',
	onBeforeAddComment,
	onOpenInsertPanel,
}: ToolbarProps) {
	// console.log('[Toolbar] Render - mode:', mode);

	const context = useCanvasEngineContext();
	const engine = context?.engine;
	const { meta } = useComponentMeta();
	const selectedIds = useSelectedIds();
	const {
		isAddingComment,
		setIsAddingComment,
		isReadonly,
		isAIChatOpen,
		openAIChat,
		closeAIChat,
	} = useEditorStore();
	const [uiComponents, setUiComponents] = useState<UIComponents>({
		textComponentPath: null,
		linkComponentPath: null,
		buttonComponentPath: null,
		imageComponentPath: null,
		containerComponentPath: null,
	});
	const [isAddingInstance, setIsAddingInstance] = useState(false);

	// State for popups
	const [colorPopupOpen, setColorPopupOpen] = useState(false);
	const [strokePopupOpen, setStrokePopupOpen] = useState(false);
	const [fontSizePopupOpen, setFontSizePopupOpen] = useState(false);

	// Timers for popup delays
	const colorPopupTimerRef = useRef<NodeJS.Timeout | null>(null);
	const strokePopupTimerRef = useRef<NodeJS.Timeout | null>(null);
	const fontSizePopupTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Debounce helper to prevent rapid-fire insertions
	const lastInsertTimeRef = useRef<number>(0);
	const DEBOUNCE_DELAY = 300; // ms

	const shouldAllowInsert = (): boolean => {
		const now = Date.now();
		if (now - lastInsertTimeRef.current < DEBOUNCE_DELAY) {
			return false;
		}
		lastInsertTimeRef.current = now;
		return true;
	};

	// Handle adding new component instance
	const handleAddInstance = async () => {
		if (isReadonly) return;
		if (!meta?.projectId || !meta?.relativeFilePath) {
			console.error(
				'[Toolbar] Cannot add instance: missing project or component path',
			);
			return;
		}

		if (isAddingInstance) return;

		setIsAddingInstance(true);

		try {
			// 1. Get current sampleRender code
			const listResponse = await authFetch(
				`/api/sample-renderer/list?projectId=${meta.projectId}&componentPath=${encodeURIComponent(meta.relativeFilePath)}`,
			);

			if (!listResponse.ok) {
				throw new Error('Failed to get sample renderers');
			}

			const { renderers } = await listResponse.json();

			// Find default renderer (sampleRender)
			const defaultCode =
				renderers.default || renderers[Object.keys(renderers)[0]];
			if (!defaultCode) {
				throw new Error('No sampleRender found in component');
			}

			// 2. Generate unique name (copy1, copy2, etc)
			const existingNames = Object.keys(renderers);
			let copyNumber = 1;
			let newName = `copy${copyNumber}`;
			while (existingNames.includes(newName)) {
				copyNumber++;
				newName = `copy${copyNumber}`;
			}

			// 3. Add new renderer through AST
			const addResponse = await authFetch('/api/sample-renderer/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId: meta.projectId,
					componentPath: meta.relativeFilePath,
					name: newName,
					code: defaultCode,
				}),
			});

			if (!addResponse.ok) {
				throw new Error('Failed to add sample renderer');
			}

			// 4. Create new instance via POST /instance
			// Get existing instance count for offset positioning
			const compositionResponse = await authFetch(
				`/api/canvas-composition/${meta.projectId}/${encodeURIComponent(meta.relativeFilePath)}`,
			);

			let instanceCount = 0;
			if (compositionResponse.ok) {
				const { composition } = await compositionResponse.json();
				instanceCount = Object.keys(composition?.instances || {}).length;
			}

			const createRes = await authFetch(`/api/canvas-composition/${meta.projectId}/instance`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					componentPath: meta.relativeFilePath,
					instanceId: newName,
					config: {
						x: 100 + instanceCount * 200,
						y: 100,
					},
				}),
			});
			const createData = await createRes.json();
			if (!createRes.ok || !createData.success) {
				throw new Error(createData.error || 'Failed to create instance');
			}

			console.log('[Toolbar] Added instance:', newName);

			// Reload the iframe to show new instance
			window.location.reload();
		} catch (error) {
			console.error('[Toolbar] Failed to add instance:', error);
		} finally {
			setIsAddingInstance(false);
		}
	};

	// Listen for openAIChat custom events
	useEffect(() => {
		const handleOpenAIChat = (e: Event) => {
			const customEvent = e as CustomEvent<{
				prompt: string;
				forceNewChat?: boolean;
			}>;
			openAIChat(customEvent.detail.prompt, customEvent.detail.forceNewChat);
		};

		window.addEventListener('openAIChat', handleOpenAIChat);
		return () => {
			window.removeEventListener('openAIChat', handleOpenAIChat);
		};
	}, [openAIChat]);

	// mode is now a controlled prop - no need for internal state synchronization

	// Load active project UI components and project ID
	useEffect(() => {
		const loadProjectComponents = async () => {
			try {
				const response = await authFetch('/api/projects/active');
				if (response.ok) {
					const project = await response.json();
					if (project) {
						setUiComponents({
							textComponentPath: project.textComponentPath,
							linkComponentPath: project.linkComponentPath,
							buttonComponentPath: project.buttonComponentPath,
							imageComponentPath: project.imageComponentPath,
							containerComponentPath: project.containerComponentPath,
						});
					}
				}
			} catch (error) {
				console.error('[Toolbar] Failed to load project components:', error);
			}
		};

		loadProjectComponents();
	}, []);

	// Cleanup popup timers on unmount
	useEffect(() => {
		return () => {
			if (colorPopupTimerRef.current) {
				clearTimeout(colorPopupTimerRef.current);
			}
			if (strokePopupTimerRef.current) {
				clearTimeout(strokePopupTimerRef.current);
			}
			if (fontSizePopupTimerRef.current) {
				clearTimeout(fontSizePopupTimerRef.current);
			}
		};
	}, []);

	// Helper function to extract component name and path from file path
	const getComponentInfo = (
		filePath: string | null,
		fallbackTag: string,
	): { name: string; path: string | undefined } => {
		if (!filePath) {
			return { name: fallbackTag, path: undefined };
		}

		// Extract component name from file path (e.g., "client/components/ui/button.tsx" -> "Button")
		const fileName = filePath
			.split('/')
			.pop()
			?.replace('.tsx', '')
			.replace('.ts', '');
		if (!fileName) {
			return { name: fallbackTag, path: undefined };
		}

		// Capitalize first letter for component name
		const componentName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
		return { name: componentName, path: filePath };
	};

	// SVG placeholder for image - use single quotes in SVG to avoid JSX attribute parsing issues
	const IMAGE_PLACEHOLDER =
		"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect fill='%23ddd' width='200' height='150'/%3E%3Ctext fill='%23999' font-family='sans-serif' font-size='14' dy='10.5' font-weight='bold' x='50%25' y='50%25' text-anchor='middle'%3EImage%3C/text%3E%3C/svg%3E";

	// Handle IconFrame click - open insert panel for frame/container
	const handleInsertFrame = () => {
		if (isReadonly) return;
		if (!shouldAllowInsert()) return;

		const { name: componentName, path: componentPath } = getComponentInfo(
			uiComponents.containerComponentPath,
			'div',
		);

		if (onOpenInsertPanel) {
			onOpenInsertPanel(componentName, componentPath);
		} else {
			// Fallback: direct insert if no callback provided
			if (!engine || !meta?.filePath) return;
			const parentId = selectedIds.length > 0 ? selectedIds[0] : null;
			engine.insertASTElement(parentId, meta.filePath, componentName, {}, componentPath);
		}
	};

	// Handle IconLetterT click - open insert panel for text element
	const handleInsertText = () => {
		if (isReadonly) return;
		if (!shouldAllowInsert()) return;

		const { name: componentName, path: componentPath } = getComponentInfo(
			uiComponents.textComponentPath,
			'span',
		);

		if (onOpenInsertPanel) {
			onOpenInsertPanel(componentName, componentPath);
		} else {
			// Fallback: direct insert if no callback provided
			if (!engine || !meta?.filePath) return;
			const parentId = selectedIds.length > 0 ? selectedIds[0] : null;
			engine.insertASTElement(parentId, meta.filePath, componentName, { children: 'Text' }, componentPath);
		}
	};

	// Handle IconLink click - open insert panel for link element
	const handleInsertLink = () => {
		if (isReadonly) return;
		if (!shouldAllowInsert()) return;

		const { name: componentName, path: componentPath } = getComponentInfo(
			uiComponents.linkComponentPath,
			'a',
		);

		if (onOpenInsertPanel) {
			onOpenInsertPanel(componentName, componentPath);
		} else {
			// Fallback: direct insert if no callback provided
			if (!engine || !meta?.filePath) return;
			const parentId = selectedIds.length > 0 ? selectedIds[0] : null;
			engine.insertASTElement(parentId, meta.filePath, componentName, { href: 'https://example.com', children: 'Link' }, componentPath);
		}
	};

	// Handle IconButton click - open insert panel for button element
	const handleInsertButton = () => {
		if (isReadonly) return;
		if (!shouldAllowInsert()) return;

		const { name: componentName, path: componentPath } = getComponentInfo(
			uiComponents.buttonComponentPath,
			'button',
		);

		if (onOpenInsertPanel) {
			onOpenInsertPanel(componentName, componentPath);
		} else {
			// Fallback: direct insert if no callback provided
			if (!engine || !meta?.filePath) return;
			const parentId = selectedIds.length > 0 ? selectedIds[0] : null;
			engine.insertASTElement(parentId, meta.filePath, componentName, { children: 'Button' }, componentPath);
		}
	};

	// Handle IconPhoto click - open insert panel for image element
	const handleInsertImage = () => {
		if (isReadonly) return;
		if (!shouldAllowInsert()) return;

		const { name: componentName, path: componentPath } = getComponentInfo(
			uiComponents.imageComponentPath,
			'img',
		);

		if (onOpenInsertPanel) {
			onOpenInsertPanel(componentName, componentPath);
		} else {
			// Fallback: direct insert if no callback provided
			if (!engine || !meta?.filePath) return;
			const parentId = selectedIds.length > 0 ? selectedIds[0] : null;
			engine.insertASTElement(parentId, meta.filePath, componentName, { src: IMAGE_PLACEHOLDER, alt: 'Image' }, componentPath);
		}
	};

	// Keyboard shortcuts - only active when not in code mode

	// Mode switching hotkeys - always active
	useHotkeys(
		'1,alt+1,ctrl+shift+1',
		(e) => {
			console.log('[Toolbar] Hotkey pressed: switch to board mode');
			e.preventDefault();
			onModeChange('board');
		},
		{ enabled: canvasMode !== 'single' },
		[onModeChange, canvasMode],
	);

	useHotkeys(
		'2,alt+2,ctrl+shift+2',
		(e) => {
			console.log('[Toolbar] Hotkey pressed: switch to interact mode');
			e.preventDefault();
			onModeChange('interact');
		},
		[onModeChange],
	);

	useHotkeys(
		'3,alt+3,ctrl+shift+3',
		(e) => {
			console.log('[Toolbar] Hotkey pressed: switch to design mode');
			e.preventDefault();
			onModeChange('design');
		},
		[onModeChange],
	);

	useHotkeys(
		'4,alt+4,ctrl+shift+4',
		(e) => {
			console.log('[Toolbar] Hotkey pressed: switch to code mode');
			e.preventDefault();
			onModeChange('code');
		},
		[onModeChange],
	);

	// AI Agent hotkeys - only active when not in code mode
	useHotkeys(
		'mod+k,mod+p,mod+shift+p',
		(e) => {
			console.log('[Toolbar] Hotkey pressed: toggle AI chat');
			e.preventDefault();
			if (isAIChatOpen) {
				closeAIChat();
			} else {
				openAIChat();
			}
		},
		{
			enabled: mode !== 'code',
			preventDefault: true,
			enableOnFormTags: true,
		},
		[mode],
	);

	useHotkeys(
		'f',
		(e) => {
			e.preventDefault();
			handleInsertFrame();
		},
		{ enabled: mode !== 'code' && mode !== 'board' },
		[handleInsertFrame, mode],
	);

	useHotkeys(
		't',
		(e) => {
			e.preventDefault();
			handleInsertText();
		},
		{ enabled: mode !== 'code' && mode !== 'board' },
		[handleInsertText, mode],
	);

	useHotkeys(
		'shift+l',
		(e) => {
			e.preventDefault();
			handleInsertLink();
		},
		{
			enabled: mode !== 'code' && mode !== 'board',
			preventDefault: true,
			enableOnFormTags: false,
		},
		[handleInsertLink, mode],
	);

	useHotkeys(
		'shift+b,b',
		(e) => {
			e.preventDefault();
			handleInsertButton();
		},
		{ enabled: mode !== 'code' && mode !== 'board' },
		[handleInsertButton, mode],
	);

	useHotkeys(
		'shift+i,mod+shift+k',
		(e) => {
			e.preventDefault();
			handleInsertImage();
		},
		{ enabled: mode !== 'code' && mode !== 'board' },
		[handleInsertImage, mode],
	);

	useHotkeys(
		'i',
		(e) => {
			e.preventDefault();
			handleAddInstance();
		},
		{ enabled: mode !== 'code' && mode !== 'board' },
		[handleAddInstance, mode],
	);

	// Shift+0 and Cmd/Ctrl+0 - Reset zoom (all modes except code)
	// Using direct event listener instead of useHotkeys to handle synthetic events from iframe
	useEffect(() => {
		if (mode === 'code' || !onResetZoom) {
			console.log(
				'[Toolbar] Reset zoom listener NOT active, mode:',
				mode,
				'onResetZoom:',
				!!onResetZoom,
			);
			return;
		}

		console.log('[Toolbar] ✅ Reset zoom listener ACTIVE');

		const handleKeyDown = (e: KeyboardEvent) => {
			// Skip when typing in text fields
			const target = e.target as HTMLElement;
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable
			) {
				return;
			}

			// Shift+0 or Cmd/Ctrl+0
			// Use code instead of key because Shift+0 gives key=')'
			// Support both Digit0 (top row) and Numpad0 (numpad)
			if ((e.code === 'Digit0' || e.code === 'Numpad0') && (e.shiftKey || e.metaKey || e.ctrlKey)) {
				console.log('[Toolbar] 🎉 RESET ZOOM TRIGGERED!');
				e.preventDefault();
				onResetZoom();
			}
		};

		// Listen on both window and document to catch synthetic events from iframe
		window.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keydown', handleKeyDown);

		console.log('[Toolbar] Event listeners attached to window and document');

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('keydown', handleKeyDown);
			console.log('[Toolbar] Event listeners removed');
		};
	}, [mode, onResetZoom]);

	// Shift+A - Arrow tool toggle (only in board mode)
	useHotkeys(
		'shift+a',
		(e) => {
			e.preventDefault();
			if (mode === 'board') {
				onBoardToolChange?.(boardTool === 'arrow' ? 'select' : 'arrow');
			}
		},
		{ enabled: mode === 'board' },
		[mode, onBoardToolChange, boardTool],
	);

	// T - Text tool toggle (only in board mode)
	useHotkeys(
		't',
		(e) => {
			e.preventDefault();
			if (mode === 'board') {
				onBoardToolChange?.(boardTool === 'text' ? 'select' : 'text');
			}
		},
		{ enabled: mode === 'board' },
		[mode, onBoardToolChange, boardTool],
	);

	return (
		<TooltipProvider delayDuration={300}>
			<div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 h-12 px-2 bg-background rounded-[14px] shadow-[0_2px_4px_rgba(0,0,0,0.15),0_2px_16px_rgba(0,0,0,0.15)] border border-border z-[1000]">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onModeChange('board')}
							disabled={canvasMode === 'single'}
							className={`w-8 h-8 rounded-md flex items-center justify-center ${
								mode === 'board' ? 'bg-[#4597F7]' : 'hover:bg-accent'
							} ${canvasMode === 'single' ? 'opacity-50 cursor-not-allowed' : ''}`}
						>
							<IconLayoutGrid
								className={`w-6 h-6 ${mode === 'board' ? 'text-white' : ''}`}
								stroke={1.5}
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="whitespace-nowrap">
							Board{' '}
							<span className="text-xs text-muted-foreground ml-1">
								1 / Alt+1 / Ctrl+Shift+1
							</span>
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onModeChange('interact')}
							className={`w-8 h-8 rounded-md flex items-center justify-center ${
								mode === 'interact' ? 'bg-[#4597F7]' : 'hover:bg-accent'
							}`}
						>
							<IconPointer
								className={`w-6 h-6 ${mode === 'interact' ? 'text-white' : ''}`}
								stroke={1.5}
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="whitespace-nowrap">
							Interact{' '}
							<span className="text-xs text-muted-foreground ml-1">
								2 / Alt+2 / Ctrl+Shift+2
							</span>
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onModeChange('design')}
							className={`w-8 h-8 rounded-md flex items-center justify-center ${
								mode === 'design' ? 'bg-[#4597F7]' : 'hover:bg-accent'
							}`}
						>
							<IconBrush
								className={`w-6 h-6 ${mode === 'design' ? 'text-white' : ''}`}
								stroke={1.5}
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="whitespace-nowrap">
							Design{' '}
							<span className="text-xs text-muted-foreground ml-1">
								3 / Alt+3 / Ctrl+Shift+3
							</span>
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							onClick={() => onModeChange('code')}
							className={`w-8 h-8 rounded-md flex items-center justify-center ${
								mode === 'code' ? 'bg-[#4597F7]' : 'hover:bg-accent'
							}`}
						>
							<IconCode
								className={`w-6 h-6 ${mode === 'code' ? 'text-white' : ''}`}
								stroke={1.5}
							/>
						</button>
					</TooltipTrigger>
					<TooltipContent>
						<p className="whitespace-nowrap">
							Code{' '}
							<span className="text-xs text-muted-foreground ml-1">
								4 / Alt+4 / Ctrl+Shift+4
							</span>
						</p>
					</TooltipContent>
				</Tooltip>

				{mode === 'board' && (
					<>
						<Divider />
						{/* Add instance button (always visible in board mode) */}
						{!isReadonly && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={handleAddInstance}
										disabled={isAddingInstance}
										className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
									>
										<IconSquarePlus2 className="w-6 h-6" stroke={1.5} />
									</button>
								</TooltipTrigger>
								<TooltipContent>
									<p>
										Add instance{' '}
										<span className="text-xs text-muted-foreground ml-1">I</span>
									</p>
								</TooltipContent>
							</Tooltip>
						)}

						{/* Drawing tools - Text and Arrow (only for editors) */}
						{!isReadonly && (
							<>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() =>
												onBoardToolChange?.(
													boardTool === 'text' ? 'select' : 'text',
												)
											}
											className={`w-8 h-8 rounded-md flex items-center justify-center ${
												boardTool === 'text' ? 'bg-[#4597F7]' : 'hover:bg-accent'
											}`}
										>
											<IconLetterT
												className={`w-6 h-6 ${boardTool === 'text' ? 'text-white' : ''}`}
												stroke={1.5}
											/>
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Text{' '}
											<span className="text-xs text-muted-foreground ml-1">T</span>
										</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() =>
												onBoardToolChange?.(
													boardTool === 'arrow' ? 'select' : 'arrow',
												)
											}
											className={`w-8 h-8 rounded-md flex items-center justify-center ${
												boardTool === 'arrow' ? 'bg-[#4597F7]' : 'hover:bg-accent'
											}`}
										>
											<IconArrowUpRight
												className={`w-6 h-6 ${boardTool === 'arrow' ? 'text-white' : ''}`}
												stroke={1.5}
											/>
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Arrow{' '}
											<span className="text-xs text-muted-foreground ml-1">
												Shift+A
											</span>
										</p>
									</TooltipContent>
								</Tooltip>

								<Divider />
							</>
						)}

						{/* Style controls and AI Agent - only for editors */}
						{!isReadonly && (
							<>
								{/* biome-ignore lint/a11y/useSemanticElements: wrapper for hover popup */}
								<div
									className="relative"
									role="group"
									onMouseEnter={() => {
										if (colorPopupTimerRef.current) {
											clearTimeout(colorPopupTimerRef.current);
											colorPopupTimerRef.current = null;
										}
										setColorPopupOpen(true);
									}}
									onMouseLeave={() => {
										colorPopupTimerRef.current = setTimeout(() => {
											setColorPopupOpen(false);
										}, 100);
									}}
								>
									<button
										type="button"
										className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
									>
										<IconPalette className="w-6 h-6" stroke={1.5} />
									</button>
									{colorPopupOpen && (
										<div className="absolute bottom-full mb-1 bg-popover rounded-lg shadow-lg border border-border p-2 z-[1001]">
											<div className="flex gap-1">
												{[
													'#000000',
													'#ef4444',
													'#3b82f6',
													'#22c55e',
													'#eab308',
													'#f97316',
													'#a855f7',
												].map((color) => (
													<button
														key={color}
														type="button"
														onClick={() => onDrawingStyleChange?.({ color })}
														className={`w-6 h-6 rounded border-2 ${
															drawingStyle.color === color
																? 'border-foreground'
																: 'border-border'
														}`}
														style={{ backgroundColor: color }}
														title={color}
													/>
												))}
											</div>
										</div>
									)}
								</div>

								{/* biome-ignore lint/a11y/useSemanticElements: wrapper for hover popup */}
								<div
									className="relative"
									role="group"
									onMouseEnter={() => {
										if (strokePopupTimerRef.current) {
											clearTimeout(strokePopupTimerRef.current);
											strokePopupTimerRef.current = null;
										}
										setStrokePopupOpen(true);
									}}
									onMouseLeave={() => {
										strokePopupTimerRef.current = setTimeout(() => {
											setStrokePopupOpen(false);
										}, 100);
									}}
								>
									<button
										type="button"
										className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
									>
										<IconLineHeight className="w-6 h-6" stroke={1.5} />
									</button>
									{strokePopupOpen && (
										<div className="absolute bottom-full mb-1 bg-popover rounded-lg shadow-lg border border-border p-3 z-[1001] min-w-[120px]">
											<div className="flex flex-col gap-2">
												{[1, 2, 4, 8].map((width) => (
													<button
														key={width}
														type="button"
														onClick={() =>
															onDrawingStyleChange?.({ strokeWidth: width })
														}
														className={`flex items-center px-3 py-2 rounded hover:bg-accent ${
															drawingStyle.strokeWidth === width
																? 'bg-accent'
																: ''
														}`}
													>
														<div
															className="w-full bg-black rounded-full"
															style={{
																height: `${width}px`,
																backgroundColor: drawingStyle.color || '#000000',
															}}
														/>
													</button>
												))}
											</div>
										</div>
									)}
								</div>

								{/* biome-ignore lint/a11y/useSemanticElements: wrapper for hover popup */}
								<div
									className="relative"
									role="group"
									onMouseEnter={() => {
										if (fontSizePopupTimerRef.current) {
											clearTimeout(fontSizePopupTimerRef.current);
											fontSizePopupTimerRef.current = null;
										}
										setFontSizePopupOpen(true);
									}}
									onMouseLeave={() => {
										fontSizePopupTimerRef.current = setTimeout(() => {
											setFontSizePopupOpen(false);
										}, 100);
									}}
								>
									<button
										type="button"
										className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
									>
										<IconTextSize className="w-6 h-6" stroke={1.5} />
									</button>
									{fontSizePopupOpen && (
										<div className="absolute bottom-full mb-1 bg-popover rounded-lg shadow-lg border border-border p-3 z-[1001] min-w-[100px]">
											<div className="flex flex-col gap-2">
												{[16, 20, 28, 36].map((size) => (
													<button
														key={size}
														type="button"
														onClick={() =>
															onDrawingStyleChange?.({ fontSize: size })
														}
														className={`px-3 py-2 text-center rounded hover:bg-accent whitespace-nowrap flex items-center justify-center ${
															drawingStyle.fontSize === size ? 'bg-accent' : ''
														}`}
													>
														<span
															style={{
																fontSize: `${size}px`,
																lineHeight: 1,
																display: 'block',
																minHeight: `${size}px`,
															}}
														>
															Aa
														</span>
													</button>
												))}
											</div>
										</div>
									)}
								</div>

								<Divider />
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={() => (isAIChatOpen ? closeAIChat() : openAIChat())}
											className={`w-8 h-8 rounded-md flex items-center justify-center ${
												isAIChatOpen ? 'bg-[#4597F7]' : 'hover:bg-accent'
											}`}
										>
											<IconSparkles
												className={`w-6 h-6 ${isAIChatOpen ? 'text-white' : ''}`}
												stroke={1.5}
											/>
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p className="whitespace-nowrap">
											AI Agent{' '}
											<span className="text-xs text-muted-foreground ml-1">
												⌘K / ⌘P / ⌘⇧P
											</span>
										</p>
									</TooltipContent>
								</Tooltip>
							</>
						)}
					</>
				)}

				{mode !== 'code' && mode !== 'board' && (
					<>
						<Divider />
						{/* Insert tools - only for editors */}
						{!isReadonly && (
							<>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleAddInstance}
											disabled={isAddingInstance}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
										>
											<IconSquarePlus2 className="w-6 h-6" stroke={1.5} />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Add instance{' '}
											<span className="text-xs text-muted-foreground ml-1">I</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleInsertFrame}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
										>
											<IconFrame className="w-6 h-6" stroke={1.5} />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Frame{' '}
											<span className="text-xs text-muted-foreground ml-1">F</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleInsertText}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
										>
											<IconLetterT className="w-6 h-6" stroke={1.5} />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Text{' '}
											<span className="text-xs text-muted-foreground ml-1">T</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleInsertLink}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
										>
											<IconLink className="w-6 h-6" stroke={1.5} />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Link{' '}
											<span className="text-xs text-muted-foreground ml-1">
												Shift+L
											</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleInsertButton}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
										>
											<IconButton className="w-6 h-6" />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Button{' '}
											<span className="text-xs text-muted-foreground ml-1">B</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											type="button"
											onClick={handleInsertImage}
											className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-accent"
										>
											<IconPhoto className="w-6 h-6" stroke={1.5} />
										</button>
									</TooltipTrigger>
									<TooltipContent>
										<p>
											Image{' '}
											<span className="text-xs text-muted-foreground ml-1">
												⇧I / ⌘⇧K
											</span>
										</p>
									</TooltipContent>
								</Tooltip>
								<Divider />
							</>
						)}
						{/* Comment - available for all users */}
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									onClick={() => {
										// If turning on, check with parent first
										if (!isAddingComment && onBeforeAddComment) {
											if (!onBeforeAddComment()) return;
										}
										setIsAddingComment(!isAddingComment);
									}}
									className={`w-8 h-8 rounded-md flex items-center justify-center ${
										isAddingComment ? 'bg-[#4597F7]' : 'hover:bg-accent'
									}`}
								>
									<IconMessageCircle
										className={`w-6 h-6 ${isAddingComment ? 'text-white' : ''}`}
										stroke={1.5}
									/>
								</button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="whitespace-nowrap">
									Add Comment{' '}
									<span className="text-xs text-muted-foreground ml-1">C</span>
								</p>
							</TooltipContent>
						</Tooltip>
						{/* AI Agent - only for editors */}
						{!isReadonly && (
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => (isAIChatOpen ? closeAIChat() : openAIChat())}
										className={`w-8 h-8 rounded-md flex items-center justify-center ${
											isAIChatOpen ? 'bg-[#4597F7]' : 'hover:bg-accent'
										}`}
									>
										<IconSparkles
											className={`w-6 h-6 ${isAIChatOpen ? 'text-white' : ''}`}
											stroke={1.5}
										/>
									</button>
								</TooltipTrigger>
								<TooltipContent>
									<p className="whitespace-nowrap">
										AI Agent{' '}
										<span className="text-xs text-muted-foreground ml-1">
											⌘K / ⌘P / ⌘⇧P
										</span>
									</p>
								</TooltipContent>
							</Tooltip>
						)}
					</>
				)}

				{/* AIAgentChat is now rendered in CanvasEditor for dock support */}
			</div>
		</TooltipProvider>
	);
}
