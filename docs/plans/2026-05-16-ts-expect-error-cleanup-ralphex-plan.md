# ts-expect-error cleanup: replace babel interop suppressions with safe types

## Context

There are 17 `@ts-expect-error` directives across the codebase. 15 of them are for babel ESM/CJS interop (`_traverse.default || _traverse`, `_generate.default || _generate`). 1 is for non-standard `allowtransparency` attribute. 1 is for Bun WebSocket headers extension.

The babel interop suppressions are brittle — if babel types ever change, tsgo/tsc will report "Unused '@ts-expect-error' directive" errors. They also hide real type issues.

## Scope

Remove ALL `@ts-expect-error` directives safely by replacing with proper types or runtime patterns that don't need suppression.

For babel interop: instead of `const generate = _generate.default || _generate` with @ts-expect-error, use a typed wrapper that handles both ESM and CJS shapes without suppression.

## Hard Rules

- Do NOT use `as any` or `as unknown` as replacement.
- Do NOT change runtime behavior — the interop must still work.
- Every removed @ts-expect-error must be accompanied by a type-safe replacement.
- Run `tsgo --noEmit` after each file group.
- If a particular @ts-expect-error genuinely cannot be removed safely, document WHY in a comment and skip it with explicit justification.

### Task 1: Audit all @ts-expect-error locations

- [ ] Run `grep -rn "@ts-expect-error" client/ lib/ server/ shared/ vscode-extension/ packages/ | grep -v node_modules | grep -v ".test."` and document each location with file, line, reason
- [ ] Categorize: babel interop, non-standard attr, Bun extension, other

### Task 2: Create babel-interop utility

- [ ] In `lib/ast/babel-interop.ts` (or similar shared location), create typed helpers:
  - `getBabelGenerator(): typeof import('@babel/generator').default`
  - `getBabelTraverse(): typeof import('@babel/traverse').default`
- [ ] These helpers should handle the `.default || module` pattern internally with a type guard, NOT with @ts-expect-error.
- [ ] The helper should be importable by all files that currently do the interop inline.

### Task 3: Replace babel interop suppressions

- [ ] Replace all inline `_generate.default || _generate` and `_traverse.default || _traverse` patterns with calls to the new helpers.
- [ ] Remove the associated `@ts-expect-error` directives.
- [ ] Files to update:
  - `lib/ast/traverser.ts`
  - `lib/ast/operations.ts`
  - `lib/ast/position-finder.ts`
  - `lib/ast/jsx-deps.ts`
  - `lib/ast/dynamic-classname-mutator.ts`
  - `lib/services/component-parser.ts`
  - `server/routes/pasteElement.ts`
  - `server/routes/wrapElement.ts`
  - `server/routes/editCondition.ts`
  - `server/routes/editMap.ts`
  - `server/routes/insertElement.ts`
  - `server/routes/copyElementTsx.ts`
  - `shared/i18n-text/detect-i18n-binding.ts`
  - `shared/i18n-text/ts-locale-ast.ts`
  - `lib/element-tracing/node-map-builder.ts`
- [ ] Run `tsgo --noEmit` — must be 0 errors.

### Task 4: Handle non-babel suppressions

- [ ] `client/components/IframeCanvas.tsx:1191` — `allowtransparency`. This is a non-standard React attribute. Options:
  a) Add it to a JSX interface augmentation in a .d.ts file
  b) Use `// @ts-ignore` with justification (if ts-expect-error is too strict)
  c) Cast the element props to `Record<string, unknown>`
  Choose the safest option and document why.
- [ ] `server/main.ts:261` — Bun WebSocket headers. Bun types may already include this. Check if `@types/bun` or `bun-types` covers it. If yes, remove suppression. If no, add to a `bun-extensions.d.ts`.
- [ ] Run `tsgo --noEmit` — must be 0 errors.

### Task 5: Verify no regressions

- [ ] Run `bun run lint` — 0 errors, warnings unchanged or reduced
- [ ] Run `bun run test` — same pass/fail count as before (no new failures)
- [ ] `git diff --stat` — review changes are minimal

### Task 6: Commit

- [ ] `git add -A && git commit -m "refactor: remove @ts-expect-error suppressions with typed babel interop helpers"`
- [ ] Push branch, create PR

Acceptance: zero @ts-expect-error in source (excluding tests), tsgo exits 0, no test regressions.
