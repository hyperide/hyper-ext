# React hooks: chat panel — extract custom hooks with TDD

## Context

oxlint found 15 hook issues in chat components. Two root causes:

**1. useAutoScroll — `[...dependencies]` spread in dep array (REAL BUG)**
`client/hooks/chat/useAutoScroll.ts:17`: `useEffect(() => { ... }, [...dependencies])` — spreading an array into deps is invalid React. Each render creates a new array, the effect fires every render regardless of whether the values changed.

**2. SharedChatPanel — object method deps pattern**
`client/components/chat/SharedChatPanel.tsx`: `history`/`stream`/`input` are plain objects returned from hooks (not useMemo-wrapped), so they're unstable. Pattern like `[history.setMessages]` tries to reference a stable state setter but violates exhaustive-deps.
Fix: extract each callback into a custom hook that takes the stable primitive (the setter itself, destructured).

**3. useChatHistory — missing initialChatId dep**
`client/hooks/chat/useChatHistory.ts:49`: effect uses `initialChatId` but dep array only has `[chatAdapter]`.

Architecture: `history = useChatHistory(...)`, `stream = useChatStream(...)`, `input = useChatInput(...)` — each returns a plain object. These stay as-is. We extract the callbacks FROM SharedChatPanel into new custom hooks that take stable destructured values.

## Hard Rules

- TDD: write failing unit test FIRST, then fix, then verify GREEN.
- Do NOT change the interface of useChatHistory, useChatStream, useChatInput.
- Do NOT use `// eslint-disable-next-line` as a fix unless it's a genuine intentional mount-only effect with explanation.
- Use `bun test <specific-file>` to verify, not full suite.
- Work in the ralphex-created worktree.

### Task 1: Read the affected files

- [x] Read `client/hooks/chat/useAutoScroll.ts` — full file
- [x] Read `client/hooks/chat/useChatHistory.ts` — full file (focus on lines 35–50 and return value)
- [x] Read `client/components/chat/SharedChatPanel.tsx` — full file
- [x] Check if `client/hooks/chat/useAutoScroll.test.ts` exists (does NOT exist)
- [x] Check if `client/hooks/chat/useChatHistory.test.ts` exists (does NOT exist)

Acceptance: understand what `dependencies` is in useAutoScroll, what the return shape of useChatHistory is, and the full callback pattern in SharedChatPanel.

### Task 2: Fix useAutoScroll — write test first

