# oxlint warnings cleanup: resolve 103 warnings to 0

## Context

`bun run lint` currently reports **103 warnings and 0 errors**. The warnings are known but clutter output and hide real issues. Categories:

- 43× `typescript/consistent-type-imports` — `import()` type annotations
- 19× `no-unsafe-optional-chaining`
- 6× `eslint/no-unused-vars` — catch `_error` params
- 3× `eslint/prefer-template` — string concatenation
- 3× `typescript/no-explicit-any`
- 3× `react-hooks/exhaustive-deps` — ref.current in cleanup
- 2× `no-control-regex`
- 2× `eslint/no-useless-expression`
- 1× `eslint/prefer-const`
- 1× `unicorn/no-useless-fallback-in-spread`
- 1× `eslint/no-unassigned-vars`
- 1× `react-hooks/rules-of-hooks` — complex expression in deps array
- Various others

## Scope

Reduce warnings from 103 to as close to 0 as possible. Fix root causes, do not disable rules globally.

## Hard Rules

- Do NOT disable rules in `.oxlintrc.json` to make warnings disappear. Fix the code.
- Do NOT use `// eslint-disable-next-line` as a blanket solution. Use only where:
  - The warning is a false positive from oxlint's conservative analysis
  - The alternative fix would harm readability or performance
  - Document the justification in the comment.
- For `consistent-type-imports`: replace `import('module').Type` with explicit `import type { Type } from 'module'` at top level.
- For `no-unsafe-optional-chaining`: add explicit null checks.
- For `no-unused-vars` catch params: prefix with `_` (oxlint allows `_error` but warns on `_error`? Actually oxlint warns on `_error` if it's "caught but never used". Wait — the warning says "Catch parameter '_error' is caught but never used." The rule is `no-unused-vars`. In oxlint, prefixing with `_` should suppress it... but it doesn't? Actually oxlint's no-unused-vars typically ignores `_` prefixed vars. But here it warns on `_error`. Let me check the rule config. Maybe it should be configured to ignore `_`-prefixed catch params. Actually — looking at the warning: "! eslint(no-unused-vars): Catch parameter '_error' is caught but never used." — the `!` means warning. The rule is enabled but `_error` is not being ignored. The fix is either: a) configure oxlint to ignore `_`-prefixed catch params, or b) rename to just `_` or c) use the error in the catch block.

Actually, the best fix for `catch (_error)` is to either:
- Rename to `catch` (no binding) if Bun/Node supports it
- Or use `catch (_)` 
- Or actually log/use the error

Since Bun supports `catch { ... }` without binding, we can use that.

### Task 1: Fix `consistent-type-imports` (43 warnings)

- [ ] Identify all `import()` type annotations in:
  - `vscode-extension/hypercanvas-preview/src/` (~30 warnings)
  - `client/lib/platform/types.ts`
  - `lib/services/tree-adapter.test.ts`
  - `server/routes/parseComponent.ts`
  - `server/services/k8s-manager.ts`
- [ ] Replace each with explicit top-level `import type { ... } from '...'`
- [ ] Run `bun run lint` — count should drop by ~43.

### Task 2: Fix `no-unsafe-optional-chaining` (19 warnings)

- [ ] Find all locations with `grep -rn "\?\." client/ lib/ server/ shared/ vscode-extension/ | grep -v node_modules | grep -v ".test."`
- [ ] Add explicit null checks or use `&&` short-circuit instead of `?.` where oxlint flags it as unsafe
- [ ] Run `bun run lint` — count should drop.

### Task 3: Fix `no-unused-vars` catch params (6 warnings)

- [ ] Find all `catch (_error)` and `catch (_parseError)` etc.
- [ ] Replace with bare `catch` (no binding) where the error is not used — Bun supports this.
- [ ] If error IS used in the block but not directly (e.g. logged), rename to `catch (error)` and use it.
- [ ] Run `bun run lint` — count should drop.

### Task 4: Fix `prefer-template` (3 warnings)

- [ ] Find string concatenations with `+` operator
- [ ] Convert to template literals where it improves readability
- [ ] Run `bun run lint`.

### Task 5: Fix `no-explicit-any` (3 warnings)

- [ ] Find `any` types and replace with `unknown` or specific types
- [ ] Run `bun run lint`.

### Task 6: Fix `react-hooks/exhaustive-deps` (3 warnings)

- [ ] `useCanvasInteraction.ts` — ref.current in cleanup. Copy ref value to local variable inside effect.
- [ ] Other locations — similar pattern.
- [ ] Run `bun run lint`.

### Task 7: Fix remaining misc warnings

- [ ] `no-control-regex` — replace regex with safe alternative or add justification comment
- [ ] `no-useless-expression` — remove or fix
- [ ] `no-unassigned-vars` — vector-cli stdinData
- [ ] `unicorn/no-useless-fallback-in-spread` — `(extra ?? {})`
- [ ] `react-hooks/rules-of-hooks` — complex deps expression
- [ ] `prefer-const` — any remaining
- [ ] Run `bun run lint` — should be close to 0 warnings.

### Task 8: Verify no regressions

- [ ] `bun run lint` — 0 errors, warnings count
- [ ] `tsgo --noEmit` — 0 errors
- [ ] `bun run test` — no new failures
- [ ] Commit and push

Acceptance: `bun run lint` shows ≤10 warnings (ideally 0), all remaining warnings have explicit justification comments.
