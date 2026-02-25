/**
 * Hook for hotkey handlers
 * Sets up all keyboard shortcuts including iframe forwarding
 */

import { useCallback, useEffect, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { buildElementSelector, getPreviewIframe } from '@/lib/dom-utils';
import { createDesignKeydownHandler } from '@shared/canvas-interaction/keyboard-handler';
import { copyMultipleElementsAsTSX } from '@/utils/tsxClipboard';

interface UseHotkeysSetupProps {
	engine: CanvasEngine;
	selectedIds: string[];
	meta: { filePath?: string; componentName?: string; repoPath?: string } | null;
	activeDesignInstanceId: string | null;
	isBoardModeActive: boolean;
	activeBoardInstance: string | null;
	isCodeEditorMode: boolean;
	iframeLoadedCounter: number;
	// Instance operations for board mode
	handleInstancePaste: () => Promise<void>;
	handleInstanceDelete: (instanceId: string) => Promise<void>;
	handleInstanceDuplicate: (instanceId: string) => Promise<void>;
	handleInstanceCopy: (instanceId: string) => Promise<void>;
	handleInstanceCut: (instanceId: string) => Promise<void>;
	// State setters
	setActiveBoardInstance: React.Dispatch<React.SetStateAction<string | null>>;
	setSidebarsHidden: React.Dispatch<React.SetStateAction<boolean>>;
	setIsAddingComment: (value: boolean) => void;
	isAddingComment: boolean;
	selectedCommentId: string | null;
	setSelectedCommentId: (id: string | null) => void;
}

/**
 * Sets up all hotkey handlers for the canvas editor
 */
export function useHotkeysSetup({
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
}: UseHotkeysSetupProps): void {
	const duplicateDebounceRef = useRef<boolean>(false);
	const pasteDebounceRef = useRef<boolean>(false);
	const undoInProgressRef = useRef<boolean>(false);
	const undoPendingRef = useRef<boolean>(false);
	const redoInProgressRef = useRef<boolean>(false);
	const redoPendingRef = useRef<boolean>(false);

	// Hotkey: Toggle sidebars visibility (Mod+/)
	useEffect(() => {
		const handleToggleSidebars = (e: KeyboardEvent) => {
			const isMod = e.metaKey || e.ctrlKey;
			if (isMod && e.key === '/') {
				e.preventDefault();
				e.stopPropagation();
				setSidebarsHidden((prev) => !prev);
			}
		};
		window.addEventListener('keydown', handleToggleSidebars, { capture: true });
		return () =>
			window.removeEventListener('keydown', handleToggleSidebars, {
				capture: true,
			});
	}, [setSidebarsHidden]);

	// ESC to deselect comment
	useEffect(() => {
		const handleEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && selectedCommentId) {
				setSelectedCommentId(null);
			}
		};
		window.addEventListener('keydown', handleEsc);
		return () => window.removeEventListener('keydown', handleEsc);
	}, [selectedCommentId, setSelectedCommentId]);

	// Cancel pending undo/redo on key release
	useEffect(() => {
		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === 'z' || e.key === 'Z') {
				undoPendingRef.current = false;
				redoPendingRef.current = false;
			}
		};
		window.addEventListener('keyup', handleKeyUp);
		return () => window.removeEventListener('keyup', handleKeyUp);
	}, []);

	// Hotkeys: Undo/Redo (disabled in board mode - let Excalidraw handle it)
	// Sequential processing: max 1 undo/redo in flight, pending flag for held key
	useHotkeys(
		'mod+z',
		async (e) => {
			e.preventDefault();
			if (undoInProgressRef.current) {
				undoPendingRef.current = true;
				return;
			}
			if (!engine?.canUndo()) return;

			undoInProgressRef.current = true;
			try {
				await engine.undo();
				while (undoPendingRef.current && engine.canUndo()) {
					undoPendingRef.current = false;
					await engine.undo();
				}
			} finally {
				undoInProgressRef.current = false;
				undoPendingRef.current = false;
			}
		},
		{
			enabled: !!engine,
			enableOnFormTags: false,
		},
		[engine],
	);

	useHotkeys(
		'mod+shift+z',
		async (e) => {
			e.preventDefault();
			if (redoInProgressRef.current) {
				redoPendingRef.current = true;
				return;
			}
			if (!engine?.canRedo()) return;

			redoInProgressRef.current = true;
			try {
				await engine.redo();
				while (redoPendingRef.current && engine.canRedo()) {
					redoPendingRef.current = false;
					await engine.redo();
				}
			} finally {
				redoInProgressRef.current = false;
				redoPendingRef.current = false;
			}
		},
		{
			enabled: !!engine,
			enableOnFormTags: false,
		},
		[engine],
	);

	// Hotkey: Toggle adding comment mode (C)
	useHotkeys(
		'c',
		(e) => {
			e.preventDefault();
			setIsAddingComment(!isAddingComment);
		},
		{
			enabled: !isCodeEditorMode && !isBoardModeActive,
			enableOnFormTags: false,
		},
		[isAddingComment, setIsAddingComment, isCodeEditorMode, isBoardModeActive],
	);

	// Hotkey: Duplicate elements (Mod+D)
	useHotkeys(
		'mod+d',
		async (e) => {
			const iframeElement = getPreviewIframe();
			const isEventFromIframe = iframeElement?.contentDocument?.contains(e.target as Node);
			if (!isEventFromIframe) return;

			e.preventDefault();
			const filePath = meta?.filePath;
			if (selectedIds.length === 0 || !filePath) return;

			if (duplicateDebounceRef.current) {
				console.log('[Hotkey] Duplicate already in progress, ignoring');
				return;
			}
			duplicateDebounceRef.current = true;

			console.log('[Hotkey] Mod+D pressed, duplicating:', selectedIds.join(', '));
			engine.clearSelection();

			const newIds: (string | null)[] = [];
			for (const id of selectedIds) {
				const newId = await engine.duplicateASTElement(id, filePath);
				console.log(`[Hotkey] Duplicated ${id.substring(0, 8)} -> ${newId?.substring(0, 8) || 'null'}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
				newIds.push(newId);
			}

			setTimeout(() => {
				duplicateDebounceRef.current = false;
			}, 500);

			const validNewIds = newIds.filter((id): id is string => id !== null);
			if (validNewIds.length > 0) {
				const selectNewElements = () => {
					console.log(`[Hotkey] Selecting new elements:`, validNewIds.map((id) => id.substring(0, 8)));
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
		},
		{
			enabled: !!engine && selectedIds.length > 0 && !!meta?.filePath,
			enableOnFormTags: false,
			preventDefault: true,
		},
		[engine, selectedIds, meta],
	);

	// Hotkey: Copy elements as TSX (Mod+C)
	useHotkeys(
		'mod+c',
		async (e) => {
			const iframeElement = getPreviewIframe();
			const isEventFromIframe = iframeElement?.contentDocument?.contains(e.target as Node);
			if (!isEventFromIframe) return;

			e.preventDefault();
			const filePath = meta?.filePath;
			if (selectedIds.length === 0 || !filePath) return;

			console.log('[Hotkey] Mod+C pressed, copying as TSX:', selectedIds.join(', '));
			await copyMultipleElementsAsTSX(selectedIds, filePath, activeDesignInstanceId);
		},
		{
			enabled: !!engine && selectedIds.length > 0 && !!meta?.filePath,
			enableOnFormTags: false,
		},
		[engine, selectedIds, meta, activeDesignInstanceId],
	);

	// Hotkey: Cut elements (Mod+X)
	useHotkeys(
		'mod+x',
		async (e) => {
			const iframeElement = getPreviewIframe();
			const isEventFromIframe = iframeElement?.contentDocument?.contains(e.target as Node);
			if (!isEventFromIframe) return;

			e.preventDefault();
			const filePath = meta?.filePath;
			if (selectedIds.length === 0 || !filePath || !engine) return;

			console.log('[Hotkey] Mod+X pressed, cutting:', selectedIds.join(', '));

			const iframe = getPreviewIframe();
			let parentId: string | null = null;
			if (iframe?.contentDocument) {
				const selector = buildElementSelector(selectedIds[0], activeDesignInstanceId);
				const currentElement = iframe.contentDocument.querySelector(selector);
				if (currentElement) {
					let parent = currentElement.parentElement;
					while (parent && !parent.dataset.uniqId) {
						parent = parent.parentElement;
					}
					if (parent) {
						const foundParentId = parent.dataset.uniqId;
						const rootId = engine.getRoot().id;
						if (foundParentId && foundParentId !== rootId) {
							parentId = foundParentId;
						}
					}
				}
			}

			const copySuccess = await copyMultipleElementsAsTSX(selectedIds, filePath, activeDesignInstanceId);
			if (copySuccess) {
				engine.deleteASTElements(selectedIds, filePath);
				if (parentId) {
					setTimeout(() => {
						engine.select(parentId);
					}, 100);
				} else {
					engine.clearSelection();
				}
			}
		},
		{
			enabled: !!engine && selectedIds.length > 0 && !!meta?.filePath,
			enableOnFormTags: false,
		},
		[engine, selectedIds, meta, activeDesignInstanceId],
	);

	// Hotkey: Paste element (Mod+V)
	useHotkeys(
		'mod+v',
		async (e) => {
			const iframeElement = getPreviewIframe();
			const isEventFromIframe = iframeElement?.contentDocument?.contains(e.target as Node);
			if (!isEventFromIframe) return;

			e.preventDefault();
			const filePath = meta?.filePath;

			// Skip AST paste in board mode - board mode has its own Mod+V handler
			if (isBoardModeActive) return;

			if (!filePath || !engine) return;

			if (pasteDebounceRef.current) {
				console.log('[Hotkey] Paste already in progress, ignoring');
				return;
			}
			pasteDebounceRef.current = true;

			console.log('[Hotkey] Mod+V pressed, pasting...');
			const tsxCode = await navigator.clipboard.readText();

			if (!tsxCode || !tsxCode.includes('<') || !tsxCode.includes('>')) {
				console.warn('[Hotkey] Clipboard does not contain valid TSX code');
				pasteDebounceRef.current = false;
				return;
			}

			const newId = await engine.pasteASTElement(selectedIds[0] || null, filePath, tsxCode);

			setTimeout(() => {
				pasteDebounceRef.current = false;
			}, 500);

			if (newId) {
				const handleComponentLoaded = () => {
					window.removeEventListener('component-loaded', handleComponentLoaded);
					setTimeout(() => {
						console.log('[Hotkey] Selecting pasted element:', newId);
						engine.select(newId);
					}, 100);
				};
				window.addEventListener('component-loaded', handleComponentLoaded);
				setTimeout(() => {
					window.removeEventListener('component-loaded', handleComponentLoaded);
				}, 1000);
			}
		},
		{
			enabled: !!engine && !!meta?.filePath,
			enableOnFormTags: false,
		},
		[engine, selectedIds, meta, isBoardModeActive],
	);

	// Setup hotkeys for iframe (since useHotkeys doesn't work inside iframe)
	useEffect(() => {
		console.log('[Hotkey-iframe] useEffect triggered, engine:', !!engine, 'iframeCounter:', iframeLoadedCounter);
		if (!engine) return;

		const setupIframeHotkeys = () => {
			console.log('[Hotkey-iframe] setupIframeHotkeys called');
			const iframe = getPreviewIframe();
			console.log('[Hotkey-iframe] iframe:', !!iframe, 'contentDocument:', !!iframe?.contentDocument);
			if (!iframe?.contentDocument) return null;

			const iframeDoc = iframe.contentDocument;

			const handleIframeKeydown = (e: KeyboardEvent) => {
				console.log('[Hotkey-iframe] 🔍 Raw keydown received:', e.key, e.code);
				const target = e.target as HTMLElement;
				if (
					target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable
				) {
					return;
				}

				const isMod = e.metaKey || e.ctrlKey;
				const isZKey = e.code === 'KeyZ' || e.key.toLowerCase() === 'z';

				// Cmd+Shift+Z (Redo)
				if (isMod && isZKey && e.shiftKey) {
					e.preventDefault();
					if (redoInProgressRef.current) {
						redoPendingRef.current = true;
						return;
					}
					if (engine.canRedo()) {
						redoInProgressRef.current = true;
						(async () => {
							try {
								await engine.redo();
								while (redoPendingRef.current && engine.canRedo()) {
									redoPendingRef.current = false;
									await engine.redo();
								}
							} finally {
								redoInProgressRef.current = false;
								redoPendingRef.current = false;
							}
						})();
					}
					return;
				}

				// Cmd+Z (Undo)
				if (isMod && isZKey && !e.shiftKey) {
					e.preventDefault();
					if (undoInProgressRef.current) {
						undoPendingRef.current = true;
						return;
					}
					if (engine.canUndo()) {
						undoInProgressRef.current = true;
						(async () => {
							try {
								await engine.undo();
								while (undoPendingRef.current && engine.canUndo()) {
									undoPendingRef.current = false;
									await engine.undo();
								}
							} finally {
								undoInProgressRef.current = false;
								undoPendingRef.current = false;
							}
						})();
					}
					return;
				}

				// Cmd+D (Duplicate)
				const isDKey = e.code === 'KeyD' || e.key.toLowerCase() === 'd';
				if (isMod && isDKey && !e.shiftKey) {
					const currentSelectedIds = engine.getSelection().selectedIds;
					if (currentSelectedIds.length === 0) return;

					e.preventDefault();
					if (duplicateDebounceRef.current) {
						return;
					}
					duplicateDebounceRef.current = true;

					engine.clearSelection();
					const root = engine.getRoot();
					const filePath = root.metadata?.filePath;
					if (filePath) {
						(async () => {
							const newIds: (string | null)[] = [];
							for (const id of currentSelectedIds) {
								const newId = await engine.duplicateASTElement(id, filePath);
								newIds.push(newId);
							}

							setTimeout(() => {
								duplicateDebounceRef.current = false;
							}, 500);

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
						})();
					}
					return;
				}

				// Cmd+Shift+C (Go to Code)
				const isCKey = e.code === 'KeyC' || e.key.toLowerCase() === 'c';
				if (isMod && isCKey && e.shiftKey) {
					e.preventDefault();
					console.log('[Hotkey-iframe] Cmd+Shift+C pressed, triggering Go to Code');
					window.dispatchEvent(new CustomEvent('trigger-go-to-code'));
					return;
				}

				// Cmd+C (Copy as TSX)
				if (isMod && isCKey && !e.shiftKey) {
					const currentSelectedIds = engine.getSelection().selectedIds;
					const selection = iframeDoc.getSelection();
					if (selection && selection.toString().length > 0) return;
					if (currentSelectedIds.length === 0) return;

					e.preventDefault();
					const root = engine.getRoot();
					const filePath = root.metadata?.filePath;
					if (filePath) {
						copyMultipleElementsAsTSX(currentSelectedIds, filePath, activeDesignInstanceId);
					}
					return;
				}

				// Cmd+X (Cut)
				const isXKey = e.code === 'KeyX' || e.key.toLowerCase() === 'x';
				if (isMod && isXKey && !e.shiftKey) {
					const currentSelectedIds = engine.getSelection().selectedIds;
					const selection = iframeDoc.getSelection();
					if (selection && selection.toString().length > 0) return;
					if (currentSelectedIds.length === 0) return;

					e.preventDefault();
					let parentId: string | null = null;
					const selector = buildElementSelector(currentSelectedIds[0], activeDesignInstanceId);
					const currentElement = iframeDoc.querySelector(selector);
					if (currentElement) {
						let parent = currentElement.parentElement;
						while (parent && !parent.dataset.uniqId) {
							parent = parent.parentElement;
						}
						if (parent) {
							const foundParentId = parent.dataset.uniqId;
							const rootId = engine.getRoot().id;
							if (foundParentId && foundParentId !== rootId) {
								parentId = foundParentId;
							}
						}
					}

					const root = engine.getRoot();
					const filePath = root.metadata?.filePath;
					if (filePath) {
						copyMultipleElementsAsTSX(currentSelectedIds, filePath, activeDesignInstanceId).then(
							async (copySuccess) => {
								if (copySuccess) {
									engine.deleteASTElements(currentSelectedIds, filePath);
									if (parentId) {
										setTimeout(() => {
											engine.select(parentId);
										}, 100);
									} else {
										engine.clearSelection();
									}
								}
							},
						);
					}
					return;
				}

				// Cmd+V (Paste)
				const isVKey = e.code === 'KeyV' || e.key.toLowerCase() === 'v';
				if (isMod && isVKey && !e.shiftKey) {
					const selection = iframeDoc.getSelection();
					if (selection && selection.toString().length > 0) return;

					e.preventDefault();
					if (pasteDebounceRef.current) {
						return;
					}
					pasteDebounceRef.current = true;

					const root = engine.getRoot();
					const filePath = root.metadata?.filePath;
					if (filePath) {
						const currentSelectedIds = engine.getSelection().selectedIds;
						navigator.clipboard.readText().then(async (tsxCode) => {
							if (!tsxCode || !tsxCode.includes('<') || !tsxCode.includes('>')) {
								pasteDebounceRef.current = false;
								return;
							}

							const newId = await engine.pasteASTElement(currentSelectedIds[0] || null, filePath, tsxCode);
							setTimeout(() => {
								pasteDebounceRef.current = false;
							}, 500);

							if (newId) {
								const handleComponentLoaded = () => {
									window.removeEventListener('component-loaded', handleComponentLoaded);
									setTimeout(() => {
										engine.select(newId);
									}, 100);
								};
								window.addEventListener('component-loaded', handleComponentLoaded);
								setTimeout(() => {
									window.removeEventListener('component-loaded', handleComponentLoaded);
								}, 1000);
							}
						});
					}
					return;
				}
			};

			iframeDoc.addEventListener('keydown', handleIframeKeydown, { capture: true });
			console.log('[Hotkey-iframe] Hotkeys installed with capture:true');

			return () => {
				iframeDoc.removeEventListener('keydown', handleIframeKeydown, { capture: true });
				console.log('[Hotkey-iframe] Hotkeys removed');
			};
		};

		const cleanup = setupIframeHotkeys();
		const handleComponentLoaded = () => {
			console.log('[Hotkey-iframe] Component loaded, re-installing hotkeys');
			setTimeout(() => {
				setupIframeHotkeys();
			}, 100);
		};

		window.addEventListener('component-loaded', handleComponentLoaded);

		return () => {
			cleanup?.();
			window.removeEventListener('component-loaded', handleComponentLoaded);
		};
	}, [engine, activeDesignInstanceId, iframeLoadedCounter]);

	// Handle keyboard shortcuts: Delete, Backspace, Shift+Enter, Enter, Escape, Tab
	useEffect(() => {
		const sharedKeydown = createDesignKeydownHandler({
			getState: () => ({
				selectedIds,
				activeInstanceId: activeDesignInstanceId,
			}),
			getDocument: () => getPreviewIframe()?.contentDocument ?? null,
			callbacks: {
				onSelectElement: (id) => engine.select(id),
				onSelectMultiple: (ids) => engine.selectMultiple(ids),
				onClearSelection: () => engine.clearSelection(),
				onDeleteElements: (ids) => {
					if (meta?.filePath) {
						engine.deleteASTElements(ids, meta.filePath);
					}
				},
			},
		});

		const handleKeyDown = async (e: KeyboardEvent) => {
			const isTyping =
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				(e.target as HTMLElement).isContentEditable;

			// Handle Escape to clear selection (has board mode logic)
			if (e.key === 'Escape') {
				if (isBoardModeActive && activeBoardInstance) {
					e.preventDefault();
					console.log('[Hotkey] Escape pressed, clearing board selection');
					setActiveBoardInstance(null);
					return;
				}
				if (selectedIds.length > 0) {
					e.preventDefault();
					console.log('[Hotkey] Escape pressed, clearing selection');
					engine.clearSelection();
				}
				return;
			}

			const iframeElement = getPreviewIframe();
			const isEventFromIframe = iframeElement?.contentDocument?.contains(e.target as Node);

			// Mod+V - paste renderer from clipboard (works without selection in board mode)
			const isMod = e.metaKey || e.ctrlKey;
			if (
				isBoardModeActive &&
				!isTyping &&
				isEventFromIframe &&
				isMod &&
				(e.key === 'v' || e.key === 'V') &&
				!e.shiftKey
			) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
				await handleInstancePaste();
				return;
			}

			// Board mode hotkeys with selected instance
			if (isBoardModeActive && activeBoardInstance && !isTyping && isEventFromIframe) {
				if (e.key === 'Delete' || e.key === 'Backspace') {
					e.preventDefault();
					await handleInstanceDelete(activeBoardInstance);
					return;
				}

				if (isMod && (e.key === 'd' || e.key === 'D') && !e.shiftKey) {
					e.preventDefault();
					await handleInstanceDuplicate(activeBoardInstance);
					return;
				}

				if (isMod && (e.key === 'c' || e.key === 'C') && !e.shiftKey) {
					e.preventDefault();
					await handleInstanceCopy(activeBoardInstance);
					return;
				}

				if (isMod && (e.key === 'x' || e.key === 'X') && !e.shiftKey) {
					e.preventDefault();
					await handleInstanceCut(activeBoardInstance);
					return;
				}
			}

			// Skip element hotkeys in board mode
			if (isBoardModeActive) return;

			// Element hotkeys only work inside iframe
			if (!isEventFromIframe) return;

			if (!selectedIds[0]) return;

			// Delegate element navigation to shared handler
			if (sharedKeydown.handler(e)) return;
		};

		document.addEventListener('keydown', handleKeyDown);

		const iframe = getPreviewIframe();
		if (iframe?.contentDocument) {
			iframe.contentDocument.addEventListener('keydown', handleKeyDown);
		}

		return () => {
			sharedKeydown.dispose();
			document.removeEventListener('keydown', handleKeyDown);
			if (iframe?.contentDocument) {
				iframe.contentDocument.removeEventListener('keydown', handleKeyDown);
			}
		};
	}, [
		selectedIds,
		engine,
		meta,
		activeDesignInstanceId,
		isBoardModeActive,
		activeBoardInstance,
		handleInstancePaste,
		handleInstanceDelete,
		handleInstanceDuplicate,
		handleInstanceCopy,
		handleInstanceCut,
		setActiveBoardInstance,
	]);
}
