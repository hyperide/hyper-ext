/**
 * @file ElementTracer — client orchestrator for fiber-based element tracing
 *
 * Accessed via: Editor components inside iframe preview
 * Assumptions: Adapter and transport are injected; adapter matches the current framework
 */

import { resolveCallSiteSource } from '../../../shared/canvas-interaction/resolve-source';
import type { LocalResolveResult, TracingResolver } from '../../../shared/canvas-interaction/types';
import { getFiberFromDOM } from '../../../shared/element-tracing/fiber-internals';
import type {
  ComponentTreeNode,
  FrameworkAdapter,
  NodeMapEntry,
  NodeMapUpdate,
  ResolveElementResponse,
  SourceLocation,
  TracingServerMessage,
  TracingTransport,
} from '../../../shared/element-tracing/types';

export type { LocalResolveResult };

export interface ClickResult {
  source: SourceLocation;
  itemIndex: number;
}

export class ElementTracer implements TracingResolver {
  private readonly _adapter: FrameworkAdapter;
  private readonly _transport: TracingTransport;
  private _requestCounter = 0;
  private readonly _nodeMaps = new Map<string, NodeMapEntry[]>();
  private readonly _selectionHandlers = new Set<(response: ResolveElementResponse) => void>();
  private readonly _nodeMapUpdateHandlers = new Set<(msg: NodeMapUpdate) => void>();
  private readonly _disposeTransport: () => void;
  /** Currently rendered component file path (set by useElementTracer) */
  renderedFile: string | null = null;

  constructor(adapter: FrameworkAdapter, transport: TracingTransport) {
    this._adapter = adapter;
    this._transport = transport;
    this._disposeTransport = transport.onMessage(this._handleMessage.bind(this));
  }

  resolveClick(element: HTMLElement): ClickResult | null {
    const source = this._adapter.getSourceLocation(element);
    if (source === null) return null;

    const itemIndex = this._adapter.getItemIndex(element);
    const requestId = `req-${++this._requestCounter}`;

    this._transport.send({ type: 'resolve-element', requestId, source, itemIndex });

    return { source, itemIndex };
  }

  /**
   * Try to resolve a click locally from cached node maps.
   * Returns null if no cached map matches — in that case,
   * also sends a resolve-element request to the server as fallback.
   */
  resolveClickLocal(element: HTMLElement): LocalResolveResult | null {
    const source = this._adapter.getSourceLocation(element);
    if (source === null) return null;

    const itemIndex = this._adapter.getItemIndex(element);

    // Resolve to call site for imported component internals (shared logic)
    const fiber = getFiberFromDOM(element);
    const resolvedSource = resolveCallSiteSource(source, fiber, this.renderedFile);
    const resolvedResult = this._findInNodeMaps(resolvedSource, itemIndex);
    if (resolvedResult) return resolvedResult;

    // Fallback: try direct source if resolved source didn't match
    if (resolvedSource !== source) {
      const directResult = this._findInNodeMaps(source, itemIndex);
      if (directResult) return directResult;
    }

    const requestId = `req-${++this._requestCounter}`;
    this._transport.send({ type: 'resolve-element', requestId, source, itemIndex });
    return null;
  }

  /** Look up a source location in cached node maps. */
  private _findInNodeMaps(source: SourceLocation, itemIndex: number): LocalResolveResult | null {
    const nodes = this._nodeMaps.get(source.fileName);
    if (!nodes) return null;

    // Exact line + column match
    let entry = nodes.find(
      (n) => n.loc.fileName === source.fileName && n.loc.line === source.line && n.loc.column === source.column,
    );

    // Fuzzy: Vite Babel plugin _debugSource column can differ from Babel AST loc.start.column.
    // Fall back to closest element on the same line.
    if (!entry) {
      const sameLine = nodes.filter((n) => n.loc.line === source.line);
      if (sameLine.length === 1) {
        entry = sameLine[0];
      } else if (sameLine.length > 1) {
        entry = sameLine.reduce((closest, n) =>
          Math.abs(n.loc.column - source.column) < Math.abs(closest.loc.column - source.column) ? n : closest,
        );
      }
    }

    if (!entry) return null;
    return { nodeRef: entry.nodeRef, entry, source, itemIndex };
  }

