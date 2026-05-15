# 2026-05-13 — NodePod Client-Side Runtime

## Context

Add a third execution mode to the SaaS: projects run their dev server inside the browser via
NodePod instead of a Docker container. Controlled by a per-user `clientSideRuntime` boolean
flag (set directly in DB, no UI). Initial scope: Vite-only projects.

Spec: `docs/specs/2026-05-13-nodepod-client-runtime-design.md`

Architecture:
- `ProjectRuntime` TS interface unifies Docker and NodePod paths — no mode branching in CanvasEditor
- `useDockerRuntime` wraps existing `useProjectControl` + `useProjectSSE` into the interface
- `useNodePodRuntime` boots NodePod, fetches project files from server, runs npm install + vite dev
- `useProjectRuntime` factory: picks Docker vs NodePod based on flag + framework check
- CanvasEditor uses `runtime.*` uniformly for both paths

NodePod (`@scelar/nodepod` v1.8.x): Node.js reimplemented in browser Workers + Service Worker
HTTP interception. Validated live: Vite + React boots in ~15s. License: MIT + Commons Clause
(building SaaS on it is allowed; reselling NodePod itself is not).

The SaaS uses Bun's HTMLBundle (not Vite), so the `@scelar/nodepod/vite` plugin can't be
used directly. We serve the SW script manually via a Bun route.

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
- Worktree: `/Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-client-runtime`
- E2E tests only via `HYPER_E2E_SHARDS=1 bun run test:docker`. Never `bun run e2e` directly.
- Commit frequently; one logical change per commit.

---

## Task 1: DB — add client_side_runtime column

**Files:**
- Create: `server/database/migrations/0009_add-client-side-runtime.sql`
- Modify: `server/database/schema/auth.ts`

- [ ] Create the migration file:

```sql
-- 0009_add-client-side-runtime.sql
ALTER TABLE users ADD COLUMN client_side_runtime boolean NOT NULL DEFAULT false;
```

- [ ] Add the column to the Drizzle schema in `server/database/schema/auth.ts`.
  After `theme: varchar('theme', { length: 10 }).default('system'),` add:

```typescript
clientSideRuntime: boolean('client_side_runtime').notNull().default(false),
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

The SW must be available at `/__sw__.js` for `Nodepod.boot()` to register it.
The `@scelar/nodepod/vite` plugin handles this in Vite projects; in Bun we serve it manually.

**Files:**
- Modify: `package.json` — add `@scelar/nodepod` dependency
- Modify: `server/main.ts` — add `/__sw__.js` Bun static route

- [ ] Add the package:

```bash
bun add @scelar/nodepod@latest
```

Expected: package appears in `package.json` dependencies and `bun.lock` updated.

- [ ] In `server/main.ts`, add a `/__sw__.js` entry to the static `routes:` object.
  Place it BEFORE the `'/*'` wildcard catch-all. The route reads the SW source from the
  installed package and serves it with the headers NodePod requires:

```typescript
'/__sw__.js': async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  // Resolve package root relative to the process CWD (repo root)
  const pkgDir = resolve('./node_modules/@scelar/nodepod');
  const source = readFileSync(`${pkgDir}/dist/__sw__.js`, 'utf-8');
  return new Response(source, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache',
    },
  });
},
```

- [ ] Verify manually: start the dev server, then:

```bash
curl -s http://localhost:8080/__sw__.js | head -3
```

Expected: JavaScript output (first line starts with something like `"use strict"` or
a variable declaration from the NodePod SW bundle).

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add package.json bun.lock server/main.ts
git commit -m "feat(server): serve NodePod SW at /__sw__.js via Bun static route"
```

---

## Task 3: Server — expose clientSideRuntime + new /files endpoint

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

### 3b — New GET /api/projects/:id/files endpoint

**Files:**
- Create: `server/routes/project-files.ts`
- Modify: `server/index.ts` — mount the router

- [ ] Write a unit test first. Create `test/readProjectFiles.test.ts`:

```typescript
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'bun:test';
import { readProjectFiles } from '../server/routes/project-files';

test('returns text files, skips node_modules and .git', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nptest-'));
  await writeFile(join(dir, 'package.json'), '{"name":"test"}');
  await mkdir(join(dir, 'node_modules/foo'), { recursive: true });
  await writeFile(join(dir, 'node_modules/foo/index.js'), 'module');
  await mkdir(join(dir, '.git'), { recursive: true });
  await writeFile(join(dir, '.git/config'), '[core]');

  const files = await readProjectFiles(dir);

  expect(files['package.json']).toBe('{"name":"test"}');
  expect(files['node_modules/foo/index.js']).toBeUndefined();
  expect(files['.git/config']).toBeUndefined();

  await rm(dir, { recursive: true });
});

test('skips files over 500KB', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nptest-'));
  await writeFile(join(dir, 'small.ts'), 'export const x = 1;');
  await writeFile(join(dir, 'large.ts'), 'x'.repeat(501 * 1024));

  const files = await readProjectFiles(dir);

  expect(files['small.ts']).toBe('export const x = 1;');
  expect(files['large.ts']).toBeUndefined();

  await rm(dir, { recursive: true });
});

test('skips binary extensions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nptest-'));
  await writeFile(join(dir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(dir, 'app.ts'), 'const x = 1;');

  const files = await readProjectFiles(dir);

  expect(files['app.ts']).toBe('const x = 1;');
  expect(files['image.png']).toBeUndefined();

  await rm(dir, { recursive: true });
});
```

