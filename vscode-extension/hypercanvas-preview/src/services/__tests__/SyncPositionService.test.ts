/**
 * @file SyncPositionService unit tests
 *
 * Accessed via: Internal service — trigged by preview element clicks
 * and code cursor movements.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { SourceLocation } from '@shared/element-tracing/types';

// Extend the global vscode workspace mock with missing APIs used by SyncPositionService
import * as vscode from 'vscode';

(vscode.workspace as unknown as Record<string, unknown>).getConfiguration = mock(() => ({
  get: <T>(_key: string, defaultValue: T) => defaultValue,
}));
(vscode.workspace as unknown as Record<string, unknown>).onDidChangeConfiguration = mock(() => ({
  dispose: mock(),
}));
(vscode.window as unknown as Record<string, unknown>).onDidChangeTextEditorSelection = mock(() => ({
  dispose: mock(),
}));

// Mock EditorBridge to track goToCode calls
// Path relative to test file (services/__tests__/) → src/EditorBridge.ts
const goToCodeMock = mock(() => Promise.resolve());
mock.module('../../EditorBridge', () => ({ goToCode: goToCodeMock }));

// Mock AstService — only used in legacy fallback path
// Path relative to test file → src/services/AstService.ts
const getElementLocationMock = mock(() => Promise.resolve(null));
mock.module('../AstService', () => ({
  AstService: class {
    getElementLocation = getElementLocationMock;
    findElementAtPosition = mock(() => Promise.resolve(null));
  },
}));

mock.module('@lib/types', () => ({}));
mock.module('@shared/element-tracing/types', () => ({}));

const { SyncPositionService } = await import('../SyncPositionService');
const { StateHub } = await import('../../StateHub');
const { AstService } = await import('../AstService');

function createService(getCurrentComponent: () => string | undefined) {
  const stateHub = new StateHub();
  const astService = new AstService('/workspace', () => Promise.resolve(undefined));
  const service = new SyncPositionService(astService, stateHub, '/workspace', mock(), getCurrentComponent);
  service.start();
  return { service, stateHub };
}

describe('SyncPositionService', () => {
  beforeEach(() => {
    goToCodeMock.mockClear();
    getElementLocationMock.mockClear();
  });

  describe('Preview → Code navigation (pendingSource fast path)', () => {
    it('navigates directly when source is provided, even without active component', async () => {
      // Bug: _getCurrentComponent() was checked BEFORE _pendingSource consumption.
      // When no TSX file was open, it returned early without navigating.
      const { stateHub } = createService(() => undefined); // no active editor

      const source: SourceLocation = { fileName: 'app/page.tsx', line: 5, column: 7 };
      stateHub.applyUpdate({ selectedIds: ['app/page.tsx:5:7'], source } as never);

      // Wait for async navigation
      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).toHaveBeenCalledTimes(1);
      expect(goToCodeMock).toHaveBeenCalledWith('app/page.tsx', 5, 8); // column is 0-based → +1
    });

    it('navigates directly when source is provided and component IS active', async () => {
      const { stateHub } = createService(() => 'app/page.tsx');

      const source: SourceLocation = { fileName: 'app/page.tsx', line: 10, column: 3 };
      stateHub.applyUpdate({ selectedIds: ['app/page.tsx:10:3'], source } as never);

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).toHaveBeenCalledTimes(1);
      expect(goToCodeMock).toHaveBeenCalledWith('app/page.tsx', 10, 4);
    });

    it('falls back to AST lookup when no source is provided', async () => {
      const { stateHub } = createService(() => 'App.tsx');

      stateHub.applyUpdate({ selectedIds: ['some-uuid-id'] });

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).not.toHaveBeenCalled();
      expect(getElementLocationMock).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no source and no active component', async () => {
      const { stateHub } = createService(() => undefined);

      stateHub.applyUpdate({ selectedIds: ['some-uuid-id'] });

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).not.toHaveBeenCalled();
      expect(getElementLocationMock).not.toHaveBeenCalled();
    });

    it('does nothing when selectedIds is empty', async () => {
      const { stateHub } = createService(() => undefined);

      stateHub.applyUpdate({ selectedIds: [] });

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).not.toHaveBeenCalled();
    });

    it('does nothing when selectedIds has multiple items', async () => {
      const { stateHub } = createService(() => 'App.tsx');

      const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 0 };
      stateHub.applyUpdate({ selectedIds: ['id-1', 'id-2'], source } as never);

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('stops reacting after dispose', async () => {
      const { service, stateHub } = createService(() => 'App.tsx');
      service.dispose();

      const source: SourceLocation = { fileName: 'App.tsx', line: 1, column: 0 };
      stateHub.applyUpdate({ selectedIds: ['id-1'], source } as never);

      await new Promise((r) => setTimeout(r, 10));

      expect(goToCodeMock).not.toHaveBeenCalled();
    });
  });
});
