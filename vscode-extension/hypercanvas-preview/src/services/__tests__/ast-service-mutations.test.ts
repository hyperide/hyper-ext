/**
 * @file Tests for updateStylesWrapper in ast-service-mutations — deps forwarding invariant (HYP-983)
 *
 * Accessed via: AstService.updateStyles → updateStylesWrapper → updateStyles (ast-update-utils)
 *   → runStyleWriteTransaction.
 * Assumptions: drives the REAL wrapper→updateStyles chain (mocking only the transaction, the same
 *   seam ast-update-utils.test.ts mocks) and asserts `projectDefaultCssSystem` reaches the executor
 *   request. This pins the wrapper-level forwarding (ast-service-mutations.ts) that the sibling
 *   updateStyles-only test bypasses, so dropping the wrapper's forwarding line now fails a test
 *   (codex review, HYP-983 P2 coverage gap). Mocks the transaction module only — no `../ast-update-utils`
 *   module mock (that would leak into the sibling suite under bun's global mock registry).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import type {
  RunStyleWriteTransactionInput,
  TransactionalStyleWriteResult,
} from '@lib/style-write/transaction/index.node';
import type { WriteId } from '@lib/style-write/transaction/types';
import type { TailwindPlan } from '@lib/style-write/types';
import type { NodeRef } from '@shared/element-tracing/types';
import type { FindElementResult } from '@lib/types';
import type { MutationWrapperDeps } from '../ast-service-mutations';
import * as t from '@babel/types';

const mockRunStyleWriteTransaction =
  mock<(input: RunStyleWriteTransactionInput) => Promise<TransactionalStyleWriteResult>>();
mock.module('@lib/style-write/transaction/index.node', () => ({
  runStyleWriteTransaction: mockRunStyleWriteTransaction,
}));

const { updateStylesWrapper } = await import('../ast-service-mutations');

function makeTailwindPlan(): TailwindPlan {
  return {
    id: 'test-plan',
    sourceForm: 'elementClass',
    cssSystem: 'tailwind-v4',
    projectRoot: '/workspace',
    sourceElement: { filePath: '/workspace/App.tsx', elementRef: '/workspace/App.tsx:1:0', tagName: 'div' },
    requestedStyles: { paddingTop: '24' },
    targetStyles: { paddingTop: '24' },
    condition: { state: 'base' },
    reason: 'existing-owner',
    confidence: 'exact',
    diagnostics: [],
    strategy: { mode: 'static', removeForProperties: ['paddingTop'], addClasses: 'pt-[24px]' },
    target: { filePath: '/workspace/App.tsx', elementRef: '/workspace/App.tsx:1:0' },
  };
}

function makeDeps(overrides: Partial<MutationWrapperDeps> = {}): MutationWrapperDeps {
  const element = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier('div'), []),
    t.jsxClosingElement(t.jsxIdentifier('div')),
    [],
  );
  const findResult: FindElementResult = { element, path: {} as FindElementResult['path'] };
  return {
    workspaceRoot: '/workspace',
    fileIO: { readFile: mock(async () => ''), writeFile: mock(async () => {}) } as unknown as FileIO,
    fileParser: {} as MutationWrapperDeps['fileParser'],
    updateNodeMap: mock(async () => {}),
    resolveElementInCorrectFile: mock(async (_p: string, _nr: NodeRef) => ({
      result: findResult,
      ast: t.file(t.program([])),
      resolvedPath: '/workspace/App.tsx',
    })),
    resolveElement: mock(() => null),
    ...overrides,
  };
}

describe('updateStylesWrapper — projectDefaultCssSystem forwarding (HYP-983)', () => {
  beforeEach(() => {
    mockRunStyleWriteTransaction.mockClear();
    mockRunStyleWriteTransaction.mockResolvedValue({
      success: true,
      plan: makeTailwindPlan(),
      mutatedFiles: ['/workspace/App.tsx'],
      writeId: 'wid-wrap' as WriteId,
    });
  });

  test('forwards deps.projectDefaultCssSystem through to the executor request', async () => {
    const deps = makeDeps({ projectDefaultCssSystem: 'tailwind-v4' });

    await updateStylesWrapper(deps, 'App.tsx', 'App.tsx:1:0', { paddingTop: '24' },
      undefined, undefined, undefined, undefined, undefined);

    // The AstService-derived project default must survive the wrapper hop and reach the request so a
    // surfaceless element floors to the Tailwind system, not a silent inline style. Regression: HYP-983.
    const call = mockRunStyleWriteTransaction.mock.calls[0]?.[0];
    expect((call?.request as Record<string, unknown>)?.projectDefaultCssSystem).toBe('tailwind-v4');
  });

  test('forwards undefined when the host supplied no project default', async () => {
    const deps = makeDeps();

    await updateStylesWrapper(deps, 'App.tsx', 'App.tsx:1:0', { paddingTop: '24' },
      undefined, undefined, undefined, undefined, undefined);

    const call = mockRunStyleWriteTransaction.mock.calls[0]?.[0];
    expect((call?.request as Record<string, unknown>)?.projectDefaultCssSystem).toBeUndefined();
  });
});
