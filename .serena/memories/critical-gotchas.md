# Critical Non-Obvious Gotchas

These are things that repeatedly caused problems in Claude sessions.
Read this FIRST before making changes.

## 1. Hono Route Registration Order (CRITICAL)

`app.use('/path/*', middleware)` in Hono does NOT protect routes that were
already declared ABOVE the `app.use` call. This caused unprotected API endpoints.

**Rule**: Always add auth middleware inline per-route, never rely on `app.use`:

```typescript
// WRONG — routes above this are unprotected
app.use('/api/*', authMiddleware)

// RIGHT — explicit per-route
app.get('/api/data', authMiddleware, requireEditor, handler)
```

## 2. Canvas Engine Fire-and-Forget (CRITICAL)

Most AST operations return `{ success: true }` SYNCHRONOUSLY while the
actual API call runs in background. This means:

- UI updates immediately (optimistic)
- Server may fail AFTER UI shows success
- `undo()` awaits `_pendingPromise` before completing
- If you add a new operation, MUST store `_pendingPromise` for undo to work

## 3. File Snapshot Undo vs Tree Undo

- **ASTStyleOperation** uses file snapshots (save/restore entire file)
- **ASTInsertOperation** uses reverse operations (delete what was inserted)
- **ASTDeleteOperation** stores deleted element structure for reinsertion
- These are DIFFERENT mechanisms. Don't confuse them.

## 4. Iframe Event Isolation

Events inside iframe do NOT propagate to parent window. Must explicitly:

- Forward keydown/keyup to `document.body` (not `document` or `window`)
- Forward mouse events for selection overlays
- Keyboard shortcuts (Cmd+Z, etc.) won't work in iframe without forwarding

## 5. proxy-path-bridge.js Injection Order

The proxy bridge script MUST be injected FIRST in `<head>`, before any
other scripts. It patches WebSocket, fetch, XHR, EventSource, and history API.
If another script loads first, it gets unpatched versions.

## 6. HMR Resets Editor State

After HMR of the EDITOR (not iframe content), React state is lost:

- Active component resets to first in list
- Board/code mode resets
- Left sidebar may disappear

**Fix**: persist critical state to sessionStorage/URL params.

## 7. `bunx drizzle-kit` Silently Fails

Shows cow ASCII art, produces no output, no error. Always use `npx`.
This has bitten the project at least 3 times.

## 8. VS Code Extension MUST Use npm

`@vscode/vsce` runs `npm list` internally. Bun's lockfile creates
"extraneous dependencies" that break packaging. All ext commands = npm.

## 9. authFetch vs fetch

ALL client-side API calls MUST use `authFetch` (from `@/utils/authFetch`).
It handles JWT tokens, token refresh, and auth headers automatically.
Raw `fetch` to `/api/*` will fail for authenticated users.
This was a security audit finding — ~25 raw fetch calls were migrated.

## 10. Platform Branching in Shared Components

LeftSidebar and RightSidebar are shared between SaaS and VS Code.

- `useCanvasEngineOptional()` returns null in VS Code
- SaaS-only UI: wrap in `{!isVSCode && ...}`
- SaaS-only imports: add esbuild stub in `vscode-extension/esbuild.js`
- Missing stub = extension build fails with cryptic error

## 11. Docker Container Knows Nothing About Prefix

Containers run at `/` root. They have NO knowledge of
`/project-preview/{id}/` prefix. All path rewriting happens at proxy layer.
Never set BASE_PATH or base config in user projects.

## 12. WebSocket HMR Requires 'vite-hmr' Protocol

```typescript
new WebSocket(backendUrl, 'vite-hmr') // REQUIRED second argument
```

Without this, Vite dev server silently rejects the connection.
No error message, HMR just doesn't work.
