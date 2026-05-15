# move-any-to-any works intermittently — must be deterministic

## User report (2026-05-06 14:30)

After move-any-to-any merge:
- Drag of `<span className="text-4xl" aria-hidden="true">🌀</span>` → works.
- Drag of "any element" → не для любых элементов, **иногда начинает работать**.

"Иногда работает" = race / non-determinism. Means there is a path that
sometimes catches the right node, sometimes doesn't.

E2E confirms this: in run-140935 the test
`cross-level drag reorders outer cards via server-side JSX lift` failed
TWICE (15233ms, 17855ms timeout). And
`drop on self-closing leaf places source as sibling (Task 6)` also failed
twice.

## Hypotheses

A. **`liftToCommonJsxParent` async race** — the AST is loaded lazily and
   sometimes the source/target lookup hits a stale snapshot.
B. **moveElement RPC silently rejects** when the source node has no
   resolvable parent in the current AST (e.g. the file was just rewritten
   by a previous mutation and AstService's cache is stale). Need cache
   invalidation on every JSX mutation.
C. **`_dragPointerUp` lift uses `dropResolved.el` which can be the wrong
   level** for inline elements — the resolver walks up for aria-hidden but
   for normal `<p>`/`<h3>` returns the element itself, then lift can't find
   a useful common ancestor.

## Tasks

### Task 1: Reproduce both failing E2E cases

- [ ] `bun run test:docker --grep "cross-level drag reorders outer cards"`
- [ ] `bun run test:docker --grep "drop on self-closing leaf"`
- [ ] Capture full failure output: which assertion fails, what the source
      file looks like before/after.

### Task 2: Trace why moveElement returns success but file unchanged

- [ ] Add server-side logging in `AstService.moveElement` for: source
      lookup result, target lookup result, lift result, write result.
- [ ] Reproduce manually: drag "Curly tail" card (the one whose drag
      worked) and drag `<p>{t('habits.behavior')}</p>` (the one that
      doesn't work). Compare logs.

### Task 3: Invalidate AstService AST cache on every mutation

- [ ] After each successful write, drop the cached AST so the next
      lookup re-parses. If "иногда работает" is stale-AST, this fixes it.
- [ ] Same on file watcher events from outside (HMR-rewrites etc).

### Task 4: liftToCommonJsxParent for non-aria-hidden inline elements

- [ ] For sources like `<p>` / `<h3>` / `<span>` that ARE the source-bearing
      node, lift still computes through the JSX hierarchy correctly. Verify
      via unit tests: source `<p>` inside `<div className="card">`, target
      `<h3>` inside `<div className="card2">` — common JSX parent should be
      the grid container, both lifted to its direct children (the cards).

### Task 5: E2E: drag every kind of element

- [ ] Build a fixture component with: span, p, h3, div with children,
      div with t() expression, button, img, ul/li. Drag each onto a
      sibling. Assert every drag produces a file change.

### Task 6: Build, install, screenshot ALL successful drags, TG

- [ ] Run E2E. Open each passed screenshot via Read; verify visible move.
- [ ] If any case still doesn't work, do NOT mark plan done.
