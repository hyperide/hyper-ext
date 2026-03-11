# VS Code Extensions

Two independent extensions for different environments:

- **HyperIDE** (`hypercanvas-preview/`) —
  Standalone local editor (4 panels, AST, DevServer, AI).
  Build: esbuild.
- **HyperIDE Code Server** (`hypercanvas-code-server/`) —
  Lightweight iframe preview for Docker IDE.
  Build: tsc.

See each extension's README for architecture
and build instructions.

## Important Rules

- **Always use npm** (not bun) —
  `@vscode/vsce` requires `npm list`
- **Shared components must use optional hooks** —
  VS Code webviews only have `PlatformProvider`,
  no `CanvasEngineProvider`/`ThemeProvider`/`AuthProvider`
- Extensions are **never installed together** —
  command IDs don't conflict

## Testing

```bash
bun test vscode-extension
```

**Covered:**

- Code-server pure utils (SSE parsing, URL building,
  position conversion, path stripping) — 22 tests
- StateHub state sync and message routing — 15 tests
- ProjectDetector (project type, UI kit, package
  manager, dev commands) — 30 tests
- PanelRouter message routing (state, editor, AST,
  AI, commands, components, files, styles) — 12 tests
- EditorBridge (openFile, goToCode, getActiveFile,
  path resolution) — 8 tests
- AstBridge (all 7 AST operations, error handling,
  webview target selection) — 12 tests
- DevServerManager (log parsing, error/success
  detection, state machine, callbacks,
  command building) — 16 tests
- CompositionStorage (compositions CRUD, chats CRUD,
  settings, directory creation) — 14 tests

## Publishing to VS Code Marketplace

Publisher: `hyperide` ([manage](https://marketplace.visualstudio.com/manage/publishers/hyperide))

**Automated (CI):**

1. Bump `version` in `hypercanvas-preview/package.json`
2. Commit and push to `main`
3. Tag with matching version: `git tag ext-v0.1.2 && git push origin ext-v0.1.2`
4. CI workflow (`publish-extension.yml`) builds, validates tag vs package.json, and publishes

**Manual:**

```bash
cd vscode-extension/hypercanvas-preview
npm run build
npx @vscode/vsce publish -p "$VSCE_PAT"
```

**Dry run (CI):** trigger `publish-extension` workflow manually with `dry_run: true` --
builds VSIX artifact without publishing.

**Secrets:** `VSCE_PAT` (GitHub repo secret) -- Azure DevOps PAT with
Marketplace Manage scope, all accessible organizations. Expires 2026-04-06.

**Not covered:**

- Extension lifecycle
  (activation, commands, event subscriptions)
- All webview React components
  (45+ components, 0 tests)
- PreviewProxy, SyncPositionService
- Code-server SSE reconnection and auth refresh
