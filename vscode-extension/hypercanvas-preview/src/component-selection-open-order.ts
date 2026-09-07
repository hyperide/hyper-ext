/**
 * @file Open-order helper for the Explorer "click a component" flow.
 *
 * Accessed via: extension.ts's handleComponentSelected (stateHub.onChange
 *   listener), once per `currentComponent` selection edge.
 * Assumptions: the caller supplies its own openTextDocument/showTextDocument
 *   (real vscode.workspace/vscode.window in production, mocks in tests) and a
 *   revealPreview callback that creates-or-shows the Hyper Canvas preview
 *   panel. Extracted from extension.ts so the ordering invariant below is
 *   unit-testable against the REAL function, not a hand-copied simulation
 *   (extension.ts itself is hard to harness in isolation — see the note next
 *   to isUiPrimitive's call site).
 * Past bugs: HYP-1372 — clicking a component in Hyper Explorer stopped
 *   opening a split view; the file landed as a second tab in the SAME editor
 *   group as "Hyper Canvas". Confirmed via the Playwright/CDP e2e harness:
 *   the FIRST Explorer click in a fresh VS Code window (no editor group open
 *   yet) always failed to split (editor-group-container count stayed 1);
 *   the SECOND click on a different component always succeeded (count 2) —
 *   exactly Alex's report ("first click never opens a split, second click
 *   always does"). Root cause: `previewPanel.createOrShow(ViewColumn.Two)`
 *   only produces a genuine split relative to an EXISTING ViewColumn.One.
 *   Calling it before any text editor is open has nothing at column One to
 *   split beside, so VS Code collapses the webview into the sole (first)
 *   group; the file's subsequent `showTextDocument(ViewColumn.One)` then
 *   resolves into that SAME group. By the second click, the first click's
 *   own (mis-split) file-open already created a real column One, so the
 *   preview panel's reveal finally has something concrete to split beside.
 */
import * as vscode from 'vscode';

/** Injected VS Code entry points + the preview-reveal callback. */
export interface OpenComponentFileThenRevealPreviewDeps {
  openTextDocument: (uri: vscode.Uri) => Thenable<vscode.TextDocument>;
  showTextDocument: (
    doc: vscode.TextDocument,
    options: vscode.TextDocumentShowOptions,
  ) => Thenable<vscode.TextEditor>;
  /** Creates-or-shows the Hyper Canvas preview panel at the given column. */
  revealPreview: (column: vscode.ViewColumn) => void;
}

/**
 * How long to wait for the file to open before revealing the preview panel
 * anyway. A Remote-SSH/WSL/virtual-filesystem provider can leave
 * openTextDocument/showTextDocument's Thenable pending indefinitely (not
 * rejected — genuinely never settling), and revealPreview previously ran
 * synchronously BEFORE any file I/O; without this bound, a hang would leave
 * the preview panel stuck closed forever instead of just losing the split
 * ordering guarantee for that one selection (review finding on HYP-1372).
 */
const REVEAL_PREVIEW_FALLBACK_TIMEOUT_MS = 5000;

/**
 * Open `absPath` in ViewColumn.One, THEN reveal the preview panel at
 * ViewColumn.Two — in that order, but bounded: if the file hasn't finished
 * opening within REVEAL_PREVIEW_FALLBACK_TIMEOUT_MS, reveal the preview panel
 * anyway rather than block on it forever (see that constant's doc comment).
 * The order is load-bearing (HYP-1372, see file header) in the common case:
 * opening the file first materializes a real ViewColumn.One (when none
 * existed yet), so the preview panel that follows always has something
 * concrete to split beside. When ViewColumn.One already exists (e.g. the
 * user had a file open already) this ordering is a behavioral no-op —
 * showTextDocument/reveal still resolve to the same columns either way.
 *
 * Both stages are defensively isolated so neither can leave an unhandled
 * promise rejection. `showTextDocument` (not just `openTextDocument`) can
 * reject — a disposed editor, a workspace switch, or another panel closing
 * all editors mid-flight — and an unhandled rejection here surfaces in VS
 * Code as an "Unhandled rejection…" error toast, which trips every
 * preview-render "renders without errors" e2e assertion that greps for
 * /fatal|crash|unhandled/i. A failed file open is logged and does NOT
 * prevent the preview panel from opening; a failure inside `revealPreview`
 * itself (e.g. called against a disposed panel mid-teardown) is likewise
 * caught and logged, never thrown.
 */
export async function openComponentFileThenRevealPreview(
  absPath: string,
  deps: OpenComponentFileThenRevealPreviewDeps,
  fallbackTimeoutMs = REVEAL_PREVIEW_FALLBACK_TIMEOUT_MS,
): Promise<void> {
  const openAndShow = (async () => {
    try {
      const doc = await deps.openTextDocument(vscode.Uri.file(absPath));
      await deps.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: true,
        preview: true,
      });
    } catch (err) {
      console.error('[HyperIDE] Failed to open component file:', err);
    }
  })();

  const timedOut = Symbol('timed-out');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), fallbackTimeoutMs);
  });
  const settledFirst = await Promise.race([openAndShow.then(() => undefined), timeoutPromise]);
  // Cancel the fallback timer once either side has settled — an uncleared
  // timer would otherwise keep the process/test runner's event loop alive
  // for the full fallbackTimeoutMs even on the fast (common) path.
  clearTimeout(timer);
  if (settledFirst === timedOut) {
    console.warn(
      `[HyperIDE] Component file did not open within ${fallbackTimeoutMs}ms — revealing the preview panel anyway ` +
        'instead of leaving it stuck closed. The file open keeps running in the background and will still land ' +
        'once it settles; only the split-ordering guarantee is lost for this one selection.',
    );
  }

  try {
    // ViewColumn.Two (not Beside): Beside resolves to "the column beside
    // whatever's currently active", which in a single-column E2E layout
    // (or any layout with no active editor yet) resolves to column 2
    // BEFORE column 2 exists — VS Code then places the webview off-screen
    // rather than creating a visible split (HYP-363). ViewColumn.Two is an
    // absolute column request, so it forces a visible split in any layout.
    deps.revealPreview(vscode.ViewColumn.Two);
  } catch (err) {
    console.error('[HyperIDE] Failed to open/reveal preview panel:', err);
  }
}
