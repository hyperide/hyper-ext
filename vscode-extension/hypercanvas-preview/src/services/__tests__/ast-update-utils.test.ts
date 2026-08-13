/**
 * @file Tests for updateStyles in ast-update-utils — B0 transaction wiring (HYP-722 T1a)
 *
 * Accessed via: AstService → updateStyles → runStyleWriteTransaction
 * Assumptions: focuses on the B0 callsite wiring invariant: baseFileIO carries the VS Code
 *   workspace FileIO, fileIO must NOT appear in request (the transaction injects its own
 *   SnapshotFileIO), and executeStyleWriteRequest is never called directly.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import type { executeStyleWriteRequest } from '@lib/style-write/style-write-executor';
import type {
  RunStyleWriteTransactionInput,
  TransactionalStyleWriteResult,
} from '@lib/style-write/transaction/index.node';
import type { WriteId } from '@lib/style-write/transaction/types';
import type { TailwindPlan } from '@lib/style-write/types';
import type { NodeRef } from '@shared/element-tracing/types';
import type { FindElementResult } from '@lib/types';
import * as t from '@babel/types';

// --- module mocks ---

const mockRunStyleWriteTransaction =
  mock<(input: RunStyleWriteTransactionInput) => Promise<TransactionalStyleWriteResult>>();
mock.module('@lib/style-write/transaction/index.node', () => ({
  runStyleWriteTransaction: mockRunStyleWriteTransaction,
}));

const mockExecuteStyleWriteRequest = mock<typeof executeStyleWriteRequest>();
mock.module('@lib/style-write/style-write-executor', () => ({
  executeStyleWriteRequest: mockExecuteStyleWriteRequest,
}));

const { updateStyles } = await import('../ast-update-utils');

// --- helpers ---

function makeFileIO(): FileIO {
  return {
    readFile: mock(async () => ''),
    writeFile: mock(async () => {}),
  } as unknown as FileIO;
}

function makeTailwindPlan(): TailwindPlan {
  return {
    id: 'test-plan',
    sourceForm: 'elementClass',
    cssSystem: 'tailwind-v4',
    projectRoot: '/workspace',
    sourceElement: { filePath: '/workspace/App.tsx', elementRef: '/workspace/App.tsx:1:0', tagName: 'div' },
    requestedStyles: { color: 'red' },
    targetStyles: { color: 'red' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    strategy: { mode: 'static', removeForProperties: ['color'], addClasses: 'text-red-500' },
    target: { filePath: '/workspace/App.tsx', elementRef: '/workspace/App.tsx:1:0' },
  };
}

function makeDeps(fileIO: FileIO) {
  const element = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('div'), []),
    t.jsxClosingElement(t.jsxIdentifier('div')),
    [],
  );
  const findResult: FindElementResult = { element, path: {} as FindElementResult['path'] };

  return {
    workspaceRoot: '/workspace',
    fileIO,
    resolveElementInCorrectFile: mock(async (_path: string, _nodeRef: NodeRef) => ({
      result: findResult,
      ast: t.file(t.program([])),
      resolvedPath: '/workspace/App.tsx',
    })),
    updateNodeMap: mock(async () => {}),
  };
}

// --- tests ---

describe('updateStyles B0 wiring invariant (HYP-722 T1a)', () => {
  beforeEach(() => {
    mockRunStyleWriteTransaction.mockClear();
    mockExecuteStyleWriteRequest.mockClear();
  });

  test('passes deps.fileIO as baseFileIO and omits fileIO from request', async () => {
    const fileIO = makeFileIO();
    mockRunStyleWriteTransaction.mockResolvedValueOnce({
      success: true,
      plan: makeTailwindPlan(),
      mutatedFiles: ['/workspace/App.tsx'],
      writeId: 'wid-1' as WriteId,
    });
    const deps = makeDeps(fileIO);

    await updateStyles('App.tsx', 'App.tsx:1:0', { color: 'red' }, undefined, undefined, undefined, undefined, deps);

    expect(mockRunStyleWriteTransaction).toHaveBeenCalledTimes(1);
    const call = mockRunStyleWriteTransaction.mock.calls[0]?.[0];
    // VS Code FileIO transport must be the baseFileIO — the transaction uses it for snapshot AND write.
    expect(call?.baseFileIO).toBe(fileIO);
    // fileIO must NOT appear in request — the transaction injects its own SnapshotFileIO wrapping baseFileIO.
    expect((call?.request as Record<string, unknown>)?.fileIO).toBeUndefined();
    // executeStyleWriteRequest must never be called directly from the callsite.
    expect(mockExecuteStyleWriteRequest).not.toHaveBeenCalled();
  });

  test('returns success with resolvedPath on a successful transaction result', async () => {
    const fileIO = makeFileIO();
    mockRunStyleWriteTransaction.mockResolvedValueOnce({
      success: true,
      plan: makeTailwindPlan(),
      mutatedFiles: ['/workspace/App.tsx'],
      writeId: 'wid-2' as WriteId,
    });

    const result = await updateStyles(
      'App.tsx',
      'App.tsx:1:0',
      { color: 'red' },
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(fileIO),
    );

    expect(result).toMatchObject({ success: true, resolvedPath: '/workspace/App.tsx' });
  });

  test('propagates a transaction failure as { success: false, error }', async () => {
    const fileIO = makeFileIO();
    mockRunStyleWriteTransaction.mockResolvedValueOnce({
      success: false,
      error: 'CSS Modules source owner unavailable',
      writeId: 'wid-3' as WriteId,
      rollback: { terminal: 'rolled_back', failedFiles: [] },
    });

    const result = await updateStyles(
      'App.tsx',
      'App.tsx:1:0',
      { color: 'red' },
      undefined,
      undefined,
      undefined,
      undefined,
      makeDeps(fileIO),
    );

    expect(result).toMatchObject({ success: false, error: 'CSS Modules source owner unavailable' });
  });
});
