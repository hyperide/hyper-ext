# 2026-05-13 — NodePod Client-Side Runtime

## Context

Add a third execution mode to the SaaS: projects run their dev server inside the browser via
NodePod instead of a Docker container. Controlled by a per-user `clientSideRuntime` boolean
flag (set directly in DB, no UI). Initial scope: Vite-only projects.

Spec: `docs/specs/2026-05-13-nodepod-client-runtime-design.md`

Architecture:

- `ProjectRuntime` TS interface unifies Docker and NodePod paths — no mode branching in CanvasEditor
- `useDockerRuntime` wraps existing `useProjectControl` + `useProjectSSE` into the interface
- `useNodePodRuntime` boots NodePod, reads files from `client-file-store` (OPFS), runs npm install + vite dev
- `useProjectRuntime` factory: picks Docker vs NodePod based on flag + framework check
- CanvasEditor uses `runtime.*` uniformly for both paths

NodePod (`@scelar/nodepod` v1.8.x): Node.js reimplemented in browser Workers + Service Worker
HTTP interception. Validated live: Vite + React boots in ~15s. License: MIT + Commons Clause
(building SaaS on it is allowed; reselling NodePod itself is not).

The SaaS uses Bun's HTMLBundle. `@scelar/nodepod/server` provides `serveSW()` — a Fetch-API
handler for non-Vite servers — used to expose `/__sw__.js` from the Hono app.

## Hard Rules

- After each substantive code change, run Codex review:
  `codex exec review --uncommitted` — read output with `tail -80`. Proceed only if findings
  are clean or explicitly noted as acceptable. Fix findings before committing.
- TDD: write failing test first for server endpoints and pure utility functions.
  Skip for hooks/UI where E2E is the only real test.
- Do not change the Docker path (`container-manager`, `docker-manager`, SSE, K8s mode).
- No UI for `clientSideRuntime`. Flag is set directly in DB.
- NodePod instance in `useRef`, not state — avoids re-render per log line.
- Both `useDockerRuntime` and `useNodePodRuntime` always called (React rules of hooks).
  `enabled` flag gates their logic. Disabled hook returns inert state and no-ops.
- Pin Vite to `7.3.1` in files served to NodePod (Vite 8 HMR WebSocket bug in NodePod v1.8.2).
- Migration file: `server/database/migrations/0009_add-client-side-runtime.sql`
- Worktree: `../hyperide-worktrees/nodepod-client-runtime`
- E2E tests only via `HYPER_E2E_SHARDS=1 bun run test:docker`. Never `bun run e2e` directly.
- Commit frequently; one logical change per commit.

---

## Task 1: DB — add client_side_runtime column

**Files:**

- Create: `server/database/migrations/0009_add-client-side-runtime.sql`
- Modify: `server/database/schema/auth.ts`

- [ ] Add the column to the Drizzle schema in `server/database/schema/auth.ts`.
      After `theme: varchar('theme', { length: 10 }).default('system'),` add:

```typescript
clientSideRuntime: boolean('client_side_runtime').notNull().default(false),
```

- [ ] Generate the migration (creates SQL + snapshot + journal entry automatically):

```bash
npx drizzle-kit generate
```

Expected: creates `server/database/migrations/0009_<random-name>.sql` +
`server/database/migrations/meta/0009_snapshot.json` + updates `_journal.json`.

- [ ] Rename the SQL file for readability (also update `tag` in `_journal.json` to match):

```bash
mv server/database/migrations/0009_*.sql \
   server/database/migrations/0009_add-client-side-runtime.sql
# then edit _journal.json: change "tag": "0009_<random>" → "tag": "0009_add-client-side-runtime"
```

- [ ] Run migration locally to verify it applies (only if `DATABASE_URL` is set):

```bash
npx drizzle-kit migrate
```

Expected: no errors, migration listed as applied.

- [ ] Codex review:

```bash
codex exec review --uncommitted
```

Read with `tail -80`. Fix any findings, then:

- [ ] Commit:

```bash
git add server/database/migrations/0009_add-client-side-runtime.sql \
        server/database/schema/auth.ts
git commit -m "feat(db): add client_side_runtime column to users"
```

---

## Task 2: Serve NodePod Service Worker script

`Nodepod.boot()` registers a Service Worker at `/__sw__.js` on the SaaS's origin.
The SaaS host must serve this script. `@scelar/nodepod/server` provides `serveSW()` —
a Fetch-API handler designed exactly for this, with a first-class Hono example in the docs:
`app.get('/__sw__.js', () => serveSW())`.

**Files:**

