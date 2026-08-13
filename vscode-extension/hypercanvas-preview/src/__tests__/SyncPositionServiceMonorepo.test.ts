/**
 * @file SyncPositionService monorepo navigate re-rooting (HYP-435 / task HYP-430).
 *
 * Preview→Code auto-navigation on element click calls goToCode directly with the
 * fileName the iframe reports — which, for a monorepo opened at the repo ROOT, is
 * sub-project-relative (`src/app/ui/HostListRow.tsx`). Pre-fix that resolved
 * against the repo root → `<repo>/src/app/...` (nonexistent) → "Failed to
 * navigate". This is the load-bearing proof for the navigate path the e2e cannot
 * reliably hit (single-target conloca renders near-empty components, so a CDP
 * pixel-click is fragile). It exercises the REAL goToCode → openTextDocument call.
 */
import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { SyncPositionService } from '../services/SyncPositionService';

function createStateHub() {
  return {
    onChange: mock(() => () => {}),
    applyUpdate: mock(),
    broadcast: mock(),
  };
}

function makeService(prefix: string) {
  const astService = {
    findElementAtPosition: mock(() => Promise.resolve(null)),
    getElementLocation: mock(() => Promise.resolve(null)),
  };
  const service = new SyncPositionService(
    astService as never,
    createStateHub() as never,
    '/test-workspace',
    mock(() => {}),
    () => 'targets/conloca-app/src/app/ui/HostListRow.tsx',
  );
  service.setSubProjectPrefix(prefix);
  return service;
}

describe('SyncPositionService monorepo navigate re-rooting', () => {
  it('re-roots a sub-project-relative click source to the repo-relative file for goToCode', async () => {
    (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockClear();
    const service = makeService('targets/conloca-app/');
    service.setPendingSource({ fileName: 'src/app/ui/HostListRow.tsx', line: 23, column: 4 });

    // _onPreviewSelectionChange is private — exercise it the way StateHub would.
    await (
      service as unknown as { _onPreviewSelectionChange: (ids: string[]) => Promise<void> }
    )._onPreviewSelectionChange(['src/app/ui/HostListRow.tsx:23:5']);

    const calls = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const uri = calls[0][0] as { fsPath?: string; path?: string };
    const opened = uri.fsPath ?? uri.path ?? String(uri);
    expect(opened).toContain('targets/conloca-app/src/app/ui/HostListRow.tsx');
    // The pre-fix bug: opening `<repo>/src/app/...` directly (no target prefix).
    expect(opened).not.toBe('/test-workspace/src/app/ui/HostListRow.tsx');
  });

  it('single-package (empty prefix) navigates the path as-is', async () => {
    (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockClear();
    const service = makeService('');
    service.setPendingSource({ fileName: 'src/App.tsx', line: 5, column: 2 });

    await (
      service as unknown as { _onPreviewSelectionChange: (ids: string[]) => Promise<void> }
    )._onPreviewSelectionChange(['src/App.tsx:5:3']);

    const calls = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const uri = calls[0][0] as { fsPath?: string; path?: string };
    const opened = uri.fsPath ?? uri.path ?? String(uri);
    expect(opened).toContain('src/App.tsx');
    expect(opened).not.toContain('targets/');
  });
});
