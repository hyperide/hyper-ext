# 2026-05-16 — NodePod Diagnostic Logs Adapter

## Context

NodePod projects boot in the browser (no Docker container). During boot they emit logs via
`appendLog()` into `runtime.logs: string[]`. These logs are never displayed — the user sees
only a blank spinner while npm install runs (can take 2+ minutes).

Docker projects use `useDiagnosticSync` → `diagnosticStore` → `DiagnosticLogsViewer` with
filtering, ANSI colours, virtual scrolling, auto-scroll, and build status.

Goal: same logs UI for NodePod. Adapter pattern — no mode branching in LogsPanel or
DiagnosticLogsViewer; two sync hooks feed the same store.

Worktree: `/Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime`

## Architecture

```
runtime.logs (string[]) ─→ useNodePodDiagnosticSync ─→ diagnosticStore ─→ DiagnosticLogsViewer
                                                                ↑
runtime.error, runtime.status ─────────────────────────────────┘

activeProject.status, gatewayError ─→ useDiagnosticSync ────────┘  (Docker path, unchanged)
```

Key design decisions:

- Both sync hooks are always mounted (React rules of hooks); `enabled` flag gates their logic
- `useDiagnosticSync` call moves from `LogsPanel` → `CanvasEditor` (LogsPanel becomes presentational)
- `LogsPanel` gets `onClear` prop instead of calling `useDiagnosticSync` itself
- NodePod log prefixes map to `DiagnosticSource`: `[npm]`/`[vite]` → `server`; `[nodepod]`/`[files]` → `system`; `[error]` → `server` with `isError: true`
- `LogsPanel` shown during NodePod boot (`runtime.mode === 'nodepod' && runtime.status !== 'idle'`)

## Hard Rules

- After each substantive code change, run Codex review: `codex exec review --uncommitted` — `tail -80` output. Fix findings before committing.
- Do not touch Docker path: `useDiagnosticSync`, `docker.ts` routes, `diagnosticStore`, `DiagnosticLogsViewer`, `DiagnosticFilterBar`.
- Do not change `useNodePodRuntime.ts` log collection logic — only consume `runtime.logs`.
- Both `useDiagnosticSync` and `useNodePodDiagnosticSync` always called in CanvasEditor (never conditionally).
- `useDiagnosticSync` gets `projectId: undefined` in NodePod mode → it becomes a no-op (already guards on projectId).
- Commit each task separately.

---

### Task 1: Create `useNodePodDiagnosticSync`

**Files:**

- Create: `client/hooks/useNodePodDiagnosticSync.ts`

- [ ] Create the file with this exact content:

```typescript
import type { RuntimeStatus } from "@/lib/project-runtime/types";
import type { DiagnosticSource } from "@shared/diagnostic-types";
import { useEffect, useRef } from "react";
import { useDiagnosticStore } from "@/stores/diagnosticStore";

interface UseNodePodDiagnosticSyncOptions {
  enabled: boolean;
  logs: string[];
  runtimeStatus: RuntimeStatus;
  runtimeError: string | null;
}

function mapSource(line: string): DiagnosticSource {
  if (line.startsWith("[npm]") || line.startsWith("[vite]")) return "server";
  if (line.startsWith("[error]")) return "server";
  return "system";
}

export function useNodePodDiagnosticSync({
  enabled,
  logs,
  runtimeStatus,
  runtimeError,
}: UseNodePodDiagnosticSyncOptions): { clear: () => void } {
  const { addLogs, setRuntimeError, setBuildStatus, setConnected, clear } = useDiagnosticStore();
  const pushedCountRef = useRef(0);
  const prevLogsLengthRef = useRef(0);

  // Detect log reset (new boot session) — logs go empty when start() is called
  useEffect(() => {
    if (!enabled) return;
    if (logs.length === 0 && prevLogsLengthRef.current > 0) {
      clear();
      pushedCountRef.current = 0;
    }
    prevLogsLengthRef.current = logs.length;
  }, [enabled, logs.length, clear]);

  // Push new log lines into the store
  useEffect(() => {
    if (!enabled) return;
    if (logs.length <= pushedCountRef.current) return;
    const newLines = logs.slice(pushedCountRef.current);
    pushedCountRef.current = logs.length;
    addLogs(
      newLines.map((line) => ({
        line,
        timestamp: Date.now(),
        source: mapSource(line),
        isError: line.startsWith("[error]"),
      })),
    );
  }, [enabled, logs, addLogs]);

  // Sync build status
  useEffect(() => {
    if (!enabled) return;
    if (runtimeStatus === "starting") setBuildStatus("building");
    else if (runtimeStatus === "running") setBuildStatus("ready");
    else if (runtimeStatus === "error") setBuildStatus("error");
    else setBuildStatus("idle");
  }, [enabled, runtimeStatus, setBuildStatus]);

  // Always connected when enabled (logs come directly from runtime state)
  useEffect(() => {
    if (!enabled) return;
    setConnected(true);
    return () => setConnected(false);
  }, [enabled, setConnected]);

  // Sync runtime error
  useEffect(() => {
    if (!enabled) return;
    setRuntimeError(runtimeError ? { type: "RuntimeError", message: runtimeError, framework: "vite" } : null);
  }, [enabled, runtimeError, setRuntimeError]);

  return { clear };
}
```