- Modify: `package.json` — add `@scelar/nodepod` dependency
- Modify: `server/index.ts` — add `/__sw__.js` Hono route

- [ ] Add the package:

```bash
bun add @scelar/nodepod@latest
```

Expected: package appears in `package.json` dependencies and `bun.lock` updated.

- [ ] In `server/index.ts`, add the import at the top:

```typescript
import { DEFAULT_SW_PATH, serveSW } from '@scelar/nodepod/server';
```

Then add the route. It doesn't require auth — place it before the `authMiddleware` block,
near the other unprotected routes (e.g. after the cors setup):

```typescript
// NodePod Service Worker — no auth, must be accessible by the browser before boot
app.get(DEFAULT_SW_PATH, () => serveSW());
```

- [ ] Verify manually: start the dev server, then:

```bash
curl -s http://localhost:8080/__sw__.js | head -3
```

Expected: JavaScript output. Also check response headers include `Service-Worker-Allowed: /`.

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add package.json bun.lock server/index.ts
git commit -m "feat(server): serve NodePod SW via @scelar/nodepod/server serveSW() in Hono"
```

---

## Task 3: Server — expose clientSideRuntime; Client — client-file-store

### 3a — Expose clientSideRuntime in GET /api/user

**Files:**

- Modify: `server/routes/user-settings.ts`

- [ ] In the `GET /` handler (line ~34), add `clientSideRuntime: true` to the `columns` object:

```typescript
columns: {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  theme: true,
  emailVerifiedAt: true,
  clientSideRuntime: true,  // ← add this
  createdAt: true,
},
```

- [ ] Manual verification: call `GET /api/user` (logged in), confirm `clientSideRuntime`
      appears in the response JSON with value `false`.

- [ ] Commit:

```bash
git add server/routes/user-settings.ts
git commit -m "feat(server): expose clientSideRuntime in GET /api/user"
```

### 3b — client-file-store (OPFS-backed per-project file cache)

NodePod reads files from OPFS, not from the server. This module is the single I/O point.

**Files:**

- Create: `client/lib/client-file-store/opfs.ts`
- Create: `client/lib/client-file-store/index.ts`
- Create: `test/client-file-store.test.ts`

- [ ] Write a failing test first. Create `test/client-file-store.test.ts`:

```typescript
import { expect, test, beforeEach } from 'bun:test';

// OPFS is browser-only; in Bun we test the pure logic layer using an in-memory Map as backend.
// Import the internal helpers we'll extract (see implementation below).
import { makeStore } from '../client/lib/client-file-store/opfs';

let store: ReturnType<typeof makeStore>;
beforeEach(() => {
  store = makeStore();
});

test('writeFile and readFiles round-trip', async () => {
  await store.writeFile('proj1', 'src/App.tsx', 'export default function App() {}');
  const files = await store.readFiles('proj1');
  expect(files['src/App.tsx']).toBe('export default function App() {}');
});

test('readFiles returns empty object when project not seeded', async () => {
  const files = await store.readFiles('unknown-proj');
  expect(files).toEqual({});
});

test('seedFiles bulk-writes and readFiles returns all', async () => {
  await store.seedFiles('proj2', {
    'package.json': '{"name":"test"}',
    'src/main.tsx': 'import React from "react"',
  });
  const files = await store.readFiles('proj2');
  expect(Object.keys(files)).toHaveLength(2);
  expect(files['package.json']).toBe('{"name":"test"}');
});

test('writeFile overwrites existing file', async () => {
  await store.seedFiles('proj3', { 'a.ts': 'v1' });
  await store.writeFile('proj3', 'a.ts', 'v2');
  const files = await store.readFiles('proj3');
  expect(files['a.ts']).toBe('v2');
});

test('clearProject removes all files for a project', async () => {
  await store.seedFiles('proj4', { 'a.ts': 'x', 'b.ts': 'y' });
  await store.clearProject('proj4');
  const files = await store.readFiles('proj4');
  expect(files).toEqual({});
});
```

- [ ] Run test — should fail with "Cannot find module":

```bash
bun test test/client-file-store.test.ts
```

Expected: module not found error.

- [ ] Create `client/lib/client-file-store/opfs.ts`:

```typescript
// In-memory store used in tests (makeStore) + OPFS adapter for browser (opfsStore).
// useNodePodRuntime uses opfsStore at runtime; tests use makeStore.

export interface FileStore {
  readFiles(projectId: string): Promise<Record<string, string>>;
  writeFile(projectId: string, path: string, content: string): Promise<void>;
  seedFiles(projectId: string, files: Record<string, string>): Promise<void>;
  clearProject(projectId: string): Promise<void>;
}