- [ ] Run test to confirm it fails (function doesn't exist yet):

```bash
bun test test/readProjectFiles.test.ts
```

Expected: `Cannot find module '../server/routes/project-files'` or similar.

- [ ] Create `server/routes/project-files.ts`:

```typescript
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { requireProjectAccess } from '../middleware/projectRole';

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.hyperide', 'dist', '.next',
  'build', '.cache', 'out', '.turbo',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.tar', '.gz', '.bz2',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
  '.exe', '.dll', '.so', '.dylib',
  '.sqlite', '.db',
]);

const MAX_FILE_BYTES = 500 * 1024;      // 500 KB per file
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10 MB total

export async function readProjectFiles(projectPath: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let totalBytes = 0;

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        const dotIdx = entry.name.lastIndexOf('.');
        const ext = dotIdx !== -1 ? entry.name.slice(dotIdx).toLowerCase() : '';
        if (BINARY_EXTENSIONS.has(ext)) continue;
        const s = await stat(full);
        if (s.size > MAX_FILE_BYTES) continue;
        if (totalBytes + s.size > MAX_TOTAL_BYTES) continue;
        const content = await readFile(full, 'utf-8').catch(() => null);
        if (content === null) continue;
        totalBytes += s.size;
        files[relative(projectPath, full)] = content;
      }
    }
  }

  await walk(projectPath);
  return files;
}

export const projectFilesRouter = new Hono();
projectFilesRouter.use('*', authMiddleware);

projectFilesRouter.get('/:id/files', requireProjectAccess, async (c) => {
  const project = c.get('checkedProject');
  if (!project.path) return c.json({ error: 'Project has no path' }, 400);
  const files = await readProjectFiles(project.path);
  return c.json({ files });
});
```

- [ ] Run tests — all three should be GREEN:

```bash
bun test test/readProjectFiles.test.ts
```

Expected: 3 passing.

- [ ] Mount in `server/index.ts`. Add import at top:

```typescript
import { projectFilesRouter } from './routes/project-files';
```

After the existing `app.route('/api/projects', subscriptionsRouter);` line, add:

```typescript
app.route('/api/projects', projectFilesRouter);
```

- [ ] Codex review, fix findings.

- [ ] Commit:

```bash
git add server/routes/user-settings.ts \
        server/routes/project-files.ts \
        server/index.ts \
        test/readProjectFiles.test.ts
git commit -m "feat(server): expose clientSideRuntime in /api/user + add /api/projects/:id/files"
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
  clientSideRuntime: boolean;  // ← add this
}
```

- [ ] Create `client/lib/project-runtime/types.ts`:

```typescript
export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'stopping' | 'error'
export type RuntimeMode = 'docker' | 'nodepod'

export interface PollStatus {
  lastPoll: Date | null;
  lastResult: { running: boolean; status: string; phase?: string } | null;
  isPolling: boolean;
}

export interface ProjectRuntime {
  mode: RuntimeMode
  status: RuntimeStatus
  /** true once runtime has reached 'running' since last stop — used to keep iframe alive during reconnects */
  hasBeenRunning: boolean
  /** Null in Docker mode (IframeCanvas builds its own proxy URL). Set in NodePod mode to SW proxy URL. */
  previewUrl: string | null
  logs: string[]
  error: string | null
  /** Docker-specific: null in NodePod mode */
  pollStatus: PollStatus | null
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}
```

- [ ] Create `client/lib/project-runtime/isViteProject.ts`:

```typescript
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';

const VITE_FRAMEWORKS = new Set([
  'Vite SPA (file-based routing)',
  'Vite SPA (JSX router)',
]);

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
import type { PollStatus, ProjectRuntime, RuntimeStatus } from './types';

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
  pollStatus: null,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useDockerRuntime(
  project: ProjectData | null,
  opts: UseDockerRuntimeOptions,
): ProjectRuntime {
  const { enabled, accessToken, setActiveProject, setIsStarting, setProjectRole, reloadComposition } = opts;

  const hasBeenRunningRef = useRef(false);
  const [hasBeenRunning, setHasBeenRunning] = useState(false);

  const {
    handleStartProject,
    handleStopProject,
    handleRestartProject,
    handleProjectUpdate,
  } = useProjectControl({
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
      case 'running':  return 'running';
      case 'building': return 'starting';
      case 'error':    return 'error';
      default:         return 'idle';
    }
  })();

  return {
    mode: 'docker',
    status,
    hasBeenRunning,
    previewUrl: null,
    logs: [],
    error: project?.status === 'error' ? 'Container error' : null,
    pollStatus: pollStatus as PollStatus,
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

NodePod implementation of `ProjectRuntime`. Boots NodePod, fetches files from server,
mounts into virtual FS, runs npm install then vite dev, sets previewUrl on server ready.

- [ ] Create `client/lib/project-runtime/useNodePodRuntime.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Nodepod } from '@scelar/nodepod';
import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import { authFetch } from '@/utils/authFetch';
import type { ProjectRuntime, RuntimeStatus } from './types';

