/**
 * Shared keyboard handler for design-mode element navigation.
 *
 * Used by both SaaS editor (useHotkeysSetup.ts) and VS Code extension
 * (iframe-interaction.ts). Handles:
 * - Tab/Shift+Tab: sibling navigation with wrapping
 * - Delete/Backspace: delete selected elements (300ms debounce)
 * - Enter: select all direct children (150ms debounce)
 * - Shift+Enter: select parent element
 * - Escape: clear selection
 */

export interface KeyboardHandlerCallbacks {
	onSelectElement: (id: string) => void;
	onSelectMultiple: (ids: string[]) => void;
	onClearSelection: () => void;
	onDeleteElements: (ids: string[]) => void;
}

/**
 * Build CSS selector for element with optional instance scope.
 * Mirrors dom-utils.ts buildElementSelector but works in any context.
 */
export function buildElementSelector(
	id: string,
	instanceId?: string | null,
): string {
	if (instanceId) {
		return `[data-canvas-instance-id="${instanceId}"] [data-uniq-id="${id}"]`;
	}
	return `[data-uniq-id="${id}"]`;
}

/**
 * Walk up the DOM tree to find the nearest ancestor with data-uniq-id.
 */
export function findParentWithUniqId(
	element: Element,
): { id: string; element: Element } | null {
	let parent = element.parentElement;
	while (parent) {
		const parentId = (parent as HTMLElement).dataset?.uniqId;
		if (parentId) {
			return { id: parentId, element: parent };
		}
		parent = parent.parentElement;
	}
	return null;
}

/**
 * Get data-uniq-id values from direct children of an element.
 */
export function findDirectChildIds(element: Element): string[] {
	const children = element.querySelectorAll(':scope > [data-uniq-id]');
	const ids: string[] = [];
	for (let i = 0; i < children.length; i++) {
		const id = (children[i] as HTMLElement).dataset?.uniqId;
		if (id) ids.push(id);
	}
	return ids;
}

/**
 * Find the next or previous sibling with data-uniq-id, wrapping around.
 */
export function findSiblingId(
	element: Element,
	direction: 'next' | 'prev',
): string | null {
	// Find parent with data-uniq-id
	let parent = element.parentElement;
	while (parent && !(parent as HTMLElement).dataset?.uniqId) {
		parent = parent.parentElement;
	}
	if (!parent) return null;

	const siblings = Array.from(
		parent.querySelectorAll(':scope > [data-uniq-id]'),
	);
	const currentIndex = siblings.indexOf(element);
	if (currentIndex === -1) return null;

	let targetIndex: number;
	if (direction === 'prev') {
		targetIndex =
			currentIndex === 0 ? siblings.length - 1 : currentIndex - 1;
	} else {
		targetIndex =
			currentIndex === siblings.length - 1 ? 0 : currentIndex + 1;
	}

	return (siblings[targetIndex] as HTMLElement).dataset?.uniqId ?? null;
}

interface DesignKeydownConfig {
	getState: () => {
		selectedIds: string[];
		activeInstanceId?: string | null;
	};
	getDocument: () => Document | null;
	callbacks: KeyboardHandlerCallbacks;
	/** If provided, handler only fires when this returns true */
	isDesignMode?: () => boolean;
}

/**
 * Create a keydown handler for design-mode element navigation.
 * Returns the handler function and a dispose function to clear timers.
 *
 * The handler returns true if the event was consumed.
 */
export function createDesignKeydownHandler(config: DesignKeydownConfig): {
	handler: (e: KeyboardEvent) => boolean;
	dispose: () => void;
} {
	const { getState, getDocument, callbacks, isDesignMode } = config;

	let deleteDebounceTime = 0;
	let enterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!target || !(target instanceof HTMLElement)) return false;
		const tag = target.tagName;
		return (
			tag === 'INPUT' ||
			tag === 'TEXTAREA' ||
			tag === 'SELECT' ||
			target.isContentEditable
		);
	}

	function handler(e: KeyboardEvent): boolean {
		if (isDesignMode && !isDesignMode()) return false;
		if (isTypingTarget(e.target)) return false;

		const { selectedIds, activeInstanceId } = getState();
		const selectedId = selectedIds[0];
		if (!selectedId) {
			// Escape with no selection
			if (e.key === 'Escape') {
				callbacks.onClearSelection();
				return true;
			}
			return false;
		}

		const doc = getDocument();
		if (!doc) return false;

		// === Escape: clear selection ===
		if (e.key === 'Escape') {
			e.preventDefault();
			callbacks.onClearSelection();
			return true;
		}

		// === Tab/Shift+Tab: sibling navigation ===
		if (e.key === 'Tab') {
			e.preventDefault();

			const selector = buildElementSelector(selectedId, activeInstanceId);
			const currentElement = doc.querySelector(selector);
			if (!currentElement) return true;

			const direction = e.shiftKey ? 'prev' : 'next';
			const targetId = findSiblingId(currentElement, direction);
			if (targetId) {
				callbacks.onSelectElement(targetId);
			}
			return true;
		}

		// === Delete/Backspace: delete elements ===
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (selectedIds.length === 0) return false;

			const now = Date.now();
			if (now - deleteDebounceTime < 300) {
				return true; // Swallow event during debounce
			}

			e.preventDefault();
			deleteDebounceTime = now;
			callbacks.onDeleteElements(selectedIds);
			return true;
		}

		// === Enter / Shift+Enter: child/parent navigation ===
		if (e.key === 'Enter') {
			e.preventDefault();

			if (enterDebounceTimer) {
				clearTimeout(enterDebounceTimer);
			}

			const shiftKey = e.shiftKey;
			enterDebounceTimer = setTimeout(() => {
				const freshDoc = getDocument();
				if (!freshDoc) return;

				const { selectedIds: freshIds, activeInstanceId: freshInstance } =
					getState();
				const freshId = freshIds[0];
				if (!freshId) return;

				const selector = buildElementSelector(freshId, freshInstance);
				const currentElement = freshDoc.querySelector(selector);
				if (!currentElement) return;

				if (shiftKey) {
					// Shift+Enter: select parent
					const parent = findParentWithUniqId(currentElement);
					if (parent) {
						callbacks.onSelectElement(parent.id);
					} else {
						callbacks.onClearSelection();
					}
				} else {
					// Enter: select direct children
					const childIds = findDirectChildIds(currentElement);
					if (childIds.length > 0) {
						callbacks.onSelectMultiple(childIds);
					}
				}
			}, 150);

			return true;
		}

		return false;
	}

	function dispose(): void {
		if (enterDebounceTimer) {
			clearTimeout(enterDebounceTimer);
			enterDebounceTimer = null;
		}
	}

	return { handler, dispose };
}
