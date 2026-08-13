/**
 * @file Tests for resetPreviewToAppShell — the component-only -> full-app transition helper.
 *
 * Accessed via: extension.ts's `resetActivePreviewToAppShell` closure and the command-palette
 * "Hyper: Reset Preview to App Shell" command delegate here. The load-bearing case is the
 * MISSING wrapper: VSCodeFileIO.deleteFile -> workspace.fs.delete throws FileNotFound, so the
 * helper must guard the delete on existence — otherwise a no-op full-app request (already in
 * app-shell, or a fire-and-forget preview:setScope) becomes an error / unhandled rejection.
 */
import { describe, expect, it, mock } from 'bun:test';
import { resetPreviewToAppShell } from '../webview-preview-panel/reset-to-app-shell';

const WRAPPER = '/repo/.hyperide/preview.tsx';

describe('resetPreviewToAppShell', () => {
  it('deletes the wrapper and returns true when it exists', async () => {
    const deleteFile = mock(async () => {});
    const access = mock(async () => {}); // resolves -> file exists

    const existed = await resetPreviewToAppShell({ access, deleteFile }, WRAPPER);

    expect(existed).toBe(true);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(WRAPPER);
  });

  it('is a clean no-op (no delete, no throw) when the wrapper is absent', async () => {
    const deleteFile = mock(async () => {
      throw new Error('FileNotFound'); // would throw if ever called on a missing file
    });
    const access = mock(async () => {
      throw new Error('ENOENT'); // rejects -> file does NOT exist
    });

    const existed = await resetPreviewToAppShell({ access, deleteFile }, WRAPPER);

    expect(existed).toBe(false);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('rethrows a non-not-found access error instead of reporting already-app-shell', async () => {
    const deleteFile = mock(async () => {});
    const access = mock(async () => {
      // A permission/transient FS failure is NOT "wrapper absent" — it must surface, not be
      // swallowed into a false "already in app-shell" (which would skip the delete silently).
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    await expect(resetPreviewToAppShell({ access, deleteFile }, WRAPPER)).rejects.toThrow('permission denied');
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('swallows a TOCTOU not-found delete (file vanished after the access check)', async () => {
    const access = mock(async () => {}); // existed at check time
    const deleteFile = mock(async () => {
      // A concurrent reset removed it between access() and deleteFile().
      throw Object.assign(new Error('EntryNotFound (FileSystemError)'), { code: 'FileNotFound' });
    });

    const existed = await resetPreviewToAppShell({ access, deleteFile }, WRAPPER);

    // End state is app-shell, which is what we wanted — not an error.
    expect(existed).toBe(true);
    expect(deleteFile).toHaveBeenCalledTimes(1);
  });

  it('rethrows a delete error that is NOT a missing-file error', async () => {
    const access = mock(async () => {});
    const deleteFile = mock(async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    });

    await expect(resetPreviewToAppShell({ access, deleteFile }, WRAPPER)).rejects.toThrow('permission denied');
  });
});
