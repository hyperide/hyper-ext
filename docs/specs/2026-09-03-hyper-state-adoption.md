# Hyper × state: adoption research & migration

**Home:** `hyperide/docs/specs/` — this is the adopter-side document. The library's own docs live in `packages/state-lib` and never reference Hyper internals (R55).
**Date:** 2026-09-03 (audit from 09-01).

## 1. Codebase audit (2026-09-01)

Numbers from `hyperide` on 2026-09-01 (client + extension webviews, tests excluded):

| Metric | Value |
|---|---|
| Client TS/TSX lines | ~76 k |
| React / TS / build | React 18.3, TypeScript 5.9, Vite, Bun; React Compiler not enabled |
| Hook files (`use*.ts[x]`) | 145 |
| `useState(` / `useEffect(` / `useCallback(` / `useMemo(` call sites | 278 / 329 / 398 / 70 |
| `useSyncExternalStore` | 11 |
| Zustand stores | 8 in `client/stores` (~1.7 k lines: auth, editor, connection, git, diagnostic, network, nudge, projectActivation) + `shared-editor-state` + `canvas-engine/store` + `nodepodRuntimeStore` |
| `@tanstack/react-query` | in `package.json`, imported by 1 file |
| REST hooks | hand-rolled `useState`+`useEffect`+`authFetch` (e.g. `useGitHubRepositories`: 7 `useState`, 3 refs, manual pagination) |
| Platform layer | `PlatformMessage` discriminated union (~40+ message types), `BrowserAdapter` / `VSCodeAdapter`, `requestId`-correlated request/response, SSE and `fetch` proxied through the extension host |
| Cross-panel state | `StateHub` (extension host) = source of truth for `SharedEditorState`; broadcasts patches to all webviews; webviews hold a Zustand replica; `mergeInitState` patches a selection race on reconnect |
| Undo/redo | `canvas-engine` (OOP, command pattern, own history, Zustand bridge) — separate from everything else |
| Persistence | ad-hoc `loadPersistedState/savePersistedState` in `editorStore`; VS Code `getState/setState` in webviews |

**What this tells us**

- There are at least **four state mechanisms** coexisting (local hooks, Zustand stores, StateHub replica, canvas-engine) plus a fifth (TanStack Query) barely used. The pain is not any one of them; it is that data fetching, RPC, cross-panel sync, persistence and undo are each solved locally, per hook, with no shared event stream.
- The **leader/replica topology is already the right shape** for VS Code (extension host = leader, webviews = replicas). It just lacks sequence numbers, patch semantics, buffering while a webview is hidden, and a transport interface — hence the race hack.
- The `PlatformMessage` union is effectively an untyped-at-runtime RPC protocol. It is a good candidate for the transport driver layer (`{post, onMessage}`), not something the new store should replace wholesale.
- 278 `useState` + 329 `useEffect` is the "hooks abstracting REST/RPC" problem in numbers: each is a private cache with private loading/error state that devtools, tests and Storybook cannot see.

---


### Transports inventory (added 09-03)

Alongside the state mechanisms, Hyper uses several transports at once: REST (`authFetch`), SSE (proxied through the extension host in VS Code), WebSockets, postMessage-RPC (`PlatformMessage` with `requestId` correlation), and `api:fetch` proxying for CORS. This is **not** a problem to fix — per-situation transport is correct — and it makes Hyper an ideal test bed for the toolkit's source adapters (`rest`, `sse`, `ws`, `rpc`): each existing transport should map onto one adapter with no loss.

## 2. Expected benefits to validate (R33)

To research before/while migrating — each with a concrete measurement or bug-class census:

1. **Bug classes eliminated:** selection/init races between webviews (the `mergeInitState` class — closed by the optimistic-overlay replication protocol by construction); stale-closure bugs in 329 `useEffect` sites; lost updates on webview reload; divergent loading/error states across 145 hand-rolled hooks; undo inconsistencies between canvas-engine and everything else. Method: label the last ~6 months of state-related bugs by class, map each class to the mechanism that removes it.
2. **Collaborativity path:** the command/patch logs + origin-scoped history are the prerequisites for multiplayer editing; evaluate CRDT-vs-leader for canvas co-editing on top of the same logs.
3. **Code/worktree indexing:** if project/worktree metadata becomes collections with live queries, indexing all code and worktrees, fast navigation and a blast-radius view become store queries (candidate: Danny-DB as the query engine, R32).
4. **Style editing master spec:** style state as slices with per-property signals should give per-control updates in the inspector without the current re-render storms; verify against the style-write unification plan.
5. **VS Code transport ceiling (R61):** `postMessage` is JSON-serialised and can bottleneck; evaluate (a) `ArrayBuffer` transfer for binary payloads, (b) a localhost WebSocket/HTTP channel from webviews via `portMapping` (the code-server variant already runs a server), keeping `postMessage` as the fallback driver.

## 3. Migration plan

The staged plan lives in the master spec §15 (spike: replace `shared-editor-state` + `StateHub` + `useGitHubRepositories`; then Zustand stores → slices; REST/RPC hooks → collections over the `PlatformMessage` contract; canvas-engine undo → `history`; transient UI → `useLocal`; templates; agent MCP). This doc owns the Hyper-side acceptance criteria: existing tests pass in both modes behind `HYPER_STATE_SPIKE=1`, webview bundle delta within budget, and the §2 bug-class census showing at least the race class structurally gone.
