# Common Pitfalls & Known Issues

## Framework Gotchas

### Hono app.use ordering

`app.use('/path/*', middleware)` does NOT cover routes already declared
above the `app.use` call. Always add middleware inline per-route:

```typescript
app.get('/api/endpoint', authMiddleware, requireEditor, handler)
```

### bunx drizzle-kit fails silently

`bunx drizzle-kit generate` shows a cow ASCII art and produces nothing.
Always use `npx drizzle-kit` instead.

### VS Code extension + bun install

`@vscode/vsce` requires `npm list` which breaks with bun's lockfile.
Always use `npm` for the extension.

## Iframe Isolation Issues

### Keyboard events don't propagate

Events from iframe don't reach parent document.
Fix: forward keydown/keyup events from iframe to document.body.

### HMR resets editor state

After HMR of the editor itself (not iframe project), left sidebar
may disappear, active component may reset.
Fix: persist board/code mode and active component to sessionStorage/URL.

## Auth & Security

### Missing auth on read endpoints

Many GET endpoints were unprotected. All routes now require explicit
authMiddleware. Check after adding new routes.

### Path traversal in file ops

readFile and uploadImage need `path.relative()` checks.
Never trust user-provided file paths.

## VS Code Webview API

### acquireVsCodeApi() is one-shot

Each webview JS context allows exactly one `acquireVsCodeApi()` call.
`PlatformProvider` → `VSCodeAdapter` → `getVSCodeApi()` already calls it.
Never import `vscodeApi.ts` directly in webview components — use
`canvas.sendEvent()` from the platform layer instead.

### Messages before React mount are lost

Extension host sends `postMessage` synchronously in `resolveWebviewView`,
but React `useEffect` hasn't attached the listener yet. Fix: webview sends
`webview:ready` first, extension host responds with initial data.

## Canvas Engine

### Fire-and-forget async

AST operations return success synchronously, launch API calls in
background. Some store `_pendingPromise`. Engine's `undo()` awaits
the promise before completing.

### DOM dependency in operations

ASTUpdateOperation uses `getPreviewIframe()` from `@/lib/dom-utils`.
For testing: `mock.module('@/lib/dom-utils', () => ({ getPreviewIframe: () => null }))`
