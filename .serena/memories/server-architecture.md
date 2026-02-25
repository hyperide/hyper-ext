# Server Architecture

## Entry Points

- `server/main.ts` — Bun native HTTP + WebSocket server (port 8080)
- `server/index.ts` — Hono app with routes, middleware, CORS

## Route Organization (57 files in server/routes/)

Routes are individual files, some grouped into sub-routers:

- `ai-agent-router.ts` — AI agent sub-router
- `docker.ts` — Docker management sub-router
- `git.ts` — Git operations sub-router
- `canvasComposition.ts` — Canvas composition sub-router
- `componentWatcher.ts` — SSE handler for component file changes

## Modules (server/modules/)

Domain-scoped modules with service + routes:

- `auth/` — JWT auth, OAuth (GitHub, Google), tokens
- `email/` — Resend email client + templates
- `projects/` — Project CRUD service
- `workspaces/` — Workspace management
- `project-sharing/` — Sharing/invites

## Middleware

- `auth.ts` — JWT/token verification, requireEditor
- `workspace.ts` — Workspace context injection
- `projectRole.ts` — Role-based access control
- `fileSnapshot.ts` — File snapshot for undo/redo tracking
- `errorHandler.ts` — Global error handler

## Proxy Architecture (main.ts)

1. Browser request → Bun server (:8080)
2. Match `/project-preview/{id}/*` routes
3. Strip prefix, proxy to container (port 3001/5173/etc)
4. Rewrite HTML/JS/CSS responses to add prefix back
5. Inject proxy-path-bridge.js + devtools-backend-init.js

## WebSocket HMR

- Requires `'vite-hmr'` protocol parameter
- Strips prefix before forwarding to container
- Bidirectional message forwarding

## Key Services

- `container-manager.ts` — Docker/K8s abstraction
- `ast-manipulator.ts` — Recast-based code editing
- `component-analyzer.ts` — Babel AST analysis
- `ai-agent*.ts` — AI orchestration
- `fileChangeTracker.ts` — File change tracking