- [ ] Run typecheck to verify no errors:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 60 bun run typecheck 2>&1 | tail -20
```

Expected: 0 errors (or only pre-existing errors unrelated to this file).

- [ ] Run Codex review:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && codex exec review --uncommitted 2>&1 | tail -80
```

- [ ] Commit:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && git add client/hooks/useNodePodDiagnosticSync.ts && git commit -m "feat(nodepod): useNodePodDiagnosticSync — sync runtime.logs to diagnosticStore"
```

---

### Task 2: Refactor `LogsPanel` — remove internal sync, accept `onClear` prop

**Files:**

- Modify: `client/pages/Editor/components/LogsPanel.tsx`

`LogsPanel` currently calls `useDiagnosticSync` and uses `persistedClear`. Move sync to
CanvasEditor. LogsPanel becomes a presentational wrapper for DiagnosticLogsViewer.

- [ ] Replace the entire file content:

```typescript
import type { RuntimeError } from '@shared/runtime-error';
import { memo, useCallback } from 'react';
import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface LogsPanelProps {
  projectId: string;
  runtimeError?: RuntimeError | null;
  height: number;
  onHeightChange: (height: number) => void;
  onDismiss?: () => void;
  onClear?: () => void;
}

export const LogsPanel = memo(function LogsPanel({
  projectId: _projectId,
  runtimeError: _runtimeError,
  height,
  onHeightChange,
  onDismiss,
  onClear,
}: LogsPanelProps) {
  const openAIChat = useOpenAIChat();

  const handleAutoFix = useCallback(
    (prompt: string) => {
      openAIChat({ prompt, forceNewChat: true });
    },
    [openAIChat],
  );

  return (
    <div
      data-testid="LogsPanel"
      data-logs-panel
      className="absolute bottom-20 left-0 right-0 bg-background border-t border-border shadow-lg z-50"
      style={{ height: `${height}px` }}
    >
      <DragResizeHandle
        orientation="horizontal"
        value={height}
        onChange={onHeightChange}
        minValue={100}
        maxValue={600}
        inverted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      />
      <DiagnosticLogsViewer height="100%" onAutoFix={handleAutoFix} onClear={onClear} onDismiss={onDismiss} />
    </div>
  );
});
```

Note: `projectId` and `runtimeError` are kept in the interface (still needed by CanvasEditor
callsite and potentially future consumers) but prefixed with `_` since LogsPanel doesn't use
them directly now.

- [ ] Run lint to verify:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 60 bun run lint 2>&1 | tail -30
```

Expected: no new errors from LogsPanel.tsx. (Existing CanvasEditor errors about missing
`containerStatus`/`proxyError` props are expected until Task 3.)

- [ ] Run typecheck:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 60 bun run typecheck 2>&1 | tail -20
```

- [ ] Commit:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && git add client/pages/Editor/components/LogsPanel.tsx && git commit -m "refactor(logs): LogsPanel — remove internal useDiagnosticSync, accept onClear prop"
```

---

### Task 3: Wire both adapters in `CanvasEditor`

**Files:**

- Modify: `client/pages/Editor/CanvasEditor.tsx`

Three changes:

1. Import and call `useDiagnosticSync` (moved from LogsPanel)
2. Import and call `useNodePodDiagnosticSync`
3. Show LogsPanel during NodePod boot; pass `onClear`

- [ ] Find where `runtime` is destructured in CanvasEditor (search for `useProjectRuntime` or `const runtime`). Add the two sync hook calls right after the runtime declaration. Find the exact lines with:

```bash
grep -n "useProjectRuntime\|const runtime\|useLogsPanelState\|useDiagnosticSync" /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime/client/pages/Editor/CanvasEditor.tsx | head -20
```

- [ ] Add imports near the top of the imports block (after existing hook imports):

