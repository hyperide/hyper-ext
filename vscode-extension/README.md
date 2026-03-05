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

**Not covered:**

- Extension lifecycle
  (activation, commands, event subscriptions)
- All webview React components
  (45+ components, 0 tests)
- PreviewProxy, SyncPositionService
- Code-server SSE reconnection and auth refresh
