# HyperIDE Code Server — VS Code Extension

Lightweight iframe preview for code-server Docker IDE.
Embeds the SaaS preview panel inside VS Code's
bottom panel via iframe.

## Build and Install

```bash
cd vscode-extension/hypercanvas-code-server
npm install
npm run compile
npm run package
code --install-extension \
  hypercanvas-code-server-*.vsix --force
```

> **Always use npm**, not bun —
> `@vscode/vsce` requires `npm list`.

## How It Works

### Environment Variables

The extension reads configuration from process
environment (set by the Docker entrypoint script):

- `IDE_PROJECT_ID` — Project ID for backend API
- `HYPERCANVAS_ORIGIN` — SaaS origin URL
  (default: `http://localhost:8080`)
- `HYPERCANVAS_AUTH_TOKEN` — Access token
  (TTL: 15 min, auto-refreshed)
- `HYPERCANVAS_REFRESH_TOKEN` — Refresh token
  for auto-renewal

### Features

**Preview Panel** — iframe showing
`{origin}/project-preview/{projectId}/test-preview`.
Reacts to active editor changes: extracts component
path from file path and updates the iframe URL
with `?component=` query parameter.

**Go to Code (SSE)** — subscribes to
`GET /api/ide/{projectId}/commands/stream`.
When user clicks an element on the canvas,
the backend sends a `gotoPosition` event with
file path, line (1-based), and column (0-based).
Opens the file and positions the cursor.
Auto-reconnects on disconnect.

**Go to Visual** —
`POST /api/ide/{projectId}/go-to-visual`
with component path extracted from the active
editor. Triggered by `Cmd+Shift+V` or context menu.

**File Save Tracking** — captures pre-save content
via `onWillSaveTextDocument`, then sends diffs to
`POST /api/code-editor/saved` for undo/redo
snapshots. Auth auto-refreshes on 401.

## Files

```text
src/extension.ts           — Activation, SSE,
                             Go to Visual,
                             file tracking
src/PreviewViewProvider.ts — Webview with iframe,
                             component path
                             handling
```

## Docker

The extension is built and installed inside the
code-server Docker image.
See `Dockerfile.code-server` at the repo root:

```dockerfile
COPY vscode-extension/hypercanvas-code-server \
  /tmp/ext
RUN cd /tmp/ext \
  && npm ci && npm run compile \
  && npm run package
RUN code-server --install-extension \
  /tmp/ext/*.vsix
```

The CI workflow `.github/workflows/build-ide.yml`
builds the Docker image on pushes to
`main`/`develop` when files in this directory change.
