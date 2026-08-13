/**
 * @file ElementTracer — client orchestrator for fiber-based element tracing
 *
 * Accessed via: Editor components inside iframe preview
 * Assumptions: Adapter and transport are injected; adapter matches the current framework
 */

import { resolveCallSiteTarget } from '../../../shared/canvas-interaction/resolve-source';
import { clearTracingDebugOnce, tracingDebugOnce } from '../../../shared/canvas-interaction/tracing-debug';
import type { LocalResolveResult, TracingResolver } from '../../../shared/canvas-interaction/types';
import { getFiberFromDOM } from '../../../shared/element-tracing/fiber-internals';
import { toProjectRelative } from '../../../shared/element-tracing/path-normalization';
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

/**
 * Synthetic nodeRef prefix for NodePod mode (no server-side AST).
 * Format: SYNTHETIC_PREFIX + fileName + ":" + line + ":" + column + ":" + itemIndex
 * Decoded by decodeSyntheticNodeRef() to recover the source location for fiber-based DOM lookup.
 */
const SYNTHETIC_PREFIX = '__np__';

function encodeSyntheticNodeRef(source: SourceLocation, itemIndex: number): string {
  return `${SYNTHETIC_PREFIX}${source.fileName}:${source.line}:${source.column}:${itemIndex}`;
}

function decodeSyntheticNodeRef(nodeRef: string): { source: SourceLocation; itemIndex: number } | null {
  if (!nodeRef.startsWith(SYNTHETIC_PREFIX)) return null;
  const rest = nodeRef.slice(SYNTHETIC_PREFIX.length);
  // Parse from end: ":<itemIndex>", ":<column>", ":<line>", then fileName
  const i3 = rest.lastIndexOf(':');
  if (i3 === -1) return null;
  const itemIndex = Number.parseInt(rest.slice(i3 + 1), 10);
  if (Number.isNaN(itemIndex)) return null;
  const s3 = rest.slice(0, i3);
  const i2 = s3.lastIndexOf(':');
  if (i2 === -1) return null;
  const column = Number.parseInt(s3.slice(i2 + 1), 10);
  if (Number.isNaN(column)) return null;
  const s2 = s3.slice(0, i2);
  const i1 = s2.lastIndexOf(':');
  if (i1 === -1) return null;
  const line = Number.parseInt(s2.slice(i1 + 1), 10);
  if (Number.isNaN(line)) return null;
  const fileName = s2.slice(0, i1);
  return { source: { fileName, line, column }, itemIndex };
}

export class ElementTracer implements TracingResolver {
  private readonly _adapter: FrameworkAdapter;
  private readonly _transport: TracingTransport;
  private _requestCounter = 0;
  private readonly _nodeMaps = new Map<string, NodeMapEntry[]>();
  private readonly _selectionHandlers = new Set<(response: ResolveElementResponse) => void>();
  private readonly _nodeMapUpdateHandlers = new Set<(msg: NodeMapUpdate) => void>();
  private readonly _disposeTransport: () => void;
  private _projectRoot: string | undefined;
  /** Currently rendered component file path (set by useElementTracer) */
  renderedFile: string | null = null;

  constructor(adapter: FrameworkAdapter, transport: TracingTransport) {
    this._adapter = adapter;
    this._transport = transport;
    this._disposeTransport = transport.onMessage(this._handleMessage.bind(this));
  }

  /** Normalize any fiber path variant to the tracer's canonical relative form. */
  private _normalizeFileName(fileName: string): string {
    return toProjectRelative(fileName, this._projectRoot);
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
    const resolvedTarget = resolveCallSiteTarget(source, fiber, this.renderedFile, itemIndex);
    const resolvedResult = this._findInNodeMaps(resolvedTarget.source, resolvedTarget.itemIndex);
    if (resolvedResult) return resolvedResult;

    // Fallback: try direct source if resolved source didn't match
    if (resolvedTarget.source !== source) {
      const directResult = this._findInNodeMaps(source, itemIndex);
      if (directResult) return directResult;
    }

    // Silent-death point: no node-map match locally — selection now depends entirely
    // on the async server resolve-element round trip.
    console.debug('[tracing] resolveClickLocal: no node-map match — falling back to server resolve-element', {
      resolvedSource: resolvedTarget.source,
      directSource: source,
      itemIndex,
    });
    const requestId = `req-${++this._requestCounter}`;
    this._transport.send({ type: 'resolve-element', requestId, source, itemIndex });
    return null;
  }

