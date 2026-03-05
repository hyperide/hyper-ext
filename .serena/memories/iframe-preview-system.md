# Iframe-Based Preview System

## Overview

User projects run in Docker containers with their own dev servers (Next.js, Vite, etc.).
The main application loads these projects in an iframe through a Bun native HTTP proxy (`server/main.ts`),
enabling same-origin access for direct DOM manipulation.

## Key Components

**IframeCanvas Component** (`client/components/IframeCanvas.tsx`):

- Registers components via POST to `/api/generate-preview` before loading
- Loads iframe URL: `/project-preview/${projectId}/test-preview?component=${componentPath}`
- Provides direct DOM access via `iframe.contentDocument` (same-origin)
- Injects CSS for empty containers with `data-uniq-id` attributes
- Forwards events (click, mouseover, mouseout, keydown) from iframe to parent

**Bun HTTP Proxy** (`server/main.ts`):

1. Bun native server (port 8080) receives request
2. Matches `/project-preview/{id}/*` routes
3. Strips prefix, looks up project port from database
4. Proxies to container at root path (e.g., `localhost:3001`)
5. Rewrites HTML/JS/CSS responses to add prefix back
6. Injects `proxy-path-bridge.js` for client-side path patching

**User Project Setup**:

- **Next.js**: Creates `pages/project-preview/[projectId]/test-preview.tsx`
- **Vite**: Configures React Router in main file
- Both import `__canvas_preview__.tsx` (AI-generated) with `sampleRenderMap`

## Two-Layer Path Rewriting

```text
Browser (:8080)
  ↓ GET /project-preview/{id}/test-preview
  ↓ WS  /project-preview/{id}/?token=xxx (Vite)
  ↓ WS  /project-preview/{id}/_next/webpack-hmr (Next.js)
Bun Server (:8080)
  ↓ HTTP: Strips prefix → proxies to container → rewrites response paths
  ↓ WS: Strips prefix → proxies with 'vite-hmr' protocol
  ↓ Injects proxy-path-bridge.js into HTML responses
Docker Container (:3001, :5173, etc.)
  ↓ Dev server with base: '/' — unaware of prefix
```

**Server layer** (`server/main.ts`):

- Strips `/project-preview/{id}` from incoming requests
- Proxies to container at root path
- Rewrites HTML/JS/CSS responses: src, href, imports, CSS url()

**Client layer** (`server/proxy-path-bridge.js`):

- Injected FIRST in `<head>` before any other scripts
- Patches: WebSocket, EventSource, fetch, XHR, history API
- Intercepts absolute paths and adds prefix

**All frameworks**: containers run WITHOUT `BASE_PATH`, `patch-vite-config.ts` forces `base: '/'`.

## WebSocket HMR

Critical: WebSocket requires `'vite-hmr'` protocol parameter:

```typescript
const backendWs = new WebSocket(backendUrl, 'vite-hmr');
```

Without it, Vite silently rejects the connection.

**Upgrade flow**: Browser → Bun strips prefix → `ws://localhost:{port}/?token=xxx` → bidirectional forwarding.

## DOM Manipulation

```typescript
const doc = iframe.contentDocument; // same-origin!
const element = doc.querySelector(`[data-uniq-id="${id}"]`);
```

Utility functions in IframeCanvas.tsx: `getElementFromIframe()`, `updateElementStyles()`, `getComputedStylesFromIframe()`.

Keyboard events from iframe propagate to parent via forwarding to `document.body`.

## AST Manipulation APIs

- `/api/update-component-styles` — modify styles
- `/api/insert-element` — insert elements
- `/api/delete-elements` — delete elements
- `/api/duplicate-element` — duplicate elements
- `/api/paste-element` — paste from clipboard

After file changes, dev server reloads iframe via HMR.

## React DevTools Integration

Bridge script (`server/devtools-backend-init.js`) inherits `__REACT_DEVTOOLS_GLOBAL_HOOK__` from parent window.
Only activates in development + inside iframe. Requires React DevTools browser extension.

## Script Injection Order

```html
<head>
<script>${proxyBridgeScript}</script>      <!-- MUST be FIRST -->
<script>${devtoolsScript}</script>
```

## Debugging WebSocket Issues

```bash
# Bun server logs
tail -f /tmp/bun-server.log
# Look for: [Bun WS] Client connected, Backend connected, Backend error

# Container logs
docker logs canvas-project-{projectId} | grep hmr

# Test WebSocket manually
timeout 5 wscat -c "ws://localhost:5352/?token=test" -H "Sec-WebSocket-Protocol: vite-hmr"
timeout 5 wscat -c "ws://localhost:8080/project-preview/{id}/?token=test" -H "Sec-WebSocket-Protocol: vite-hmr"
```

**Common errors**:

- No `Backend connected` log → missing `'vite-hmr'` protocol parameter
- `FAILED TO CONNECT` → container port mismatch or dev server not running
- `WebSocket handshake failed` → wrong path or protocol
