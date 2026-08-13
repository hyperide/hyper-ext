# TypeScript strict mode migration

## Context

Currently `tsconfig.json` has:

```json
"strict": false,
"noUnusedLocals": false,
"noUnusedParameters": false,
"noImplicitAny": false,
"noFallthroughCasesInSwitch": false,
"strictNullChecks": false
```

Running `tsc --noEmit --strict --noImplicitAny --strictNullChecks` produces **159 errors**.

Top error categories (from audit):

- 24× `server/routes/docker.ts` — `string | undefined` not assignable to `string` (route params)
- 13× `server/routes/ide.ts` — same pattern
- 9× `server/routes/projects.ts` — same
- 9× `client/pages/Editor/components/hooks/useOverlayMapCondHighlightComponents.ts` — `condItem` possibly undefined
- 5× `server/services/component-analyzer.ts` — implicit any in Babel traverse callbacks
- 4× `server/middleware/workspace.test.ts` + `projectRole.test.ts` — test mock type mismatch
- 4× `client/pages/Editor/components/hooks/useCanvasComments.ts` — scroll possibly null
- 3× `server/services/ai-agent.ts` — currentToolUse possibly null
- 3× `server/routes/ide.ts` — no overload matches
- 3×2 `client/components/annotations/AnnotationsLayer.tsx` — pos.width/height possibly undefined

## Scope

Enable strict mode in `tsconfig.json` and fix all 159 errors.

### Phase 1: Enable strict in tsconfig (worktree branch)

Change tsconfig.json:

```json
"strict": true,
"noImplicitAny": true,
"strictNullChecks": true
```

Keep `noUnusedLocals: false`, `noUnusedParameters: false` (too noisy, tracked by oxlint).

### Phase 2: Fix server route errors (string | undefined)

Pattern: route handlers use `c.req.param('id')` which returns `string | undefined` in Hono.
Fix approach: assert non-null with `!` where the route guarantees presence, or use proper Hono typing.

Example pattern:

```ts
// Before
const id = c.req.param("projectId"); // string | undefined
doSomething(id); // error
// After
const id = c.req.param("projectId")!; // or validate at middleware level
```

File list:

- `server/routes/docker.ts`
- `server/routes/ide.ts`
- `server/routes/projects.ts`
- `server/routes/pasteElement.ts`
- `server/routes/github.ts`
- `server/routes/editCondition.ts`
- `server/routes/detectPublicDir.ts`

### Phase 3: Fix server services

- `server/services/component-analyzer.ts` — Babel traverse path callback params: add explicit type annotations
- `server/services/ai-agent.ts` — null guard for currentToolUse
- `server/services/docker-manager.ts` — string | null → string | undefined conversions
- `server/services/write-default-props.ts` — Babel traverse path params

### Phase 4: Fix client hooks

- `client/pages/Editor/components/hooks/useOverlayMapCondHighlightComponents.ts` — guard on `condItem`
- `client/pages/Editor/components/hooks/useCanvasComments.ts` — null guard for `scroll`
- `client/components/annotations/AnnotationsLayer.tsx` — guard on `pos.width`/`pos.height`

### Phase 5: Fix test mocks

- `server/middleware/workspace.test.ts` — cast test mocks properly
- `server/middleware/projectRole.test.ts` — cast test mocks properly

### Phase 6: Fix @babel/generator missing types

Install `@types/babel__generator` and `@types/babel__traverse` or add local declarations.

## Hard Rules

- Work in a NEW worktree, NOT `oxc-research`. Create: `ts-strict-migration`.
- TDD: for each fix in client hooks, check if there's an existing unit test. If not, add one that proves the null/undefined case is handled.
- Do NOT use `as any` as a fix. Use proper null guards, type narrowing, or `as SpecificType`.
- Do NOT change behavior of route handlers — only add type safety.
- Run `tsc --noEmit --strict` after each file group to verify error count decreases.
- Commit each phase separately.
- Do not touch files outside the error list.
- Use `tsgo --noEmit` from the `oxc-research` worktree's node_modules for final validation.
