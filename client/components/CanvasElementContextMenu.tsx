import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Input } from '@/components/ui/input';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { useComponentMetaOptional } from '@/contexts/ComponentMetaContext';
import { buildElementSelector, getPreviewIframe } from '@/lib/dom-utils';
import {
	copyMultipleElementsAsTSX,
	pasteElementFromTSX,
} from '@/utils/tsxClipboard';
import { wrapElement } from '@/utils/wrapElement';
import { useEditorStore } from '@/stores/editorStore';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/utils/authFetch';
import { usePlatformCanvas } from '@/lib/platform';
import cn from 'clsx';

// ============================================================================
// Types
// ============================================================================

interface ContextMenuTarget {
	type: 'board-instance' | 'board-empty' | 'design-element';
	instanceId?: string | null;
	x: number;
	y: number;
}

interface CanvasElementContextMenuProps {
	children?: React.ReactNode;
	selectedIds: string[];
	iframeLoadCounter?: number;
	boardModeActive?: boolean;
	activeDesignInstanceId?: string | null;
	projectId?: string;
	onInstanceEdit?: (instanceId: string) => void;
	onInstanceCopy?: (instanceId: string) => Promise<void>;
	onInstanceCut?: (instanceId: string) => Promise<void>;
	onInstancePaste?: () => Promise<void>;
	onInstanceDuplicate?: (instanceId: string) => Promise<void>;
	onInstanceDelete?: (instanceId: string) => Promise<void>;
	// Controlled mode — for VSCode, where context menu is triggered externally
	externalTarget?: { type: 'design-element'; x: number; y: number } | null;
	onExternalClose?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function CanvasElementContextMenu({
	children,
	selectedIds,
	iframeLoadCounter = 0,
	boardModeActive = false,
	activeDesignInstanceId = null,
	projectId,
	onInstanceEdit,
	onInstanceCopy,
	onInstanceCut,
	onInstancePaste,
	onInstanceDuplicate,
	onInstanceDelete,
	externalTarget = null,
	onExternalClose,
}: CanvasElementContextMenuProps) {
	const engine = useCanvasEngineOptional();
	const metaCtx = useComponentMetaOptional();
	const meta = metaCtx?.meta ?? null;
	const canvas = usePlatformCanvas();
	const { openFile, isReadonly } = useEditorStore();

	const menuRef = useRef<HTMLDivElement>(null);
	const [filter, setFilter] = useState('');
	const boardModeRef = useRef(boardModeActive);
	boardModeRef.current = boardModeActive;

	// Internal context menu state (SaaS self-managed mode)
	const [internalTarget, setInternalTarget] = useState<ContextMenuTarget | null>(null);

	// Merge: external (controlled) or internal (self-managed)
	const target = externalTarget ?? internalTarget;

	const closeMenu = useCallback(() => {
		setInternalTarget(null);
		setFilter('');
		onExternalClose?.();
	}, [onExternalClose]);

	// ========================================================================
	// Setup iframe context menu handler (SaaS only — needs engine)
	// ========================================================================
	useEffect(() => {
		if (!engine) return;

		const handleIframeContextMenu = (e: MouseEvent) => {
			if (boardModeRef.current) return;
			e.preventDefault();

			// Select element before showing menu
			const eventTarget = e.target as HTMLElement;
			let element: HTMLElement | null = eventTarget;
			while (element && !element.dataset.uniqId) {
				element = element.parentElement;
			}

			if (element?.dataset.uniqId) {
				const uniqId = element.dataset.uniqId;
				const currentSelection = engine.getSelection().selectedIds;
				if (!currentSelection.includes(uniqId)) {
					engine.select(uniqId);
				}
			}

			const iframe = getPreviewIframe();
			const iframeRect = iframe?.getBoundingClientRect();

			setInternalTarget({
				type: 'design-element',
				x: (iframeRect?.left || 0) + e.clientX,
				y: (iframeRect?.top || 0) + e.clientY,
			});
		};

		const installHandler = () => {
			const iframe = getPreviewIframe();
			if (!iframe?.contentDocument) return;
			iframe.contentDocument.addEventListener(
				'contextmenu',
				handleIframeContextMenu,
			);
		};

		installHandler();

		const handleComponentLoaded = () => {
			setTimeout(installHandler, 100);
		};
		window.addEventListener('component-loaded', handleComponentLoaded);

		return () => {
			const iframe = getPreviewIframe();
			if (iframe?.contentDocument) {
				iframe.contentDocument.removeEventListener(
					'contextmenu',
					handleIframeContextMenu,
				);
			}
			window.removeEventListener('component-loaded', handleComponentLoaded);
		};
	}, [engine, iframeLoadCounter]);

	// ========================================================================
	// Setup instance overlay context menu handler (SaaS board mode only)
	// ========================================================================
	useEffect(() => {
		if (!engine) return;

		const handleInstanceOverlayContextMenu = (e: MouseEvent) => {
			if (!boardModeRef.current) return;

			const iframeElement = getPreviewIframe();
			if (iframeElement?.contentDocument?.contains(e.target as Node)) return;

			const eventTarget = e.target as HTMLElement;

			const instanceFrame = eventTarget.closest(
				'[data-instance-frame]',
			) as HTMLElement;
			const instanceBadge = eventTarget.closest(
				'[data-instance-badge]',
			) as HTMLElement;
			const instanceId =
				instanceFrame?.dataset.instanceFrame ||
				instanceBadge?.dataset.instanceBadge;

			if (instanceId) {
				e.preventDefault();
				e.stopPropagation();
				setInternalTarget({
					type: 'board-instance',
					instanceId,
					x: e.clientX,
					y: e.clientY,
				});
				return;
			}

			const iframe = eventTarget.closest('iframe');
			if (iframe) {
				e.preventDefault();
				e.stopPropagation();
				setInternalTarget({
					type: 'board-empty',
					x: e.clientX,
					y: e.clientY,
				});
				return;
			}

			if (boardModeRef.current) {
				e.preventDefault();
				e.stopPropagation();
				setInternalTarget({
					type: 'board-empty',
					x: e.clientX,
					y: e.clientY,
				});
			}
		};

		document.addEventListener(
			'contextmenu',
			handleInstanceOverlayContextMenu,
			true,
		);

		return () => {
			document.removeEventListener(
				'contextmenu',
				handleInstanceOverlayContextMenu,
				true,
			);
		};
	}, [engine]);

	// ========================================================================
	// Action handlers — dual path: engine (SaaS) / canvas.sendEvent (VSCode)
	// ========================================================================

	const handleCopy = useCallback(async () => {
		if (selectedIds.length === 0) return;
		if (engine && meta?.filePath) {
			await copyMultipleElementsAsTSX(
				selectedIds,
				meta.filePath,
				activeDesignInstanceId,
			);
		} else {
			canvas.sendEvent({
				type: 'contextMenu:copy',
				elementIds: selectedIds,
			} as never);
		}
	}, [selectedIds, meta, activeDesignInstanceId, engine, canvas]);

	const handlePaste = useCallback(async () => {
		if (engine && meta?.filePath) {
			try {
				const tsxCode = await navigator.clipboard.readText();
				if (!tsxCode || !tsxCode.includes('<') || !tsxCode.includes('>')) {
					console.warn('[ContextMenu] Clipboard does not contain valid TSX code');
					return;
				}

				const newId = await engine.pasteASTElement(
					selectedIds[0] || null,
					meta.filePath,
					tsxCode,
				);

				if (newId) {
					setTimeout(() => {
						engine.select(newId);
					}, 300);
				}
			} catch (error) {
				console.error('[ContextMenu] Paste failed:', error);
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:paste',
				targetId: selectedIds[0] || null,
			} as never);
		}
	}, [selectedIds, meta, engine, canvas]);

