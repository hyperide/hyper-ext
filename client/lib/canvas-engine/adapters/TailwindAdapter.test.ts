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
  const updatePropsCalls: Parameters<AstOperations['updateProps']>[0][] = [];

  const astOps: AstOperations = {
    updateStyles: async (params) => {
      updateStylesCalls.push(params);
    },
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

  return { astOps, updateStylesCalls, updatePropsCalls };
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

  describe('writeOrder', () => {
    it('writes base order-N preserving md: variant', async () => {
      const { astOps, updatePropsCalls } = createAstOpsRecorder();
      const adapter = new TailwindAdapter(astOps);

      const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
        filePath: 'src/App.tsx',
        currentClassName: 'flex order-1 md:order-2 p-4',
      });

      expect(result).toEqual({ success: true });
      expect(updatePropsCalls).toHaveLength(1);
      expect(updatePropsCalls[0]).toMatchObject({
        elementId: 'src/App.tsx:10:4',
        filePath: 'src/App.tsx',
        props: { className: 'flex order-3 md:order-2 p-4' },
      });
    });

    it('writes md:order-N preserving base order', async () => {
      const { astOps, updatePropsCalls } = createAstOpsRecorder();
      const adapter = new TailwindAdapter(astOps);

      const result = await adapter.writeOrder('src/App.tsx:10:4', 5, {
        filePath: 'src/App.tsx',
        breakpoint: 'md',
        currentClassName: 'order-1 md:order-2 lg:order-3 flex',
      });

      expect(result).toEqual({ success: true });
      expect(updatePropsCalls[0].props).toEqual({
        className: 'order-1 md:order-5 lg:order-3 flex',
      });
    });

    it('removes order class when value is null', async () => {
      const { astOps, updatePropsCalls } = createAstOpsRecorder();
      const adapter = new TailwindAdapter(astOps);

      const result = await adapter.writeOrder('src/App.tsx:10:4', null, {
        filePath: 'src/App.tsx',
        currentClassName: 'flex order-2 p-4',
      });

      expect(result).toEqual({ success: true });
      expect(updatePropsCalls[0].props).toEqual({ className: 'flex p-4' });
    });

    it('returns success: false when filePath missing', async () => {
      const { astOps, updatePropsCalls } = createAstOpsRecorder();
      const adapter = new TailwindAdapter(astOps);

      const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
        filePath: '',
        currentClassName: 'flex',
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
      const adapter = new TailwindAdapter(astOps);

      const result = await adapter.writeOrder('src/App.tsx:10:4', 3, {
        filePath: 'src/App.tsx',
        currentClassName: 'flex',
      });

      expect(result).toEqual({ success: false, error: 'AST mutation failed' });
    });
  });
});
