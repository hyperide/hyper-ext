/**
 * CanvasEngine AST integration tests
 *
 * Tests engine methods that create and execute AST operations.
 * Uses MockASTApiService injected into engine via (engine as any).api.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { CanvasEngine } from '../core/CanvasEngine';
import type { ComponentDefinition } from '../models/types';
import { MockASTApiService } from './mocks/MockASTApiService';

// Mock getPreviewIframe (used by ASTUpdate operations)
mock.module('@/lib/dom-utils', () => ({
  getPreviewIframe: () => null,
  PREVIEW_IFRAME_ID: 'preview-iframe',
}));

describe('CanvasEngine AST Integration', () => {
  let engine: CanvasEngine;
  let mockApi: MockASTApiService;

  const buttonDef: ComponentDefinition = {
    type: 'Button',
    label: 'Button',
    fields: {
      text: { type: 'text', label: 'Text' },
    },
    defaultProps: { text: 'Click me' },
    render: () => null,
  };

  beforeEach(() => {
    engine = new CanvasEngine({ debug: false });
    engine.registerComponent(buttonDef);

    // Inject mock API service
    mockApi = new MockASTApiService();
    Object.assign(engine, { api: mockApi });
  });

  describe('insertASTElement', () => {
    it('should create operation, execute it, and record in history', () => {
      engine.insertASTElement('parent-1', '/test/file.tsx', 'Button', { text: 'Test' });

      expect(engine.canUndo()).toBe(true);
      expect(engine.getHistoryState().length).toBe(1);
    });

    it('should call API with correct params', async () => {
      engine.insertASTElement('parent-1', '/test/file.tsx', 'Button', { text: 'Test' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('insertElement')).toBe(1);
      expect(
        mockApi.wasCalledWith('insertElement', {
          parentId: 'parent-1',
          componentType: 'Button',
          filePath: '/test/file.tsx',
        }),
      ).toBe(true);
    });

    it('should support undo that calls deleteElement', async () => {
      mockApi.insertElementResult = { success: true, newId: 'new-btn' };
      engine.insertASTElement('parent-1', '/test/file.tsx', 'Button', { text: 'Test' });

      // Wait for async insert to complete
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockApi.reset();
      await engine.undo();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('deleteElement')).toBe(1);
      expect(mockApi.wasCalledWith('deleteElement', { elementId: 'new-btn' })).toBe(true);
      expect(engine.canUndo()).toBe(false);
    });
  });

  describe('deleteASTElement', () => {
    function setupAST(): void {
      const root = engine.getRoot();
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

    it('should delete element and record in history', async () => {
      setupAST();
      engine.deleteASTElement('elem-1', '/test/file.tsx');

      expect(engine.canUndo()).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('deleteElement')).toBe(1);
    });

    it('should clear selection after delete', () => {
      setupAST();
      engine.select('elem-1');
      expect(engine.getSelection().selectedIds.length).toBe(1);

      engine.deleteASTElement('elem-1', '/test/file.tsx');
      expect(engine.getSelection().selectedIds.length).toBe(0);
    });

    it('should restore element on undo', async () => {
      setupAST();
      engine.deleteASTElement('elem-1', '/test/file.tsx');

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockApi.reset();
      await engine.undo();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Undo restores via insertElement
      expect(mockApi.getCallCount('insertElement')).toBe(1);
      expect(mockApi.wasCalledWith('insertElement', { componentType: 'Button' })).toBe(true);
    });
  });

  describe('duplicateASTElement', () => {
    function setupAST(): void {
      const root = engine.getRoot();
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

    it('should duplicate and return new element ID', async () => {
      setupAST();
      mockApi.duplicateElementResult = {
        success: true,
        newId: 'dup-1',
        parentId: 'root',
        index: 1,
      };

      const newId = await engine.duplicateASTElement('elem-1', '/test/file.tsx');
      expect(newId).toBe('dup-1');
      expect(engine.canUndo()).toBe(true);
    });

    it('should delete duplicate on undo', async () => {
      setupAST();
      mockApi.duplicateElementResult = {
        success: true,
        newId: 'dup-1',
        parentId: 'root',
        index: 1,
      };

      await engine.duplicateASTElement('elem-1', '/test/file.tsx');

      mockApi.reset();
      await engine.undo();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('deleteElement')).toBe(1);
      expect(mockApi.wasCalledWith('deleteElement', { elementId: 'dup-1' })).toBe(true);
    });
  });

  describe('pasteASTElement', () => {
    it('should paste TSX and return new element ID', async () => {
      mockApi.pasteElementResult = {
        success: true,
        newId: 'pasted-1',
        newIds: ['pasted-1'],
        index: 0,
      };

      const newId = await engine.pasteASTElement('parent-1', '/test/file.tsx', '<Button>Click me</Button>');

      expect(newId).toBe('pasted-1');
      expect(engine.canUndo()).toBe(true);
    });

    it('should batch-delete pasted elements on undo', async () => {
      mockApi.pasteElementResult = {
        success: true,
        newId: 'pasted-1',
        newIds: ['pasted-1', 'pasted-2'],
        index: 0,
      };

      await engine.pasteASTElement('parent-1', '/test/file.tsx', '<div><span>A</span><span>B</span></div>');

      mockApi.reset();
      await engine.undo();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('deleteElements')).toBe(1);
      const call = mockApi.getLastCall('deleteElements');
      expect((call?.args[0] as Record<string, unknown>).elementIds).toEqual(['pasted-1', 'pasted-2']);
    });
  });

  describe('updateASTStyles', () => {
    it('should update styles and record in history', async () => {
      engine.updateASTStyles('elem-1', '/test/file.tsx', { padding: '16px' });

      expect(engine.canUndo()).toBe(true);

      // Wait for async
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('updateStyles')).toBe(1);
    });

    it('should restore snapshot on undo', async () => {
      mockApi.updateStylesResult = { success: true, snapshotId: 42 };
      engine.updateASTStyles('elem-1', '/test/file.tsx', { padding: '16px' });

      // Wait for async style update
      await new Promise((resolve) => setTimeout(resolve, 50));

      mockApi.reset();
      await engine.undo();

      // Wait for async undo
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('restoreFileSnapshot')).toBe(1);
      const call = mockApi.getLastCall('restoreFileSnapshot');
      expect(call?.args[0]).toBe(42);
    });
  });

  describe('editASTCondition', () => {
    it('should edit condition and record in history', async () => {
      engine.editASTCondition({
        type: 'condition',
        boundaryId: 'cond-1',
        elementId: 'elem-1',
        filePath: '/test/file.tsx',
        oldExpression: 'isVisible',
        newExpression: 'isVisible && isActive',
      });

      expect(engine.canUndo()).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('editCondition')).toBe(1);
    });

    it('should swap expressions on undo', async () => {
      engine.editASTCondition({
        type: 'condition',
        boundaryId: 'cond-1',
        elementId: 'elem-1',
        filePath: '/test/file.tsx',
        oldExpression: 'isVisible',
        newExpression: 'isVisible && isActive',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      mockApi.reset();
      await engine.undo();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockApi.getCallCount('editCondition')).toBe(1);
      const call = mockApi.getLastCall('editCondition');
      // On undo, expressions are swapped
      expect((call?.args[0] as Record<string, unknown>).newExpression).toBe('isVisible');
      expect((call?.args[0] as Record<string, unknown>).oldExpression).toBe('isVisible && isActive');
    });
  });

  describe('undo/redo integration', () => {
    it('should handle multiple sequential undos', async () => {
      mockApi.insertElementResult = { success: true, newId: 'a' };
      engine.insertASTElement('p', '/f.tsx', 'Button', {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      mockApi.insertElementResult = { success: true, newId: 'b' };
      engine.insertASTElement('p', '/f.tsx', 'Button', {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      const result1 = await engine.undo();
      expect(result1).toBe(true);
      expect(engine.getHistoryState().length).toBe(2);
      expect(engine.getHistoryState().position).toBe(0);

      const result2 = await engine.undo();
      expect(result2).toBe(true);
      expect(engine.getHistoryState().position).toBe(-1);
    });

    it('should handle undo → redo cycle', async () => {
      mockApi.insertElementResult = { success: true, newId: 'new-1' };
      engine.insertASTElement('p', '/f.tsx', 'Button', {});

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(engine.canUndo()).toBe(true);
      expect(engine.canRedo()).toBe(false);

      await engine.undo();
      expect(engine.canUndo()).toBe(false);
      expect(engine.canRedo()).toBe(true);

      await engine.redo();
      expect(engine.canUndo()).toBe(true);
      expect(engine.canRedo()).toBe(false);
    });

    it('should emit history:change events', () => {
      const historyChanges: unknown[] = [];
      engine.events.on('history:change', (payload) => {
        historyChanges.push(payload);
      });

      engine.insertASTElement('p', '/f.tsx', 'Button', {});
      engine.insertASTElement('p', '/f.tsx', 'Button', {});

      // Should have emitted history:change for each operation
      expect(historyChanges.length).toBe(2);
    });

    it('should return correct history state', () => {
      engine.insertASTElement('p', '/f.tsx', 'Button', {});
      engine.insertASTElement('p', '/f.tsx', 'Button', {});

      const state = engine.getHistoryState();
      expect(state.canUndo).toBe(true);
      expect(state.canRedo).toBe(false);
      expect(state.length).toBe(2);
      expect(state.position).toBe(1);
    });
  });
});
