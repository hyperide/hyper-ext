/**
 * Shared interfaces for canvas interaction (overlays, click handling, style injection).
 * Used by both SaaS editor and VS Code extension.
 */

import type { NodeMapEntry, NodeRef, SourceLocation } from '../element-tracing/types';

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
  onPlaceholderClick?: (elementId: string) => void;
  editorMode?: 'design' | 'interact' | 'code';
  /** Platform-specific element resolver for overlay rendering */
  elementResolver?: OverlayElementResolver;
}

export interface OverlayRect {
  key: string;
  left: number;
  top: number;
  width: number;
  height: number;
  type: 'selection' | 'hover';
}

export interface PlaceholderRect {
  elementId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

// ============================================================================
// Click Handler
// ============================================================================

/** Result of a local (synchronous, cache-based) element resolution. */
export interface LocalResolveResult {
  nodeRef: NodeRef;
  entry: NodeMapEntry;
  source: SourceLocation;
  itemIndex: number;
}

/**
 * Interface for fiber-based element resolution — implemented by ElementTracer (client).
 * Dependency inversion: shared/ defines the interface, client/ provides the implementation.
 */
export interface TracingResolver {
  getSourceLocation(element: HTMLElement): SourceLocation | null;
  getItemIndex(element: HTMLElement): number;
  resolveClickLocal(element: HTMLElement): LocalResolveResult | null;
  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null;
}

export interface ClickHandlerCallbacks {
  /**
   * Called when an element is clicked in design mode.
   * nodeRef is null when local resolution failed (server round-trip pending).
   */
  onElementClick: (
    nodeRef: string | null,
    element: HTMLElement,
    event: MouseEvent,
    itemIndex: number,
    source: SourceLocation,
  ) => void;
  /** Called on mouseover/mouseout (null = mouse left all elements) */
  onElementHover: (
    nodeRef: string | null,
    element: HTMLElement | null,
    itemIndex: number | null,
    source: SourceLocation | null,
  ) => void;
  /** Called when clicking empty space (no fiber source found) */
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
  getActiveInstanceId?: () => string | null;
}

// ============================================================================
// Overlay Element Resolver (DI for SaaS / Extension overlay rendering)
// ============================================================================

/**
 * Abstraction for finding DOM elements by nodeRef — implemented differently in SaaS and Extension.
 * SaaS: delegates to ElementTracer (FiberSourceIndex, cached node maps)
 * Extension: uses inline fiber source cache (rebuilt on React commit)
 */
export interface OverlayElementResolver {
  /**
   * Find DOM elements for a given nodeRef.
   * When itemIndex is non-null, returns at most one element (specific map item).
   * When itemIndex is null, returns all elements at that source (for .map() rendering).
   */
  findElements(nodeRef: string, itemIndex: number | null): HTMLElement[];

  /**
   * Find all empty containers (elements with a React source but no meaningful children).
   * Returns elementId (nodeRef) and the DOM element for rect computation.
   */
  findEmptyContainers(): Array<{ elementId: string; element: HTMLElement }>;
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
