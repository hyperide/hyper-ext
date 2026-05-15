/**
 * @file TailwindAdapter write routing tests
 *
 * Accessed via: inspector style writes using the legacy StyleAdapter path
 * Assumptions: AstOperations owns undo tracking and platform-specific AST writes.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it } from 'bun:test';
import type { AstOperations } from '@/lib/platform/types';
import { TailwindAdapter } from './TailwindAdapter';

function createAstOpsRecorder() {
  const updateStylesCalls: Parameters<AstOperations['updateStyles']>[0][] = [];

  const astOps: AstOperations = {
    updateStyles: async (params) => {
      updateStylesCalls.push(params);
    },
    insertElement: async () => ({ success: true }),
    deleteElements: async () => undefined,
    duplicateElement: async () => ({ success: true }),
    updateProps: async () => undefined,
    renameElement: async () => undefined,
    updateText: async () => undefined,
    writeI18nResource: async () => undefined,
  };

  return { astOps, updateStylesCalls };
}

describe('TailwindAdapter', () => {
  it('forwards selectedSourceTabId from writeBatch options to AST operations', async () => {
    const { astOps, updateStylesCalls } = createAstOpsRecorder();
    const adapter = new TailwindAdapter(astOps);

    await adapter.writeBatch(
      'src/App.tsx:10:4',
      'src/App.tsx',
      { width: '10px' },
      {
        state: 'hover',
        selectedSourceTabId: 'css-modules:card',
      },
    );

    expect(updateStylesCalls).toHaveLength(1);
    expect(updateStylesCalls[0]).toMatchObject({
      elementId: 'src/App.tsx:10:4',
      filePath: 'src/App.tsx',
      styles: { width: '10px' },
      state: 'hover',
      selectedSourceTabId: 'css-modules:card',
    });
  });
});
