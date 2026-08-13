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
  /** nodeRef (fileName:line:col) used for AST mutation — only set on selection rects */
  elementId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  type: 'selection' | 'hover';
  /** Present when the selected element has an explicit Tailwind/CSS size on that axis */
  resizable?: { width: boolean; height: boolean; hasSizeClass?: boolean };
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
  /**
   * Provenance-safe variant of getSourceLocation: resolves ONLY via a real source
   * map hit or a React 18 `_debugSource`, never a raw React 19 `_debugStack` line
   * (a Vite-transformed-module position useless for AST lookup). Returns null when
   * only the raw fallback is available (e.g. cold source map). Optional — callers
   * that need cold-safe resolution (the decorative drag path) use it; others may omit.
   */
  getMappedSourceLocation?(element: HTMLElement): SourceLocation | null;
  getItemIndex(element: HTMLElement): number;
  resolveClickLocal(element: HTMLElement): LocalResolveResult | null;
  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null;
  /**
   * Warm the source-map resolution for a drop-target element whose source is cold
   * (React 19 / RSC, chunk maps not yet fetched), BEFORE resolveDragSource runs.
   * Idempotent and cheap; a no-op for resolvers that don't do source-map warming
   * (e.g. the SaaS ElementTracer, which resolves from server-pushed node maps).
   * Warming is async, so callers must warm on each drag pointermove and defer the
   * AST write to drop (pointerup), by which time the hovered leaf's map is warm —
   * otherwise resolveDragSource walks up a cold leaf to its warm container (HYP-31).
   */
  warmElementSource?(element: HTMLElement): void;
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
