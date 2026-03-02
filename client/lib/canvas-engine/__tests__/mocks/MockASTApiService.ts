/**
 * Mock implementation of ASTApiService for testing.
 * Tracks all calls and returns configurable responses.
 */

import type {
  ApiResult,
  ASTApiService,
  DeleteElementParams,
  DeleteElementsParams,
  DuplicateElementParams,
  DuplicateElementResult,
  EditConditionParams,
  EditConditionResult,
  InsertElementParams,
  InsertElementResult,
  ParseComponentResult,
  PasteElementParams,
  PasteElementResult,
  SaveSnapshotResult,
  UpdatePropParams,
  UpdatePropsBatchParams,
  UpdateStylesParams,
  UpdateStylesResult,
  UpdateTextParams,
} from '../../services/ASTApiService';

export interface MockCall {
  method: string;
  args: unknown[];
}

export class MockASTApiService implements ASTApiService {
  calls: MockCall[] = [];

  // Configurable responses
  insertElementResult: InsertElementResult = { success: true, newId: 'new-1' };
  deleteElementResult: ApiResult = { success: true };
  deleteElementsResult: ApiResult = { success: true };
  duplicateElementResult: DuplicateElementResult = {
    success: true,
    newId: 'dup-1',
    parentId: 'parent-1',
    index: 1,
  };
  pasteElementResult: PasteElementResult = {
    success: true,
    newId: 'pasted-1',
    newIds: ['pasted-1'],
    index: 0,
  };
  updateStylesResult: UpdateStylesResult = {
    success: true,
    snapshotId: 1,
    className: 'flex p-4',
    oldClassName: 'flex',
  };
  updatePropResult: ApiResult = { success: true };
  updatePropsBatchResult: ApiResult = { success: true };
  updateTextResult: ApiResult = { success: true };
  editConditionResult: EditConditionResult = { filePath: '/test/file.tsx' };
  parseComponentResult: ParseComponentResult = { success: true };
  saveFileSnapshotResult: SaveSnapshotResult = { success: true, snapshotId: 2 };

  private snapshotCounter = 10;

  async insertElement(params: InsertElementParams): Promise<InsertElementResult> {
    this.calls.push({ method: 'insertElement', args: [params] });
    return { ...this.insertElementResult };
  }

  async deleteElement(params: DeleteElementParams): Promise<ApiResult> {
    this.calls.push({ method: 'deleteElement', args: [params] });
    return { ...this.deleteElementResult };
  }

  async deleteElements(params: DeleteElementsParams): Promise<ApiResult> {
    this.calls.push({ method: 'deleteElements', args: [params] });
    return { ...this.deleteElementsResult };
  }

  async duplicateElement(params: DuplicateElementParams): Promise<DuplicateElementResult> {
    this.calls.push({ method: 'duplicateElement', args: [params] });
    return { ...this.duplicateElementResult };
  }

  async pasteElement(params: PasteElementParams): Promise<PasteElementResult> {
    this.calls.push({ method: 'pasteElement', args: [params] });
    return { ...this.pasteElementResult };
  }

  async updateStyles(params: UpdateStylesParams): Promise<UpdateStylesResult> {
    this.calls.push({ method: 'updateStyles', args: [params] });
    return { ...this.updateStylesResult };
  }

  async updateProp(params: UpdatePropParams): Promise<ApiResult> {
    this.calls.push({ method: 'updateProp', args: [params] });
    return { ...this.updatePropResult };
  }

  async updatePropsBatch(params: UpdatePropsBatchParams): Promise<ApiResult> {
    this.calls.push({ method: 'updatePropsBatch', args: [params] });
    return { ...this.updatePropsBatchResult };
  }

  async updateText(params: UpdateTextParams): Promise<ApiResult> {
    this.calls.push({ method: 'updateText', args: [params] });
    return { ...this.updateTextResult };
  }

  async editCondition(params: EditConditionParams): Promise<EditConditionResult> {
    this.calls.push({ method: 'editCondition', args: [params] });
    return { ...this.editConditionResult };
  }

  async parseComponent(filePath: string, sampleName?: string): Promise<ParseComponentResult> {
    this.calls.push({ method: 'parseComponent', args: [filePath, sampleName] });
    return { ...this.parseComponentResult };
  }

  async saveFileSnapshot(filePath: string): Promise<SaveSnapshotResult> {
    this.calls.push({ method: 'saveFileSnapshot', args: [filePath] });
    this.snapshotCounter++;
    return { success: true, snapshotId: this.snapshotCounter };
  }

  async restoreFileSnapshot(snapshotId: number, filePath: string, sampleName?: string): Promise<void> {
    this.calls.push({ method: 'restoreFileSnapshot', args: [snapshotId, filePath, sampleName] });
  }

  async reloadComponent(filePath: string, sampleName?: string): Promise<void> {
    this.calls.push({ method: 'reloadComponent', args: [filePath, sampleName] });
  }

  // Test helpers

  reset(): void {
    this.calls = [];
    this.snapshotCounter = 10;
  }

  getCallsFor(method: string): MockCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  getCallCount(method: string): number {
    return this.getCallsFor(method).length;
  }

  getLastCall(method: string): MockCall | undefined {
    const calls = this.getCallsFor(method);
    return calls[calls.length - 1];
  }

  wasCalledWith(method: string, partialArgs: Record<string, unknown>): boolean {
    return this.getCallsFor(method).some((call) => {
      const args = call.args[0];
      if (typeof args !== 'object' || args === null) return false;
      return Object.entries(partialArgs).every(([key, value]) => (args as Record<string, unknown>)[key] === value);
    });
  }
}
