# React hooks: chat panel — extract custom hooks with TDD

## Context

`oxlint` found 15 warnings in chat-related hooks across:
- `client/components/chat/SharedChatPanel.tsx` — 13 issues
- `client/hooks/chat/useChatHistory.ts` — 1 issue (missing `initialChatId`)
- `client/hooks/chat/useAutoScroll.ts` — 1 issue (spread in deps array — REAL BUG)

### Root causes

**1. useAutoScroll — `[...dependencies]` spread (REAL BUG)**
```ts
useEffect(() => { ... }, [...dependencies]);
```
Spreading in dep array is not valid React — oxlint correctly flags this. The hook takes `dependencies: unknown[]` and spreads into the effect dep. React ignores array identity changes so this won't work as expected. The effect will fire every render.

**2. SharedChatPanel — object method deps pattern**
`history` comes from `useChatHistory(...)` — returns plain object (not useMemo-wrapped). Each render creates a new object reference, so `history` itself is unstable. Pattern like `[history.setMessages]` was used to reference the stable state setter, but violates exhaustive-deps rule because `history` isn't in the dep array.

Current pattern (broken):
```ts
const history = useChatHistory({...}); // new object each render
const onMessagesAppend = useCallback((msgs) => {
  history.setMessages(prev => [...prev, ...msgs]);
}, [history.setMessages]); // oxlint: missing 'history'
```

Correct pattern: destructure stable values at call site OR extract to a hook that takes stable primitives.

**3. useChatHistory — `initialChatId` missing dep**
```ts
useEffect(() => {
  if (initialChatId) setCurrentChatId(initialChatId);
  ...
}, [chatAdapter]); // missing: initialChatId
```
If `initialChatId` changes after mount, the effect won't re-run. This is likely a real bug.

## Scope

### 1. Fix useAutoScroll (unit test first)

Write unit test in `client/hooks/chat/useAutoScroll.test.ts` that:
- Verifies the effect fires when dep values change
- Verifies it does NOT fire spuriously on every render

Then fix: replace spread pattern with proper dep tracking. The correct approach:
```ts
// Accept explicit deps array and use it directly — but React needs static deps
// Better: let callers pass a stable callback instead of deps
export function useAutoScroll(
  scrollCallback: () => void,
  trigger: unknown  // stable trigger value, not a spread
)
```
Evaluate the actual usage in `SharedChatPanel.tsx` to find the right fix.

### 2. Fix useChatHistory — initialChatId dep

Write unit test that verifies `setCurrentChatId` is called when `initialChatId` changes post-mount.
Fix: add `initialChatId` to dep array, or if truly mount-only, add `// eslint-disable-next-line react-hooks/exhaustive-deps` with explanation comment.

### 3. Stabilize history/stream/input in SharedChatPanel

**Architectural fix**: wrap `useChatHistory`, `useChatStream`, `useChatInput` return values with `useMemo` inside their respective hooks so the returned objects are stable. This is the cleanest fix.

OR: extract each useCallback/useEffect in SharedChatPanel that references history/stream/input into dedicated custom hooks that take destructured stable values:

```ts
// NEW: client/hooks/chat/useMessagesAppend.ts
export function useMessagesAppend(
  setMessages: Dispatch<SetStateAction<DisplayMessage[]>>
) {
  return useCallback((newMessages: DisplayMessage[]) => {
    setMessages(prev => [...prev, ...newMessages]);
  }, [setMessages]);
}
```

Each extracted hook:
- `useMessagesAppend(setMessages)` — from SharedChatPanel:86
- `useStreamingSync(setIsStreaming, isStreaming)` — from SharedChatPanel:107
- `useSendMessages(currentChatId, createNewChat, setIsStreaming, sendMessage, onMessagesAppend, forceNewChat)` — from SharedChatPanel:116-159
- `useHandleStop(stopStreaming, restoreQueueToInput)` — from SharedChatPanel:179-183
- `useInitialPromptEffect(...)` — from SharedChatPanel:194-201

### 4. Unit tests for each extracted hook

Each new hook in `client/hooks/chat/` gets a `*.test.ts` file:
- Test with React Testing Library's `renderHook`
- Test stable references (useCallback result doesn't change between renders)
- Test correct behavior

### 5. E2E test (if existing chat e2e exists)

Check `tests/` for existing chat e2e tests. If they exist, run them after the change to confirm no regression. Do NOT write new e2e tests from scratch — only verify existing ones pass.

## Hard Rules

- Work in a NEW worktree. Create: `hooks-chat-refactor`.
- TDD: write failing unit test FIRST, then implement the fix, then verify GREEN.
- Do NOT change behavior — only stabilize deps.  
- Do NOT use `// eslint-disable-next-line` as a fix unless the suppression has a clear comment explaining WHY (e.g., "initialChatId is intentionally mount-only because...").
- Read `ext-test-projects/CLAUDE.md` before any E2E work.
- Keep the architecture: `useChatHistory`, `useChatStream`, `useChatInput` remain as is — only stabilize their outputs.
- Commit after each hook extraction with test GREEN.