  onSelectionResolved(handler: (response: ResolveElementResponse) => void): () => void {
    this._selectionHandlers.add(handler);
    return () => {
      this._selectionHandlers.delete(handler);
    };
  }

  getNodeMap(filePath: string): NodeMapEntry[] | null {
    return this._nodeMaps.get(filePath) ?? null;
  }

  /** Build a lookup map from source key ("fileName:line:column") to node entry for all cached maps. */
  buildSourceKeyIndex(): Map<string, { nodeRef: string; source: SourceLocation }> {
    const index = new Map<string, { nodeRef: string; source: SourceLocation }>();
    for (const entries of this._nodeMaps.values()) {
      for (const entry of entries) {
        const key = `${entry.loc.fileName}:${entry.loc.line}:${entry.loc.column}`;
        index.set(key, { nodeRef: entry.nodeRef, source: entry.loc });
      }
    }
    return index;
  }

  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null {
    return this._adapter.findDOMElement(source, itemIndex);
  }

  /** Look up source location for a nodeRef from cached node maps. */
  getSourceByNodeRef(nodeRef: string): SourceLocation | null {
    for (const entries of this._nodeMaps.values()) {
      const entry = entries.find((e) => e.nodeRef === nodeRef);
      if (entry) return entry.loc;
    }
    return null;
  }

  /** Resolve a nodeRef to a DOM element by looking up all cached node maps. */
  findDOMElementByNodeRef(nodeRef: string): HTMLElement | null {
    for (const entries of this._nodeMaps.values()) {
      const entry = entries.find((e) => e.nodeRef === nodeRef);
      if (entry) {
        return this._adapter.findDOMElement(entry.loc, 0);
      }
    }
    return null;
  }

  /** Delegate to adapter.getSourceLocation — public for shared/ code that can't import adapter. */
  getSourceLocation(element: HTMLElement): SourceLocation | null {
    return this._adapter.getSourceLocation(element);
  }

  /** Delegate to adapter.getItemIndex — public for shared/ code that can't import adapter. */
  getItemIndex(element: HTMLElement): number {
    return this._adapter.getItemIndex(element);
  }

  /**
   * Find DOM elements for a nodeRef with itemIndex support.
   * When itemIndex is non-null, returns at most one element (specific .map() item).
   * When null, returns all elements rendered at that source location.
   */
  findDOMElements(nodeRef: string, itemIndex: number | null): HTMLElement[] {
    for (const entries of this._nodeMaps.values()) {
      const entry = entries.find((e) => e.nodeRef === nodeRef);
      if (entry) {
        if (itemIndex !== null) {
          const el = this._adapter.findDOMElement(entry.loc, itemIndex);
          return el ? [el] : [];
        }
        // Collect all elements at this source (for .map() rendering)
        const elements: HTMLElement[] = [];
        for (let i = 0; i < 1000; i++) {
          const el = this._adapter.findDOMElement(entry.loc, i);
          if (!el) break;
          elements.push(el);
        }
        return elements;
      }
    }
    return [];
  }

  /** Delegate to adapter.walkComponentTree — public for overlay empty container detection. */
  walkComponentTree(rootElement: HTMLElement): ComponentTreeNode[] {
    return this._adapter.walkComponentTree(rootElement);
  }

  /** Subscribe to node-map-update messages (for selection remapping on refMapping). */
  onNodeMapUpdate(handler: (msg: NodeMapUpdate) => void): () => void {
    this._nodeMapUpdateHandlers.add(handler);
    return () => {
      this._nodeMapUpdateHandlers.delete(handler);
    };
  }

  dispose(): void {
    this._disposeTransport();
    this._nodeMaps.clear();
    this._selectionHandlers.clear();
    this._nodeMapUpdateHandlers.clear();
  }

  private _handleMessage(msg: TracingServerMessage): void {
    switch (msg.type) {
      case 'node-map-update':
        this._nodeMaps.set(msg.filePath, msg.nodes);
        for (const handler of this._nodeMapUpdateHandlers) handler(msg);
        break;
      case 'node-map-invalidate':
        this._nodeMaps.delete(msg.filePath);
        break;
      case 'resolve-element-response':
        for (const handler of this._selectionHandlers) handler(msg);
        break;
    }
  }
}
