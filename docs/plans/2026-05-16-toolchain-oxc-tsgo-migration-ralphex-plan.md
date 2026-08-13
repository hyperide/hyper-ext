# Toolchain migration: biome→oxlint+oxfmt, tsc→tsgo

## Context

Research in `oxc-research` worktree (branch `oxc-research`) showed:

- **tsgo 7.0-dev** is 6× faster than tsc 5.9.3 (warm: 8.1s → 1.3s)
- **oxlint** scans 850 files in 25ms vs biome's lint speed
- **oxfmt** is 3× faster than biome formatter, 100% Prettier-compatible (beta Feb 2026)
- tsgo found a real bug that tsc 5.9.3 missed: `server/main.ts:393` — `SharedArrayBuffer` not assignable to `ArrayBuffer` in ws.send()

One breaking change: `tsconfig.json` must drop `"baseUrl": "."` (removed in TS7).
Confirmed already fixed in worktree: paths without baseUrl work correctly.

`biome-ignore` comments need to be converted to `// eslint-disable-next-line` format for oxlint.
Count: 6 intentional suppressions with `biome-ignore.*exhaustive-deps`.

## Scope

### 1. package.json — replace biome with oxlint + oxfmt, add tsgo

- Remove `@biomejs/biome` from devDependencies
- Add `oxlint`, `oxfmt`, `@typescript/native-preview` to devDependencies
- Update scripts:
  - `lint`: replace `biome check` → `oxlint ./client/ ./lib/ ./server/ ./shared/ ...`
  - `lint:fix`: replace `biome check --write` → `oxfmt --write ./client/ ./lib/ ...`
  - `typecheck`: replace `tsc` → `tsgo`
  - Keep `postinstall` as-is

### 2. tsconfig.json — remove baseUrl

Remove `"baseUrl": "."` line (confirmed safe — paths resolve without it in tsgo).

### 3. .oxlintrc.json — create config matching current biome.jsonc rules

Map all active biome lint rules to oxlint equivalents. Use this as the base:

```json
{
  "plugins": ["react", "react-hooks", "typescript", "import", "unicorn"],
  "rules": {
    "no-unused-vars": "warn",
    "no-var": "error",
    "prefer-const": "error",
    "prefer-template": "error",
    "typescript/no-explicit-any": "warn",
    "typescript/consistent-type-imports": "error",
    "unicorn/prefer-node-protocol": "error",
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

### 4. .oxfmtrc.jsonc — create formatter config matching biome.jsonc

```json
{
  "printWidth": 120,
  "tabWidth": 2,
  "useTabs": false,
  "singleQuote": true,
  "trailingComma": "all"
}
```

### 5. lefthook.yml — update pre-commit hooks

Replace biome with oxlint + oxfmt. Replace tsc with tsgo:

```yaml
pre-commit:
  parallel: true
  commands:
    lint:
      glob: '*.{ts,tsx,js,jsx,json,css}'
      run: npx oxlint --config .oxlintrc.json {staged_files}
      stage_fixed: true
    format:
      glob: '*.{ts,tsx,js,jsx,json,css}'
      run: npx oxfmt --write {staged_files}
      stage_fixed: true
    typecheck:
      glob: '*.{ts,tsx}'
      run: npx tsgo --noEmit && npx tsgo --noEmit -p vscode-extension/hypercanvas-preview/tsconfig.json
    react-hooks-import:
      glob: '*.{tsx,ts}'
      run: node scripts/check-react-hooks-import.cjs {staged_files}
```

### 6. .github/workflows/ci.yml — update CI

Replace `bun lint` step internals (scripts already updated in step 1).
Remove the tsc incremental cache step (tsgo is fast enough it doesn't need it).

### 7. Convert biome-ignore comments to oxlint-disable

Find all `// biome-ignore lint/...` comments and convert to `// eslint-disable-next-line` format:

- `biome-ignore lint/suspicious/noExplicitAny` → `eslint-disable-next-line @typescript-eslint/no-explicit-any`
- `biome-ignore lint/suspicious/noControlCharactersInRegex` → `eslint-disable-next-line no-control-regex`

Run grep to find all instances before converting.

### 8. Fix the tsgo type error

`server/main.ts:393`: `binaryMsg.buffer.slice(...)` returns `ArrayBuffer | SharedArrayBuffer`.
Cast to `ArrayBuffer`: `data.backendWs.send(arrayBuffer as ArrayBuffer)` or fix properly by ensuring slice always returns `ArrayBuffer`.

## Hard Rules

- Do NOT run `bun install` for the full project in the worktree (too slow). Install only new packages.
- Do NOT touch vscode-extension tsconfig files unless they also need baseUrl removed.
- Run `tsgo --noEmit` and `oxlint` after each step to verify no regressions.
- Do not touch any business logic. This is pure toolchain swap.
- Work in the existing `oxc-research` worktree at `../hyperide-worktrees/oxc-research`.
- Commit each step separately with clear commit messages.
