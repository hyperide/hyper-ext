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

export interface UpdateStylesParams {
  selectedId: string;
  filePath: string;
  styles: Record<string, string>;
  domClasses?: string;
  instanceProps?: Record<string, unknown>;
  instanceId?: string;
  state?: string;
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
