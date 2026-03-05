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

- `auth.ts` — JWT/token verification, sets `userId` and `user` in context
- `workspace.ts` — `requireWorkspaceAccess` (resolves workspaceId from param/query/body,
  checks membership, sets `workspaceId` + `workspaceRole`), `requireChatAccess`
  (loads chat, validates workspace membership), `checkWorkspaceAccess()` helper,
  `checkProjectAccess()` helper
- `projectRole.ts` — `requireEditor` (editor-only routes, uses `resolveProjectId()`
  with 5-step chain: param → query → body → bodyPath → active, sets `checkedProject`),
  `requireProjectAccess` (viewer-safe), `setProjectRole` (non-blocking),
  `resolveProjectId()` shared helper. All throw AppError (not HTTPException).
- `fileSnapshot.ts` — File snapshot for undo/redo tracking
- `errorHandler.ts` — Global error handler (handles AppError, HTTPException, DB errors)

### Access control pattern (HYP-219)

All authorization is at route registration level — handlers never check access:

```typescript
app.get('/api/projects', authMiddleware, requireWorkspaceAccess, listProjects);
app.put('/api/projects/:id', authMiddleware, requireEditor, updateProject);
// Handler uses c.get('checkedProject'), c.get('workspaceId')
```

Write handlers MUST use `c.get('workspaceId')` (not body value) to prevent
workspace ID mismatch bypass. AI agent handlers use `checkedProject.path` (not
body `projectPath`) to prevent IDOR.

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
- `ast-manipulator.ts` — Recast-based code editing (includes `toSampleExportName()`)
- `parseComponent.ts` — Parses component JSX → AST tree; supports `sampleName` param to parse Sample* variant alongside main component; uses `extractJSXFromFunction` + `findExportJSX` helpers
- `injectUniqueIds.ts` — Injects `data-uniq-id` into source; supports `sampleIdMap` for Sample* exports; cache key includes componentName + sampleName
- `component-analyzer.ts` — Babel AST analysis
- `ai-agent*.ts` — AI orchestration (routes by provider: anthropic→SDK tools, openai→text-only via callAIStream, opencode→session SDK)
- `remote-git-parser.ts` — Parser for remote git commands (fetch/pull/push). Uses `shell-parser.ts` (shell-quote) for proper tokenization. Used by `ai-agent.ts` to intercept remote ops before sandbox, execute server-side with GitHub App credentials via `execFile`
- `lib/shell-parser.ts` — Generic shell command parser wrapping shell-quote. Splits input into commands + operators with proper quoting/escaping support
- `fileChangeTracker.ts` — File change tracking
