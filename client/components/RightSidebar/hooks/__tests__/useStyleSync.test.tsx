/**
 * @file useStyleSync queue lifecycle tests
 *
 * Accessed via: Right sidebar style controls in the VS Code preview panel
 * Assumptions: pending style writes are scoped to the selected element and component file.
 * Past bugs: stale trailing debounce writes survived test teardown and triggered VS Code applyEdit conflicts.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
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

describe('useStyleSync', () => {
  it('cancels trailing style writes when the component file changes', async () => {
    const updateStyles = mock(async () => {});
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
      result.current.syncStyleChange('paddingLeft', '16px', { debounceOnly: true });
    });

    rerender({
      filePath: 'src/components/Profile.tsx',
      selectedIds: ['profile-root'],
    });

    await act(waitPastDebounce);

    expect(updateStyles).not.toHaveBeenCalled();
  });

  it('flushes trailing style writes while selection and component file remain stable', async () => {
    const updateStyles = mock(async () => {});
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
      result.current.syncStyleChange('paddingLeft', '16px', { debounceOnly: true });
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
});