  /** Look up a source location in cached node maps. */
  private _findInNodeMaps(source: SourceLocation, itemIndex: number): LocalResolveResult | null {
    const queryFile = this._normalizeFileName(source.fileName);

    let nodes = this._nodeMaps.get(queryFile);
    if (!nodes) {
      // Fallback: scan keys and compare on normalized form. Handles maps that
      // were sent by a server that has not migrated to relative storage yet.
      for (const [key, value] of this._nodeMaps) {
        if (this._normalizeFileName(key) === queryFile) {
          nodes = value;
          break;
        }
      }
    }
    if (!nodes) return null;

    let entry = nodes.find(
      (n) =>
        this._normalizeFileName(n.loc.fileName) === queryFile &&
        n.loc.line === source.line &&
        n.loc.column === source.column,
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

  /**
   * Build a lookup map from source key ("fileName:line:column") to node entry.
   *
   * Keys are normalized to project-relative form. Callers looking up by fiber
   * source must use {@link makeSourceKey} (or {@link resolveBySource}) so the
   * query path is normalized with the same rules.
   */
  buildSourceKeyIndex(): Map<string, { nodeRef: string; source: SourceLocation }> {
    const index = new Map<string, { nodeRef: string; source: SourceLocation }>();
    for (const entries of this._nodeMaps.values()) {
      for (const entry of entries) {
        const fileName = this._normalizeFileName(entry.loc.fileName);
        const key = `${fileName}:${entry.loc.line}:${entry.loc.column}`;
        index.set(key, { nodeRef: entry.nodeRef, source: entry.loc });
      }
    }
    return index;
  }

  /**
   * Format a fiber source into the canonical key used by {@link buildSourceKeyIndex}.
   * Lets hot-loop consumers (overlay RAF) keep O(1) Map lookups while still
   * accepting any fiber path variant.
   */
  makeSourceKey(source: SourceLocation): string {
    return `${this._normalizeFileName(source.fileName)}:${source.line}:${source.column}`;
  }

  /**
   * Resolve a fiber source location (in any path form) to its cached node
   * entry. Convenience for cold-path callers — overlay RAF code should use
   * {@link buildSourceKeyIndex} + {@link makeSourceKey} instead.
   */
  resolveBySource(source: SourceLocation): { nodeRef: string; source: SourceLocation } | null {
    const index = this.buildSourceKeyIndex();
    return index.get(this.makeSourceKey(source)) ?? null;
  }

  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null {
    return this._adapter.findDOMElement(source, itemIndex);
  }

  /** Encode a source location + itemIndex as a synthetic NodePod nodeRef (no server AST). */
  static encodeSyntheticNodeRef(source: SourceLocation, itemIndex: number): string {
    return encodeSyntheticNodeRef(source, itemIndex);
  }

  /** Look up source location for a nodeRef from cached node maps, or decode a synthetic nodeRef. */
  getSourceByNodeRef(nodeRef: string): SourceLocation | null {
    for (const entries of this._nodeMaps.values()) {
      const entry = entries.find((e) => e.nodeRef === nodeRef);
      if (entry) return entry.loc;
    }
    const decoded = decodeSyntheticNodeRef(nodeRef);
    return decoded?.source ?? null;
  }

  /** Resolve a nodeRef to a DOM element by looking up cached node maps, or decoding synthetic nodeRef. */
  findDOMElementByNodeRef(nodeRef: string): HTMLElement | null {
    for (const entries of this._nodeMaps.values()) {
      const entry = entries.find((e) => e.nodeRef === nodeRef);
      if (entry) {
        return this._adapter.findDOMElement(entry.loc, 0);
      }
    }
    const decoded = decodeSyntheticNodeRef(nodeRef);
    if (decoded) return this._adapter.findDOMElement(decoded.source, decoded.itemIndex);
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
    const elements = this._findDOMElementsInner(nodeRef, itemIndex);
    // Silent-death point: overlay/selection callers get [] and draw nothing. Once-per-key —
    // the overlay resolver calls this inside the RAF loop.
    const missKey = `findDOMElements:${nodeRef}:${itemIndex}`;
    if (elements.length === 0) {
      tracingDebugOnce(missKey, 'findDOMElements: no DOM elements for nodeRef', nodeRef, 'itemIndex', itemIndex);
    } else {
      clearTracingDebugOnce(missKey);
    }
    return elements;
  }

  private _findDOMElementsInner(nodeRef: string, itemIndex: number | null): HTMLElement[] {
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
    // Synthetic nodeRef (NodePod mode): decode source from the ID, use fiber adapter
    const decoded = decodeSyntheticNodeRef(nodeRef);
    if (decoded) {
      const effectiveIndex = itemIndex ?? decoded.itemIndex;
      const el = this._adapter.findDOMElement(decoded.source, effectiveIndex);
      return el ? [el] : [];
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
    // A reconnecting transport must be torn down too, or it keeps a ghost WS
    // client alive after iframe reloads / project switches (HYP-594).
    this._transport.dispose?.();
    this._nodeMaps.clear();
    this._selectionHandlers.clear();
    this._nodeMapUpdateHandlers.clear();
  }

  /**
   * Configure the project root used for path normalization across the tracer
   * and its adapter's fiber-source index. Normally invoked via the server's
   * `tracing-config` message; ext-side bridges can call this directly.
   */
  setProjectRoot(projectRoot: string): void {
    this._projectRoot = projectRoot;
    this._adapter.setProjectRoot?.(projectRoot);
  }

  private _handleMessage(msg: TracingServerMessage): void {
    switch (msg.type) {
      case 'tracing-config':
        this.setProjectRoot(msg.projectRoot);
        break;
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