/** In-memory implementation — for unit tests and SSR environments without OPFS. */
export function makeStore(): FileStore {
  const data = new Map<string, Map<string, string>>();

  function project(id: string) {
    if (!data.has(id)) data.set(id, new Map());
    return data.get(id)!;
  }

  return {
    async readFiles(projectId) {
      return Object.fromEntries(project(projectId));
    },
    async writeFile(projectId, path, content) {
      project(projectId).set(path, content);
    },
    async seedFiles(projectId, files) {
      const p = project(projectId);
      for (const [k, v] of Object.entries(files)) p.set(k, v);
    },
    async clearProject(projectId) {
      data.delete(projectId);
    },
  };
}

/** OPFS-backed implementation — used at browser runtime. */
function makeOpfsStore(): FileStore {
  async function projectDir(projectId: string, create = false) {
    const root = await navigator.storage.getDirectory();
    const nodepod = await root.getDirectoryHandle('hyper-nodepod', { create: true });
    return nodepod.getDirectoryHandle(projectId, { create });
  }

  async function readDir(dir: FileSystemDirectoryHandle, prefix = ''): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for await (const [name, handle] of dir) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        Object.assign(out, await readDir(handle as FileSystemDirectoryHandle, path));
      } else {
        const file = await (handle as FileSystemFileHandle).getFile();
        out[path] = await file.text();
      }
    }
    return out;
  }

  return {
    async readFiles(projectId) {
      try {
        const dir = await projectDir(projectId);
        return readDir(dir);
      } catch {
        return {};
      }
    },
    async writeFile(projectId, path, content) {
      const dir = await projectDir(projectId, true);
      const parts = path.split('/');
      let cur = dir;
      for (const part of parts.slice(0, -1)) {
        cur = await cur.getDirectoryHandle(part, { create: true });
      }
      const fh = await cur.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await fh.createWritable();
      await writable.write(content);
      await writable.close();
    },
    async seedFiles(projectId, files) {
      await Promise.all(Object.entries(files).map(([path, content]) => this.writeFile(projectId, path, content)));
    },
    async clearProject(projectId) {
      try {
        const root = await navigator.storage.getDirectory();
        const nodepod = await root.getDirectoryHandle('hyper-nodepod', { create: false });
        await nodepod.removeEntry(projectId, { recursive: true });
      } catch {}
    },
  };
}

export const opfsStore: FileStore =
  typeof navigator !== 'undefined' && 'storage' in navigator ? makeOpfsStore() : makeStore();
```

- [ ] Create `client/lib/client-file-store/index.ts`:

```typescript
import { opfsStore } from './opfs';

export async function readFiles(projectId: string): Promise<Record<string, string>> {
  return opfsStore.readFiles(projectId);
}

export async function writeFile(projectId: string, path: string, content: string): Promise<void> {
  return opfsStore.writeFile(projectId, path, content);
}

export async function seedFiles(projectId: string, files: Record<string, string>): Promise<void> {
  return opfsStore.seedFiles(projectId, files);
}

export async function clearProject(projectId: string): Promise<void> {
  return opfsStore.clearProject(projectId);
}
```

- [ ] Run tests — all 5 should be GREEN:

```bash
bun test test/client-file-store.test.ts
```

Expected: 5 passing.

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/lib/client-file-store/opfs.ts \
        client/lib/client-file-store/index.ts \
        test/client-file-store.test.ts
git commit -m "feat(client): client-file-store — OPFS-backed per-project file cache for NodePod"
```

---

## Task 4: Client types — User + ProjectRuntime interface + isViteProject

**Files:**

- Modify: `client/stores/authStore.ts`
- Create: `client/lib/project-runtime/types.ts`
- Create: `client/lib/project-runtime/isViteProject.ts`

- [ ] Add `clientSideRuntime: boolean` to the `User` interface in `client/stores/authStore.ts`
      after `emailVerifiedAt: string | null`:

```typescript
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  theme: 'light' | 'dark' | 'system' | null;
  emailVerifiedAt: string | null;
  clientSideRuntime: boolean; // ← add this
}
```

- [ ] Create `client/lib/project-runtime/types.ts`:

