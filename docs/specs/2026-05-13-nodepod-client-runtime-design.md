# NodePod Client-Side Runtime — Design Spec

**Date:** 2026-05-13  
**Status:** Approved

## Goal

Add a third execution mode to the SaaS: projects run their dev server inside the browser via NodePod instead of a Docker container on the server. Controlled by a per-user flag `clientSideRuntime`. No UI for the flag — set directly in DB. Initial scope: Vite-based projects only.

## Context

Current SaaS flow: user opens project → server starts Docker container → dev server boots → iframe shows preview via server proxy. This requires Docker infrastructure and a backend for each running project.

NodePod (`@scelar/nodepod`) reimplements the Node.js runtime in TypeScript/JS, running in a browser Worker. It intercepts HTTP via Service Worker. Validated: Vite + React boots in ~15s, React state works.

## What Changes

### 1. Database — `users.client_side_runtime`

New boolean column on `users` table, default `false`.

```sql
ALTER TABLE users ADD COLUMN client_side_runtime boolean NOT NULL DEFAULT false;
```

Drizzle schema (`server/database/schema/auth.ts`):
```typescript
clientSideRuntime: boolean('client_side_runtime').notNull().default(false),
```

Migration: new file in `server/database/migrations/`.

No new API endpoint for setting this flag — set directly in DB per user.

### 2. Server — `GET /api/user` exposes the flag

Existing route in `server/routes/user-settings.ts` already returns the `user` object. Add `clientSideRuntime` to the columns selected in the GET handler.

### 3. Server — `GET /api/projects/:id/files`

New endpoint. Returns the project's source file tree as a flat JSON map `{ [relativePath: string]: string }`. Used by NodePod runtime to populate its virtual FS.

```
GET /api/projects/:id/files
→ 200 { files: { "package.json": "...", "src/App.tsx": "...", ... } }
```

Access control: same `requireProjectAccess` middleware as other project routes.  
Scope: reads `project.path` from filesystem, returns text files only (skip `node_modules`, `.git`, binary files). Size cap: skip files > 500KB, total response cap 10MB.

### 4. Client — `User` type gains `clientSideRuntime`

`client/stores/authStore.ts`:
```typescript
export interface User {
  // ...existing fields...
  clientSideRuntime: boolean
}
```

### 5. Client — `ProjectRuntime` abstraction

New module `client/lib/project-runtime/`.

#### `types.ts`

```typescript
export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'
export type RuntimeMode = 'docker' | 'nodepod'

export interface ProjectRuntime {
  mode: RuntimeMode
  status: RuntimeStatus
  previewUrl: string | null
  logs: string[]
  error: string | null
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}
```

#### `useDockerRuntime.ts`

Wraps the existing `useProjectControl` + `useProjectSSE` hooks into `ProjectRuntime`. All Docker-specific logic (SSE, polling, container status, `broadcastContainerStatusChange`) stays here. Nothing from the Docker path leaks into consumers.

Interface matches `ProjectRuntime` exactly:
- `status` derived from `activeProject.status` + `isStarting`
- `previewUrl` built from `activeProject.port` (same logic currently in `CanvasEditor`)
- `logs` forwarded from SSE log events
- `start/stop/restart` delegate to existing handlers

This hook replaces the separate `useProjectControl` + `useProjectSSE` call sites in `CanvasEditor`.

#### `useNodePodRuntime.ts`

Implements `ProjectRuntime` for the NodePod path:

1. `start()` — boots NodePod, fetches files from `/api/projects/:id/files`, mounts into virtual FS, runs `npm install` then `vite dev`
2. `onServerReady` → sets `previewUrl` to SW proxy URL
3. `stop()` — calls `pod.teardown()` (NodePod v1.8 API) and clears the ref
4. `restart()` → `stop()` then `start()`
5. `logs` — forwarded from `spawn.on('output')` events
6. `status` — derived from NodePod lifecycle phases

NodePod instance held in a `useRef` (not state) to avoid re-render on each log line.

#### `useProjectRuntime.ts`

Factory hook. Selects implementation based on user flag and project framework:

```typescript
export function useProjectRuntime(
  project: ProjectData,
  user: User,
): ProjectRuntime {
  const isNodePodEligible = user.clientSideRuntime && isViteProject(project)
  const mode: RuntimeMode = isNodePodEligible ? 'nodepod' : 'docker'

  const docker = useDockerRuntime(project, { enabled: mode === 'docker' })
  const nodepod = useNodePodRuntime(project, { enabled: mode === 'nodepod' })

  return mode === 'nodepod' ? nodepod : docker
}
```

`isViteProject(project)` checks `project.framework` against `['Vite SPA (file-based routing)', 'Vite SPA (JSX router)']`.

Both hooks are always called (React rules of hooks) but guarded by `enabled` flag — disabled hook returns inert state and no-op methods.

### 6. Client — `CanvasEditor` refactor

`CanvasEditor` replaces:
```typescript
// before
const { handleStartProject, ... } = useProjectControl(...)
// + useProjectSSE(...)
// + manual previewUrl assembly
```

with:
```typescript
// after
const runtime = useProjectRuntime(activeProject, user)
```

Uses `runtime.previewUrl`, `runtime.status`, `runtime.start()`, `runtime.stop()`, `runtime.logs` — no mode-specific branching. The `ProjectStartOverlay`, `IframeCanvas`, and `LogsPanel` all consume from `runtime`.

### 7. COOP/COEP headers

NodePod works without COOP/COEP for basic Vite (confirmed in test). SharedArrayBuffer unavailable without them — NodePod logs a warning but `execSync`/`spawnSync` are not used in Vite dev path. No header changes needed for initial scope.

If in future `worker_threads` Atomics sync is needed (Webpack support), COOP/COEP can be added to a separate subdomain.

## What Does NOT Change

- Docker path — `container-manager`, `docker-manager`, SSE streaming, K8s mode: untouched
- VS Code extension — unaffected
- All non-Vite projects — `isViteProject` returns false → always Docker
- No UI for the flag in this iteration

## File Layout

```
client/lib/project-runtime/
  types.ts                  ← ProjectRuntime interface, RuntimeStatus, RuntimeMode
  useDockerRuntime.ts       ← Docker impl (wraps useProjectControl + useProjectSSE)
  useNodePodRuntime.ts      ← NodePod impl
  useProjectRuntime.ts      ← factory hook
  isViteProject.ts          ← framework check utility

server/database/schema/auth.ts          ← add clientSideRuntime column
server/database/migrations/XXXX_*.sql   ← ALTER TABLE migration
server/routes/user-settings.ts          ← expose clientSideRuntime in GET /api/user
server/routes/project-files.ts          ← new: GET /api/projects/:id/files
server/index.ts                         ← mount project-files route

client/stores/authStore.ts              ← add clientSideRuntime to User type
client/pages/Editor/CanvasEditor.tsx    ← use useProjectRuntime, remove old hooks
```

## Open Questions (deferred)

- HMR for file edits made in HyperIDE while NodePod is running: NodePod watches its virtual FS, but edits from HyperIDE write to server disk. Syncing disk→NodePod VFS is not in scope now. First version: NodePod loads files once on start.
- `npm install` cold start (~14s) UX: show log panel during install. NodePod v1.8 has `pod.snapshot()` / `pod.restore()` which can serialize the entire virtual FS including `node_modules` — caching this in OPFS for repeat opens is deferred but the API is available.
- Vite 8 HMR WebSocket bug in NodePod v1.8.2 — pin Vite to `7.3.1` in the files served to NodePod.
