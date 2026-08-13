/**
 * API service interface for AST operations.
 * Decouples operations from specific API endpoints.
 */

export interface InsertElementParams {
  parentId: string;
  filePath: string;
  componentType: string;
  props?: Record<string, unknown>;
  componentFilePath?: string;
}

export interface InsertElementResult {
  success: boolean;
  newId?: string;
  error?: string;
}

export interface DeleteElementParams {
  elementId: string;
  filePath: string;
}

export interface DeleteElementsParams {
  elementIds: string[];
  filePath: string;
}

export interface DuplicateElementParams {
  elementId: string;
  filePath: string;
}

export interface ReorderElementParams {
  /** nodeRef / id of the JSX element to move within its parent */
  elementId: string;
  filePath: string;
  /** Zero-based logical index among the parent's JSXElement children */
  targetIndex: number;
}

export interface ReorderElementResult {
  success: boolean;
  /** Pre-mutation file snapshot id (from fileSnapshotMiddleware) — used for undo */
  snapshotId?: number;
  error?: string;
}

/**
 * DOM-mode map-iteration op on a Sample-file array prop (HYP-290d, category 1).
 * Splices the array passed via `propName` to the Sample export, NOT the JSX template.
 */
export interface MapSampleArrayOpParams {
  /** Sample file path (`*.samples.tsx`); also the snapshot target for undo. */
  filePath: string;
  /** Component file containing the `.map()` — the classifier gate reads it. */
  componentFilePath: string;
  /** Sample export whose JSX passes the array prop, e.g. "SampleDefault". */
  sampleName: string;
  /** Raw `.map()` receiver source (from getSelectedMapContext); must be a bare identifier. */
  mapExpression: string;
  /** Array-element index (== rendered itemIndex for a bare map). */
  itemIndex: number;
  operation: 'delete' | 'duplicate' | 'reorder';
  /** Destination index for `reorder`. */
  targetIndex?: number;
}

export interface MapSampleArrayOpResult {
  success: boolean;
  /** Pre-mutation file snapshot id (from fileSnapshotMiddleware) — used for undo. */
  snapshotId?: number;
  error?: string;
}

export interface MapLiteralArrayOpParams {
  /**
   * Component file containing BOTH the `.map()` and the in-component `const x = [...]`
   * literal. It is the classifier gate source AND the mutation/snapshot target (category 3
   * has no separate sample file), so `fileSnapshotMiddleware` snapshots it via the
   * `componentFilePath` fallback.
   */
  componentFilePath: string;
  /** Active sample export, used only to reload the canvas after the mutation. */
  sampleName?: string;
  /** Raw `.map()` receiver source (from getSelectedMapContext); must classify as literal-array. */
  mapExpression: string;
  /** Array-element index (== rendered itemIndex for a bare map). */
  itemIndex: number;
  operation: 'delete' | 'duplicate' | 'reorder';
  /** Destination index for `reorder`. */
  targetIndex?: number;
}

export interface MapLiteralArrayOpResult {
  success: boolean;
  /** Pre-mutation file snapshot id (from fileSnapshotMiddleware) — used for undo. */
  snapshotId?: number;
  error?: string;
}

export interface DuplicateElementResult {
  success: boolean;
  newId?: string;
  parentId?: string;
  index?: number;
  error?: string;
}

export interface PasteElementParams {
  parentId: string;
  filePath: string;
  tsx: string;
  position?: string;
  index?: number;
}

export interface PasteElementResult {
  success: boolean;
  newId?: string;
  newIds?: string[];
  index?: number;
  error?: string;
}

/** Babel source loc of the element, as known to the client AST (HYP-593 server fallback). */
interface ElementSourceLoc {
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface UpdateStylesParams {
  selectedId: string;
  elementLoc?: ElementSourceLoc;
  filePath: string;
  styles: Record<string, string>;
  domClasses?: string;
  instanceProps?: Record<string, unknown>;
  instanceId?: string;
  state?: string;
  selectedSourceTabId?: string;
}

export interface UpdateStylesResult {
  success: boolean;
  className?: string;
  oldClassName?: string;
  snapshotId?: number;
  error?: string;
}

export interface UpdatePropParams {
  selectedId: string;
  filePath: string;
  propName: string;
  propValue: unknown;
}

export interface UpdatePropsBatchParams {
  selectedId: string;
  filePath: string;
  props: Record<string, unknown>;
}

export interface UpdateTextParams {
  selectedId: string;
  filePath: string;
  text: string;
}

export interface EditConditionParams {
  endpoint: string;
  idKey: string;
  boundaryId: string;
  newExpression: string;
  oldExpression: string;
  elementId: string;
  filePath: string;
}

export interface EditConditionResult {
  filePath: string;
}

export interface SaveSnapshotResult {
  success: boolean;
  snapshotId?: number;
}

export interface ApiResult {
  success: boolean;
  error?: string;
}

export interface ParseComponentResult {
  success: boolean;
  [key: string]: unknown;
}

export interface ASTApiService {
  insertElement(params: InsertElementParams): Promise<InsertElementResult>;
  deleteElement(params: DeleteElementParams): Promise<ApiResult>;
  deleteElements(params: DeleteElementsParams): Promise<ApiResult>;
  duplicateElement(params: DuplicateElementParams): Promise<DuplicateElementResult>;
  reorderElement(params: ReorderElementParams): Promise<ReorderElementResult>;
  mapSampleArrayOp(params: MapSampleArrayOpParams): Promise<MapSampleArrayOpResult>;
  mapLiteralArrayOp(params: MapLiteralArrayOpParams): Promise<MapLiteralArrayOpResult>;
  pasteElement(params: PasteElementParams): Promise<PasteElementResult>;
  updateStyles(params: UpdateStylesParams): Promise<UpdateStylesResult>;
  updateProp(params: UpdatePropParams): Promise<ApiResult>;
  updatePropsBatch(params: UpdatePropsBatchParams): Promise<ApiResult>;
  updateText(params: UpdateTextParams): Promise<ApiResult>;
  editCondition(params: EditConditionParams): Promise<EditConditionResult>;
  parseComponent(filePath: string, sampleName?: string): Promise<ParseComponentResult>;
  saveFileSnapshot(filePath: string): Promise<SaveSnapshotResult>;
  restoreFileSnapshot(snapshotId: number, filePath: string, sampleName?: string): Promise<void>;

  /** Parse component and dispatch component-loaded event */
  reloadComponent(filePath: string, sampleName?: string): Promise<void>;
}