```typescript
import type { ContainerPhase, ProjectStatus } from '@shared/types/statuses';

export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error';
export type RuntimeMode = 'docker' | 'nodepod';

// Matches ProjectStartOverlay's expected shape; uses the same types as useProjectSSE
export interface PollStatus {
  lastPoll: Date | null;
  lastResult: { running: boolean; status: ProjectStatus; phase?: ContainerPhase } | null;
  isPolling: boolean;
}

export const INERT_POLL_STATUS: PollStatus = {
  lastPoll: null,
  lastResult: null,
  isPolling: false,
};

export interface ProjectRuntime {
  mode: RuntimeMode;
  status: RuntimeStatus;
  /** true once runtime has reached 'running' since last stop — used to keep iframe alive during reconnects */
  hasBeenRunning: boolean;
  /** Null in Docker mode (IframeCanvas builds its own proxy URL). Set in NodePod mode to SW proxy URL. */
  previewUrl: string | null;
  logs: string[];
  error: string | null;
  /**
   * Always non-null — NodePod mode returns INERT_POLL_STATUS so ProjectStartOverlay never crashes.
   * Docker mode fills with real poll data.
   */
  pollStatus: PollStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}
```

- [ ] Create `client/lib/project-runtime/isViteProject.ts`:

```typescript
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';

const VITE_FRAMEWORKS = new Set(['Vite SPA (file-based routing)', 'Vite SPA (JSX router)']);

export function isViteProject(project: ProjectData): boolean {
  return project.framework != null && VITE_FRAMEWORKS.has(project.framework);
}
```

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/stores/authStore.ts \
        client/lib/project-runtime/types.ts \
        client/lib/project-runtime/isViteProject.ts
git commit -m "feat(client): ProjectRuntime types, isViteProject utility, User.clientSideRuntime"
```

---

## Task 5: useDockerRuntime

**Files:**

- Create: `client/lib/project-runtime/useDockerRuntime.ts`

Wraps `useProjectControl` + `useProjectSSE` into the `ProjectRuntime` interface.
All Docker-specific logic (SSE, polling, container status) stays here.

- [ ] Create `client/lib/project-runtime/useDockerRuntime.ts`:

```typescript
import { useEffect, useRef, useState } from 'react';
import { type ProjectData, useProjectControl } from '@/pages/Editor/components/hooks/useProjectControl';
import { useProjectSSE } from '@/pages/Editor/components/hooks/useProjectSSE';
import { INERT_POLL_STATUS, type PollStatus, type ProjectRuntime, type RuntimeStatus } from './types';

interface UseDockerRuntimeOptions {
  enabled: boolean;
  accessToken: string | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setProjectRole: (role: 'owner' | 'editor' | 'viewer') => void;
  reloadComposition?: () => Promise<void>;
}

