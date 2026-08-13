/**
 * @file PropsSection tests — restored inspector props editor (HYP-437)
 *
 * Accessed via: RightSidebar inspector body (mounts <PropsSection /> for a single
 * selected source element that exposes a typed props schema).
 *
 * Assumptions:
 *   - Current prop VALUES are read from the selected node in
 *     `engine.getRoot().metadata.astStructure` (per-node `{ id, type, props }`).
 *   - The props SCHEMA is fetched from `/api/component-props-types` (same endpoint
 *     InstanceEditPopup uses — proven-live).
 *   - Edits route through `engine.updateASTProp(elementId, filePath, propName, value)`
 *     — the source-AST write path, NOT the canvas.json instance REST path that
 *     InstanceEditPopup uses. Different surface (source element vs placed instance).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';

// ─── Shared mutable mock state ──────────────────────────────────────────────

type ASTNodeLike = { id: string; type: string; props?: Record<string, unknown>; children?: ASTNodeLike[] };

interface UpdateCall {
  elementId: string;
  filePath: string;
  propName: string;
  value: unknown;
}

const mockState = {
  selectedIds: [] as string[],
  filePath: 'src/Button.tsx' as string | undefined,
  astStructure: [] as ASTNodeLike[],
  updateCalls: [] as UpdateCall[],
  // Component names whose /api/component-props-types lookup should 404 (silent miss).
  noSchemaTypes: [] as string[],
};

const fakeEngine = {
  getRoot: () => ({
    id: 'root',
    children: [] as string[],
    metadata: {
      filePath: mockState.filePath,
      astStructure: mockState.astStructure,
    },
  }),
  getInstance: () => null,
  updateASTProp(elementId: string, filePath: string, propName: string, value: unknown) {
    mockState.updateCalls.push({ elementId, filePath, propName, value });
  },
};

// ─── Module mocks (before importing the component under test) ────────────────

mock.module('@/lib/canvas-engine', () => ({
  useCanvasEngine: () => fakeEngine,
  useSelectedIds: () => mockState.selectedIds,
}));

mock.module('@/hooks/useTamaguiTokens', () => ({
  useTamaguiTokens: () => ({ tokens: { color: [], size: [], space: [] }, loading: false, error: null }),
}));

mock.module('@/utils/authFetch', () => ({
  authFetch: async (url: string) => {
    if (url.includes('/api/component-props-types')) {
      const compName = new URL(url, 'http://x').searchParams.get('componentName') ?? '';
      if (mockState.noSchemaTypes.includes(compName)) {
        return { ok: false, status: 404, json: async () => ({ success: false }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          componentName: 'Button',
          props: {
            label: { type: 'string', required: false, description: 'Button label' },
            disabled: { type: 'boolean', required: false },
          },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ success: false }) };
  },
}));

const { PropsSection } = await import('../PropsSection');

beforeEach(() => {
  mockState.selectedIds = ['btn-1'];
  mockState.filePath = 'src/Button.tsx';
  mockState.astStructure = [{ id: 'btn-1', type: 'Button', props: { label: 'Click me' } }];
  mockState.updateCalls = [];
  mockState.noSchemaTypes = [];
});

afterEach(() => {
  mockState.updateCalls = [];
});

describe('PropsSection', () => {
  it('renders the props form for a selected element with a typed schema', async () => {
    const { findByTestId, getByDisplayValue } = render(<PropsSection />);

    expect(await findByTestId('PropsEditor')).toBeTruthy();
    // Current value of `label` read from astStructure node props
    expect(getByDisplayValue('Click me')).toBeTruthy();
  });

  it('routes prop edits through engine.updateASTProp (source-AST write path)', async () => {
    const { getByDisplayValue } = render(<PropsSection />);

    const labelInput = await waitFor(() => getByDisplayValue('Click me'));
    fireEvent.change(labelInput, { target: { value: 'Submit' } });

    expect(mockState.updateCalls).toEqual([
      { elementId: 'btn-1', filePath: 'src/Button.tsx', propName: 'label', value: 'Submit' },
    ]);
  });

  it('renders nothing when no file path is available', () => {
    mockState.filePath = undefined;
    const { queryByTestId } = render(<PropsSection />);
    expect(queryByTestId('PropsEditor')).toBeNull();
  });

  it('clears stale props when switching to a component whose schema is a silent miss', async () => {
    // Start on Button (has schema), then switch selection to Card whose schema
    // lookup 404s. The Button props must NOT linger for the Card selection.
    const { getByDisplayValue, queryByDisplayValue, queryByTestId, rerender } = render(<PropsSection />);
    await waitFor(() => getByDisplayValue('Click me'));

    mockState.astStructure = [{ id: 'card-1', type: 'Card', props: {} }];
    mockState.selectedIds = ['card-1'];
    mockState.noSchemaTypes = ['Card'];
    rerender(<PropsSection />);

    await waitFor(() => {
      expect(queryByDisplayValue('Click me')).toBeNull();
    });
    expect(queryByTestId('PropsEditor')).toBeNull();
  });

  it('renders nothing (no stuck loading) for an HTML element selection', async () => {
    // Lowercase element type → no TS props schema. Must clear loading and hide,
    // not get stuck on "Loading props..." (regression guard for the stale-fetch fix).
    mockState.astStructure = [{ id: 'div-1', type: 'div', props: {} }];
    mockState.selectedIds = ['div-1'];

    const { queryByText, queryByTestId } = render(<PropsSection />);

    await waitFor(() => {
      expect(queryByText('Loading props...')).toBeNull();
    });
    expect(queryByTestId('PropsEditor')).toBeNull();
  });
});
