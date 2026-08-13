/**
 * @file Tests for gitStore — focuses on the initial git-status fetch wiring.
 *
 * Accessed via: the SaaS Editor mounts the listener on project load
 * (CanvasEditor.tsx -> useGitStore.getState().setupGitStatusListener()).
 * Assumptions: the visible Push-button badge (SidebarHeader.tsx) reads the
 * summary fields `unpushedFileCount` / `hasUnpushedChanges`, which are populated
 * by SSE events AND must be primed by an initial fetch on listener setup so the
 * count shows immediately on load (not only after the first edit).
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockAuthFetch = mock(async (_input: string, _init?: RequestInit) => {
  return new Response(JSON.stringify({ success: false }), { status: 200 });
});

mock.module('@/utils/authFetch', () => ({
  authFetch: mockAuthFetch,
}));

const { useGitStore } = await import('../gitStore');

function statusResponse(files: Array<{ path: string; index: string; working_dir: string }>) {
  return new Response(JSON.stringify({ success: true, status: { files } }), { status: 200 });
}

const initialState = useGitStore.getState();

describe('gitStore', () => {
  beforeEach(() => {
    mockAuthFetch.mockClear();
    useGitStore.setState({
      changedFiles: [],
      isLoadingChanges: false,
      hasUnpushedChanges: false,
      unpushedFileCount: 0,
    });
  });

  afterEach(() => {
    useGitStore.setState(initialState);
  });

  describe('fetchChangedFiles', () => {
    test('populates both changedFiles and the summary fields the badge reads', async () => {
      mockAuthFetch.mockImplementationOnce(async () =>
        statusResponse([
          { path: 'a.tsx', index: ' ', working_dir: 'M' },
          { path: 'b.tsx', index: 'M', working_dir: ' ' },
        ]),
      );

      await useGitStore.getState().fetchChangedFiles();

      const state = useGitStore.getState();
      expect(state.changedFiles).toHaveLength(2);
      // The visible Push-button badge reads these summary fields, not changedFiles.
      expect(state.unpushedFileCount).toBe(2);
      expect(state.hasUnpushedChanges).toBe(true);
    });

    test('clears summary fields when there are no changes', async () => {
      useGitStore.setState({ hasUnpushedChanges: true, unpushedFileCount: 5 });
      mockAuthFetch.mockImplementationOnce(async () => statusResponse([]));

      await useGitStore.getState().fetchChangedFiles();

      const state = useGitStore.getState();
      expect(state.changedFiles).toHaveLength(0);
      expect(state.unpushedFileCount).toBe(0);
      expect(state.hasUnpushedChanges).toBe(false);
    });
  });

  describe('setupGitStatusListener', () => {
    test('performs an initial fetch on setup so the badge count appears before any edit', async () => {
      mockAuthFetch.mockImplementationOnce(async () =>
        statusResponse([{ path: 'a.tsx', index: ' ', working_dir: 'M' }]),
      );

      const cleanup = useGitStore.getState().setupGitStatusListener();
      // Let the initial fetch promise resolve.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      const state = useGitStore.getState();
      expect(mockAuthFetch).toHaveBeenCalledWith('/api/git/status');
      expect(state.unpushedFileCount).toBe(1);
      expect(state.hasUnpushedChanges).toBe(true);

      cleanup();
    });

    test('still updates summary fields from a git_status_changed SSE event', async () => {
      mockAuthFetch.mockImplementationOnce(async () => statusResponse([]));

      const cleanup = useGitStore.getState().setupGitStatusListener();
      await new Promise((r) => setTimeout(r, 0));

      window.dispatchEvent(new CustomEvent('git_status_changed', { detail: { hasChanges: true, fileCount: 3 } }));

      const state = useGitStore.getState();
      expect(state.unpushedFileCount).toBe(3);
      expect(state.hasUnpushedChanges).toBe(true);

      cleanup();
    });
  });
});
