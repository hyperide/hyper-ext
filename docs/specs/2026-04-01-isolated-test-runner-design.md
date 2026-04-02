# Isolated Test Runner

## Problem

`bun test` runs all test files in a single process. `mock.module()` replaces modules in Bun's
global cache — mocks from one file leak into others. 59 files use `mock.module()`, and the
global preload (`mock-vscode.ts`) injects vscode mocks into every file, including lib/server
tests that don't need them.

Secondary problems:
- **Noisy output**: HyperMCP servers start (`[HyperMCP] Server started on ...`), EditorBridge
  logs messages, vecli prints formatted tables. No way to distinguish noise from real failures.
- **No parallelism**: 165 files, 2700 tests, 22.78s wall time on 14-core machine — single process.
- **Preload bloat**: `bunfig.toml` forces `setup.ts` + `mock-vscode.ts` on all tests. Server and
  lib tests load vscode mocks for nothing; mock-vscode's `beforeEach` runs on every test everywhere.

## Solution

A `scripts/test-runner.ts` that spawns each test file in its own `bun test <file>` subprocess,
with a worker pool for parallelism. Same approach as
[ExpenseSyncBot#41](https://github.com/alex-mextner/ExpenseSyncBot/commit/6377c31).

### Core Design

```
scripts/test-runner.ts
├── findTestFiles()    — Bun.Glob across configured directories
├── runFile(file)      — Bun.spawn('bun test <file>'), parse stdout for pass/fail
├── runPool(files, N)  — worker pool, concurrency = CPU count
└── run()              — orchestrator, aggregated summary, exit code
```

Each subprocess gets its own module cache → `mock.module()` is fully isolated.

### File Discovery

Scan directories: `client`, `lib`, `server`, `shared`, `vscode-extension`, `packages`.

Exclusions:
- `cloned-projects/` — user project clones, not our tests
- `.claude/worktrees/` — duplicate test files from worktrees
- `node_modules/`
- `templates/` — has its own dependencies

Pattern: `**/*.test.{ts,tsx}` within each directory.

### Preload Handling

Current `bunfig.toml` preloads apply to ALL files. With process isolation, we can be smarter:

| Preload | Applies to | Detection |
|---------|-----------|-----------|
| `test/setup.ts` (localStorage mock) | `client/`, `shared/` | File path starts with `client/` or `shared/` |
| `test/mock-vscode.ts` | `vscode-extension/` | File path starts with `vscode-extension/` |
| Neither | `lib/`, `server/`, `packages/` | Everything else |

Implementation: `runFile()` builds `--preload` flags per file based on directory:

```ts
function getPreloads(file: string): string[] {
  if (file.startsWith('vscode-extension/')) {
    return ['--preload', './test/setup.ts', '--preload', './test/mock-vscode.ts'];
  }
  if (file.startsWith('client/') || file.startsWith('shared/')) {
    return ['--preload', './test/setup.ts'];
  }
  return [];
}
```

**Migration**: Remove `[test]` section from `bunfig.toml` entirely. Preloads are now per-file
via CLI flags. Direct `bun test <file>` still works — the file either imports its own mocks or
runs without them (pure lib tests don't need preloads).

### Output Control

**Per-file**: Capture stdout/stderr via `Bun.spawn({ stdout: 'pipe', stderr: 'pipe' })`.

- On success: print one-line summary (`✓ file.test.ts (12 pass, 0 fail) [340ms]`)
- On failure: print one-line summary + indented full output for the failed file

**Aggregated summary**:

```
────────────────────────────────────────────────────────
Files:  165 total, 163 passed, 2 failed
Tests:  2700 total, 2698 passed, 2 failed
Time:   4.21s
```

Noise from HyperMCP, EditorBridge, etc. is swallowed on success — only visible in failed files.

### Concurrency

Default: `os.cpus().length` (14 on dev machine). Override: `TEST_CONCURRENCY=N`.

Worker pool pattern (not `Promise.all` over all files — that would spawn 165 processes):

```ts
async function runPool(files: string[], concurrency: number): Promise<FileResult[]> {
  const results: FileResult[] = [];
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < files.length) {
      const file = files[idx++]!;
      const result = await runFile(file);
      results.push(result);
      // print progress line
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}
```

### Filtering

```bash
bun scripts/test-runner.ts              # all files
bun scripts/test-runner.ts parser       # files matching "parser"
bun scripts/test-runner.ts vector-engine # files matching "vector-engine"
```

Substring match on file path, same as ExpenseSyncBot.

### Package Scripts

```json
{
  "test": "bun scripts/test-runner.ts",
  "test:watch": "bun scripts/test-runner.ts --watch",
  "test:coverage": "bun scripts/test-runner.ts --coverage",
  "test:single": "bun test"
}
```

- `bun run test` → isolated runner (default, CI, lefthook-safe)
- `bun run test:watch` → watch mode, re-runs changed files
- `bun run test:coverage` → isolated runner + merged lcov coverage report
- `bun run test:single` → original single-process mode (quick one-file debugging)
- `bun test <file>` → still works for a single file (no preload for lib/server, which is fine)

### CI Integration

`.github/workflows/ci.yml` change:

```yaml
- name: Test
  run: bun run test
```

Replaces `bun test client lib server shared vscode-extension`. The runner handles directory
scanning and exit code propagation.

### CLAUDE.md Update

Replace mock.module restriction with:

```
- **`mock.module()` is safe** — each test file runs in its own process via
  `scripts/test-runner.ts`. Use freely for mocking dependencies.
- **Always run tests via `bun run test`** (isolated runner), not bare `bun test` —
  the latter runs all files in one process and mock.module leaks between files.
```

### Watch Mode

File watcher that re-runs only changed test files (and their dependents if detectable).

```bash
bun run test:watch              # watch all
bun run test:watch parser       # watch filtered subset
```

Implementation: `chokidar` or `Bun.FileSystemWatcher` on scan directories.

On file change:
1. If `*.test.{ts,tsx}` changed — re-run that file
2. If source file changed — re-run test files that import it (best-effort, fall back to
   re-running all tests in the same directory)
3. Debounce 200ms to batch rapid saves

Output: clear terminal, re-print results. Show only the re-run file(s), not the full suite.

Package script:
```json
"test:watch": "bun scripts/test-runner.ts --watch"
```

### Coverage

The runner collects coverage from each subprocess and merges into a single report.

```bash
bun run test:coverage           # isolated runner + merged coverage
```

Implementation: each subprocess runs with `--coverage`. Bun writes coverage data to
`coverage/` by default. The runner collects per-file lcov output and merges after all files
complete (simple concatenation — lcov format is appendable, or `lcov-result-merger` if
deduplication needed).

Note: verify `bun test --coverage` flags at implementation time — Bun's coverage API differs
from Jest/Vitest. May need `bunfig.toml` `[test.coverage]` section per-subprocess or env vars.

Output: merged `coverage/lcov.info` + optional `text-summary` to stdout.

Package script:
```json
"test:coverage": "bun scripts/test-runner.ts --coverage"
```

### Shared Test Utilities (Phase 2)

Current duplication is **modest** — not blocking, but two patterns are clear extraction
candidates. The rest should be extracted organically (rule: 3rd copy-paste triggers extraction).

#### 1. `createFsMock()` — in-memory `node:fs/promises`

6 test files mock `node:fs/promises` with the same pattern: an in-memory `Record<string, string>`
as the file system, `readFile` throws ENOENT when key missing, `writeFile` sets keys, plus
optional `mkdir`/`unlink`/`access`/`stat`.

Variations across files:
- Some track call history (`readFileCalls.push(path)`)
- Some use external state objects (`state.writtenContent = content`)
- Some need `stat` returning `{ size }`, others only `readFile`/`writeFile`

**API design:**

```ts
// test-utils/mocks/fs.ts
interface FsMockOptions {
  files?: Record<string, string>;       // initial file contents
  accessiblePaths?: Set<string>;        // for access() — defaults to files keys
  fileSizes?: Record<string, number>;   // for stat() — defaults to 100
}

interface FsMock {
  files: Record<string, string>;        // mutable — tests read/write directly
  calls: {
    readFile: string[];
    writeFile: Array<{ path: string; content: string }>;
    mkdir: string[];
    unlink: string[];
    access: string[];
  };
  module: {                             // pass to mock.module()
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    mkdir: (dir: string) => Promise<void>;
    unlink: (path: string) => Promise<void>;
    access: (path: string) => Promise<void>;
    stat: (path: string) => Promise<{ size: number }>;
  };
  reset: () => void;                    // clear files + calls
}

export function createFsMock(options?: FsMockOptions): FsMock;
```

**Usage in test:**

```ts
import { createFsMock } from '../../test-utils/mocks/fs';

const fs = createFsMock({
  files: { '/project/package.json': '{"name":"test"}' },
});

mock.module('node:fs/promises', () => fs.module);

// assert
expect(fs.calls.readFile).toContain('/project/package.json');
expect(fs.files['/project/output.json']).toBe('...');
```

**Consumers (6 files):**
- `vscode-extension/.../FileStructureStore.test.ts` — readFile, writeFile, mkdir
- `vscode-extension/.../ProjectDetector.test.ts` — readFile, access
- `vscode-extension/.../DiagnosticPersistenceService.test.ts` — readFile, writeFile, unlink, mkdir
- `vscode-extension/.../DiagnosticHub.test.ts` — readFile, writeFile, unlink, mkdir
- `vscode-extension/.../PanelRouter.test.ts` — readFile, mkdir, writeFile
- `server/.../fileChangeTracker.test.ts` — stat, readFile

#### 2. `mockServerDb()` — database + projects service

2 test files (`workspace.test.ts`, `projectRole.test.ts`) mock `../database/db` and
`../modules/projects/service` with near-identical code. Each file includes **all** exports
from both modules to prevent mock bleed in shared process — bloating each mock to ~30 lines
of unused stubs.

With process isolation, each test only mocks what it actually uses. The shared utility provides
a pre-configured mock that returns `null`/`[]` by default, with individual overrides.

**API design:**

```ts
// test-utils/mocks/server-db.ts
interface DbMock {
  db: {
    query: {
      workspaceMembers: { findFirst: Mock };
      projectMembers: { findFirst: Mock };
    };
  };
  setRLSContext: Mock;
}

interface ProjectsServiceMock {
  getProject: Mock;
  getActiveProject: Mock;
  getProjectByPath: Mock;
  getChat: Mock;
  getAIConfig: Mock;
  listProjects: Mock;
  createProject: Mock;
  updateProject: Mock;
  deleteProject: Mock;
  setActiveProject: Mock;
}

interface ServerDbMock {
  db: DbMock;
  projectsService: ProjectsServiceMock;
  /** Call mock.module() for both modules */
  install: (dbPath: string, servicePath: string) => void;
  reset: () => void;
}

export function mockServerDb(): ServerDbMock;
```

**Usage in test:**

```ts
import { mockServerDb } from '../../test-utils/mocks/server-db';

const mocks = mockServerDb();
mocks.install('../database/db', '../modules/projects/service');

// override only what this test needs
mocks.projectsService.getProject.mockResolvedValue({ id: 'proj-1', name: 'Test' });
mocks.db.db.query.workspaceMembers.findFirst.mockResolvedValue({ role: 'owner' });
```

**Consumers (2 files + future server middleware tests):**
- `server/middleware/workspace.test.ts`
- `server/middleware/projectRole.test.ts`

#### Not extracting (rationale)

| Pattern | Files | Decision |
|---------|-------|----------|
| `@lib/types` empty mock | 2 | One-liner, no value in sharing |
| DOM utils mock | 3 | 70% overlap but each needs different methods — premature |
| `beforeEach` mock reset | 8+ | Too diverse — each resets different mocks |
| `make*` factories | scattered | Almost all unique per test |

## Non-Goals

- **Logger silencing**: tests don't have a central logger like ExpenseSyncBot's pino. Noisy
  console output is suppressed by the runner's stdout capture.

## Risks

| Risk | Mitigation |
|------|-----------|
| Slower total time (process spawn overhead × 165) | Pool limits concurrency; bun subprocess start is ~50ms; expected wall time 4-6s (vs 22.78s sequential) |
| Some tests rely on global preload side effects | Selective preload via `--preload` flags per directory |
| bunfig.toml removal breaks `bun test <file>` for vscode tests | Devs use `bun run test <filter>` instead; document in CLAUDE.md |
| WASM tests (vector-wasm) have longer startup | They're already slow; parallel execution compensates |

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/test-runner.ts` | Isolated parallel test runner |
| Modify | `package.json` | Replace `test` script, add `test:single` |
| Modify | `bunfig.toml` | Remove `[test]` preload section |
| Modify | `.github/workflows/ci.yml` | Use `bun run test` |
| Modify | `CLAUDE.md` | Update mock.module rules |
| Create | `test-utils/mocks/fs.ts` | Phase 2: shared `node:fs/promises` mock factory |
| Create | `test-utils/mocks/server-db.ts` | Phase 2: shared database/projects mock |
