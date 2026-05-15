<!-- markdownlint-disable MD013 -->

# Commit Split Instructions for Codex

The current uncommitted diff (~2557 lines, 43 files) needs to be split into
atomic commits. Each commit should pass lint, typecheck, and tests independently.

**Read `CODEX.md` first** — it has the pre-commit checklist and self-review rules.

## MANDATORY: Fix Two Concerns BEFORE Committing

These must be addressed in the relevant commits. Do not commit the code as-is.

### Concern 1: Deduplicate `executeSharedStyleWrite` (Commit 6)

`_executeSharedStyleWrite` in `AstService.ts` and `executeSharedStyleWrite` in
`server/routes/updateComponentStyles.ts` are ~80% identical. The spec (Phase 6)
explicitly says: "Remove duplicated Tailwind mutation code from platform endpoints."

**What to do:**

Extract the shared logic into `lib/style-write/style-write-executor.ts`:

```typescript
export class StyleWriteExecutor {
  constructor(private deps: {
    fileIO: FileIO;
    projectRoot: string;
  }) {}

  async execute(plan: StyleWritePlan): Promise<StyleWriteResult> {
    // The shared mutation logic from both executeSharedStyleWrite functions
  }
}
```

Then both platform endpoints become thin wrappers:

```typescript
// AstService.ts
const executor = new StyleWriteExecutor({ fileIO: this._fileIO, projectRoot: this._workspaceRoot });
const result = await executor.execute(plan);
this._updateNodeMap(result);  // VS Code-specific post-mutation

// updateComponentStyles.ts
const executor = new StyleWriteExecutor({ fileIO: new NodeFileIO(), projectRoot });
const result = await executor.execute(plan);
afterMutation(result);  // SaaS-specific post-mutation
trackEditFromContext(result);
```

Add tests for the shared executor in `lib/style-write/style-write-executor.test.ts`.

### Concern 2: Delete old Tailwind-only mutation path (Commit 5 or 6)

The old code routes all writes through `generateTailwindClasses()` → className
append. This is the bug. Delete it. Replace with `StyleWritePlanner.selectTarget()`.

Default source tab is Computed. Planner selects adapter by element facts —
that's normal routing, not a fallback.

**What to do:**

In both `AstService.ts` and `updateComponentStyles.ts`, delete the old path and
replace with planner-based routing:

```typescript
const planner = new DefaultStyleWritePlanner([
  tailwindV4Adapter,
  cssModulesAdapter,
  inlineStyleAdapter,
]);
const { adapter, writer, sourceOwner } = planner.selectTarget(writeContext);
const plan = writer.createPlan({ context: writeContext, sourceOwner });
const executor = new StyleWriteExecutor({ fileIO, projectRoot });
return executor.execute(plan);
```

Construct `ElementStyleFacts` from what's available at the call site:

```typescript
const elementFacts: ElementStyleFacts = {
  elementCssSystems: detectedSystems,  // from existing detection logic
  elementUiKits: [],
  elementPropMappers: [],
  sourceOwners: existingOwners,  // from existing owner lookup
};
```

**Every write goes through the planner.** No conditional "if routable then
planner else old code." The old code is deleted.

---

## Commit Order (dependencies flow top-to-bottom)

### Commit 1: `feat(style-read): implement adapter readers with SourceClassIdentity`

Files:

- `lib/style-read/types.ts` (new types: FrameworkReadResult, SourceClassIdentity, StyleReadResult, etc.)
- `lib/style-write/types.ts` (FrameworkStyleReader signature change)
- `lib/style-adapters/tailwind-v4/reader.ts` (from stub to real impl)
- `lib/style-adapters/tailwind-v4/index.test.ts` (updated tests)
- `lib/style-adapters/css-modules/reader.ts` (from stub to real impl)
- `lib/style-adapters/css-modules/index.test.ts` (updated tests)
- `lib/style-adapters/inline-style/reader.ts` (from stub to real impl)
- `lib/style-adapters/inline-style/index.test.ts` (updated tests)

### Commit 2: `refactor(ast): extract CSS module reference utilities from inline-style-mutator`

Files:

- `lib/ast/inline-style-mutator.ts` (moved helpers out)
- New: `lib/ast/css-module-references.ts` (extracted helpers)
- `lib/ast/css-module-references.test.ts` (if tests exist)

### Commit 3: `feat(tailwind): add fontSize support to generator and parser`