```typescript
import { useDiagnosticSync } from "@/hooks/useDiagnosticSync";
import { useNodePodDiagnosticSync } from "@/hooks/useNodePodDiagnosticSync";
```

- [ ] Find where `runtimeError` is used in CanvasEditor (it comes from `useGatewayErrorHandling`). Convert `runtime.error` to `RuntimeError` format for NodePod. Add this block right after `parseErrorAsRuntimeError` useMemo (around line 266):

```typescript
// Convert NodePod runtime error string to RuntimeError shape for LogsPanel
const nodePodRuntimeError = useMemo(
  (): RuntimeError | null =>
    runtime.mode === "nodepod" && runtime.error
      ? { type: "RuntimeError", message: runtime.error, framework: "vite" }
      : null,
  [runtime.mode, runtime.error],
);
```

- [ ] Call both sync hooks. Add right after `useLogsPanelState` call (around line 500). Both always called — no conditional:

```typescript
// Docker diagnostic sync (no-op when projectId is undefined = NodePod mode)
const { clear: dockerLogsClear } = useDiagnosticSync({
  projectId: runtime.mode === "docker" ? activeProject?.id : undefined,
  containerStatus: activeProject?.status,
  runtimeError: runtimeError || parseErrorAsRuntimeError,
  proxyError: gatewayErrorMessage,
});

// NodePod diagnostic sync (no-op when enabled = false)
const { clear: nodePodLogsClear } = useNodePodDiagnosticSync({
  enabled: runtime.mode === "nodepod",
  logs: runtime.logs,
  runtimeStatus: runtime.status,
  runtimeError: runtime.error,
});

const logsClear = runtime.mode === "nodepod" ? nodePodLogsClear : dockerLogsClear;
```

- [ ] Update `useLogsPanelState` call to also react to NodePod errors. Find the call (around line 499-500) and add `nodePodRuntimeError`:

```typescript
const { isLogsPanelOpen, isLogsPanelCollapsed, handleLogsDismiss, handleExpandLogs, handleToggleLogs } =
  useLogsPanelState({ hasGatewayError, runtimeError: runtimeError || nodePodRuntimeError, parseErrorAsRuntimeError });
```

- [ ] Find the LogsPanel render block (around line 1399-1413). Update it:

Old condition:

```
(hasGatewayError || runtimeError || parseErrorAsRuntimeError || isLogsPanelOpen)
```

New condition adds NodePod active state and passes onClear, removes containerStatus/proxyError:

```typescript
{!isCodeEditorMode &&
  !isLogsPanelCollapsed &&
  (hasGatewayError ||
    runtimeError ||
    parseErrorAsRuntimeError ||
    nodePodRuntimeError ||
    isLogsPanelOpen ||
    (runtime.mode === 'nodepod' && runtime.status !== 'idle')) &&
  activeProject?.id && (
    <LogsPanel
      projectId={activeProject.id}
      runtimeError={runtimeError || parseErrorAsRuntimeError || nodePodRuntimeError}
      height={logsHeight}
      onHeightChange={setLogsHeight}
      onDismiss={handleLogsDismiss}
      onClear={logsClear}
    />
  )}
```

- [ ] Run typecheck:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 60 bun run typecheck 2>&1 | tail -20
```

Expected: 0 new errors.

- [ ] Run lint:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 60 bun run lint 2>&1 | tail -30
```

- [ ] Run Codex review:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && codex exec review --uncommitted 2>&1 | tail -80
```

- [ ] Commit:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && git add client/pages/Editor/CanvasEditor.tsx && git commit -m "feat(nodepod): wire diagnostic log adapters in CanvasEditor, show LogsPanel during boot"
```

---

### Task 4: Push to develop

- [ ] Push branch commits to develop for staging:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && git push origin HEAD:develop && echo "pushed"
```

- [ ] Verify typecheck and lint pass cleanly:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/nodepod-browser-runtime && timeout 90 bun run typecheck 2>&1 | tail -5 && timeout 90 bun run lint 2>&1 | tail -5
```

---

## Verification (manual — after staging deploy)

1. Open HyperIDE with a NodePod project (cat-demo)
2. Observe: LogsPanel appears automatically at bottom during boot
3. Observe: log lines appear in real time — `[nodepod]`, `[files]`, `[npm] …`, `[vite] …`
4. Verify: `[npm]` lines shown with `server` source colour; `[nodepod]`/`[files]` with `system` colour
5. Verify: when runtime ready, build status badge shows "Ready"
6. Open a Docker project — logs panel still works as before
