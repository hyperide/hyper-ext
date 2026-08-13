/**
 * @file Pure, testable helper for the component-only -> full-app ("app shell") transition.
 *
 * Accessed via: extension.ts's `resetPreviewToAppShell` closure delegates here. It is the single
 *   source of truth for the reverse-scope direction, shared by the automatic `preview:setScope`
 *   handler (chrome-detected prompt / HYP-487 provider-error recovery) and the command-palette
 *   "Hyper: Reset Preview to App Shell" command (the discoverable undo that replaced the removed
 *   manual scope button).
 *
 * Why this exists: the transition is "delete `.hyperide/preview.tsx`, let the PreviewModeManager
 *   FSWatch fire onWrapperDeleted -> setIsolatedMode(false)". The subtlety is the missing-file
 *   case: VSCodeFileIO.deleteFile -> workspace.fs.delete THROWS FileNotFound, so a delete that
 *   races a concurrent reset (or runs when already in app-shell) turns a no-op full-app request —
 *   including the fire-and-forget `preview:setScope` router path — into an unhandled rejection.
 *   The helper is therefore idempotent two ways: it skips the delete when the wrapper is absent
 *   AND swallows a not-found thrown by the delete itself (TOCTOU: the file can vanish between the
 *   existence check and the delete). Both branches are pinned by unit tests.
 */

import type { FileIO } from '@lib/ast/file-io';

/**
 * The minimal IO surface this helper needs. `deleteFile` is REQUIRED here even though it is
 * optional on FileIO: deletion is the whole job, and the only caller (VSCodeFileIO) always
 * implements it — making it optional would let "wrapper exists but can't be deleted" masquerade
 * as success and leave the user stuck in isolated mode.
 */
type ResetFileIO = Pick<FileIO, 'access'> & Required<Pick<FileIO, 'deleteFile'>>;

/** A filesystem error that means "the path is already gone" — treat as the desired end state. */
function isFileNotFound(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ENOENT' || code === 'FileNotFound') return true;
  const message = err instanceof Error ? err.message : String(err);
  return /not\s*found|enoent|no such file/i.test(message);
}

/**
 * Reset the preview to the full app shell by deleting the isolation wrapper at `wrapperPath`.
 * Idempotent: a missing wrapper (absent up front, or removed by a concurrent reset between the
 * existence check and the delete) is a clean no-op, never a throw. Any OTHER error (EACCES,
 * ENOTDIR, a transient VS Code FS failure) is surfaced, not swallowed — only "not found" is benign.
 *
 * @returns `true` when a wrapper was present and removed, `false` when already in app-shell mode.
 */
export async function resetPreviewToAppShell(io: ResetFileIO, wrapperPath: string): Promise<boolean> {
  const existed = await io
    .access(wrapperPath)
    .then(() => true)
    .catch((err: unknown) => {
      // A genuine "not found" means already in app-shell. A permission / ENOTDIR / transient
      // failure is NOT "absent" — surface it so the command reports the real error instead of a
      // false "already in app-shell".
      if (isFileNotFound(err)) return false;
      throw err;
    });
  if (!existed) return false;
  try {
    await io.deleteFile(wrapperPath);
  } catch (err) {
    // TOCTOU: the wrapper vanished after the access() check (e.g. a concurrent reset). The
    // end state is the one we wanted — app-shell — so a not-found delete is success, not an error.
    if (!isFileNotFound(err)) throw err;
  }
  return true;
}
