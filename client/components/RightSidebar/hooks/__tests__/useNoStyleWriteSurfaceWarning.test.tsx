/**
 * @file HYP-1294 — useNoStyleWriteSurfaceWarning tests
 *
 * Accessed via: bun test client/components/RightSidebar/hooks/__tests__/useNoStyleWriteSurfaceWarning.test.tsx
 * Covers: (1) the pure content builder's copy for a named tag / fallback tag / null componentPath;
 * (2) the hook only toasts when `componentPropSurface` reports NO known style-write channel;
 * (3) dedupe — a re-render with the same (componentPath, selectedId) and the same verdict does not
 * re-toast; (4) the toast is dismissed when the selection moves to a different element/file, and
 * when the facts flip to forwarding.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ComponentPropSurfaceFacts } from '@lib/style-read/types';

interface ToastCallArgs {
  title: string;
  description?: string;
  duration?: number;
  action?: unknown;
}

const mockDismiss = mock(() => {});
const mockToast = mock((_args: ToastCallArgs) => ({ id: 'toast-1', dismiss: mockDismiss, update: mock(() => {}) }));

mock.module('@/hooks/use-toast', () => ({
  toast: mockToast,
}));

const { buildNoStyleWriteSurfaceWarningContent, useNoStyleWriteSurfaceWarning } = await import(
  '../useNoStyleWriteSurfaceWarning'
);

function facts(partial: Partial<ComponentPropSurfaceFacts> = {}): ComponentPropSurfaceFacts {
  return {
    acceptsClassName: false,
    acceptsStyle: false,
    acceptsCssProp: false,
    acceptsSxProp: false,
    recursivePropsSchemaAvailable: false,
    styleLikeProps: [],
    semanticProps: [],
    ...partial,
  };
}

describe('buildNoStyleWriteSurfaceWarningContent (pure)', () => {
  it('names the tag in title/description/prompt when tagType is known', () => {
    const content = buildNoStyleWriteSurfaceWarningContent('Layout', '/project/src/App.tsx');
    expect(content.description).toContain('<Layout>');
    expect(content.prompt).toContain('<Layout>');
    expect(content.prompt).toContain('/project/src/App.tsx');
    // A PRE-write warning must never claim a write already failed/reverted (contrast the
    // POST-write buildStyleAutoFixPrompt).
    expect(content.prompt.toLowerCase()).not.toContain('reverted');
  });

  it('falls back to a generic phrase when tagType is empty', () => {
    const content = buildNoStyleWriteSurfaceWarningContent('', '/project/src/App.tsx');
    expect(content.description).toContain('<this component>');
  });

  it('falls back to a generic phrase when componentPath is null', () => {
    const content = buildNoStyleWriteSurfaceWarningContent('Layout', null);
    expect(content.prompt).toContain('this file');
  });
});

describe('useNoStyleWriteSurfaceWarning', () => {
  const openAIChat = mock(() => {});

  beforeEach(() => {
    mockToast.mockClear();
    mockDismiss.mockClear();
    openAIChat.mockClear();
  });
  afterEach(() => {
    mockToast.mockClear();
    mockDismiss.mockClear();
  });

  it('does nothing when componentPropSurface is undefined (facts not yet fetched)', () => {
    renderHook(() =>
      useNoStyleWriteSurfaceWarning({
        componentPropSurface: undefined,
        tagType: 'Layout',
        selectedId: 'App.tsx:3:2',
        componentPath: '/project/src/App.tsx',
        openAIChat,
      }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('does nothing when the element accepts a style channel', () => {
    renderHook(() =>
      useNoStyleWriteSurfaceWarning({
        componentPropSurface: facts({ acceptsClassName: true }),
        tagType: 'Button',
        selectedId: 'App.tsx:3:2',
        componentPath: '/project/src/App.tsx',
        openAIChat,
      }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('toasts once when componentPropSurface reports no known channel at all', () => {
    renderHook(() =>
      useNoStyleWriteSurfaceWarning({
        componentPropSurface: facts(),
        tagType: 'Layout',
        selectedId: 'App.tsx:3:2',
        componentPath: '/project/src/App.tsx',
        openAIChat,
      }),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
    const call = mockToast.mock.calls[0][0];
    expect(call.title).toBe('This component may not accept style edits');
    expect(call.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it('does NOT re-toast on a re-render for the same element with the same verdict (refreshKey churn)', () => {
    const { rerender } = renderHook(
      (props: { surface: ComponentPropSurfaceFacts }) =>
        useNoStyleWriteSurfaceWarning({
          componentPropSurface: props.surface,
          tagType: 'Layout',
          selectedId: 'App.tsx:3:2',
          componentPath: '/project/src/App.tsx',
          openAIChat,
        }),
      { initialProps: { surface: facts() } },
    );
    expect(mockToast).toHaveBeenCalledTimes(1);

    // A refetch (e.g. refreshKey bump) resolves a NEW object with the SAME verdict.
    rerender({ surface: facts() });
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it('dismisses the toast and clears the dedupe key when the facts flip to forwarding', () => {
    const { rerender } = renderHook(
      (props: { surface: ComponentPropSurfaceFacts }) =>
        useNoStyleWriteSurfaceWarning({
          componentPropSurface: props.surface,
          tagType: 'Layout',
          selectedId: 'App.tsx:3:2',
          componentPath: '/project/src/App.tsx',
          openAIChat,
        }),
      { initialProps: { surface: facts() } },
    );
    expect(mockToast).toHaveBeenCalledTimes(1);

    rerender({ surface: facts({ acceptsClassName: true }) });
    expect(mockDismiss).toHaveBeenCalledTimes(1);

    // Flipping back to non-forwarding re-shows it (dedupe key was cleared, not just left stale).
    rerender({ surface: facts() });
    expect(mockToast).toHaveBeenCalledTimes(2);
  });

  it('dismisses the previous toast and shows a new one when the selection moves to a different element', () => {
    const { rerender } = renderHook(
      (props: { selectedId: string }) =>
        useNoStyleWriteSurfaceWarning({
          componentPropSurface: facts(),
          tagType: 'Layout',
          selectedId: props.selectedId,
          componentPath: '/project/src/App.tsx',
          openAIChat,
        }),
      { initialProps: { selectedId: 'App.tsx:3:2' } },
    );
    expect(mockToast).toHaveBeenCalledTimes(1);

    rerender({ selectedId: 'App.tsx:9:4' });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(2);
  });

  it('replaces the toast when tagType changes for the same (componentPath, selectedId)', () => {
    const { rerender } = renderHook(
      (props: { tagType: string }) =>
        useNoStyleWriteSurfaceWarning({
          componentPropSurface: facts(),
          tagType: props.tagType,
          selectedId: 'App.tsx:3:2',
          componentPath: '/project/src/App.tsx',
          openAIChat,
        }),
      { initialProps: { tagType: 'Layout' } },
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(mockToast.mock.calls[0][0].description).toContain('<Layout>');

    rerender({ tagType: 'Wrapper' });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledTimes(2);
    expect(mockToast.mock.calls[1][0].description).toContain('<Wrapper>');
  });

  // Regression for a real StrictMode-reproducible bug (review finding, HYP-1294): React
  // StrictMode's dev-mode double-invoke runs mount -> effect cleanup -> mount again WITHOUT
  // destroying the component or its refs. Before the fix, the cleanup dismissed the toast but
  // left the dedupe key set, so the simulated remount's main effect saw the stale key and
  // early-returned — the warning appeared once, then vanished permanently. `toHaveBeenCalledTimes`
  // isn't reliable here across bun's StrictMode double-invoke interleaving, so assert on the
  // outcome that actually matters: a toast is showing (not dismissed-and-never-recreated) once
  // StrictMode's simulated cycle settles.
  it('still shows the warning after StrictMode\'s mount -> cleanup -> remount cycle settles', () => {
    renderHook(
      () =>
        useNoStyleWriteSurfaceWarning({
          componentPropSurface: facts(),
          tagType: 'Layout',
          selectedId: 'App.tsx:3:2',
          componentPath: '/project/src/App.tsx',
          openAIChat,
        }),
      { wrapper: StrictMode },
    );

    // Fixed: the last toast() call outnumbers dismiss() calls by one — a toast is currently
    // showing. Buggy (pre-fix): toast() called once, dismiss() called once, nothing recreated —
    // counts would be EQUAL, not toast > dismiss.
    expect(mockToast.mock.calls.length).toBeGreaterThan(mockDismiss.mock.calls.length);
  });
});