const INERT: ProjectRuntime = {
  mode: 'docker',
  status: 'idle',
  hasBeenRunning: false,
  previewUrl: null,
  logs: [],
  error: null,
  pollStatus: INERT_POLL_STATUS,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useDockerRuntime(project: ProjectData | null, opts: UseDockerRuntimeOptions): ProjectRuntime {
  const { enabled, accessToken, setActiveProject, setIsStarting, setProjectRole, reloadComposition } = opts;

  const hasBeenRunningRef = useRef(false);
  const [hasBeenRunning, setHasBeenRunning] = useState(false);

  const { handleStartProject, handleStopProject, handleRestartProject, handleProjectUpdate } = useProjectControl({
    activeProject: enabled ? project : null,
    setActiveProject,
    setIsStarting,
    setProjectRole,
  });

  const { pollStatus } = useProjectSSE({
    accessToken: enabled ? accessToken : null,
    activeProject: enabled ? project : null,
    setActiveProject,
    handleProjectUpdate,
    reloadComposition,
  });

  // Track hasBeenRunning — stays true once running, resets on stop/error
  useEffect(() => {
    if (!enabled) return;
    if (project?.status === 'running') {
      if (!hasBeenRunningRef.current) {
        hasBeenRunningRef.current = true;
        setHasBeenRunning(true);
      }
    } else if (project?.status === 'stopped' || project?.status === 'error') {
      if (hasBeenRunningRef.current) {
        hasBeenRunningRef.current = false;
        setHasBeenRunning(false);
      }
    }
  }, [enabled, project?.status]);

  if (!enabled) return INERT;

  const status: RuntimeStatus = (() => {
    switch (project?.status) {
      case 'running':
        return 'running';
      case 'building':
        return 'starting';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  })();

  return {
    mode: 'docker',
    status,
    hasBeenRunning,
    previewUrl: null,
    logs: [],
    error: project?.status === 'error' ? 'Container error' : null,
    // Cast is safe: useProjectSSE's PollStatus uses ProjectStatus/ContainerPhase, same as our PollStatus
    pollStatus: (pollStatus as PollStatus) ?? INERT_POLL_STATUS,
    start: handleStartProject,
    stop: handleStopProject,
    restart: handleRestartProject,
  };
}
```

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/lib/project-runtime/useDockerRuntime.ts
git commit -m "feat(client): useDockerRuntime — wrap Docker control+SSE into ProjectRuntime"
```

---

## Task 6: useNodePodRuntime

**Files:**

- Create: `client/lib/project-runtime/useNodePodRuntime.ts`

NodePod implementation of `ProjectRuntime`. Boots NodePod, reads files from `client-file-store`
(OPFS), mounts into virtual FS, runs npm install then vite dev, sets previewUrl on server ready.
If OPFS is empty for this project (first boot), bootstraps from the existing project files API
then seeds OPFS — subsequent starts skip the server round-trip entirely.

- [ ] Create `client/lib/project-runtime/useNodePodRuntime.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import { authFetch } from '@/utils/authFetch';
import * as clientFileStore from '@/lib/client-file-store';
import { INERT_POLL_STATUS, type ProjectRuntime, type RuntimeStatus } from './types';

interface UseNodePodRuntimeOptions {
  enabled: boolean;
}

// Minimal interface for the NodePod pod instance.
// Nodepod is dynamically imported inside start() — this avoids bundling the ~3MB package
// for Docker-only users who never trigger NodePod mode.
interface PodInstance {
  fs: { writeFile(path: string, content: string): Promise<void> };
  spawn(cmd: string, args: string[], opts?: { cwd?: string }): Promise<SpawnHandle>;
  teardown(): Promise<void>;
}
interface SpawnHandle {
  on(event: 'output' | 'error', handler: (t: string) => void): void;
  completion: Promise<{ exitCode: number }>;
}

const INERT: ProjectRuntime = {
  mode: 'nodepod',
  status: 'idle',
  hasBeenRunning: false,
  previewUrl: null,
  logs: [],
  error: null,
  pollStatus: INERT_POLL_STATUS,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useNodePodRuntime(project: ProjectData | null, opts: UseNodePodRuntimeOptions): ProjectRuntime {
  const { enabled } = opts;

  const podRef = useRef<PodInstance | null>(null);
  // Track current run to ignore stale async results from previous start() invocations
  const runIdRef = useRef(0);
  const [status, setStatus] = useState<RuntimeStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasBeenRunning, setHasBeenRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev, line]);
  }, []);

  const start = useCallback(async () => {
    if (!project?.id || !enabled) return;
    // Allow restart after error by not returning early when podRef === null
    if (podRef.current) return; // already running (pod alive)

    const runId = ++runIdRef.current;
    const isStale = () => runId !== runIdRef.current;

    setStatus('starting');
    setLogs([]);
    setError(null);
    setPreviewUrl(null);
    setHasBeenRunning(false);

    try {
      // Dynamic import — tree-shaken away for Docker users
      const { Nodepod } = await import('@scelar/nodepod');
      if (isStale()) return;

      appendLog('[nodepod] booting...');
      // Non-null assertion: resolveServer is always called before the Promise resolves
      let resolveServer!: (url: string) => void;
      const serverReady = new Promise<string>((r) => {
        resolveServer = r;
      });

      const pod = await Nodepod.boot({
        watermark: false,
        workdir: '/app',
        onServerReady: (_port: number, url: string) => {
          if (!isStale()) {
            appendLog('[nodepod] server ready: ' + url);
            resolveServer(url);
          }
        },
      });
      if (isStale()) {
        pod.teardown().catch(() => {});
        return;
      }
      podRef.current = pod;
      appendLog('[nodepod] runtime booted');

      // Read files from OPFS; bootstrap from server on first boot for this project
      appendLog('[files] loading from OPFS...');
      let files = await clientFileStore.readFiles(project.id);
      if (Object.keys(files).length === 0) {
        appendLog('[files] OPFS empty — bootstrapping from server...');
        const res = await authFetch(`/api/projects/${project.id}/files`);
        if (!res.ok) throw new Error(`Failed to bootstrap files: ${res.status}`);
        const { files: serverFiles } = (await res.json()) as { files: Record<string, string> };
        await clientFileStore.seedFiles(project.id, serverFiles);
        files = serverFiles;
        appendLog(`[files] seeded ${Object.keys(files).length} files into OPFS`);
      } else {
        appendLog(`[files] ${Object.keys(files).length} files from OPFS`);
      }
      if (isStale()) return;

      // Mount files into NodePod virtual FS
      // Override Vite to 7.3.1 in both dependencies and devDependencies —
      // Vite 8 has an HMR WebSocket bug in NodePod v1.8.2
      const patchedFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        if (path === 'package.json') {
          try {
            const pkg = JSON.parse(content) as Record<string, unknown>;
            for (const field of ['dependencies', 'devDependencies'] as const) {
              const deps = pkg[field] as Record<string, string> | undefined;
              if (deps?.vite) deps.vite = '7.3.1';
            }
            patchedFiles[path] = JSON.stringify(pkg, null, 2);
          } catch {
            patchedFiles[path] = content;
          }
        } else {
          patchedFiles[path] = content;
        }
      }

      await Promise.all(Object.entries(patchedFiles).map(([rel, content]) => pod.fs.writeFile(`/app/${rel}`, content)));
      appendLog(`[files] ${Object.keys(files).length} files mounted`);

      // npm install
      appendLog('[npm] install started...');
      const install = await pod.spawn('npm', ['install'], { cwd: '/app' });
      install.on('output', (t) => appendLog('[npm] ' + t));
      install.on('error', (t) => appendLog('[npm:err] ' + t));
      const { exitCode: installCode } = await install.completion;
      if (isStale()) return;
      if (installCode !== 0) throw new Error('npm install failed with exit ' + installCode);
      appendLog('[npm] install done');

      // vite dev
      appendLog('[vite] starting dev server...');
      const dev = await pod.spawn('npm', ['run', 'dev'], { cwd: '/app' });
      dev.on('output', (t) => appendLog('[vite] ' + t));
      dev.on('error', (t) => appendLog('[vite:err] ' + t));
      dev.completion.then(({ exitCode }) => {
        if (isStale()) return;
        appendLog('[vite] process exited: ' + exitCode);
        podRef.current = null; // allow restart
        setStatus((s) => {
          if (s === 'running') setError('Vite dev server exited unexpectedly');
          return s === 'running' ? 'error' : s;
        });
      });

      const url = await Promise.race([
        serverReady,
        dev.completion.then(({ exitCode }) => Promise.reject(new Error('vite exited early: ' + exitCode))),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout 120s waiting for vite')), 120_000)),
      ]);
      if (isStale()) return;

      setPreviewUrl(url);
      setStatus('running');
      setHasBeenRunning(true);
    } catch (err) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      appendLog('[error] ' + msg);
      setError(msg);
      setStatus('error');
      if (podRef.current) {
        podRef.current.teardown().catch(() => {});
        podRef.current = null; // allow restart after error
      }
    }
  }, [project?.id, enabled, appendLog]);

  const stop = useCallback(async () => {
    runIdRef.current++; // invalidate any in-flight start()
    setStatus('stopping');
    if (podRef.current) {
      await podRef.current.teardown().catch(() => {});
      podRef.current = null;
    }
    setPreviewUrl(null);
    setStatus('idle');
    setHasBeenRunning(false);
    setError(null);
  }, []);

  const restart = useCallback(async () => {
    await stop();
    await start();
  }, [stop, start]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runIdRef.current++;
      if (podRef.current) {
        podRef.current.teardown().catch(() => {});
        podRef.current = null;
      }
    };
  }, []);

  if (!enabled) return INERT;

  return {
    mode: 'nodepod',
    status,
    hasBeenRunning,
    previewUrl,
    logs,
    error,
    pollStatus: INERT_POLL_STATUS,
    start,
    stop,
    restart,
  };
}
```

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/lib/project-runtime/useNodePodRuntime.ts
git commit -m "feat(client): useNodePodRuntime — NodePod ProjectRuntime implementation"
```

---

## Task 7: useProjectRuntime factory

**Files:**

- Create: `client/lib/project-runtime/useProjectRuntime.ts`
- Create: `client/lib/project-runtime/index.ts`

Factory hook — selects implementation based on user flag + framework.

- [ ] Create `client/lib/project-runtime/useProjectRuntime.ts`:

```typescript
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import type { User } from '@/stores/authStore';
import { useDockerRuntime } from './useDockerRuntime';
import { useNodePodRuntime } from './useNodePodRuntime';
import { isViteProject } from './isViteProject';
import type { ProjectRuntime, RuntimeMode } from './types';

interface UseProjectRuntimeOptions {
  accessToken: string | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setProjectRole: (role: 'owner' | 'editor' | 'viewer') => void;
  reloadComposition?: () => Promise<void>;
}

export function useProjectRuntime(
  project: ProjectData | null,
  user: User | null,
  opts: UseProjectRuntimeOptions,
): ProjectRuntime {
  const isNodePodEligible = !!(user?.clientSideRuntime && project && isViteProject(project));
  const mode: RuntimeMode = isNodePodEligible ? 'nodepod' : 'docker';

  const docker = useDockerRuntime(project, {
    enabled: mode === 'docker',
    accessToken: opts.accessToken,
    setActiveProject: opts.setActiveProject,
    setIsStarting: opts.setIsStarting,
    setProjectRole: opts.setProjectRole,
    reloadComposition: opts.reloadComposition,
  });

  const nodepod = useNodePodRuntime(project, { enabled: mode === 'nodepod' });

  return mode === 'nodepod' ? nodepod : docker;
}
```

- [ ] Create `client/lib/project-runtime/index.ts` (barrel):

```typescript
export { useProjectRuntime } from './useProjectRuntime';
export type { ProjectRuntime, RuntimeMode, RuntimeStatus, PollStatus } from './types';
export { isViteProject } from './isViteProject';
```

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/lib/project-runtime/useProjectRuntime.ts \
        client/lib/project-runtime/index.ts
git commit -m "feat(client): useProjectRuntime factory — selects Docker or NodePod based on flag+framework"
```

---

## Task 8: IframeCanvas — add overrideSrc prop

**Files:**

- Modify: `client/components/IframeCanvas.tsx`

When `overrideSrc` is provided, the iframe uses it instead of building the proxy URL.
Used in NodePod mode to point the iframe at the SW proxy URL.

- [ ] Add `overrideSrc?: string` to `IframeCanvasProps` interface (line ~42, after `onGatewayError`):

```typescript
/** When set, uses this URL as iframe src instead of the built /project-preview proxy URL */
overrideSrc?: string;
```

- [ ] Destructure it in the function signature (after line 70 where other props are destructured):

```typescript
export default function IframeCanvas({
  componentPath,
  // ... existing props ...
  overrideSrc,
}: IframeCanvasProps) {
```

- [ ] Modify the `src` attribute of the `<iframe>` (around line 1158). Replace the inner
      `const baseUrl = ...` block with:

```typescript
src={
  previewReady
    ? (() => {
        if (overrideSrc) return overrideSrc;
        const baseUrl = `/project-preview/${meta.projectId}/test-preview`;
        const params = new URLSearchParams();
        params.set('component', componentPath);
        if (canvasMode === 'multi') {
          params.set('mode', 'multi');
        }
        // ... rest of existing params assembly unchanged ...
```

That is: only add the `if (overrideSrc) return overrideSrc;` guard at the top of the IIFE.
Everything else in the existing `src={...}` block stays identical.

- [ ] Verify tsc: `bun tsc --noEmit` — no new errors.

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/components/IframeCanvas.tsx
git commit -m "feat(IframeCanvas): add optional overrideSrc prop for NodePod preview URL"
```

---

## Task 9: CanvasEditor refactor

**Files:**

- Modify: `client/pages/Editor/CanvasEditor.tsx`

Replace separate `useProjectControl` + `useProjectSSE` calls with `useProjectRuntime`.
The `ProjectStartOverlay`, `IframeCanvas`, and log consumers get data from `runtime.*`.

- [ ] Add imports at top of `CanvasEditor.tsx`. Replace:

```typescript
import { type ProjectData, useProjectControl } from './components/hooks/useProjectControl';
import { useProjectSSE } from './components/hooks/useProjectSSE';
```

with:

```typescript
import { type ProjectData } from './components/hooks/useProjectControl';
import { useProjectRuntime } from '@/lib/project-runtime';
```

- [ ] Change the `useAuthStore` destructure (line ~303) to also extract `user`:

```typescript
const { accessToken, user } = useAuthStore();
```

- [ ] Replace the two hook calls (lines ~307-320):

```typescript
// REMOVE:
const { handleStartProject, handleRestartProject, handleProjectUpdate, wasRunningRef } = useProjectControl({...});
const { pollStatus } = useProjectSSE({...});

// ADD:
const runtime = useProjectRuntime(activeProject, user, {
  accessToken,
  setActiveProject,
  setIsStarting,
  setProjectRole,
  reloadComposition,  // keep this — it's defined elsewhere in CanvasEditor, passed to SSE
});
```

`reloadComposition` is already defined in CanvasEditor and was being passed to `useProjectSSE`.
It stays as-is — `useDockerRuntime` accepts it and forwards to `useProjectSSE` internally.

- [ ] Update the iframe visibility check (line ~1074). Replace:

```typescript
activeProject && (activeProject.status === 'running' || wasRunningRef.current);
```

with:

```typescript
activeProject && (runtime.status === 'running' || runtime.hasBeenRunning);
```

- [ ] Derive `isStarting` from `runtime.status` so the overlay shows loading in NodePod mode too.
      Find where `isStarting` is currently set and add a synchronization effect after the runtime call:

```typescript
// Keep isStarting in sync with runtime status (NodePod sets status, not isStarting directly)
useEffect(() => {
  if (runtime.mode === 'nodepod') {
    setIsStarting(runtime.status === 'starting');
  }
}, [runtime.mode, runtime.status]);
```

- [ ] Handle NodePod error state for canvas visibility. Find the `activeProject.status === 'error'`
      branch in the render (if any) and also check `runtime.error`:

```typescript
const hasError = activeProject?.status === 'error' || runtime.status === 'error';
```

Update the relevant conditional rendering to use `hasError`.

- [ ] Update `IframeCanvas` usage (line ~1137). Add `overrideSrc={runtime.previewUrl ?? undefined}`:

```typescript
<IframeCanvas
  // ... existing props unchanged ...
  overrideSrc={runtime.previewUrl ?? undefined}
/>
```

- [ ] Update `ProjectStartOverlay` usage (line ~1234-1239). Replace handler references:

```typescript
<ProjectStartOverlay
  // ... other props unchanged ...
  pollStatus={runtime.pollStatus}
  isStarting={isStarting}
  onRestart={runtime.restart}
  onStart={runtime.start}
/>
```

Note: `pollStatus` type in `ProjectStartOverlay` expects the Docker poll shape.
Check `ProjectStartOverlay`'s props type — if it's typed as the Docker-specific type,
cast: `pollStatus={runtime.pollStatus as PollStatus}`. The value is null in NodePod mode
so the overlay will simply not show poll info.

- [ ] Run tsc:

```bash
bun tsc --noEmit
```

Expected: no new type errors. If there are, fix them — likely `handleProjectUpdate`
being used elsewhere in CanvasEditor for SSE event handling. Grep for other usages:

```bash
grep -n "handleProjectUpdate\|handleStartProject\|handleRestartProject\|wasRunningRef\|pollStatus" \
  client/pages/Editor/CanvasEditor.tsx
```

Handle each remaining usage appropriately — `handleProjectUpdate` may be passed to other
hooks as a callback; if so, expose it from `useDockerRuntime` as a runtime extension or
thread it through differently. Check the component carefully before changing.

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add client/pages/Editor/CanvasEditor.tsx
git commit -m "refactor(CanvasEditor): use useProjectRuntime, remove separate useProjectControl+useProjectSSE calls"
```

---

## Task 10: Set DB flag + smoke test

- [ ] Set `client_side_runtime = true` for `invntrm@gmail.com` in the local DB:

```bash
# Find the DB path from .env or config
# For SQLite (local dev):
sqlite3 ./database.sqlite \
  "UPDATE users SET client_side_runtime = 1 WHERE email = 'invntrm@gmail.com';"

# For Postgres (if DATABASE_URL set):
psql $DATABASE_URL -c \
  "UPDATE users SET client_side_runtime = true WHERE email = 'invntrm@gmail.com';"
```

Verify: query `SELECT email, client_side_runtime FROM users WHERE email = 'invntrm@gmail.com';`
Expected: `client_side_runtime = true`.

- [ ] Start the dev server and open a Vite project in the SaaS editor.

- [ ] Open browser DevTools → Application → Service Workers. Confirm `/__sw__.js` is registered.

- [ ] Open browser DevTools console. Confirm no errors during NodePod boot. Watch logs panel
      for `[npm] install started...` → `[vite] starting dev server...` → `[vite] server ready`.

- [ ] Confirm the preview iframe loads the Vite project after ~15-20s.

- [ ] Confirm Docker project (non-Vite framework) still uses Docker path — switch to a
      Next.js project, confirm the Docker container starts normally, no NodePod activity.

- [ ] If smoke test passes, commit any outstanding changes. If it fails, debug the failure
      before committing — add a `[nodepod] error:` log or read the browser console carefully.

- [ ] Final Codex review of the full diff:

```bash
codex exec review --uncommitted
tail -80 <output>
```

Fix any findings.

- [ ] Final commit (if anything left):

```bash
git add -p
git commit -m "chore(nodepod): smoke test verified, DB flag set for dev"
```

---

## Deferred (out of scope for this plan)

- HMR for edits in HyperIDE while NodePod running (disk → NodePod VFS sync)
- `pod.snapshot()/restore()` caching of node_modules in OPFS for repeat opens
- Webpack, Remix, Next.js support in NodePod
- COOP/COEP headers for SharedArrayBuffer (only needed for `worker_threads` Atomics)
- UI to toggle `clientSideRuntime` per user
