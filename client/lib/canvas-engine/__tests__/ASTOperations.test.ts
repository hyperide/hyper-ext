/**
 * AST Operations unit tests
 *
 * Tests all 9 AST operations using MockASTApiService.
 * Each test creates an operation, calls execute/undo/redo, and verifies API calls.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { ASTBatchDeleteOperation } from '../operations/ASTBatchDeleteOperation';
import { ASTDeleteOperation } from '../operations/ASTDeleteOperation';
import { ASTDuplicateOperation } from '../operations/ASTDuplicateOperation';
import { ASTEditConditionOperation } from '../operations/ASTEditConditionOperation';
import { ASTInsertOperation } from '../operations/ASTInsertOperation';
import { ASTPasteOperation } from '../operations/ASTPasteOperation';
import { ASTStyleOperation } from '../operations/ASTStyleOperation';
import { BatchOperation } from '../operations/BatchOperation';
import { MockASTApiService } from './mocks/MockASTApiService';

// Mutable iframe mock — tests configure this before running
let mockIframeElement: Record<string, unknown> | null = null;

mock.module('@/lib/dom-utils', () => ({
  getPreviewIframe: () => {
    if (!mockIframeElement) return null;
    return {
      contentDocument: {
        querySelector: () => mockIframeElement,
        getElementById: () => mockIframeElement,
      },
    };
  },
  getElementFromIframe: () => mockIframeElement as unknown as HTMLElement | null,
  getDOMClassesFromIframe: () => '',
  getComputedStylesFromIframe: () => null,
}));

// Import after mocking
const { ASTUpdateOperation } = await import('../operations/ASTUpdateOperation');
const { ASTUpdatePropsOperation } = await import('../operations/ASTUpdatePropsOperation');

/** Create a fake DOM element with mutable state */
function createFakeElement(initial: Record<string, string> = {}): Record<string, unknown> {
  const attrs = new Map<string, string>(Object.entries(initial));
  return {
    className: initial.className ?? '',
    textContent: initial.textContent ?? '',
    style: { ...(initial.style ? {} : {}) },
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attrs.set(name, value);
    },
    removeAttribute: (name: string) => {
      attrs.delete(name);
    },
  };
}

