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

### Don't use prefers-color-scheme in injected iframe styles

Injected overlay styles (selection, hover, insert markers) render on top of
the **user's project**, whose background color is independent of both the
VS Code theme and the system theme. `prefers-color-scheme` tells us about
the OS/editor preference, not the actual project background. Fix: use neutral
semi-transparent grays (e.g. `rgba(128,128,128,0.3)`) that work on any background.
See `overlay-renderer.ts`.

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

### Click events unreliable in VS Code webview iframes

`click` events were not firing reliably inside VS Code webview preview
iframes — possibly OOPIF-related or due to event interception by the
webview host (not verified). Fix: use `pointerdown`/`pointerup` with
distance threshold instead of `click` listener.

### Component scanner names include file extension

`ComponentListItem.name` from the scanner is `path.relative(categoryRoot, fullPath)`,
which includes `.tsx`/`.ts` extension. Strip with `name.replace(/\.\w+$/, '')`
before using as JSX component type.

### AstService insertElement doesn't add imports (ext only)

The SaaS server route (`server/routes/insertElement.ts`) resolves imports,
but `AstService.insertElement()` in the VS Code extension didn't.
Now uses `ensureImport()` from `lib/ast/import-manager.ts` — but it always
generates named imports. Components with default exports need manual adjustment.

### Recast preserves parentheses as JSXText when mutating arrow bodies

When duplicating a JSX element that's the body of an arrow function
(e.g. `items.map(item => (<Row />))`), wrapping in a fragment via direct
AST mutation produces `<>(<Row />)(<Clone />)</>` — recast preserves the
original parentheses as JSXText `"("`. Don't mutate arrow function bodies
directly; use Babel's path API or restructure the callback to a block body first.

## Canvas Engine

### Fire-and-forget async

AST operations return success synchronously, launch API calls in
background. Some store `_pendingPromise`. Engine's `undo()` awaits
the promise before completing.

### bun mock.module is process-global

`mock.module('path')` replaces the module for ALL test files in the same bun
process, not just the current file. If `AstBridge.test.ts` mocks `AstService`,
any other test importing `AstService` in the same run gets the mock.
Fix: put real-module integration tests in a different directory subtree
(e.g. `shared/` vs `vscode-extension/`), or use `mock.restore()`.

### DOM dependency in operations

ASTUpdateOperation uses `getPreviewIframe()` from `@/lib/dom-utils`.
For testing: `mock.module('@/lib/dom-utils', () => ({ getPreviewIframe: () => null }))`
