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

## AI Provider Routing

### Anthropic SDK + non-Anthropic provider = crash

`new Anthropic({ baseURL: 'https://api.openai.com/v1' })` sends Anthropic
Messages API format to an OpenAI endpoint → HTTP 404/401. Before calling
`getAnthropicClient()` or `anthropic.messages.*`, check that
`resolvedConfig.provider !== 'openai'`. Use `callAI()`/`callAIStream()`
from `lib/ai-client` instead — they route by protocol internally.

### resolveServerAIConfig() throws for opencode

It's not just "returns null" — it throws `AppError` for opencode provider.
All callers must either check provider before calling, or wrap in try/catch.
`parseComponent.ts` already has try/catch; `project-doctor.ts` was missing it.

### generateArrayItems() must respect user's model

Was hardcoding `claude-sonnet-4-20250514`. If user has proxy+gemini, this
sends to litellm asking for a model it doesn't have. Use `config.model`.

## Project Switching

### Window event listeners miss events on component remount

When a component unmounts (e.g. sidebar hidden, code→design switch) and remounts,
`project-activated` has already fired. Event-only data loading leaves the component
permanently empty. Fix: always do an initial fetch on mount AND listen for events.
Handle `success: false` gracefully (don't mark as loaded) so events can retry.
Found in HYP-224 via codex review.

### localStorage.projectId must be updated BEFORE window.location.href reload

`handleOpenProject` calls `/api/projects/:id/activate` (server updates in-memory
`activeProjectId`), then `window.location.href = '/'`. But `useProjectSSE` reads
`loadPersistedState().projectId` from localStorage on mount to build the SSE URL.
If localStorage wasn't updated before reload, SSE connects with the **old** project ID.
All project-scoped features (AI agent, diagnostics, SSE) then operate on the wrong project.

Fix: call `resetStateForProject(newProjectId)` before `window.location.href`.
Conditional: only reset when projectId actually changed, otherwise `savePersistedState`
to avoid losing `openedComponent`/`openFiles`/`activeFilePath` on same-project reopen.

## Auth & Security

### Handlers must not bypass middleware with direct service calls

When using `setProjectRole` (non-blocking middleware), handlers MUST use
`c.get('checkedProject')` — never fall back to direct service calls like
`getActiveProjectService()`. The middleware validates access; the fallback
doesn't. Also: SSE handlers must only register clients for broadcasts
**after** confirming access (don't add to `projectStatusClients` if
`checkedProject` is undefined). Found in HYP-219 codex review.

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

### New PlatformMessage types must be added to the union

`canvas.sendEvent<T extends PlatformMessage>(message)` in VSCodeAdapter is
generic-constrained to `PlatformMessage`. If a message type (e.g. `canvas:undo`)
is NOT in the union at `client/lib/platform/types.ts`, TypeScript won't complain
(due to `as never` casts at call sites), but the message silently fails to send.
Always add new message types to `PlatformMessage` before using them.

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

## Preview Generator

### Regex vs AST for source code scanning

Never use regex to extract exports, component names, or parse code structure from
TypeScript/TSX source files. Regex matches inside comments, string literals, and
template literals, producing false positives. Use `@babel/parser` with
`errorRecovery: true` instead. Learned in HYP-203 when 12+ tests revealed regex
false positives in `scanner.ts` and `parseExistingPreview`.

### Babel errorRecovery still throws on broken JSX

`@babel/parser` with `errorRecovery: true` still throws on some broken code
(e.g. unterminated JSX `<div>`). Always wrap scanner calls in try/catch when
processing user-edited files that may be mid-edit.

## Canvas Engine

### ParseContext seenIds must be separate per tree

When parsing main component AND Sample* variant from the same file,
each must use its own `ParseContext` with independent `seenIds` Set.
If shared, the second parse gets regenerated UUIDs for any elements
that appeared in the first parse (via `{...props}` spread sharing IDs).

### Recast: separate processJSX functions for main vs Sample*

`processJSXElement` / `processJSXInNode` are mutually recursive.
If Sample* reuses the main component's `processJSXInNode`, nested
expressions (`{expr}`) will incorrectly use `idMap` instead of `sampleIdMap`.
Always create separate `processSampleJSX` / `processSampleJSXInNode`.

### findExportJSX: skipDefaultExport for Sample* lookups

`findExportJSX` falls back to `ExportDefaultDeclaration` when no named
export matches. For Sample* lookups, this fallback must be disabled
(`skipDefaultExport=true`), otherwise `SampleDefault` matches the
component's default export instead of the named Sample* export.

### Fire-and-forget async

AST operations return success synchronously, launch API calls in
background. Some store `_pendingPromise`. Engine's `undo()` awaits
the promise before completing.

### bun mock.module is process-global and has NO restore

`mock.module('path')` replaces the module for ALL test files in the same bun
process, not just the current file. `mock.restore()` explicitly does NOT reset
module mocks ([bun#12823](https://github.com/oven-sh/bun/issues/12823)).
`mock.restoreModule()` PR ([bun#25844](https://github.com/oven-sh/bun/pull/25844))
exists but NOT merged yet (as of bun 1.3.10).

**Strategy**: avoid `mock.module` when possible. Extract pure logic into
lightweight files (zero heavy deps) and test those directly. If `mock.module`
is unavoidable — run the file in isolation (`bun test <file>`).

If `AstBridge.test.ts` mocks `AstService`, any other test importing `AstService`
in the same run gets the mock. Fix: put real-module integration tests in a
different directory subtree (e.g. `shared/` vs `vscode-extension/`).

**When multiple test files mock the same module differently:** both files must
include ALL exported functions in their mocks (not just the ones they use).
Dynamic `await import()` caches the first mock's exports — if file A mocks
`service` with `{getProject, getChat}` and file B mocks it with `{getChat}`,
file B may get file A's mock missing `getChat`. Include cross-pollinating stubs:

```typescript
// projectRole.test.ts mocks service
mock.module('../modules/projects/service', () => ({
  getProject: mockGetProject,
  getActiveProject: mockGetActiveProject,
  // Include getChat to prevent mock bleed from workspace.test.ts
  getChat: mock(() => Promise.resolve(null)),
}));
```

### globalThis.fetch mock leaks across test files

Assigning `globalThis.fetch = mockFetch` in a test file persists for ALL
subsequent test files in the bun process. Always save and restore the original:

```typescript
const originalFetch = globalThis.fetch;
// @ts-expect-error — Bun's fetch has extra properties (preconnect)
globalThis.fetch = mockFetch;
afterAll(() => { globalThis.fetch = originalFetch; });
```

### bun mockClear vs mockReset

`mockClear()` only clears call tracking, NOT pending `mockResolvedValueOnce`
queue. Use `mockReset().mockResolvedValue(null)` in `beforeEach` to clear
everything and set a safe default.

### DOM dependency in operations

ASTUpdateOperation uses `getPreviewIframe()` from `@/lib/dom-utils`.
For testing: `mock.module('@/lib/dom-utils', () => ({ getPreviewIframe: () => null }))`

### Heavy imports contaminate test suite

Module resolution errors from one test file cascade to unrelated test files
in the same bun process. Keep test imports lightweight.

### `console.error(Error)` in error-path tests

Bun counts `console.error(new Error(...))` as "1 error" in the full test suite
summary. Suppress `console.error` in tests that exercise caught error paths.

### `Promise.reject` in mockImplementation

`Promise.reject(new Error(...))` in `mockImplementation` triggers unhandled
rejection when tests run in parallel. Use `async () => { throw new Error(...); }`
instead.

## Tooling Gotchas

### Serena `write_memory` overwrites entire file

`write_memory` replaces the file, not appends. To add content to an existing
memory file, use `edit_memory` or read the file first and write back with additions.

### `node:child_process` has no promise-based variant

`node:child_process/promises` does NOT exist. Use `promisify(execFile)`.
Don't confuse with `node:fs/promises` which does exist. In general, verify the
`/promises` subpath actually exists before assuming.

## Tailwind JIT Does Not Scan Record/Object Values

Tailwind JIT content scanner does NOT extract class names from:

- `Record<string, string>` objects
- Object literals / lookup tables
- Array-of-objects configs (e.g. `SOURCE_PILLS[].activeColor`)
- `switch` return values stored in variables

Classes like `bg-cyan-500/20` or `w-[3px]` in these patterns will NOT be generated into CSS.

### Safe Alternatives

1. **Inline styles** for lookup objects:

   ```ts
   const COLORS: Record<string, { bg: string; text: string }> = {
     proxy: { bg: 'rgba(6,182,212,0.2)', text: '#22d3ee' },
   };
   // <div style={{ backgroundColor: COLORS[source].bg }} />
   ```

2. **Classes directly in JSX** via `cn()`:

   ```tsx
   <div className={cn(
     type === 'added' && 'bg-green-500/20 text-green-700',
     type === 'removed' && 'bg-red-500/20 text-red-700',
   )} />
   ```

### Why Not Safelist?

Relying on a class being "safe" because it's used in JSX elsewhere is fragile —
someone removes that JSX and the lookup silently breaks with invisible styles.

### Known Fixed Instances

- `DiagnosticLogsViewer.tsx` — SOURCE_STYLE_* uses inline hex colors
- `DiagnosticFilterBar.tsx` — SOURCE_PILLS uses inline styles for active state
- `EditFileDiff.tsx` — lineClass moved to direct `cn()` conditionals in JSX

## Shell Parsing (shell-quote)

### shell-quote treats newlines as whitespace

`parse("a\nb")` returns `['a', 'b']` (single command), not two commands.
In shell, `\n` is a command separator like `;`. Fix: split input on `\n`
before passing to shell-quote, merge results with `;` operators.

### shell-quote glob and comment tokens

`parse("echo *.ts")` returns `[{op: 'glob', pattern: '*.ts'}]`, not a string.
`parse("echo #foo")` returns `[{comment: 'foo'}]`. Both need explicit handling
in the token loop — don't assume all `{op}` objects are control operators.

## Preview Pipeline

### injectUniqueIds validates paths against process.cwd(), not project path

Container sends absolute paths like `/app/src/card.tsx`. Server CWD is the
HyperIDE project root, not the user project root. `path.relative(cwd, containerPath)`
starts with `..` → 403 "path traversal detected". Fix: use `getActiveProject().path`
as the base for validation.

### parseComponent derives componentName from filename, not actual export

`card.tsx` → `componentName = "card"`, but actual export is `export function Card`.
The generated `__canvas_preview__.tsx` imports `{ SampleDefault } from './card'` as
`cardSampleDefault` — wrong identifier in SampleDefaultMap and sampleRenderersMap.
Fix: `findActualExportName(ast, matchFn)` resolves the real export name from AST.

### Module SyntaxErrors are invisible to ALL JS error APIs

`SyntaxError: does not provide an export named 'X'` is a V8 module linking error.
It does NOT fire `window.error`, `console.error()`, or `unhandledrejection`.
Framework overlays (Vite/Next.js/Bun) don't detect it either.

**Only working capture method**: dynamic `import(script.src)` returns a Promise
that rejects on linking failures. Added to `iframe-console-capture.js` on
DOMContentLoaded — re-imports each `<script type="module" src>` to detect errors.
ES modules are cached, so no double execution on success.

IframeCanvas.tsx receives the error via `hypercanvas:runtimeError` postMessage
with `event.source` validation against the iframe. Uses `errorSourceRef` (useRef)
to track error origin and prevent polling from clearing postMessage-sourced errors.
