/**
 * @file useStyleSync queue lifecycle tests
 *
 * Accessed via: Right sidebar style controls in the VS Code preview panel
 * Assumptions: pending style writes are scoped to the selected element and component file.
 * Past bugs: stale trailing debounce writes survived test teardown and triggered VS Code applyEdit conflicts.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import { CanvasEngine } from '@/lib/canvas-engine';
import type { StyleAdapter } from '@/lib/canvas-engine/adapters/StyleAdapter';
import type { AstOperations } from '@/lib/platform/types';
import { STYLE_DEBOUNCE_MS } from '../../constants';
import { useStyleSync } from '../useStyleSync';

const styleAdapter: StyleAdapter = {
  writeMode: 'className',
  read: () => ({}),
  write: async () => {},
  writeBatch: async () => {},
  changeLayout: async () => {},
};

function createAstOps(updateStyles: AstOperations['updateStyles']): AstOperations {
  return {
    updateStyles,
    insertElement: async () => ({ success: true }),
    deleteElements: async () => {},
    duplicateElement: async () => ({ success: true }),
    updateProps: async () => {},
    renameElement: async () => {},
    updateText: async () => {},
    writeI18nResource: async () => ({}),
  };
}

async function waitPastDebounce() {
  await new Promise((resolve) => setTimeout(resolve, STYLE_DEBOUNCE_MS + 50));
}

/**
 * Real engine with the network write stubbed out. In jsdom there is no preview
 * iframe and no active tracer, so FastPatchService's own DOM work is a no-op —
 * the spies only record what useStyleSync asks it to do.
 */
function createEngine() {
  const engine = new CanvasEngine({ debug: false });
  spyOn(engine, 'updateASTStyles').mockImplementation(() => Promise.resolve());
  const applyPatch = spyOn(engine.fastPatch, 'applyPatch');
  const clearPatch = spyOn(engine.fastPatch, 'clearPatch');
  return { engine, applyPatch, clearPatch };
}