interface UseNodePodRuntimeOptions {
  enabled: boolean;
}

const INERT: ProjectRuntime = {
  mode: 'nodepod',
  status: 'idle',
  hasBeenRunning: false,
  previewUrl: null,
  logs: [],
  error: null,
  pollStatus: null,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useNodePodRuntime(
  project: ProjectData | null,
  opts: UseNodePodRuntimeOptions,
): ProjectRuntime {
  const { enabled } = opts;

  const podRef = useRef<Awaited<ReturnType<typeof Nodepod.boot>> | null>(null);
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
    if (podRef.current) return; // already running

    setStatus('starting');
    setLogs([]);
    setError(null);
    setPreviewUrl(null);
    setHasBeenRunning(false);

    try {
      // Dynamic import — avoids bundling NodePod for Docker-only users
      const { Nodepod } = await import('@scelar/nodepod');

      appendLog('[nodepod] booting...');
      let resolveServer: (url: string) => void;
      const serverReady = new Promise<string>((r) => { resolveServer = r; });

      const pod = await Nodepod.boot({
        watermark: false,
        workdir: '/app',
        allowedFetchDomains: null,
        onServerReady: (_port: number, url: string) => {
          appendLog('[nodepod] server ready: ' + url);
          resolveServer(url);
        },
      });
      podRef.current = pod;
      appendLog('[nodepod] runtime booted');

      // Fetch project files from server
      appendLog('[files] fetching project files...');
      const res = await authFetch(`/api/projects/${project.id}/files`);
      if (!res.ok) throw new Error(`Failed to fetch files: ${res.status}`);
      const { files } = await res.json() as { files: Record<string, string> };

      // Mount files into NodePod virtual FS
      // Override Vite version to 7.3.1 to avoid Vite 8 HMR WebSocket bug in NodePod v1.8.2
      const patchedFiles: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        if (path === 'package.json') {
          try {
            const pkg = JSON.parse(content) as Record<string, unknown>;
            const deps = pkg.devDependencies as Record<string, string> | undefined;
            if (deps?.vite) deps.vite = '7.3.1';
            patchedFiles[path] = JSON.stringify(pkg, null, 2);
          } catch {
            patchedFiles[path] = content;
          }
        } else {
          patchedFiles[path] = content;
        }
      }

      await Promise.all(
        Object.entries(patchedFiles).map(([rel, content]) =>
          pod.fs.writeFile(`/app/${rel}`, content)
        )
      );
      appendLog(`[files] ${Object.keys(files).length} files mounted`);

      // npm install
      appendLog('[npm] install started...');
      const install = await pod.spawn('npm', ['install'], { cwd: '/app' });
      install.on('output', (t: string) => appendLog('[npm] ' + t));
      install.on('error', (t: string) => appendLog('[npm:err] ' + t));
      const { exitCode: installCode } = await install.completion;
      if (installCode !== 0) throw new Error('npm install failed with exit ' + installCode);
      appendLog('[npm] install done');

      // vite dev
      appendLog('[vite] starting dev server...');
      const dev = await pod.spawn('npm', ['run', 'dev'], { cwd: '/app' });
      dev.on('output', (t: string) => appendLog('[vite] ' + t));
      dev.on('error', (t: string) => appendLog('[vite:err] ' + t));
      dev.completion.then((r: { exitCode: number }) => {
        appendLog('[vite] process exited: ' + r.exitCode);
        if (status === 'running') setError('Vite dev server exited unexpectedly');
      });

      const url = await Promise.race([
        serverReady,
        dev.completion.then((r: { exitCode: number }) =>
          Promise.reject(new Error('vite exited: ' + r.exitCode))
        ),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('timeout 120s waiting for vite')), 120_000)
        ),
      ]);

      setPreviewUrl(url);
      setStatus('running');
      setHasBeenRunning(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog('[error] ' + msg);
      setError(msg);
      setStatus('error');
      if (podRef.current) {
        podRef.current.teardown().catch(() => {});
        podRef.current = null;
      }
    }
  }, [project?.id, enabled, appendLog]);

  const stop = useCallback(async () => {
    setStatus('stopping');
    if (podRef.current) {
      await podRef.current.teardown().catch(() => {});
      podRef.current = null;
    }
    setPreviewUrl(null);
    setStatus('idle');
    setHasBeenRunning(false);
  }, []);

  const restart = useCallback(async () => {
    await stop();
    await start();
  }, [stop, start]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
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
    pollStatus: null,
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
  reloadComposition,
});
```

- [ ] Update the iframe visibility check (line ~1074). Replace:

```typescript
activeProject && (activeProject.status === 'running' || wasRunningRef.current)
```

with:

```typescript
activeProject && (runtime.status === 'running' || runtime.hasBeenRunning)
```

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
