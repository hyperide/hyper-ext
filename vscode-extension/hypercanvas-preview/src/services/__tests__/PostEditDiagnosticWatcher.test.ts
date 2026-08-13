/**
 * @file HYP-991 — unit tests for PostEditDiagnosticWatcher.
 *
 * Covers the before/after error-diagnostic diff and the review-driven hardening: only NEW errors
 * trigger a warning, a pre-existing error that merely SHIFTED LINES is not re-reported (multiset,
 * position-independent), non-Error severities are ignored, edited-file errors headline first, a
 * clean edit broadcasts a scoped "cleared", the native notification fires only on a real error,
 * MAX_REPORTED truncation, the debounce settle path, and the rapid-edit baseline handoff.
 *
 * The `vscode` module is the shared happy-path mock (test/mock-vscode.ts). Each test overrides
 * `vscode.languages.getDiagnostics` to script the workspace error state.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { PostEditDiagnosticWatcher, type PostEditDiagnosticSink } from '../PostEditDiagnosticWatcher';

const ERROR = 0; // vscode.DiagnosticSeverity.Error
const WARNING = 1; // vscode.DiagnosticSeverity.Warning

interface FakeDiag {
  severity: number;
  message: string;
  code?: string | number;
  range: { start: { line: number; character: number } };
}

function diag(message: string, line: number, character = 0, severity = ERROR, code?: string): FakeDiag {
  return { severity, message, code, range: { start: { line, character } } };
}

function setDiagnostics(byFile: Record<string, FakeDiag[]>): void {
  const entries = Object.entries(byFile).map(([fsPath, diags]) => [vscode.Uri.file(fsPath), diags]);
  (vscode.languages.getDiagnostics as ReturnType<typeof mock>).mockImplementation(() => entries);
}

const FILE = '/test-workspace/src/Card.tsx';
const OTHER = '/test-workspace/src/Other.tsx';

interface Recorder {
  broadcasts: unknown[];
  notified: unknown[];
  sink: PostEditDiagnosticSink;
}
function recorder(): Recorder {
  const broadcasts: unknown[] = [];
  const notified: unknown[] = [];
  return { broadcasts, notified, sink: { broadcast: (m) => broadcasts.push(m), notifyError: (w) => notified.push(w) } };
}

function makeWatcher(sink: PostEditDiagnosticSink): PostEditDiagnosticWatcher {
  return new PostEditDiagnosticWatcher(sink, { settleDebounceMs: 5, maxSettleMs: 30 });
}

describe('PostEditDiagnosticWatcher', () => {
  beforeEach(() => {
    (vscode.languages.onDidChangeDiagnostics as ReturnType<typeof mock>).mockImplementation(() => ({
      dispose: mock(),
    }));
  });

  it('broadcasts a warning AND fires the native notification when the edit introduces a NEW error', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag("Type 'string' is not assignable to type 'number'", 9, 4)] });
    await watcher.checkAfterEdit(baseline, FILE, 'Card.tsx:10:2', 'src/Card.tsx', 'ast:updateStyles');

    expect(r.broadcasts).toHaveLength(1);
    const msg = r.broadcasts[0] as { type: string; warning: { diagnostics: unknown[]; elementId: string } };
    expect(msg.type).toBe('diagnostic:postEditError');
    expect(msg.warning.elementId).toBe('Card.tsx:10:2');
    expect((msg.warning.diagnostics[0] as { line: number }).line).toBe(10); // 1-based
    expect(r.notified).toHaveLength(1); // native platform notification
  });

  it('ignores a PRE-EXISTING error even after it SHIFTS LINES (position-independent multiset)', async () => {
    setDiagnostics({ [FILE]: [diag('Cannot find name foo', 2, 0)] });
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    // Same error, now on a later line (the edit inserted lines above it) — NOT new.
    setDiagnostics({ [FILE]: [diag('Cannot find name foo', 7, 0)] });
    await watcher.checkAfterEdit(baseline, FILE, 'id', 'src/Card.tsx', 'ast:updateProps');

    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError')).toHaveLength(0);
    expect(r.notified).toHaveLength(0);
  });

  it('ignores non-Error severities (a new WARNING is not surfaced)', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag('unused var', 3, 0, WARNING)] });
    await watcher.checkAfterEdit(baseline, FILE, 'id', 'src/Card.tsx', 'ast:updateText');

    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError')).toHaveLength(0);
    expect(r.notified).toHaveLength(0);
  });

  it('a clean edit with NO standing warning broadcasts nothing', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({});
    await watcher.checkAfterEdit(baseline, FILE, 'the-el', 'src/Card.tsx', 'ast:updateStyles');

    expect(r.broadcasts).toHaveLength(0); // nothing to clear, no error to report
    expect(r.notified).toHaveLength(0);
  });

  it('a later edit that does NOT fix the error does NOT clear the standing warning', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baselineA = watcher.snapshot();

    // Edit A introduces the error → warning stands.
    setDiagnostics({ [FILE]: [diag('boom', 5, 0)] });
    await watcher.checkAfterEdit(baselineA, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');
    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError')).toHaveLength(1);

    // Edit B on the same element leaves the error in place (no NEW error, but not fixed either).
    const baselineB = watcher.snapshot();
    await watcher.checkAfterEdit(baselineB, FILE, 'X', 'src/Card.tsx', 'ast:updateProps');
    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditErrorCleared')).toHaveLength(
      0,
    );
  });

  it('a later edit that FIXES the error broadcasts a scoped cleared with the reported elementId', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baselineA = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag('boom', 5, 0)] });
    await watcher.checkAfterEdit(baselineA, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');

    const baselineB = watcher.snapshot();
    setDiagnostics({}); // the edit removed the error
    await watcher.checkAfterEdit(baselineB, FILE, 'X', 'src/Card.tsx', 'ast:updateProps');

    const cleared = r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditErrorCleared');
    expect(cleared).toHaveLength(1);
    expect((cleared[0] as { elementId: string }).elementId).toBe('X');
  });

  it('orders edited-file errors FIRST, then cross-file cascade errors', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({
      [OTHER]: [diag('cascade error in importer', 1, 0)],
      [FILE]: [diag('error in the edited file', 5, 0)],
    });
    await watcher.checkAfterEdit(baseline, FILE, 'id', 'src/Card.tsx', 'ast:moveElement');

    const msg = r.broadcasts[0] as { warning: { diagnostics: Array<{ filePath: string }> } };
    expect(msg.warning.diagnostics).toHaveLength(2);
    expect(msg.warning.diagnostics[0].filePath).toBe(FILE);
    expect(msg.warning.diagnostics[1].filePath).toBe(OTHER);
  });

  it('truncates the reported diagnostics to MAX_REPORTED_DIAGNOSTICS (5)', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: Array.from({ length: 8 }, (_, i) => diag(`err ${i}`, i, 0)) });
    await watcher.checkAfterEdit(baseline, FILE, 'id', 'src/Card.tsx', 'ast:updateStyles');

    const msg = r.broadcasts[0] as { warning: { diagnostics: unknown[] } };
    expect(msg.warning.diagnostics).toHaveLength(5);
  });

  it('settles via the trailing debounce when onDidChangeDiagnostics fires', async () => {
    let fireChange: (() => void) | undefined;
    (vscode.languages.onDidChangeDiagnostics as ReturnType<typeof mock>).mockImplementation((cb: () => void) => {
      fireChange = cb;
      return { dispose: mock() };
    });
    setDiagnostics({});
    const r = recorder();
    // Large maxSettle so the ONLY way this resolves in time is the debounce path.
    const watcher = new PostEditDiagnosticWatcher(r.sink, { settleDebounceMs: 10, maxSettleMs: 5000 });
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag('new error', 1, 0)] });
    const p = watcher.checkAfterEdit(baseline, FILE, 'id', 'src/Card.tsx', 'ast:updateStyles');
    // Simulate the TS server emitting diagnostics; the debounce (10ms) then resolves the settle.
    await new Promise((r2) => setTimeout(r2, 2));
    fireChange?.();
    await p;

    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError')).toHaveLength(1);
  });

  it('clears a standing warning when its error is fixed WITHOUT an edit (hand-fix / AI-fix)', async () => {
    const callbacks: Array<() => void> = [];
    (vscode.languages.onDidChangeDiagnostics as ReturnType<typeof mock>).mockImplementation((cb: () => void) => {
      callbacks.push(cb);
      return { dispose: mock() };
    });
    setDiagnostics({});
    const r = recorder();
    const watcher = new PostEditDiagnosticWatcher(r.sink, { settleDebounceMs: 5, maxSettleMs: 20 });
    // callbacks[0] is the persistent resolve listener registered in the constructor.
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag('boom', 5, 0)] });
    await watcher.checkAfterEdit(baseline, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');
    expect(r.broadcasts.some((m) => (m as { type: string }).type === 'diagnostic:postEditError')).toBe(true);

    // The user fixes it by hand (no AST mutation): diagnostics clear and the persistent listener fires.
    setDiagnostics({});
    callbacks[0]();
    await new Promise((res) => setTimeout(res, 20));

    const cleared = r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditErrorCleared');
    expect(cleared).toHaveLength(1);
    expect((cleared[0] as { elementId: string }).elementId).toBe('X');
    watcher.dispose();
  });

  it('rapid edits: the superseded check hands its baseline over so no error is dropped', async () => {
    setDiagnostics({}); // clean before edit A
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baselineA = watcher.snapshot();

    // Edit A commits and introduces error-A, but its diagnostics have NOT landed yet.
    const checkA = watcher.checkAfterEdit(baselineA, FILE, 'A', 'src/Card.tsx', 'ast:updateStyles');
    // Edit B commits immediately; B's baseline is captured now — still clean (A's error not yet shown).
    const baselineB = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('error from A', 3, 0), diag('error from B', 9, 0)] });
    const checkB = watcher.checkAfterEdit(baselineB, FILE, 'B', 'src/Card.tsx', 'ast:updateProps');
    await Promise.all([checkA, checkB]);

    // B (the surviving check) diffs against the OLDEST baseline (pre-A), so BOTH errors are caught.
    const errorMsgs = r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError');
    expect(errorMsgs).toHaveLength(1);
    const msg = errorMsgs[0] as { warning: { diagnostics: unknown[] } };
    expect(msg.warning.diagnostics).toHaveLength(2);
  });

  it('tracks ALL new errors for clearing, not just the displayed 5 (no premature clear)', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baselineA = watcher.snapshot();

    // 7 new errors on one file → reported (display capped at 5, but all 7 tracked for clearing).
    setDiagnostics({ [FILE]: Array.from({ length: 7 }, (_, i) => diag(`err ${i}`, i, 0)) });
    await watcher.checkAfterEdit(baselineA, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');

    // A later edit fixes the first 5 but leaves errors 5 and 6 — must NOT clear.
    const baselineB = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('err 5', 5, 0), diag('err 6', 6, 0)] });
    await watcher.checkAfterEdit(baselineB, FILE, 'X', 'src/Card.tsx', 'ast:updateProps');
    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditErrorCleared')).toHaveLength(
      0,
    );
  });

  it('with an unresolved (null) elementId: notifies only, no overlay broadcast, no highlight strand', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: [diag('boom', 1, 0)] });
    await watcher.checkAfterEdit(baseline, FILE, null, 'src/Card.tsx', 'ast:updateStyles');

    // Native notification fires (message is still useful), but there is no element to anchor, so no
    // overlay broadcast and no standing-warning tracking that a null-id clear could never match.
    expect(r.notified).toHaveLength(1);
    expect((r.notified[0] as { elementId: string | null }).elementId).toBeNull();
    expect(r.broadcasts).toHaveLength(0);
  });

  it('reports totalErrorCount as the true count even when the payload is capped at 5', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();

    setDiagnostics({ [FILE]: Array.from({ length: 8 }, (_, i) => diag(`e${i}`, i, 0)) });
    await watcher.checkAfterEdit(baseline, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');

    const w = r.notified[0] as { totalErrorCount: number; diagnostics: unknown[] };
    expect(w.totalErrorCount).toBe(8);
    expect(w.diagnostics).toHaveLength(5);
  });

  it('reset() broadcasts a scoped clear for the standing warning (workspace switch)', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baseline = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('boom', 1, 0)] });
    await watcher.checkAfterEdit(baseline, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');

    watcher.reset();
    const cleared = r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditErrorCleared');
    expect(cleared).toHaveLength(1);
    expect((cleared[0] as { elementId: string }).elementId).toBe('X');
  });

  it('does NOT re-notify (native toast) when a repeat edit re-reports the same standing error', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = makeWatcher(r.sink);
    const baselineA = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('boom', 1, 0)] });
    await watcher.checkAfterEdit(baselineA, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');
    expect(r.notified).toHaveLength(1);

    // A second edit re-introduces the SAME error against a clean baseline (still-broken element).
    setDiagnostics({});
    const baselineB = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('boom', 1, 0)] });
    await watcher.checkAfterEdit(baselineB, FILE, 'X', 'src/Card.tsx', 'ast:updateProps');
    // Overlay re-broadcast, but no second stacked native toast.
    expect(r.notified).toHaveLength(1);
    expect(r.broadcasts.filter((m) => (m as { type: string }).type === 'diagnostic:postEditError').length).toBe(2);
  });

  it('dispose() neutralizes an in-flight check so nothing broadcasts after teardown', async () => {
    setDiagnostics({});
    const r = recorder();
    const watcher = new PostEditDiagnosticWatcher(r.sink, { settleDebounceMs: 5, maxSettleMs: 60 });
    const baseline = watcher.snapshot();
    setDiagnostics({ [FILE]: [diag('late', 1, 0)] });
    const p = watcher.checkAfterEdit(baseline, FILE, 'X', 'src/Card.tsx', 'ast:updateStyles');
    watcher.dispose(); // tears down mid-settle
    await p;
    expect(r.broadcasts).toHaveLength(0);
    expect(r.notified).toHaveLength(0);
  });
});