describe('useStyleSync', () => {
  it('cancels trailing style writes when the component file changes', async () => {
    const updateStyles = mock(async () => ({}));
    const astOps = createAstOps(updateStyles);

    const { result, rerender } = renderHook(
      ({ filePath, selectedIds }) => useStyleSync({ selectedIds, filePath, styleAdapter, astOps }),
      {
        initialProps: {
          filePath: 'src/components/Card.tsx',
          selectedIds: ['card-root'],
        },
      },
    );

    act(() => {
      result.current.syncStyleChange('paddingLeft', '16px', {
        debounceOnly: true,
      });
    });

    rerender({
      filePath: 'src/components/Profile.tsx',
      selectedIds: ['profile-root'],
    });

    await act(waitPastDebounce);

    expect(updateStyles).not.toHaveBeenCalled();
  });

  it('flushes trailing style writes while selection and component file remain stable', async () => {
    const updateStyles = mock(async () => ({}));
    const astOps = createAstOps(updateStyles);

    const { result } = renderHook(
      ({ filePath, selectedIds }) => useStyleSync({ selectedIds, filePath, styleAdapter, astOps }),
      {
        initialProps: {
          filePath: 'src/components/Card.tsx',
          selectedIds: ['card-root'],
        },
      },
    );

    act(() => {
      result.current.syncStyleChange('paddingLeft', '16px', {
        debounceOnly: true,
      });
    });

    await act(waitPastDebounce);

    expect(updateStyles).toHaveBeenCalledWith({
      elementId: 'card-root',
      filePath: 'src/components/Card.tsx',
      styles: { paddingLeft: '16px' },
      // Live applied className from the DOM (HYP-544); empty in jsdom (no preview iframe).
      domClasses: '',
      state: undefined,
      selectedSourceTabId: undefined,
    });
  });

  it('clears the injected fast-patch when the selection changes mid-sync (HYP-650)', async () => {
    const { engine, applyPatch, clearPatch } = createEngine();
    const astOps = createAstOps(mock(async () => ({})));

    const { rerender, result } = renderHook(
      ({ filePath, selectedIds }) => useStyleSync({ selectedIds, filePath, styleAdapter, astOps, engine }),
      {
        initialProps: {
          filePath: 'src/components/Card.tsx',
          selectedIds: ['card-root'],
        },
      },
    );

    // Leading-edge flush applies the instant fast-patch immediately.
    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red');
    });
    expect(applyPatch).toHaveBeenCalled();

    // Switch element before verification settles — the stale !important rule
    // must not survive on the previous element.
    rerender({
      filePath: 'src/components/Card.tsx',
      selectedIds: ['other-element'],
    });

    expect(clearPatch).toHaveBeenCalledWith('card-root');

    // The patch id ref is reset on cancel — a later cancel must not re-clear.
    rerender({
      filePath: 'src/components/Profile.tsx',
      selectedIds: ['profile-root'],
    });

    expect(clearPatch).toHaveBeenCalledTimes(1);
  });

  it('threads the selected map item index into the fast patch (HYP-651)', () => {
    const { engine, applyPatch } = createEngine();
    const astOps = createAstOps(mock(async () => ({})));

    const { result } = renderHook(() =>
      useStyleSync({
        selectedIds: ['list-item'],
        filePath: 'src/components/List.tsx',
        styleAdapter,
        astOps,
        engine,
        itemIndex: 2,
      }),
    );

    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red');
    });

    // Without the index every .map() item shares one nodeRef and the patch
    // lands on the first rendered item, not the selected one (HYP-651).
    expect(applyPatch).toHaveBeenCalledWith('list-item', { backgroundColor: 'red' }, 2);
  });

  it('routes multi-select edits through engine.updateASTStylesBatch with all selected ids', async () => {
    // Real engine: the batch path now resolves a per-element nodeRef + elementLoc (HYP-593 parity),
    // which reads the engine root via the id-bridge — a bare partial mock would throw in getAstTrees.
    const { engine } = createEngine();
    const updateASTStylesBatch = spyOn(engine, 'updateASTStylesBatch').mockImplementation(() => Promise.resolve());

    const { result } = renderHook(() =>
      useStyleSync({
        selectedIds: ['el-a', 'el-b', 'el-c'],
        filePath: 'src/components/Card.tsx',
        styleAdapter,
        astOps: createAstOps(mock(async () => ({}))),
        engine,
      }),
    );

    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red', {
        debounceOnly: true,
      });
    });

    await act(waitPastDebounce);

    expect(updateASTStylesBatch).toHaveBeenCalledTimes(1);
    const [ids, file, styles, options] = updateASTStylesBatch.mock.calls[0] as [
      string[],
      string,
      Record<string, string>,
      { state?: string; selectedSourceTabId?: string; elementUpdates?: unknown },
    ];
    expect(ids).toEqual(['el-a', 'el-b', 'el-c']);
    expect(file).toBe('src/components/Card.tsx');
    expect(styles).toEqual({ backgroundColor: 'red' });
    expect(options.state).toBeUndefined();
    expect(options.selectedSourceTabId).toBeUndefined();
    // Single-element path must not fire for a multi-select edit.
    expect(engine.updateASTStyles).not.toHaveBeenCalled();
  });

  it('threads a per-element nodeRef + elementLoc into the batch write (HYP-593 parity)', async () => {
    // In jsdom there is no AST tree, so the id-bridge resolves nodeRef to the raw id and elementLoc to
    // undefined — but the batch path MUST still build one elementUpdate per selected id (with the same
    // nodeRef/elementLoc shape single-select sends) so the server loc fallback can fire in production.
    const { engine } = createEngine();
    const updateASTStylesBatch = spyOn(engine, 'updateASTStylesBatch').mockImplementation(() => Promise.resolve());

    const { result } = renderHook(() =>
      useStyleSync({
        selectedIds: ['el-a', 'el-b'],
        filePath: 'src/components/Card.tsx',
        styleAdapter,
        astOps: createAstOps(mock(async () => ({}))),
        engine,
      }),
    );

    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red', { debounceOnly: true });
    });

    await act(waitPastDebounce);

    const options = updateASTStylesBatch.mock.calls[0]?.[3] as {
      elementUpdates?: Array<{ nodeRef: string; elementLoc?: unknown }>;
    };
    expect(options.elementUpdates).toHaveLength(2);
    expect(options.elementUpdates?.map((u) => u.nodeRef)).toEqual(['el-a', 'el-b']);
    // No AST tree in jsdom → elementLoc resolves to undefined, but the field is plumbed end-to-end.
    expect(options.elementUpdates?.[0]).toHaveProperty('nodeRef');
  });

  it('fires onSyncError when the batch engine write rejects (HYP-301 revert trigger)', async () => {
    // Real engine: the batch path resolves per-element nodeRef/elementLoc through the id-bridge, which
    // reads the engine root — a bare partial mock would throw in getAstTrees before the write rejects.
    const { engine } = createEngine();
    spyOn(engine, 'updateASTStylesBatch').mockImplementation(() => Promise.reject(new Error('transport down')));
    const onSyncError = mock(() => {});

    const { result } = renderHook(() =>
      useStyleSync({
        selectedIds: ['el-a', 'el-b'],
        filePath: 'src/components/Card.tsx',
        styleAdapter,
        astOps: createAstOps(mock(async () => ({}))),
        engine,
        onSyncError,
      }),
    );

    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red', {
        debounceOnly: true,
      });
    });

    await act(waitPastDebounce);

    expect(onSyncError).toHaveBeenCalledTimes(1);
    expect(onSyncError).toHaveBeenCalledWith({ backgroundColor: 'red' }, 'transport down');
  });

  it('routes single-select edits through engine.updateASTStyles, not the batch path', async () => {
    // Real engine so the single-select writeId/elementLoc resolution (HYP-593) has a root to read;
    // a partial `{ updateASTStyles }` mock would throw in getElementLocByUuid before the write.
    const { engine } = createEngine();
    const updateASTStylesBatch = spyOn(engine, 'updateASTStylesBatch').mockImplementation(() => Promise.resolve());

    const { result } = renderHook(() =>
      useStyleSync({
        selectedIds: ['el-a'],
        filePath: 'src/components/Card.tsx',
        styleAdapter,
        astOps: createAstOps(mock(async () => ({}))),
        engine,
      }),
    );

    act(() => {
      result.current.syncStyleChange('backgroundColor', 'red', {
        debounceOnly: true,
      });
    });

    await act(waitPastDebounce);

    expect(engine.updateASTStyles).toHaveBeenCalledTimes(1);
    expect(updateASTStylesBatch).not.toHaveBeenCalled();
  });
});
