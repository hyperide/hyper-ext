/**
 * @file TamaguiAdapter writeOrder tests
 *
 * Accessed via: drag-reorder pipeline routing to TamaguiAdapter when the parent owns
 *   `order` props on Tamagui Stack/YStack/XStack children.
 * Assumptions: AstOperations.updateProps writes the JSX prop verbatim and owns
 *   undo tracking.
 */
import { describe, expect, it } from 'bun:test';
import type { AstOperations } from '@/lib/platform/types';
import { TamaguiAdapter } from './TamaguiAdapter';

function createAstOpsRecorder() {
  const updatePropsCalls: Parameters<AstOperations['updateProps']>[0][] = [];

  const astOps: AstOperations = {
    updateStyles: async () => undefined,
    insertElement: async () => ({ success: true }),
    deleteElements: async () => undefined,
    duplicateElement: async () => ({ success: true }),
    updateProps: async (params) => {
      updatePropsCalls.push(params);
    },
    renameElement: async () => undefined,
    updateText: async () => undefined,
    writeI18nResource: async () => ({}),
  };

  return { astOps, updatePropsCalls };
}

describe('TamaguiAdapter.writeOrder', () => {
  it('writes order prop at base breakpoint', async () => {
    const { astOps, updatePropsCalls } = createAstOpsRecorder();
    const adapter = new TamaguiAdapter(astOps);

    const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
      filePath: 'src/App.tsx',
    });

    expect(result).toEqual({ success: true });
    expect(updatePropsCalls).toHaveLength(1);
    expect(updatePropsCalls[0]).toMatchObject({
      elementId: 'src/App.tsx:10:4',
      filePath: 'src/App.tsx',
      props: { order: 3 },
    });
  });

  it('removes order prop when value is null', async () => {
    const { astOps, updatePropsCalls } = createAstOpsRecorder();
    const adapter = new TamaguiAdapter(astOps);

    const result = await adapter.writeOrder('src/App.tsx:10:4', null, {
      filePath: 'src/App.tsx',
    });

    expect(result).toEqual({ success: true });
    expect(updatePropsCalls[0].props).toEqual({ order: undefined });
  });

  it('returns order-not-supported for non-base breakpoint', async () => {
    const { astOps, updatePropsCalls } = createAstOpsRecorder();
    const adapter = new TamaguiAdapter(astOps);

    const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
      filePath: 'src/App.tsx',
      breakpoint: 'md',
    });

    expect(result).toEqual({ success: false, error: 'order-not-supported' });
    expect(updatePropsCalls).toHaveLength(0);
  });

  it('returns success: false when filePath missing', async () => {
    const { astOps, updatePropsCalls } = createAstOpsRecorder();
    const adapter = new TamaguiAdapter(astOps);

    const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
      filePath: '',
    });

    expect(result).toEqual({ success: false, error: 'filePath required' });
    expect(updatePropsCalls).toHaveLength(0);
  });

  it('reports updateProps failure as error', async () => {
    const astOps: AstOperations = {
      updateStyles: async () => undefined,
      insertElement: async () => ({ success: true }),
      deleteElements: async () => undefined,
      duplicateElement: async () => ({ success: true }),
      updateProps: async () => {
        throw new Error('AST mutation failed');
      },
      renameElement: async () => undefined,
      updateText: async () => undefined,
      writeI18nResource: async () => ({}),
    };
    const adapter = new TamaguiAdapter(astOps);

    const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
      filePath: 'src/App.tsx',
    });

    expect(result).toEqual({ success: false, error: 'AST mutation failed' });
  });
});
