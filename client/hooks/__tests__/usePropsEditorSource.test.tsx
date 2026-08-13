/**
 * @file Tests for the platform-converged PropsEditor data source (HYP-709), EXT realm.
 *
 * Accessed via: PropsEditor in the VS Code extension webview. The SaaS (engine) realm is
 * covered by `PropsSection.test.tsx`; this file pins the ext branch — selection/AST from
 * SharedEditorState, schema/tokens over canvasRPC, writes via usePlatformAst().updateProps —
 * with NO CanvasEngineProvider present (the throwing engine hooks must NOT fire).
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { renderHook, waitFor } from '@testing-library/react';

interface SharedState {
  selectedIds: string[];
  currentComponent: { name: string; path: string } | null;
  astStructure: unknown[] | null;
}

const sharedState: SharedState = {
  selectedIds: [],
  currentComponent: null,
  astStructure: null,
};

const rpcCalls: Array<{ type: string }> = [];
const updateCalls: Array<{ elementId: string; filePath: string; props: Record<string, unknown> }> = [];

// No CanvasEngineProvider in the ext → the optional engine hooks return null/[].
mock.module('@/lib/canvas-engine', () => ({
  useCanvasEngineOptional: () => null,
  useSelectedIdsOptional: () => [] as string[],
}));

// Stable canvas singleton — the real PlatformProvider memoizes it; a fresh identity each
// render would re-trigger the schema/tokens effects and drop the in-flight result.
const stableCanvas = { sendEvent() {}, onEvent: () => () => {} };
mock.module('@/lib/platform', () => ({
  usePlatformContext: () => 'vscode-webview',
  usePlatformCanvas: () => stableCanvas,
  usePlatformAst: () => ({
    updateProps: async (p: { elementId: string; filePath: string; props: Record<string, unknown> }) => {
      updateCalls.push(p);
    },
  }),
  canvasRPC: async (_canvas: unknown, request: { type: string }) => {
    rpcCalls.push({ type: request.type });
    if (request.type === 'tamagui:getTokens') {
      return { success: true, data: { tokens: { color: ['$blue1', '$red'], size: ['$1'], space: ['$sm'] } } };
    }
    if (request.type === 'component:propsTypes') {
      return {
        success: true,
        data: { componentName: 'Button', props: { label: { type: 'string', required: false } } },
      };
    }
    return { success: false };
  },
}));

mock.module('@/lib/platform/shared-editor-state', () => ({
  useSelectedIds: () => sharedState.selectedIds,
  useSharedEditorState: (selector: (s: SharedState) => unknown) => selector(sharedState),
}));

mock.module('@/utils/authFetch', () => ({
  authFetch: async () => ({ ok: false, status: 404, json: async () => ({}) }),
}));

const { usePropsEditorSelection, useTamaguiTokensSource, usePropsSchemaSource, usePropWriter } =
  await import('../usePropsEditorSource');

afterEach(() => {
  rpcCalls.length = 0;
  updateCalls.length = 0;
  sharedState.selectedIds = [];
  sharedState.currentComponent = null;
  sharedState.astStructure = null;
});

describe('usePropsEditorSelection (ext / SharedEditorState)', () => {
  it('resolves elementType from the ext TreeNode by matching the nodeRef location to loc', () => {
    // Ext astStructure is a TreeNode tree: selection id is a `path:line:column` nodeRef, the node
    // id is a UUID (not the nodeRef), type is the category 'component', and the JSX tag is in label.
    sharedState.selectedIds = ['src/Screen.tsx:12:6'];
    sharedState.currentComponent = { name: 'Screen', path: 'src/Screen.tsx' };
    sharedState.astStructure = [
      {
        id: 'uuid-root',
        type: 'component',
        label: 'View',
        loc: { start: { line: 4, column: 2 } },
        children: [
          {
            id: 'uuid-btn',
            type: 'component',
            label: 'PressableButton',
            loc: { start: { line: 12, column: 6 } },
            children: [],
          },
        ],
      },
    ];

    const { result } = renderHook(() => usePropsEditorSelection());
    expect(result.current.selectedId).toBe('src/Screen.tsx:12:6');
    expect(result.current.filePath).toBe('src/Screen.tsx');
    expect(result.current.elementType).toBe('PressableButton');
    expect(result.current.astNode?.type).toBe('PressableButton');
  });

  it('strips label decoration to recover the JSX tag (e.g. `Text "hi"` -> Text)', () => {
    sharedState.selectedIds = ['src/Screen.tsx:20:8'];
    sharedState.currentComponent = { name: 'Screen', path: 'src/Screen.tsx' };
    sharedState.astStructure = [
      { id: 'u1', type: 'component', label: 'Text "Deliver to"', loc: { start: { line: 20, column: 8 } } },
    ];
    const { result } = renderHook(() => usePropsEditorSelection());
    expect(result.current.elementType).toBe('Text');
  });

  it('returns nulls when nothing is selected', () => {
    const { result } = renderHook(() => usePropsEditorSelection());
    expect(result.current.selectedId).toBeNull();
    expect(result.current.astNode).toBeNull();
  });
});

describe('useTamaguiTokensSource (ext / canvasRPC)', () => {
  it('fetches tokens over the tamagui:getTokens RPC', async () => {
    const { result } = renderHook(() => useTamaguiTokensSource());
    await waitFor(() => expect(result.current.tokens.color.length).toBeGreaterThan(0));
    expect(result.current.tokens.color).toContain('$blue1');
    expect(rpcCalls.some((c) => c.type === 'tamagui:getTokens')).toBe(true);
  });
});

describe('usePropsSchemaSource (ext / canvasRPC)', () => {
  it('fetches a typed schema over the component:propsTypes RPC', async () => {
    const { result } = renderHook(() => usePropsSchemaSource('src/Button.tsx', 'Button'));
    await waitFor(() => expect(result.current.schema).not.toBeNull());
    expect(result.current.schema?.props.label).toBeTruthy();
    expect(rpcCalls.some((c) => c.type === 'component:propsTypes')).toBe(true);
  });

  it('skips HTML elements (lowercase) — no RPC, no schema', async () => {
    const { result } = renderHook(() => usePropsSchemaSource('src/Button.tsx', 'div'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.schema).toBeNull();
    expect(rpcCalls.some((c) => c.type === 'component:propsTypes')).toBe(false);
  });
});

describe('usePropWriter (ext / platform AST)', () => {
  it('writes via usePlatformAst().updateProps when no engine is present', () => {
    const { result } = renderHook(() => usePropWriter('btn-1', 'src/Button.tsx'));
    result.current('label', 'Click');
    expect(updateCalls).toEqual([{ elementId: 'btn-1', filePath: 'src/Button.tsx', props: { label: 'Click' } }]);
  });

  it('is a no-op without a selection', () => {
    const { result } = renderHook(() => usePropWriter(null, null));
    result.current('label', 'Click');
    expect(updateCalls).toEqual([]);
  });
});
