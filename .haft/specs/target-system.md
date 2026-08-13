# Target System Spec

## TS.ENV.001 Environment change: visual canvas edits produce source file diffs without text editor

```yaml spec-section
id: TS.ENV.001
spec: target-system
kind: target.environment
title: Visual canvas interaction produces git-tracked source file diff without text editor
statement_type: explanation
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: []
supersedes: [TS.placeholder.001]
terms: [CanvasInteraction, SourceFileDiff, ASTTransformation]
target_refs: []
evidence_required:
  - kind: E2E
    description: E2E test confirms file content updated after canvas interaction (e.g. style change, i18n edit, element reorder)
  - kind: manual
    description: git status shows modified file after canvas interaction in a real project
```

A developer working on a React codebase interacts with a live canvas preview (click element, change style/text/order). The HyperCanvas extension performs an AST transformation on the source file. The observable that flips: `git status` shows a modified file before the developer opens a text editor. The round-trip that was previously "find file → edit text → save → wait for HMR" collapses to a single canvas interaction.

## TS.ROLE.001 Role of the target system in producing the environment change

```yaml spec-section
id: TS.ROLE.001
spec: target-system
kind: target.role
title: HyperCanvas is the AST-transformer of React source files on developer command from canvas UI
statement_type: explanation
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [TS.ENV.001]
supersedes: []
terms: [HyperCanvas, ASTTransformation, CanvasInteraction]
target_refs: [TS.ENV.001]
evidence_required:
  - kind: E2E
    description: E2E test confirms extension writes file after canvas interaction (not just preview update)
```

**Role (assigned)**: AST-transformer of React source files on developer command from canvas UI.

**Capability (what it can do)**: read and write TypeScript/JSX AST; start and proxy a Vite/webpack dev server; render a live component preview in an iframe; identify DOM elements via React Fiber traversal; read and write i18n locale files; reorder JSX children; apply Tailwind/CSS Modules/inline style changes.

**Method (how it does it)**: developer selects element in canvas → extension matches DOM node to AST node via Fiber → generates syntax-preserving transformation → writes source file → HMR propagates change to preview iframe.

**Work (what it did)**: the specific file write produced by a specific canvas interaction — e.g. `className="text-red-500"` replaced in `src/components/Hero.tsx` at 10:42:03.

## TS.BOUNDARY.001 Scope and explicit out-of-scope for HyperCanvas

```yaml spec-section
id: TS.BOUNDARY.001
spec: target-system
kind: target.boundary
title: HyperCanvas scope — React/Remix components with supported CSS; logic editing and non-React frameworks out of scope
statement_type: explanation
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [TS.ROLE.001]
supersedes: []
terms: [HyperCanvas, CanvasInteraction, ASTTransformation]
target_refs: [TS.ENV.001, TS.ROLE.001, TS.DUTIES.001, TS.EVIDENCE.001]
evidence_required:
  - kind: E2E
    description: Non-JSX files remain unmodified after canvas interactions (verified by E2E file-content assertions)
  - kind: E2E
    description: Remix projects load and preview correctly in canvas (PI-B1-* tests)
```

**In scope:**
- Style editing on React and Remix components (Tailwind, CSS Modules, inline styles, CSS-in-JS)
- i18n text and key editing (JSON locale files, merged TypeScript translations)
- Drag/reorder, duplicate, wrap, delete JSX elements
- VS Code extension and SaaS surface (shared AST logic)
- Server-rendered frameworks with client JSX components — Remix is supported; React Server Components with JSX output are in scope

**Out of scope (current version):**
- Creating new components from scratch (planned — near-term roadmap)
- Editing component logic: event handlers, hooks, state, effects
- Non-React frameworks: Vue, Svelte, Angular, plain HTML
- Files outside the selected component's source tree (node_modules, generated files)

**4 boundary perspectives:**
1. **Defines (AST engine)**: boundary is set by what the AST parser can match to a DOM element via React Fiber — if no Fiber node maps to a JSX AST node with a supported style adapter, the element is outside scope
2. **Admitted**: React/Remix JSX/TSX components with at least one supported styling approach; server-rendered entry files are admitted when they contain client-side JSX
3. **Duties**: extension must not write to files outside the matched component; canvas interactions must not mutate logic (non-style, non-i18n, non-structural AST nodes)
4. **Evidence**: E2E suite PI-5-* (style write), PI-7-* (i18n write), PI-5-DR-* (reorder/delete), PI-B1-* (Remix/bulka) — all assert exact file content changes with no collateral mutations
