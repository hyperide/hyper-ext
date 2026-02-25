/**
 * Shared interfaces for canvas interaction (overlays, click handling, style injection).
 * Used by both SaaS editor and VS Code extension.
 */

// ============================================================================
// Overlay Renderer
// ============================================================================

export interface OverlayState {
	selectedIds: string[];
	hoveredId: string | null;
	hoveredItemIndex?: number | null;
	selectedItemIndices?: Map<string, number | null>;
	activeInstanceId?: string | null;
	viewportZoom?: number;
}

export interface OverlayRendererOptions {
	viewportZoom?: number;
}

export interface OverlayRect {
	key: string;
	left: number;
	top: number;
	width: number;
	height: number;
	type: 'selection' | 'hover';
}

// ============================================================================
// Click Handler
// ============================================================================

export interface ClickHandlerCallbacks {
	/** Called when an element with data-uniq-id is clicked in design mode */
	onElementClick: (
		elementId: string,
		element: HTMLElement,
		event: MouseEvent,
		itemIndex: number | null,
	) => void;
	/** Called on mouseover/mouseout (null = mouse left all elements) */
	onElementHover: (
		elementId: string | null,
		element: HTMLElement | null,
		itemIndex: number | null,
	) => void;
	/** Called when clicking empty space (no data-uniq-id ancestor) */
	onEmptyClick?: (event: MouseEvent) => void;
	/** Returns current editor mode */
	getMode: () => 'design' | 'interact';
	/**
	 * Optional pre-intercept before default click handling.
	 * Return true to skip default handling entirely.
	 */
	shouldIntercept?: (event: MouseEvent) => boolean;
}

export interface ClickHandlerOptions {
	activeInstanceId?: string | null;
}

// ============================================================================
// Style Injector
// ============================================================================

export interface DesignStylesOptions {
	mode: 'design' | 'interact';
	boardModeActive?: boolean;
	canvasMode?: 'single' | 'multi';
	transparentBackground?: boolean;
}