	const handleDuplicate = useCallback(async () => {
		if (selectedIds.length === 0) return;
		if (engine && meta?.filePath) {
			const newIds: (string | null)[] = [];
			for (const id of selectedIds) {
				const newId = await engine.duplicateASTElement(id, meta.filePath);
				newIds.push(newId);
			}

			const validNewIds = newIds.filter((id): id is string => id !== null);
			if (validNewIds.length > 0) {
				const selectNewElements = () => {
					engine.selectMultiple(validNewIds);
				};

				const handleComponentLoaded = () => {
					window.removeEventListener('component-loaded', handleComponentLoaded);
					setTimeout(selectNewElements, 100);
				};

				window.addEventListener('component-loaded', handleComponentLoaded);
				setTimeout(() => {
					window.removeEventListener('component-loaded', handleComponentLoaded);
					selectNewElements();
				}, 1000);
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:duplicate',
				elementId: selectedIds[0],
			} as never);
		}
	}, [selectedIds, meta, engine, canvas]);

	const handleCut = useCallback(async () => {
		if (selectedIds.length === 0) return;
		if (engine && meta?.filePath) {
			const copySuccess = await copyMultipleElementsAsTSX(
				selectedIds,
				meta.filePath,
				activeDesignInstanceId,
			);
			if (copySuccess) {
				engine.deleteASTElements(selectedIds, meta.filePath!);
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:cut',
				elementIds: selectedIds,
			} as never);
		}
	}, [selectedIds, meta, engine, activeDesignInstanceId, canvas]);

	const handleDelete = useCallback(() => {
		if (selectedIds.length === 0) return;
		if (engine && meta?.filePath) {
			engine.deleteASTElements(selectedIds, meta.filePath);
		} else {
			canvas.sendEvent({
				type: 'contextMenu:delete',
				elementId: selectedIds[0],
			} as never);
		}
	}, [selectedIds, meta, engine, canvas]);

	const handleSelectParent = useCallback(() => {
		if (selectedIds.length === 0) return;
		const selectedId = selectedIds[0];

		if (engine) {
			// SaaS: DOM-based parent lookup
			const iframe = getPreviewIframe();
			if (!iframe?.contentDocument) return;
			const doc = iframe.contentDocument;

			const selector = buildElementSelector(selectedId, activeDesignInstanceId);
			const currentElement = doc.querySelector(selector);
			if (!currentElement) return;

			let parent = currentElement.parentElement;
			while (parent) {
				const parentId = (parent as HTMLElement).dataset.uniqId;
				if (parentId) {
					const rootId = engine.getRoot().id;
					if (parentId === rootId) {
						engine.clearSelection();
						return;
					}
					engine.select(parentId);
					return;
				}
				parent = parent.parentElement;
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:selectParent',
				elementId: selectedId,
			} as never);
		}
	}, [selectedIds, engine, activeDesignInstanceId, canvas]);

	const handleSelectChild = useCallback(() => {
		if (selectedIds.length === 0) return;
		const selectedId = selectedIds[0];

		if (engine) {
			// SaaS: DOM-based child lookup
			const iframe = getPreviewIframe();
			if (!iframe?.contentDocument) return;
			const doc = iframe.contentDocument;

			const selector = buildElementSelector(selectedId, activeDesignInstanceId);
			const currentElement = doc.querySelector(selector);
			if (!currentElement) return;

			const directChildren = Array.from(
				currentElement.querySelectorAll(':scope > [data-uniq-id]'),
			) as HTMLElement[];
			if (directChildren.length > 0) {
				const childIds = directChildren
					.map((child) => child.dataset.uniqId)
					.filter((id): id is string => !!id);
				if (childIds.length > 0) {
					engine.selectMultiple(childIds);
				}
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:selectChild',
				elementId: selectedId,
			} as never);
		}
	}, [selectedIds, engine, activeDesignInstanceId, canvas]);

	const handleCopyText = useCallback(async () => {
		if (selectedIds.length === 0) return;
		const selectedId = selectedIds[0];

		if (engine) {
			// SaaS: direct iframe DOM access
			const iframe = getPreviewIframe();
			if (!iframe?.contentDocument) return;
			const doc = iframe.contentDocument;

			const selector = buildElementSelector(selectedId, activeDesignInstanceId);
			const element = doc.querySelector(selector);
			if (element) {
				const text =
					(element as HTMLElement).innerText ||
					(element as HTMLElement).textContent ||
					'';
				await navigator.clipboard.writeText(text);
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:copyText',
				elementId: selectedId,
			} as never);
		}
	}, [selectedIds, activeDesignInstanceId, engine, canvas]);

	const handleCopyAsHTML = useCallback(async () => {
		if (selectedIds.length === 0) return;

		if (engine) {
			// SaaS: direct iframe DOM access
			const iframe = getPreviewIframe();
			if (!iframe?.contentDocument) return;
			const doc = iframe.contentDocument;

			const htmlCodes: string[] = [];
			for (const selectedId of selectedIds) {
				const selector = buildElementSelector(selectedId, activeDesignInstanceId);
				const element = doc.querySelector(selector);
				if (element) {
					htmlCodes.push(element.outerHTML);
				}
			}

			if (htmlCodes.length > 0) {
				await navigator.clipboard.writeText(htmlCodes.join('\n'));
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:copyAsHTML',
				elementId: selectedIds[0],
			} as never);
		}
	}, [selectedIds, activeDesignInstanceId, engine, canvas]);

	const handleWrapInDiv = useCallback(async () => {
		if (selectedIds.length === 0) return;
		const selectedId = selectedIds[0];

		if (engine && meta?.filePath) {
			const wrapperId = await wrapElement(selectedId, meta.filePath, 'div');
			if (wrapperId) {
				setTimeout(() => engine.select(wrapperId), 300);
			}
		} else {
			canvas.sendEvent({
				type: 'contextMenu:wrapInDiv',
				elementId: selectedId,
			} as never);
		}
	}, [selectedIds, meta, engine, canvas]);

	const handleGoToCode = useCallback(async () => {
		if (selectedIds.length === 0) return;
		const selectedId = selectedIds[0];

		if (engine && meta?.relativeFilePath) {
			// SaaS path
			try {
				const response = await authFetch(
					`/api/get-element-location?filePath=${encodeURIComponent(meta.relativeFilePath)}&uniqId=${encodeURIComponent(selectedId)}`,
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

				const { line, column } = data.location;

				if (projectId) {
					engine.setMode('code');
					const absolutePath = `/app/${meta.relativeFilePath}`;
					const cmdResponse = await authFetch(`/api/projects/${projectId}/ide/command`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							command: `gotoPosition:${absolutePath}:${line}:${column}`,
						}),
					});

					if (!cmdResponse.ok) {
						toast({
							variant: 'destructive',
							title: 'Navigation Error',
							description: 'Could not navigate in code editor',
						});
					}
				} else {
					const fileResponse = await authFetch(
						`/api/read-file?path=${encodeURIComponent(meta.relativeFilePath)}`,
					);
					if (!fileResponse.ok) return;

					const fileData = await fileResponse.json();
					engine.setMode('code');
					openFile(meta.relativeFilePath, fileData.content);

					requestAnimationFrame(() => {
						window.dispatchEvent(
							new CustomEvent('monaco-goto-position', {
								detail: { line, column, filePath: meta.relativeFilePath },
							}),
						);
					});
				}
			} catch (error) {
				console.error('[Go to Code] Error:', error);
				toast({
					variant: 'destructive',
					title: 'Navigation Error',
					description: 'Failed to navigate to code',
				});
			}
		} else {
			// VSCode path
			canvas.sendEvent({
				type: 'contextMenu:goToCode',
				elementId: selectedId,
			} as never);
		}
	}, [selectedIds, meta, engine, openFile, projectId, canvas]);

	// Listen for go-to-code hotkey trigger
	useEffect(() => {
		const handleHotkeyTrigger = () => {
			handleGoToCode();
		};
		window.addEventListener('trigger-go-to-code', handleHotkeyTrigger);
		return () => {
			window.removeEventListener('trigger-go-to-code', handleHotkeyTrigger);
		};
	}, [handleGoToCode]);

	// ========================================================================
	// Derived state
	// ========================================================================

	const menuType = target?.type;
	const instanceId = target && 'instanceId' in target ? target.instanceId : undefined;
	const isDisabled = menuType === 'design-element' && selectedIds.length === 0;

	const filterLower = filter.toLowerCase();
	const matchesFilter = (text: string) =>
		filter === '' || text.toLowerCase().includes(filterLower);

	// ========================================================================
	// Instance operation handlers (SaaS board mode)
	// ========================================================================

	const handleInstanceCopyClick = useCallback(async () => {
		if (!instanceId || !onInstanceCopy) return;
		await onInstanceCopy(instanceId);
	}, [instanceId, onInstanceCopy]);

	const handleInstanceCutClick = useCallback(async () => {
		if (!instanceId || !onInstanceCut) return;
		await onInstanceCut(instanceId);
	}, [instanceId, onInstanceCut]);

	const handleInstancePasteClick = useCallback(async () => {
		if (!onInstancePaste) return;
		await onInstancePaste();
	}, [onInstancePaste]);

	const handleInstanceDuplicateClick = useCallback(async () => {
		if (!instanceId || !onInstanceDuplicate) return;
		await onInstanceDuplicate(instanceId);
	}, [instanceId, onInstanceDuplicate]);

	const handleInstanceDeleteClick = useCallback(async () => {
		if (!instanceId || !onInstanceDelete) return;
		await onInstanceDelete(instanceId);
	}, [instanceId, onInstanceDelete]);

	const handleInstanceEditClick = useCallback(() => {
		if (!instanceId || !onInstanceEdit) return;
		onInstanceEdit(instanceId);
	}, [instanceId, onInstanceEdit]);

	// ========================================================================
	// Close on click outside / Escape
	// ========================================================================

	useEffect(() => {
		if (!target) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				closeMenu();
			}
		};

		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				closeMenu();
			}
		};

		const handleIframeClick = () => {
			closeMenu();
		};

		document.addEventListener('mousedown', handleClickOutside);
		document.addEventListener('keydown', handleEscape, { capture: true });
		window.addEventListener('contextmenuclose', handleIframeClick);

		// SaaS: also listen on iframe document
		const iframe = getPreviewIframe();
		const iframeDoc = iframe?.contentDocument;
		if (iframeDoc) {
			iframeDoc.addEventListener('mousedown', handleClickOutside);
			iframeDoc.addEventListener('keydown', handleEscape);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			document.removeEventListener('keydown', handleEscape, { capture: true });
			window.removeEventListener('contextmenuclose', handleIframeClick);
			if (iframeDoc) {
				iframeDoc.removeEventListener('mousedown', handleClickOutside);
				iframeDoc.removeEventListener('keydown', handleEscape);
			}
		};
	}, [target, closeMenu]);

	const handleMenuItemClick = useCallback(
		(handler: () => void | Promise<void>) => {
			handler();
			closeMenu();
		},
		[closeMenu],
	);

	// ========================================================================
	// Render
	// ========================================================================

	return (
		<>
			{children && (
				<div style={{ width: '100%', height: '100%' }}>{children}</div>
			)}
			{target &&
				createPortal(
					<Menu
						ref={menuRef}
						style={{
							left: target.x,
							top: target.y,
						}}
					>
						<div className="px-2 py-1.5">
							<Input
								placeholder="Filter actions..."
								value={filter}
								onChange={(e) => setFilter(e.target.value)}
								className="h-8 text-sm"
								autoFocus
								onKeyDown={(e) => {
									if (e.metaKey || e.ctrlKey) return;
									e.stopPropagation();
								}}
							/>
						</div>

						<MenuSeparator />

						{(() => {
							switch (menuType) {
								case 'board-instance':
									return (
										<>
											{!isReadonly && matchesFilter('edit') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleInstanceEditClick)
													}
												>
													Edit
												</MenuItem>
											)}
											{matchesFilter('copy') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleInstanceCopyClick)
													}
												>
													Copy{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘C
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('cut') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleInstanceCutClick)
													}
												>
													Cut{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘X
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('duplicate') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleInstanceDuplicateClick)
													}
												>
													Duplicate{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘D
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('delete') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleInstanceDeleteClick)
													}
												>
													Delete{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														Del
													</span>
												</MenuItem>
											)}
										</>
									);
								case 'board-empty':
									return (
										!isReadonly && matchesFilter('paste') && (
											<MenuItem
												onClick={() =>
													handleMenuItemClick(handleInstancePasteClick)
												}
											>
												Paste{' '}
												<span className="ml-auto text-xs text-muted-foreground">
													⌘V
												</span>
											</MenuItem>
										)
									);
								case 'design-element':
									return (
										<>
											{matchesFilter('go to code') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleGoToCode)}
													disabled={isDisabled}
												>
													Go to Code{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘⇧C
													</span>
												</MenuItem>
											)}

											{matchesFilter('go to code') && <MenuSeparator />}

											{matchesFilter('copy') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleCopy)}
													disabled={isDisabled}
												>
													Copy{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘C
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('paste') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handlePaste)}
												>
													Paste{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘V
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('duplicate') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleDuplicate)}
													disabled={isDisabled}
												>
													Duplicate{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘D
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('cut') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleCut)}
													disabled={isDisabled}
												>
													Cut{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⌘X
													</span>
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('delete') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleDelete)}
													disabled={isDisabled}
												>
													Delete{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														Del
													</span>
												</MenuItem>
											)}

											{(matchesFilter('select parent') ||
												matchesFilter('select child')) && <MenuSeparator />}

											{matchesFilter('select parent') && (
												<MenuItem
													onClick={() =>
														handleMenuItemClick(handleSelectParent)
													}
													disabled={isDisabled}
												>
													Select Parent{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														⇧↵
													</span>
												</MenuItem>
											)}
											{matchesFilter('select child') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleSelectChild)}
													disabled={isDisabled}
												>
													Select Child{' '}
													<span className="ml-auto text-xs text-muted-foreground">
														↵
													</span>
												</MenuItem>
											)}

											{(matchesFilter('copy text') ||
												matchesFilter('copy as html') ||
												(!isReadonly && matchesFilter('wrap'))) && <MenuSeparator />}

											{matchesFilter('copy text') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleCopyText)}
													disabled={isDisabled}
												>
													Copy Text
												</MenuItem>
											)}
											{matchesFilter('copy as html') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleCopyAsHTML)}
													disabled={isDisabled}
												>
													Copy as HTML
												</MenuItem>
											)}
											{!isReadonly && matchesFilter('wrap') && (
												<MenuItem
													onClick={() => handleMenuItemClick(handleWrapInDiv)}
													disabled={isDisabled}
												>
													Wrap in div
												</MenuItem>
											)}
										</>
									);
								default:
									return null;
							}
						})()}
					</Menu>,
					document.body,
				)}
		</>
	);
}