Files:

- `lib/tailwind/generator.ts` (toTextSizeClass, buildTailwindColorMap)
- `lib/tailwind/generator.test.ts` (fontSize tests)
- `lib/tailwind/parser.ts` (fontSize mapping, conflict removal)
- `lib/tailwind/parser.test.ts` (fontSize parse tests)
- `client/lib/canvas-engine/utils/tailwindParser.ts` (text-* disambiguation)
- `client/components/RightSidebar/sections/FillSection.tsx` (fontSize input)

### Commit 4: `feat(ext): add StyleReadService with source tabs pipeline`

Files:

- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`
- `vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts`
- `vscode-extension/hypercanvas-preview/src/bridges/AstBridge.ts` (styles:read message)
- `vscode-extension/hypercanvas-preview/src/__tests__/AstBridge.test.ts`
- `vscode-extension/hypercanvas-preview/src/types.ts` (StyleReadResult type)

### Commit 5: `feat: wire selectedSourceTabId through client write pipeline`

Files:

- `client/components/RightSidebar/RightSidebar.tsx` (source tabs state + UI)
- `client/components/RightSidebar/hooks/useStyleSync.ts` (pass selectedSourceTabId)
- `client/components/RightSidebar/sections/index.ts` (export)
- `client/lib/canvas-engine/adapters/TailwindAdapter.ts`
- `client/lib/canvas-engine/adapters/types.ts`
- `client/lib/canvas-engine/core/CanvasEngine.ts`
- `client/lib/canvas-engine/operations/ASTStyleOperation.ts`
- `client/lib/canvas-engine/services/ASTApiService.ts`
- `client/lib/canvas-engine/__tests__/CanvasEngineAST.test.ts`
- `client/lib/platform/PlatformContext.tsx`
- `client/lib/platform/hooks/useElementStyleData.ts`
- `client/lib/platform/types.ts`

### Commit 6: `feat(style-write): add StyleWriteExecutor and wire shared write path`

**This commit addresses both concerns.**

Files:

- NEW: `lib/style-write/style-write-executor.ts` (extracted shared logic)
- NEW: `lib/style-write/style-write-executor.test.ts`
- `vscode-extension/hypercanvas-preview/src/services/AstService.ts` (thin wrapper)
- `server/routes/updateComponentStyles.ts` (thin wrapper)

Changes:

1. Extract shared mutation logic into `StyleWriteExecutor`
2. Both platform endpoints delegate to shared executor
3. Replace legacy Tailwind fallback with planner-based routing
   (or at minimum: inline fallback instead of Tailwind default)

### Commit 7: `fix(element-tracing): improve React 19 map item fiber resolution`

Files:

- `shared/element-tracing/fiber-internals.ts`
- `client/lib/element-tracing/fiber-utils.test.ts`
- `client/lib/element-tracing/react-adapter.test.ts`

### Commit 8: `fix(ext): panel readiness gating for prompt delivery`

Files:

- `vscode-extension/hypercanvas-preview/src/AIChatPanelProvider.ts`
- `vscode-extension/hypercanvas-preview/src/RightPanelProvider.ts`
- `vscode-extension/hypercanvas-preview/src/extension.ts` (MCP constructor)
- `vscode-extension/hypercanvas-preview/src/webview-ai-chat/AIChatApp.tsx`
- `vscode-extension/hypercanvas-preview/package-lock.json`

## Review Checklist (per commit)

Before each `git commit` (see `CODEX.md` for details):

1. `git diff --staged` — self-review the diff
2. `biome check <changed-files>` — no lint issues
3. `npx tsc --noEmit` — no type errors
4. `bun run test` — 0 failures
5. `bunx knip --include exports,files` — no new unused exports
6. Check: no `any`, `import type` for types, file headers present
7. Check: no commented-out code, no debug console.log

## Notes

- Commits 1-2 are pure lib/ changes — safe foundation
- Commit 3 is feature work (fontSize) — can be reordered after 4-5 if needed
- Commits 4-5 wire the read+write pipeline end-to-end
- **Commit 6 is the most important** — fixes both review concerns
- Commits 7-8 are independent fixes, can be committed in any order
- If concern fixes in commit 6 are too complex to do atomically, split into:
  - 6a: extract StyleWriteExecutor (pure refactor)
  - 6b: replace legacy Tailwind fallback with planner routing
