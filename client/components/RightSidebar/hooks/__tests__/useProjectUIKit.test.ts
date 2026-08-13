/**
 * @file useProjectUIKit dependency-tracking tests
 *
 * Accessed via: Right sidebar — derives UI kit (tamagui/tailwind/none) from active project.
 * Assumptions: when `activeProject` props (id, name, publicDir) change between renders,
 *   the hook MUST re-derive `activeProjectName` / `publicDirExists` to match.
 * Past bugs: dep array was `[activeProject?.id]` only — name/publicDir changes with the
 *   same id never propagated into the hook's returned state (stale UI in sidebar).
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockAuthFetch = mock((url: string, _opts?: RequestInit): Promise<Response> => {
  if (url.includes('/dependencies')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({ tamagui: false, '@tamagui/core': false, '@tamagui/cli': false, tailwindcss: false }),
        {
          status: 200,
        },
      ),
    );
  }
  if (url.includes('/detect-public-dir')) {
    return Promise.resolve(new Response(JSON.stringify({ publicDir: null }), { status: 200 }));
  }
  return Promise.resolve(new Response('{}', { status: 200 }));
});

mock.module('@/utils/authFetch', () => ({
  authFetch: mockAuthFetch,
}));

const { useProjectUIKit } = await import('../useProjectUIKit');

type Active = Parameters<typeof useProjectUIKit>[0];

const baseProject: Active = {
  id: 'proj-1',
  name: 'Alpha',
  status: 'running',
  publicDir: '/pub',
};

describe('useProjectUIKit — dependency tracking', () => {
  beforeEach(() => {
    mockAuthFetch.mockClear();
  });

  afterEach(() => {
    mockAuthFetch.mockClear();
  });

  it('updates activeProjectName when name changes while id stays the same', async () => {
    const { result, rerender } = renderHook(({ project }) => useProjectUIKit(project), {
      initialProps: { project: baseProject },
    });

    await waitFor(() => {
      expect(result.current.activeProjectName).toBe('Alpha');
    });

    await act(async () => {
      rerender({ project: { ...baseProject, name: 'Beta' } });
    });

    await waitFor(() => {
      expect(result.current.activeProjectName).toBe('Beta');
    });
  });

  it('updates publicDirExists when publicDir disappears while id stays the same', async () => {
    const { result, rerender } = renderHook(({ project }) => useProjectUIKit(project), {
      initialProps: { project: baseProject },
    });

    await waitFor(() => {
      expect(result.current.publicDirExists).toBe(true);
    });

    await act(async () => {
      rerender({ project: { ...baseProject, publicDir: undefined } });
    });

    await waitFor(() => {
      expect(result.current.publicDirExists).toBe(false);
    });
  });

  it('does not overwrite fresh state when a superseded in-flight fetch resolves late', async () => {
    let resolveFirstDeps: ((r: Response) => void) | null = null;
    let depsCalls = 0;

    mockAuthFetch.mockImplementation((url: string) => {
      if (url.includes('/detect-public-dir')) {
        return Promise.resolve(new Response(JSON.stringify({ publicDir: null }), { status: 200 }));
      }
      if (url.includes('/dependencies')) {
        depsCalls++;
        if (depsCalls === 1) {
          // Stale request — hold open until we resolve below
          return new Promise<Response>((resolve) => {
            resolveFirstDeps = resolve;
          });
        }
        // Fresh request — resolves immediately with tamagui detected
        return Promise.resolve(new Response(JSON.stringify({ tamagui: true }), { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    const { result, rerender } = renderHook(({ project }) => useProjectUIKit(project), {
      initialProps: { project: baseProject },
    });

    // Supersede the first request before it resolves.
    await act(async () => {
      rerender({ project: { ...baseProject, name: 'Beta' } });
    });

    // Fresh request lands first.
    await waitFor(() => {
      expect(result.current.projectUIKit).toBe('tamagui');
    });

    // Now let the stale request resolve with a contradicting payload.
    await act(async () => {
      resolveFirstDeps?.(new Response(JSON.stringify({ tailwindcss: true }), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Stale resolution MUST NOT clobber the fresh result.
    expect(result.current.projectUIKit).toBe('tamagui');
  });
});