// ============================================================================
// Menu shell with viewport boundary handling
// ============================================================================

const Menu = React.forwardRef<
	HTMLDivElement,
	{ children: React.ReactNode; style?: React.CSSProperties }
>(({ children, style }, ref) => {
	const internalRef = useRef<HTMLDivElement | null>(null);
	const [adjustedStyle, setAdjustedStyle] = useState(style);

	useEffect(() => {
		if (!internalRef.current || !style) return;

		const menu = internalRef.current;
		const rect = menu.getBoundingClientRect();
		const padding = 8;

		let { left, top } = style as { left: number; top: number };

		if (left + rect.width > window.innerWidth - padding) {
			left = window.innerWidth - rect.width - padding;
		}
		if (top + rect.height > window.innerHeight - padding) {
			top = window.innerHeight - rect.height - padding;
		}
		left = Math.max(padding, left);
		top = Math.max(padding, top);

		setAdjustedStyle({ left, top });
	}, [style]);

	return (
		<div
			ref={(node) => {
				internalRef.current = node;
				if (typeof ref === 'function') ref(node);
				else if (ref) ref.current = node;
			}}
			role="menu"
			data-role="context-menu"
			className="fixed z-[1100] min-w-[256px] rounded-md border border-border bg-popover p-1 shadow-md"
			style={adjustedStyle}
		>
			{children}
		</div>
	);
});
Menu.displayName = 'Menu';

function MenuSeparator() {
	return <hr className="border-0 border-t border-border my-1" />;
}

function MenuItem({
	children,
	onClick,
	disabled = false,
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			className={cn(
				'w-full px-2 py-1.5 text-sm text-left rounded flex items-center',
				disabled
					? 'text-muted-foreground/50 cursor-not-allowed'
					: 'hover:bg-muted text-foreground cursor-pointer',
			)}
			onClick={() => {
				if (!disabled) onClick();
			}}
			disabled={disabled}
		>
			{children}
		</button>
	);
}
