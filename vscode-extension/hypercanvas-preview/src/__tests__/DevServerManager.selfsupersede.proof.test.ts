import { describe, expect, it, mock } from 'bun:test';

// PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME (built next to the
// bundle, absent in src/). Stub readFileSync for iframe-* only — same pattern as the
// main DevServerManager.test.ts — so the real module imports cleanly. Capture the
// ORIGINAL readFileSync first (bun mutates the namespace in place).
const realFs = await import('node:fs');
const origReadFileSync = realFs.readFileSync;
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return origReadFileSync(file as string, enc as never);
  },
}));
const vscode = await import('vscode');
const { DevServerManager } = await import('../services/DevServerManager');

/**
 * HYP-52 regression: a PLAIN single start() must NOT self-supersede when the manager's
 * project path differs from the (unpinned) VS Code workspace folder.
 *
 * BUG (now fixed): _runStart captured `gen = ++_generation` BEFORE awaiting
 * _syncProjectPathWithWorkspace(). When the path differed from the workspace folder, the
 * sync ran _applyProjectPath(workspaceRoot) -> _runStop() -> ++_generation, bumping the
 * epoch PAST the captured gen. The pre-spawn supersede check (gen !== _generation) then
 * fired on a normal, non-concurrent start -> transition('stopped'), NEVER spawned ->
 * "Server failed to start" in the e2e harness (the monorepo / setProjectPath-rerouted
 * preview shape). FIX: capture gen AFTER the sync's own intra-op bump.
 */
describe('HYP-52 regression: plain start() does not self-supersede via workspace sync', () => {
  it('a single start() whose path != (valid) workspace root reaches spawn, not the supersede bail', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    // Two DISTINCT valid projects: the workspace root, and the manager's initial path.
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyp52-ws-'));
    const initialDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hyp52-init-'));
    for (const d of [workspaceDir, initialDir]) {
      await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));
    }

    // Point the (global) workspace mock at the valid workspaceDir for this test.
    const ws = vscode.workspace as unknown as {
      workspaceFolders: { uri: { fsPath: string }; name: string; index: number }[];
    };
    const savedFolders = ws.workspaceFolders;
    ws.workspaceFolders = [{ uri: { fsPath: workspaceDir }, name: 'ws', index: 0 }];

    try {
      // Manager starts on initialDir, which DIFFERS from workspaceDir -> sync reroutes.
      const manager = new DevServerManager(initialDir);
      const priv = manager as unknown as {
        _findFreePort: (start: number) => Promise<number>;
        _probeHttpServer: (port: number) => Promise<boolean>;
        _spawnDevServer?: (...a: unknown[]) => unknown;
        _waitForReady: (timeout: number, gen?: number) => Promise<void>;
        _status: string;
        _generation: number;
        _process: unknown;
        _runStart: (dep?: boolean) => Promise<unknown>;
      };

      // Keep the start on the spawn path: the HYP-1160 attach-first probe would
      // otherwise adopt any real HTTP server this dev machine has on :3000.
      priv._probeHttpServer = mock(async () => false);

      // At port-find time, snapshot whether the captured gen still matches the live epoch.
      // Pre-fix this DID NOT match (sync had bumped past it) and the next supersede check
      // bailed. Post-fix it matches and the start proceeds.
      let genAtPortFind = -1;
      let portFindCalled = false;
      priv._findFreePort = mock(async () => {
        portFindCalled = true;
        genAtPortFind = priv._generation;
        return 5173;
      });
      // Short-circuit the real readiness wait so we don't depend on an actual vite boot.
      // If the start self-superseded, we never reach here; if it doesn't, we want it to
      // settle fast. Throwing here keeps us off a real 90s poll while still proving we got
      // PAST the pre-spawn supersede branch (which would have returned 'stopped' earlier).
      priv._waitForReady = mock(async () => {
        throw new Error('test-shortcircuit-ready');
      });

      await priv._runStart();

      // eslint-disable-next-line no-console
      console.log(
        `[HYP-52] status=${priv._status} portFindCalled=${portFindCalled} genAtPortFind=${genAtPortFind} genNow=${priv._generation}`,
      );

      // Regression assertions: the start reached port-find (project is valid) AND did not
      // bail at the pre-spawn supersede branch. Pre-fix it bailed to 'stopped' with the
      // captured gen already stale; post-fix the captured gen still equals the live epoch
      // at port-find, so the supersede check passes and the start proceeds to the spawn
      // path (here it ends in 'error' only because we short-circuit _waitForReady, NOT
      // because of a supersede). Either way it is NOT the self-supersede 'stopped' bail.
      expect(portFindCalled).toBe(true);
      expect(priv._status).not.toBe('stopped'); // would be 'stopped' on the buggy self-supersede
      // The direct invariant the fix establishes: at port-find time the captured gen still
      // equals the live epoch (the sync's intra-op bump was absorbed by capturing AFTER it).
      // Guards a false green where _status lands non-'stopped' for an unrelated reason while
      // gen has in fact diverged from _generation.
      expect(genAtPortFind).toBe(priv._generation);

      manager.dispose();
    } finally {
      ws.workspaceFolders = savedFolders;
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(initialDir, { recursive: true, force: true });
    }
  });
});
