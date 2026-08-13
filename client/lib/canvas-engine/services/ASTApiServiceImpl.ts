/**
 * Default implementation of ASTApiService using authFetch.
 */

import { authFetch } from '@/utils/authFetch';
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
  MapLiteralArrayOpParams,
  MapLiteralArrayOpResult,
  MapSampleArrayOpParams,
  MapSampleArrayOpResult,
  ParseComponentResult,
  PasteElementParams,
  PasteElementResult,
  ReorderElementParams,
  ReorderElementResult,
  SaveSnapshotResult,
  UpdatePropParams,
  UpdatePropsBatchParams,
  UpdateStylesBatchParams,
  UpdateStylesBatchResult,
  UpdateStylesParams,
  UpdateStylesResult,
  UpdateTextParams,
} from './ASTApiService';

export class ASTApiServiceImpl implements ASTApiService {
  async insertElement(params: InsertElementParams): Promise<InsertElementResult> {
    const response = await authFetch('/api/insert-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async deleteElement(params: DeleteElementParams): Promise<ApiResult> {
    const response = await authFetch('/api/delete-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async deleteElements(params: DeleteElementsParams): Promise<ApiResult> {
    const response = await authFetch('/api/delete-elements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeRefs: params.elementIds,
        filePath: params.filePath,
      }),
    });
    return response.json();
  }

  async duplicateElement(params: DuplicateElementParams): Promise<DuplicateElementResult> {
    const response = await authFetch('/api/duplicate-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async pasteElement(params: PasteElementParams): Promise<PasteElementResult> {
    const response = await authFetch('/api/paste-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async reorderElement(params: ReorderElementParams): Promise<ReorderElementResult> {
    const response = await authFetch('/api/reorder-element', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeRef: params.elementId,
        filePath: params.filePath,
        targetIndex: params.targetIndex,
      }),
    });
    return response.json();
  }

  async mapSampleArrayOp(params: MapSampleArrayOpParams): Promise<MapSampleArrayOpResult> {
    const response = await authFetch('/api/map-sample-array-op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async mapLiteralArrayOp(params: MapLiteralArrayOpParams): Promise<MapLiteralArrayOpResult> {
    const response = await authFetch('/api/map-literal-array-op', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async updateStyles(params: UpdateStylesParams): Promise<UpdateStylesResult> {
    const response = await authFetch('/api/update-component-styles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async updateStylesBatch(params: UpdateStylesBatchParams): Promise<UpdateStylesBatchResult> {
    // Prefer the per-element updates (nodeRef + elementLoc) when the caller resolved them client-side
    // (HYP-593 parity); otherwise fall back to bare nodeRefs from elementIds. The route dedupes
    // same-source instances itself (D2 §5.4), so no client-side collapse is needed here.
    const updates = params.elementUpdates
      ? params.elementUpdates.map((u) => ({ nodeRef: u.nodeRef, elementLoc: u.elementLoc, domClasses: u.domClasses }))
      : params.elementIds.map((nodeRef) => ({ nodeRef }));
    const response = await authFetch('/api/update-component-styles-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: params.filePath,
        styles: params.styles,
        state: params.state,
        selectedSourceTabId: params.selectedSourceTabId,
        projectDefaultCssSystem: params.projectDefaultCssSystem,
        updates,
      }),
    });
    return response.json();
  }

  async updateProp(params: UpdatePropParams): Promise<ApiResult> {
    const response = await authFetch('/api/update-component-props', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return response.json();
  }

  async updatePropsBatch(params: UpdatePropsBatchParams): Promise<ApiResult> {
    const response = await authFetch('/api/update-component-props-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error || 'Failed to update props' };
    }
    return { success: true };
  }

  async updateText(params: UpdateTextParams): Promise<ApiResult> {
    const response = await authFetch('/api/update-element-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedId: params.selectedId,
        filePath: params.filePath,
        newText: params.text,
      }),
    });
    return response.json();
  }

  async editCondition(params: EditConditionParams): Promise<EditConditionResult> {
    const response = await authFetch(params.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        [params.idKey]: params.boundaryId,
        newExpression: params.newExpression,
        elementId: params.elementId,
        oldExpression: params.oldExpression,
        filePath: params.filePath,
      }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to edit expression');
    }
    return response.json();
  }

  async parseComponent(filePath: string, sampleName?: string): Promise<ParseComponentResult> {
    let url = `/api/parse-component?path=${encodeURIComponent(filePath)}&skipSampleDefault=true`;
    if (sampleName) {
      url += `&sampleName=${encodeURIComponent(sampleName)}`;
    }
    const response = await authFetch(url);
    return response.json();
  }

  async saveFileSnapshot(filePath: string): Promise<SaveSnapshotResult> {
    const response = await authFetch('/api/file-snapshot/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath }),
    });
    return response.json();
  }

  async restoreFileSnapshot(snapshotId: number, filePath: string, sampleName?: string): Promise<void> {
    const response = await authFetch('/api/file-snapshot/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId }),
    });
    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to restore file snapshot');
    }

    await this.reloadComponent(filePath, sampleName);
  }

  async reloadComponent(filePath: string, sampleName?: string): Promise<void> {
    const parseResult = await this.parseComponent(filePath, sampleName);
    if (parseResult.success) {
      window.dispatchEvent(new CustomEvent('component-loaded', { detail: parseResult }));
    }
  }
}
