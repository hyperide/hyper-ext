/**
 * @file Shared types for fiber-based element tracing system
 *
 * Accessed via: Internal module — consumed by client (ElementTracer), server (NodeMapService),
 * and VS Code extension (PostMessageTracingTransport)
 */

/* ─── Core identifiers ───────────────────────────────────────────── */

/** Source location in a JSX file. Universal element identifier. */
export interface SourceLocation {
  /** Absolute or project-relative file path */
  fileName: string;
  /** 1-based line number */
  line: number;
  /** 0-based column number (matches Babel AST and _debugSource.columnNumber) */
  column: number;
}

/**
 * Server-assigned session-scoped identifier for an AST node.
 * Format: `"<filePath>:<traversalIndex>"` — opaque string, clients must NOT parse it.
 */
export type NodeRef = string;

/* ─── Node map ───────────────────────────────────────────────────── */

export interface NodeMapEntry {
  nodeRef: NodeRef;
  tag: string;
  loc: SourceLocation;
  endLoc: SourceLocation;
  parentRef: NodeRef | null;
  children: NodeRef[];
  isComponent: boolean;
  componentName?: string;
  /** Short hex hash of (sorted prop names, children count, subtree height). */
  fingerprint: string;
}

/* ─── Protocol messages ──────────────────────────────────────────── */

/**
 * Server → Client: one-shot configuration pushed before the first node map.
 * Carries the project root the server used to normalize entry paths so the
 * client can configure its FiberSourceIndex with the same root.
 */
interface TracingConfig {
  type: 'tracing-config';
  projectRoot: string;
}

/** Server → Client: pushed after every file parse */
export interface NodeMapUpdate {
  type: 'node-map-update';
  filePath: string;
  fileHash: string;
  version: number;
  nodes: NodeMapEntry[];
  refMapping?: Record<NodeRef, NodeRef>;
  mutatedNodeRef?: NodeRef;
}

/** Server → Client: pushed when a file is deleted or renamed */
interface NodeMapInvalidate {
  type: 'node-map-invalidate';
  filePath: string;
}

/** Client → Server: resolve DOM click to nodeRef */
export interface ResolveElement {
  type: 'resolve-element';
  requestId: string;
  source: SourceLocation;
  itemIndex: number;
}

/** Server → Client: response to resolve-element */
export interface ResolveElementResponse {
  type: 'resolve-element-response';
  requestId: string;
  nodeRef: NodeRef | null;
  entry: NodeMapEntry | null;
}

export type TracingClientMessage = ResolveElement;
export type TracingServerMessage = TracingConfig | NodeMapUpdate | NodeMapInvalidate | ResolveElementResponse;

/* ─── Framework adapter ──────────────────────────────────────────── */

export interface ComponentInfo {
  name: string;
  source: SourceLocation | null;
  definitionSource?: SourceLocation;
  props: Record<string, string>;
  isLibrary: boolean;
}

export interface ComponentTreeNode {
  name: string;
  source: SourceLocation | null;
  children: ComponentTreeNode[];
  /** DOM element reference — null for non-host components.
   *  FrameworkAdapter interface uses HTMLElement; this shared type uses
   *  HTMLElement which is available via lib.dom in all three tsconfigs. */
  domElement: HTMLElement | null;
  fiberTag?: number;
}

export interface FrameworkAdapter {
  readonly name: string;
  detect(doc: Document): boolean;
  getSourceLocation(element: HTMLElement): SourceLocation | null;
  getComponentChain(element: HTMLElement): ComponentInfo[];
  getItemIndex(element: HTMLElement): number;
  walkComponentTree(rootElement: HTMLElement): ComponentTreeNode[];
  findDOMElement(source: SourceLocation, itemIndex: number): HTMLElement | null;
  /**
   * Propagate the project root to the framework's internal fiber-source index
   * so reverse lookups (entry.loc → DOM) normalize paths consistently with
   * the server's node-map keys. Optional — adapters without a source index
   * may ignore it.
   */
  setProjectRoot?(projectRoot: string): void;
}

/* ─── Transport ──────────────────────────────────────────────────── */

export interface TracingTransport {
  send(msg: TracingClientMessage): void;
  onMessage(handler: (msg: TracingServerMessage) => void): () => void;
  readonly connected: boolean;
  onConnectionChange(handler: (connected: boolean) => void): () => void;
  /** Tear down the underlying channel; reconnecting transports MUST stop reconnecting (HYP-594). */
  dispose?(): void;
}

/* ─── Sync state ─────────────────────────────────────────────────── */

export type SyncState = 'synced' | 'awaiting-both' | 'awaiting-hmr' | 'awaiting-map';