describe('AST Operations', () => {
  let api: MockASTApiService;
  let tree: DocumentTree;

  beforeEach(() => {
    api = new MockASTApiService();
    tree = new DocumentTree();
    mockIframeElement = null;
  });

  describe('ASTInsertOperation', () => {
    const params = {
      parentId: 'parent-1',
      filePath: '/test/component.tsx',
      componentType: 'Button',
      props: { text: 'Click me' },
    };

    it('should call insertElement on execute', async () => {
      const op = new ASTInsertOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      // Wait for async API call to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('insertElement')).toBe(1);
      const call = api.getLastCall('insertElement');
      expect((call?.args[0] as Record<string, unknown>).parentId).toBe('parent-1');
      expect((call?.args[0] as Record<string, unknown>).componentType).toBe('Button');
    });

    it('should store insertedId from response', async () => {
      api.insertElementResult = { success: true, newId: 'elem-42' };
      const op = new ASTInsertOperation(api, params);
      op.execute(tree);

      // Wait for async
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(op.getInsertedId()).toBe('elem-42');
    });

    it('should call reloadComponent after insert', async () => {
      const op = new ASTInsertOperation(api, params);
      op.execute(tree);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('reloadComponent')).toBe(1);
      expect(api.getLastCall('reloadComponent')?.args[0]).toBe('/test/component.tsx');
    });

    it('should call deleteElement on undo', async () => {
      api.insertElementResult = { success: true, newId: 'elem-42' };
      const op = new ASTInsertOperation(api, params);
      op.execute(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElement')).toBe(1);
      expect(api.wasCalledWith('deleteElement', { elementId: 'elem-42' })).toBe(true);
    });

    it('should return error on undo without insertedId', () => {
      const op = new ASTInsertOperation(api, params);
      // Don't execute, so no insertedId
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });
  });

  describe('ASTDeleteOperation', () => {
    const params = {
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
    };

    function setupTreeWithAST(): void {
      const root = tree.getRoot();
      root.metadata = {
        ...root.metadata,
        astStructure: [
          {
            id: 'elem-1',
            type: 'Button',
            props: { text: 'Click me' },
            children: [],
          },
        ],
      };
    }

    it('should call deleteElement on execute', async () => {
      setupTreeWithAST();
      const op = new ASTDeleteOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);
      expect(result.changedIds).toContain('elem-1');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElement')).toBe(1);
      expect(api.wasCalledWith('deleteElement', { elementId: 'elem-1' })).toBe(true);
    });

    it('should store element structure for undo', async () => {
      setupTreeWithAST();
      const op = new ASTDeleteOperation(api, params);
      op.execute(tree);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Undo should call insertElement to restore
      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('insertElement')).toBe(1);
      const insertCall = api.getLastCall('insertElement');
      expect((insertCall?.args[0] as Record<string, unknown>).componentType).toBe('Button');
    });

    it('should return error on undo without stored element', () => {
      const op = new ASTDeleteOperation(api, params);
      // Don't execute, so no stored element
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should re-delete on redo', async () => {
      setupTreeWithAST();
      const op = new ASTDeleteOperation(api, params);
      op.execute(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      api.reset();
      const redoResult = op.redo(tree);
      expect(redoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElement')).toBe(1);
    });
  });

  describe('ASTBatchDeleteOperation', () => {
    const params = {
      elementIds: ['elem-1', 'elem-2'],
      filePath: '/test/component.tsx',
    };

    function setupTreeWithMultipleAST(): void {
      const root = tree.getRoot();
      root.metadata = {
        ...root.metadata,
        astStructure: [
          {
            id: 'elem-1',
            type: 'Button',
            props: { text: 'Btn 1' },
            children: [],
          },
          {
            id: 'elem-2',
            type: 'Input',
            props: { placeholder: 'Type...' },
            children: [],
          },
        ],
      };
    }

    it('should call deleteElements on execute', async () => {
      setupTreeWithMultipleAST();
      const op = new ASTBatchDeleteOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);
      expect(result.changedIds).toEqual(['elem-1', 'elem-2']);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElements')).toBe(1);
      const call = api.getLastCall('deleteElements');
      expect((call?.args[0] as Record<string, unknown>).elementIds).toEqual(['elem-1', 'elem-2']);
    });

    it('should restore all elements on undo', async () => {
      setupTreeWithMultipleAST();
      const op = new ASTBatchDeleteOperation(api, params);
      op.execute(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should call insertElement for each deleted element
      expect(api.getCallCount('insertElement')).toBe(2);
    });

    it('should return error on undo without stored elements', () => {
      const op = new ASTBatchDeleteOperation(api, params);
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should re-delete on redo', async () => {
      setupTreeWithMultipleAST();
      const op = new ASTBatchDeleteOperation(api, params);
      op.execute(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      api.reset();
      const redoResult = op.redo(tree);
      expect(redoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElements')).toBe(1);
    });
  });

  describe('ASTDuplicateOperation', () => {
    const params = {
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
    };

    function setupTreeForDuplicate(): void {
      const root = tree.getRoot();
      root.metadata = {
        ...root.metadata,
        astStructure: [
          {
            id: 'elem-1',
            type: 'Button',
            props: { text: 'Original' },
            children: [],
          },
        ],
      };
    }

    it('should call duplicateElement on execute', async () => {
      setupTreeForDuplicate();
      const op = new ASTDuplicateOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('duplicateElement')).toBe(1);
      expect(api.wasCalledWith('duplicateElement', { elementId: 'elem-1' })).toBe(true);
    });

    it('should store newElementId from response', async () => {
      api.duplicateElementResult = {
        success: true,
        newId: 'dup-99',
        parentId: 'parent-1',
        index: 1,
      };
      setupTreeForDuplicate();
      const op = new ASTDuplicateOperation(api, params);
      op.execute(tree);

      const newId = await op.waitForCompletion();
      expect(newId).toBe('dup-99');
      expect(op.getNewElementId()).toBe('dup-99');
    });

    it('should delete duplicate on undo', async () => {
      api.duplicateElementResult = { success: true, newId: 'dup-99', parentId: 'p-1', index: 1 };
      setupTreeForDuplicate();
      const op = new ASTDuplicateOperation(api, params);
      op.execute(tree);
      await op.waitForCompletion();

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('deleteElement')).toBe(1);
      expect(api.wasCalledWith('deleteElement', { elementId: 'dup-99' })).toBe(true);
    });

    it('should return error on undo without newElementId', () => {
      const op = new ASTDuplicateOperation(api, params);
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should re-insert on redo using insertElement', async () => {
      api.duplicateElementResult = { success: true, newId: 'dup-99', parentId: 'p-1', index: 1 };
      setupTreeForDuplicate();
      const op = new ASTDuplicateOperation(api, params);
      op.execute(tree);
      await op.waitForCompletion();

      api.reset();
      const redoResult = op.redo(tree);
      expect(redoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Redo uses insertElement (not duplicateElement) to place at exact position
      expect(api.getCallCount('insertElement')).toBe(1);
    });
  });

  describe('ASTPasteOperation', () => {
    const params = {
      parentId: 'parent-1',
      filePath: '/test/component.tsx',
      tsxCode: '<Button>Click me</Button>',
    };

    it('should call pasteElement on execute', async () => {
      const op = new ASTPasteOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('pasteElement')).toBe(1);
      const call = api.getLastCall('pasteElement');
      expect((call?.args[0] as Record<string, unknown>).tsx).toBe('<Button>Click me</Button>');
    });

    it('should store newElementId from response', async () => {
      api.pasteElementResult = {
        success: true,
        newId: 'pasted-42',
        newIds: ['pasted-42'],
        index: 0,
      };
      const op = new ASTPasteOperation(api, params);
      op.execute(tree);

      const newId = await op.waitForCompletion();
      expect(newId).toBe('pasted-42');
      expect(op.getNewElementId()).toBe('pasted-42');
    });

    it('should delete pasted elements on undo', async () => {
      api.pasteElementResult = {
        success: true,
        newId: 'pasted-1',
        newIds: ['pasted-1', 'pasted-2'],
        index: 0,
      };
      const op = new ASTPasteOperation(api, params);
      op.execute(tree);
      await op.waitForCompletion();

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should batch-delete all pasted elements
      expect(api.getCallCount('deleteElements')).toBe(1);
      const deleteCall = api.getLastCall('deleteElements');
      expect((deleteCall?.args[0] as Record<string, unknown>).elementIds).toEqual(['pasted-1', 'pasted-2']);
    });

    it('should return error on undo without newElementIds', () => {
      const op = new ASTPasteOperation(api, params);
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should re-paste on redo', async () => {
      const op = new ASTPasteOperation(api, params);
      op.execute(tree);
      await op.waitForCompletion();

      api.reset();
      const redoResult = op.redo(tree);
      expect(redoResult.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Redo calls syncPaste again with preserved TSX code
      expect(api.getCallCount('pasteElement')).toBe(1);
    });
  });

  describe('ASTStyleOperation', () => {
    const params = {
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
      styles: { padding: '16px', display: 'flex' },
    };

    it('should call updateStyles on execute', async () => {
      const op = new ASTStyleOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      // Wait for _pendingPromise
      await op._pendingPromise;

      expect(api.getCallCount('updateStyles')).toBe(1);
      expect(api.wasCalledWith('updateStyles', { selectedId: 'elem-1' })).toBe(true);
    });

    it('should store undoSnapshotId and redoSnapshotId', async () => {
      api.updateStylesResult = {
        success: true,
        snapshotId: 42,
        className: 'flex p-4',
      };
      const op = new ASTStyleOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      // After execute: updateStyles (returns snapshotId=42 for undo)
      // then saveFileSnapshot (returns snapshotId for redo)
      expect(api.getCallCount('saveFileSnapshot')).toBe(1);
    });

    it('should restore snapshot on undo', async () => {
      api.updateStylesResult = { success: true, snapshotId: 42 };
      const op = new ASTStyleOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await op._pendingPromise;

      expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
      const call = api.getLastCall('restoreFileSnapshot');
      expect(call?.args[0]).toBe(42); // undoSnapshotId
    });

    it('should return error on undo without snapshotId', () => {
      const op = new ASTStyleOperation(api, params);
      // Don't execute
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should restore redo snapshot on redo', async () => {
      api.updateStylesResult = { success: true, snapshotId: 42 };
      const op = new ASTStyleOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      // Get the redoSnapshotId that was saved
      const saveCall = api.getLastCall('saveFileSnapshot');
      expect(saveCall).toBeDefined();

      api.reset();
      const redoResult = op.redo(tree);
      expect(redoResult.success).toBe(true);

      await op._pendingPromise;

      expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    });
  });

  describe('ASTUpdateOperation', () => {
    const params = {
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
      propName: 'text',
      propValue: 'New text',
    };

    it('should call updateText for text prop on execute', async () => {
      mockIframeElement = createFakeElement({ textContent: 'Old text' });
      const op = new ASTUpdateOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('updateText')).toBe(1);
      expect(
        api.wasCalledWith('updateText', {
          selectedId: 'elem-1',
          text: 'New text',
        }),
      ).toBe(true);
    });

    it('should call updateProp for non-text prop', async () => {
      mockIframeElement = createFakeElement({ className: 'old-class' });
      const op = new ASTUpdateOperation(api, {
        ...params,
        propName: 'className',
        propValue: 'flex items-center',
      });
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('updateProp')).toBe(1);
      expect(
        api.wasCalledWith('updateProp', {
          selectedId: 'elem-1',
          propName: 'className',
          propValue: 'flex items-center',
        }),
      ).toBe(true);
    });

    it('should capture oldValue from DOM on execute', () => {
      mockIframeElement = createFakeElement({ textContent: 'Original text' });
      const op = new ASTUpdateOperation(api, params);
      op.execute(tree);

      // After execute, DOM should have new value
      expect(mockIframeElement?.textContent).toBe('New text');
    });

    it('should apply className to DOM on execute', () => {
      mockIframeElement = createFakeElement({ className: 'old-class' });
      const op = new ASTUpdateOperation(api, {
        ...params,
        propName: 'className',
        propValue: 'new-class',
      });
      op.execute(tree);

      expect(mockIframeElement?.className).toBe('new-class');
    });

    it('should restore old textContent on undo', async () => {
      mockIframeElement = createFakeElement({ textContent: 'Original' });
      const op = new ASTUpdateOperation(api, params);
      op.execute(tree);

      expect(mockIframeElement?.textContent).toBe('New text');

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);
      expect(mockIframeElement?.textContent).toBe('Original');

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Undo should sync old value to file
      expect(api.getCallCount('updateText')).toBe(1);
      expect(
        api.wasCalledWith('updateText', {
          selectedId: 'elem-1',
          text: 'Original',
        }),
      ).toBe(true);
    });

    it('should restore old className on undo', async () => {
      mockIframeElement = createFakeElement({ className: 'flex p-2' });
      const op = new ASTUpdateOperation(api, {
        ...params,
        propName: 'className',
        propValue: 'grid gap-4',
      });
      op.execute(tree);

      expect(mockIframeElement?.className).toBe('grid gap-4');

      api.reset();
      op.undo(tree);
      expect(mockIframeElement?.className).toBe('flex p-2');

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('updateProp')).toBe(1);
      expect(
        api.wasCalledWith('updateProp', {
          propName: 'className',
          propValue: 'flex p-2',
        }),
      ).toBe(true);
    });

    it('should set/remove arbitrary attributes via setAttribute', () => {
      mockIframeElement = createFakeElement();
      (mockIframeElement as Record<string, unknown>)['data-testid'] = undefined;

      const op = new ASTUpdateOperation(api, {
        ...params,
        propName: 'data-testid',
        propValue: 'my-button',
      });
      op.execute(tree);

      // setAttribute should have been called on the fake element
      const getAttr = mockIframeElement?.getAttribute as (name: string) => string | null;
      expect(getAttr('data-testid')).toBe('my-button');
    });

    it('should return error on undo without iframe (no oldValue)', () => {
      // No mockIframeElement — getPreviewIframe returns null
      const op = new ASTUpdateOperation(api, params);
      op.execute(tree);

      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should reload component after syncing to file', async () => {
      mockIframeElement = createFakeElement({ textContent: 'Old' });
      const op = new ASTUpdateOperation(api, params);
      op.execute(tree);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('reloadComponent')).toBe(1);
    });

    it('should expose elementId and propName', () => {
      const op = new ASTUpdateOperation(api, params);
      expect(op.getElementId()).toBe('elem-1');
      expect(op.getPropName()).toBe('text');
    });
  });

  describe('ASTUpdatePropsOperation', () => {
    const params = {
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
      props: { className: 'flex', 'aria-label': 'test' },
    };

    it('should return error when iframe is not available', () => {
      // applyPropToDOM throws when element can't be found (no iframe)
      const op = new ASTUpdatePropsOperation(api, params);
      const result = op.execute(tree);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Element "elem-1" not found in iframe');
    });

    it('should call updatePropsBatch on execute', async () => {
      mockIframeElement = createFakeElement({ className: 'old-class' });
      const op = new ASTUpdatePropsOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('updatePropsBatch')).toBe(1);
      expect(
        api.wasCalledWith('updatePropsBatch', {
          selectedId: 'elem-1',
        }),
      ).toBe(true);
    });

    it('should apply multiple props to DOM on execute', () => {
      mockIframeElement = createFakeElement({ className: 'old-class' });
      const op = new ASTUpdatePropsOperation(api, params);
      op.execute(tree);

      // className should be updated
      expect(mockIframeElement?.className).toBe('flex');

      // aria-label should be set via setAttribute
      const getAttr = mockIframeElement?.getAttribute as (name: string) => string | null;
      expect(getAttr('aria-label')).toBe('test');
    });

    it('should capture old values from DOM for undo', () => {
      mockIframeElement = createFakeElement({ className: 'original-class' });
      const op = new ASTUpdatePropsOperation(api, params);
      op.execute(tree);

      // className changed
      expect(mockIframeElement?.className).toBe('flex');

      // Undo should restore
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);
      expect(mockIframeElement?.className).toBe('original-class');
    });

    it('should sync old values to file on undo', async () => {
      mockIframeElement = createFakeElement({ className: 'original' });
      const op = new ASTUpdatePropsOperation(api, params);
      op.execute(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      api.reset();
      op.undo(tree);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(api.getCallCount('updatePropsBatch')).toBe(1);
      const call = api.getLastCall('updatePropsBatch');
      const syncedProps = (call?.args[0] as Record<string, unknown>).props as Record<string, unknown>;
      expect(syncedProps.className).toBe('original');
    });

    it('should return error on undo without old values', () => {
      const op = new ASTUpdatePropsOperation(api, params);
      // No execute, no old values
      const result = op.undo(tree);
      expect(result.success).toBe(false);
    });

    it('should expose elementId', () => {
      const op = new ASTUpdatePropsOperation(api, params);
      expect(op.getElementId()).toBe('elem-1');
    });
  });

  describe('ASTEditConditionOperation', () => {
    const params = {
      type: 'condition' as const,
      boundaryId: 'cond-1',
      elementId: 'elem-1',
      filePath: '/test/component.tsx',
      oldExpression: 'isVisible',
      newExpression: 'isVisible && isActive',
    };

    it('should call editCondition with new expression on execute', async () => {
      const op = new ASTEditConditionOperation(api, params);
      const result = op.execute(tree);

      expect(result.success).toBe(true);

      await op._pendingPromise;

      expect(api.getCallCount('editCondition')).toBe(1);
      const call = api.getLastCall('editCondition');
      expect((call?.args[0] as Record<string, unknown>).newExpression).toBe('isVisible && isActive');
      expect((call?.args[0] as Record<string, unknown>).oldExpression).toBe('isVisible');
    });

    it('should call editCondition with old expression on undo', async () => {
      const op = new ASTEditConditionOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      api.reset();
      const undoResult = op.undo(tree);
      expect(undoResult.success).toBe(true);

      await op._pendingPromise;

      expect(api.getCallCount('editCondition')).toBe(1);
      const call = api.getLastCall('editCondition');
      // On undo: old becomes new, new becomes old (swapped)
      expect((call?.args[0] as Record<string, unknown>).newExpression).toBe('isVisible');
      expect((call?.args[0] as Record<string, unknown>).oldExpression).toBe('isVisible && isActive');
    });

    it('should use correct endpoint for condition type', async () => {
      const op = new ASTEditConditionOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      const call = api.getLastCall('editCondition');
      expect((call?.args[0] as Record<string, unknown>).endpoint).toBe('/api/edit-condition');
      expect((call?.args[0] as Record<string, unknown>).idKey).toBe('condId');
    });

    it('should use correct endpoint for map type', async () => {
      const op = new ASTEditConditionOperation(api, {
        ...params,
        type: 'map',
      });
      op.execute(tree);
      await op._pendingPromise;

      const call = api.getLastCall('editCondition');
      expect((call?.args[0] as Record<string, unknown>).endpoint).toBe('/api/edit-map');
      expect((call?.args[0] as Record<string, unknown>).idKey).toBe('parentMapId');
    });

    it('should reload component after execute and undo', async () => {
      const op = new ASTEditConditionOperation(api, params);
      op.execute(tree);
      await op._pendingPromise;

      expect(api.getCallCount('reloadComponent')).toBe(1);

      op.undo(tree);
      await op._pendingPromise;

      expect(api.getCallCount('reloadComponent')).toBe(2);
    });
  });

  describe('BatchOperation', () => {
    it('should execute all operations in order', () => {
      const order: string[] = [];

      const makeOp = (name: string) => ({
        name,
        execute: () => {
          order.push(name);
          return { success: true, changedIds: [name] };
        },
        undo: () => ({ success: true, changedIds: [name] }),
        redo: () => ({ success: true, changedIds: [name] }),
        canUndo: () => true,
      });

      const batch = new BatchOperation([makeOp('op-1'), makeOp('op-2'), makeOp('op-3')]);
      const result = batch.execute(tree);

      expect(result.success).toBe(true);
      expect(order).toEqual(['op-1', 'op-2', 'op-3']);
      expect(result.changedIds).toEqual(['op-1', 'op-2', 'op-3']);
    });

    it('should undo all operations in reverse order', () => {
      const undoOrder: string[] = [];

      const makeOp = (name: string) => ({
        name,
        execute: () => ({ success: true }),
        undo: () => {
          undoOrder.push(name);
          return { success: true, changedIds: [name] };
        },
        redo: () => ({ success: true }),
        canUndo: () => true,
      });

      const batch = new BatchOperation([makeOp('op-1'), makeOp('op-2'), makeOp('op-3')]);
      batch.execute(tree);
      const result = batch.undo(tree);

      expect(result.success).toBe(true);
      expect(undoOrder).toEqual(['op-3', 'op-2', 'op-1']);
    });

    it('should stop execution on first failure', () => {
      const order: string[] = [];

      const makeOp = (name: string, fail = false) => ({
        name,
        execute: () => {
          order.push(name);
          return fail ? { success: false, error: 'fail' } : { success: true };
        },
        undo: () => ({ success: true }),
        redo: () => ({ success: true }),
        canUndo: () => true,
      });

      const batch = new BatchOperation([makeOp('op-1'), makeOp('op-2', true), makeOp('op-3')]);
      const result = batch.execute(tree);

      expect(result.success).toBe(false);
      expect(order).toEqual(['op-1', 'op-2']);
      // op-3 should not have been called
    });

    it('should skip non-undoable operations during undo', () => {
      const undoOrder: string[] = [];

      const ops = [
        {
          name: 'undoable-1',
          execute: () => ({ success: true }),
          undo: () => {
            undoOrder.push('undoable-1');
            return { success: true };
          },
          redo: () => ({ success: true }),
          canUndo: () => true,
        },
        {
          name: 'non-undoable',
          execute: () => ({ success: true }),
          undo: () => ({ success: true }),
          redo: () => ({ success: true }),
          canUndo: () => false,
        },
        {
          name: 'undoable-2',
          execute: () => ({ success: true }),
          undo: () => {
            undoOrder.push('undoable-2');
            return { success: true };
          },
          redo: () => ({ success: true }),
          canUndo: () => true,
        },
      ];

      const batch = new BatchOperation(ops);
      batch.execute(tree);
      batch.undo(tree);

      expect(undoOrder).toEqual(['undoable-2', 'undoable-1']);
    });

    it('should report canUndo based on all operations', () => {
      const allUndoable = new BatchOperation([
        {
          name: 'op',
          execute: () => ({ success: true }),
          undo: () => ({ success: true }),
          redo: () => ({ success: true }),
          canUndo: () => true,
        },
      ]);
      expect(allUndoable.canUndo()).toBe(true);

      const hasNonUndoable = new BatchOperation([
        {
          name: 'op',
          execute: () => ({ success: true }),
          undo: () => ({ success: true }),
          redo: () => ({ success: true }),
          canUndo: () => false,
        },
      ]);
      expect(hasNonUndoable.canUndo()).toBe(false);
    });

    it('should await async child _pendingPromise (server writes committed) after execute', async () => {
      // Mirrors the real pattern: each child op kicks off an async write in execute()
      // (e.g. ASTStyleOperation) and only flips `committed` once that write resolves.
      // The async write completes on a deferred timer — so the ONLY way to observe the
      // commit is to await something that chains on the child _pendingPromise. The batch
      // must expose such a _pendingPromise; without it `await undefined` returns before
      // the timer fires and the writes are still in flight (the await-gap bug).
      const makeAsyncOp = (name: string) => {
        const state = { committed: false };
        return {
          op: {
            name,
            _pendingPromise: undefined as Promise<void> | undefined,
            execute() {
              this._pendingPromise = new Promise<void>((res) => {
                setTimeout(res, 5);
              }).then(() => {
                state.committed = true;
              });
              return { success: true, changedIds: [name] };
            },
            undo: () => ({ success: true, changedIds: [name] }),
            redo: () => ({ success: true, changedIds: [name] }),
            canUndo: () => true,
          },
          state,
        };
      };

      const a = makeAsyncOp('async-1');
      const b = makeAsyncOp('async-2');

      const batch = new BatchOperation([a.op, b.op]);
      const result = batch.execute(tree);
      expect(result.success).toBe(true);

      // Awaiting the batch's pending promise must guarantee all child writes committed.
      await (batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise;

      expect(a.state.committed).toBe(true);
      expect(b.state.committed).toBe(true);
    });

    it('should drive each child redo() (not execute()) on redo (P1a)', () => {
      // A recorded batch replayed via redo() must call child redo(), not child
      // execute(). For snapshot/ID-sensitive children the two differ (execute mints
      // new IDs; redo reuses recorded ones). The inherited BaseOperation.redo() wrongly
      // delegates to execute(), which would re-run execute() on every child.
      const calls: string[] = [];

      const makeOp = (name: string) => ({
        name,
        execute: () => {
          calls.push(`${name}:execute`);
          return { success: true, changedIds: [`${name}-exec`] };
        },
        undo: () => ({ success: true, changedIds: [name] }),
        redo: () => {
          calls.push(`${name}:redo`);
          return { success: true, changedIds: [`${name}-redo`] };
        },
        canUndo: () => true,
      });

      const batch = new BatchOperation([makeOp('op-1'), makeOp('op-2')]);
      const result = batch.redo(tree);

      expect(result.success).toBe(true);
      // Only redo() of each child should have fired, in order — no execute() calls.
      expect(calls).toEqual(['op-1:redo', 'op-2:redo']);
      // changedIds collected from redo() results (the same way execute() collects them).
      expect(result.changedIds).toEqual(['op-1-redo', 'op-2-redo']);
    });

    it('should await async child redo() _pendingPromise after redo (P1a)', async () => {
      // redo() must refresh the batch _pendingPromise from child redo() in-flight writes,
      // exactly as execute() does — otherwise CanvasEngine.redo resolves before commit.
      const makeAsyncRedoOp = (name: string) => {
        const state = { committed: false };
        return {
          op: {
            name,
            _pendingPromise: undefined as Promise<void> | undefined,
            execute: () => ({ success: true, changedIds: [name] }),
            undo: () => ({ success: true, changedIds: [name] }),
            redo() {
              this._pendingPromise = new Promise<void>((res) => {
                setTimeout(res, 5);
              }).then(() => {
                state.committed = true;
              });
              return { success: true, changedIds: [name] };
            },
            canUndo: () => true,
          },
          state,
        };
      };

      const a = makeAsyncRedoOp('redo-1');
      const b = makeAsyncRedoOp('redo-2');

      const batch = new BatchOperation([a.op, b.op]);
      batch.redo(tree);

      await (batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise;

      expect(a.state.committed).toBe(true);
      expect(b.state.committed).toBe(true);
    });

    it('should await a child whose async write is exposed only via the shared _pendingPromise (P1b)', async () => {
      // ASTPasteOperation kicks off its server write in execute() but historically tracked
      // it on `pastePromise`, NOT the shared `_pendingPromise` the batch reads. So a batch
      // containing it resolved before the write committed and `newElementId` was still unset.
      // After standardization the op also sets `_pendingPromise`, so awaiting the batch
      // guarantees the paste committed.
      api.pasteElementResult = { success: true, newId: 'pasted-77', newIds: ['pasted-77'], index: 0 };
      const paste = new ASTPasteOperation(api, {
        parentId: 'parent-1',
        filePath: '/test/component.tsx',
        tsxCode: '<Button>Hi</Button>',
      });

      const batch = new BatchOperation([paste]);
      const result = batch.execute(tree);
      expect(result.success).toBe(true);

      await (batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise;

      // If the batch awaited the in-flight paste, the new ID is committed by now.
      expect(paste.getNewElementId()).toBe('pasted-77');
    });

    it('should await a duplicate child whose async write is exposed via the shared _pendingPromise (P1b)', async () => {
      // Same standardization as paste: ASTDuplicateOperation must set `_pendingPromise`
      // so a batch containing it waits for the duplicate write before resolving.
      api.duplicateElementResult = { success: true, newId: 'dup-77', parentId: 'p-1', index: 1 };
      const dup = new ASTDuplicateOperation(api, {
        elementId: 'elem-1',
        filePath: '/test/component.tsx',
      });

      const batch = new BatchOperation([dup]);
      const result = batch.execute(tree);
      expect(result.success).toBe(true);

      await (batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise;

      expect(dup.getNewElementId()).toBe('dup-77');
    });

    it('should resolve immediately for an empty batch', async () => {
      const batch = new BatchOperation([]);
      const result = batch.execute(tree);
      expect(result.success).toBe(true);
      expect(result.changedIds).toEqual([]);
      // No children → _pendingPromise resolves with no in-flight writes.
      await expect((batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise).resolves.toBeUndefined();
    });

    it('should resolve immediately for a purely synchronous batch', async () => {
      const makeSyncOp = (name: string) => ({
        name,
        execute: () => ({ success: true, changedIds: [name] }),
        undo: () => ({ success: true, changedIds: [name] }),
        redo: () => ({ success: true, changedIds: [name] }),
        canUndo: () => true,
      });

      const batch = new BatchOperation([makeSyncOp('sync-1'), makeSyncOp('sync-2')]);
      const result = batch.execute(tree);
      expect(result.success).toBe(true);
      // No child set _pendingPromise → batch _pendingPromise resolves with nothing pending.
      await expect((batch as unknown as { _pendingPromise?: Promise<void> })._pendingPromise).resolves.toBeUndefined();
    });
  });
});