- [x] Create `client/hooks/chat/useAutoScroll.test.ts` (if not exists)
- [x] Write test: render a component using useAutoScroll, verify effect does NOT fire on every render when trigger value hasn't changed
- [x] Run `bun test client/hooks/chat/useAutoScroll.test.ts` — confirm RED (old single-array signature throws on positional-arg calls; 6 fail)
- [x] Read how useAutoScroll is called in SharedChatPanel — `[history.messages, stream.currentAssistantMessage, stream.currentToolCalls]`
- [x] Fix useAutoScroll: changed signature to three positional `unknown` triggers; effect deps now a literal `[triggerA, triggerB, triggerC]` (statically analyzable), with a biome-ignore explaining the sentinel-dep pattern (effect body intentionally doesn't read the triggers)
- [x] Run `bun test client/hooks/chat/useAutoScroll.test.ts` — GREEN (6 pass)
- [x] Verify SharedChatPanel call site still compiles (tsc + biome clean)

Acceptance: test GREEN, effect does not fire spuriously.

### Task 3: Fix useChatHistory — initialChatId dep

- [x] Write test in `client/hooks/chat/useChatHistory.test.ts` — 3 cases: mount with id, null→id, id→id
- [x] Run test — GREEN immediately (no RED phase): existing "Sync initialChatId prop changes" effect (lines 79–83) already propagates prop changes; the missing dep on the mount-only chat-list effect is intentional, not a bug
- [x] Read line 39 comment: "Don't auto-select first chat — start with 'New Chat' (null)" — confirms mount-effect should NOT reload the chat list when initialChatId changes (that would re-call listChats unnecessarily)
- [x] Decision: chat-list effect stays mount-only (re-running `listChats` per prop change is wrong); the dedicated sync effect at lines 79–83 carries the responsibility of propagating later `initialChatId` changes
- [x] Apply fix: replaced the misleading biome-ignore comment ("mount-only, chatAdapter is stable") with a 3-line block explaining WHY `initialChatId` is excluded and pointing to the sync effect that handles later changes
- [x] Run test — GREEN (3 pass, biome + oxlint clean)

Acceptance: test GREEN, decision documented.

### Task 4: Extract useMessagesAppend from SharedChatPanel

SharedChatPanel lines 83–87: `onMessagesAppend` callback uses `history.setMessages`.

- [x] Create `client/hooks/chat/useMessagesAppend.ts`
- [x] Create `client/hooks/chat/useMessagesAppend.test.ts` with test: verify callback appends messages to previous state
- [x] Run test — RED (module not found)
- [x] Implement: `export function useMessagesAppend(setMessages: Dispatch<SetStateAction<DisplayMessage[]>>) { return useCallback((msgs) => setMessages(prev => [...prev, ...msgs]), [setMessages]); }`
- [x] Run test — GREEN (4 pass: append, multi-call functional form, stable ref, empty-array no-op)
- [x] Replace inline callback in SharedChatPanel:82–87 with `useMessagesAppend(history.setMessages)`; export added to `client/hooks/chat/index.ts`; unused `DisplayMessage` import removed from SharedChatPanel; tsc, biome, oxlint clean; full chat hooks suite GREEN (13 pass)

Acceptance: test GREEN, SharedChatPanel compiles.

### Task 5: Extract useHandleStop from SharedChatPanel

SharedChatPanel lines 179–183: uses `stream.stopStreaming` and `input.restoreQueueToInput`.

- [x] Create `client/hooks/chat/useHandleStop.ts`
- [x] Create `client/hooks/chat/useHandleStop.test.ts`: 4 cases — ordering (stop→restore), stable ref across re-renders, ref changes when stopStreaming identity changes, no-throw on no-op fns
- [x] Run test — RED (`Cannot find module './useHandleStop'`)
- [x] Implement: `useCallback(() => { stopStreaming(); restoreQueueToInput(); }, [stopStreaming, restoreQueueToInput])` — both inputs are stable `useCallback`s from useChatStream/useChatInput
- [x] Run test — GREEN (4 pass)
- [x] Replace inline callback in SharedChatPanel:174–177 with `useHandleStop(stream.stopStreaming, input.restoreQueueToInput)`; export added to `client/hooks/chat/index.ts`; biome + oxlint clean; full chat hooks suite GREEN (17 pass across 4 files)

Acceptance: test GREEN, SharedChatPanel compiles.

### Task 6: Fix remaining SharedChatPanel deps

For remaining exhaustive-deps warnings in SharedChatPanel (lines 107, 152, 201, 217, 229):

- [x] For each warning: read the code, understand if it's a real bug or stable-ref pattern (oxlint --react-plugin reported 8 sub-warnings across 5 sites — all rooted in member access on the unstable `history`/`stream`/`input` objects forcing the parent into deps)
- [x] Line 107 (`history.setIsStreaming`): destructured `setIsStreaming` from `useChatHistory`; effect deps now `[isStreaming, setIsStreaming]` — both stable primitives
- [x] Line 152 (sendMessages callback): destructured `currentChatId, createNewChat, setIsStreaming` from history and `sendMessage` from stream; useCallback deps now reference local bindings only
- [x] Line 201 (initialPrompt effect): replaced `biome-ignore` with full deps list `[initialPrompt, isLoadingChats, isStreamingRef, resetScrollFlag, handleSendMessages, onPromptSent]`; `initialPromptSentRef` guards against re-firing on stable-dep churn
- [x] Line 217 (`input.resetInputState`): destructured `resetInputState` from `useChatInput`; kept `biome-ignore` with clearer wording because biome (not oxlint) now flags `currentChatId` as a sentinel-only dep
- [x] Line 229 (`history` missing): destructured `messages, chats, updateChatTitle` from history; effect body uses bare locals; deps are stable refs and reactive primitives
- [x] Approach: destructure all stable callbacks/setters AND reactive values from `history`, `stream`, `input` once at the top of the component so the rest of the component (effects, callbacks, JSX) references locals; no `history.X` / `stream.X` / `input.X` access remains in the function body. No new re-render loops: deps are either stable useCallback refs, useRef objects, useState setters, or reactive primitives the effect *should* respond to.

Acceptance: `bunx oxlint --react-plugin client/components/chat/SharedChatPanel.tsx` reports 0 warnings (verified). Biome check clean. tsc shows no chat-related errors. All 17 chat hook unit tests pass.

### Task 7: Run full unit test suite for chat hooks

- [ ] `bun test client/hooks/chat/ client/components/chat/`
- [ ] All tests GREEN

Acceptance: 0 failures in chat hook/component tests.

### Task 8: Commit

- [ ] `git add client/hooks/chat/ client/components/chat/SharedChatPanel.tsx`
- [ ] `git diff --cached --stat`
- [ ] `git commit -m "refactor(chat): extract custom hooks from SharedChatPanel, fix exhaustive-deps"`

Acceptance: clean commit.
