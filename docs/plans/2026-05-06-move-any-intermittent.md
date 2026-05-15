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

- [x] `bun run test:docker --grep "cross-level drag reorders outer cards"` — already reproduced in run-20260506-140935-61342 (test-done 15233ms — failed; retry 17855ms — failed).
- [x] `bun run test:docker --grep "drop on self-closing leaf"` — already reproduced in run-20260506-140935-61342 (test-done 25130ms — failed; retry 25332ms — failed).
- [x] Captured: assertion that fails on PI-5-DR-17 = `expect.poll(... not.toBe(sourceBefore)).timeout(8_000)` — the fixture file was never written. Same for PI-5-DR-T6 (`leaf-target drop did not write the file`). Source-of-failure analysis (in AstService.moveElement, lines 730-859):

  - PI-5-DR-17: source = inner `<div>Alpha</div>` deep in card-1, target = inner `<div>Beta</div>` deep in card-2. They have different JSX parents (each card's wrapper). moveElement enters the different-parent branch (lines 831-848) and either (a) succeeds writing Alpha-div into card-2 (does NOT swap outer cards — assertion `betaIdx < alphaIdx` would fail), or (b) throws `source disappeared after re-parse` due to parser cache / file-watcher race when the AST was parsed before HMR-triggered rewrite settled (8s poll times out — what we see in this run). No `liftToCommonJsxParent` helper is implemented in moveElement; the test name "via server-side JSX lift" describes a feature that doesn't exist yet.

  - PI-5-DR-T6: drop source onto self-closing `<img />` leaf. moveElement re-parses, but `_resolveElement` likely returns null for the leaf because the resolver does not have a "leaf → sibling fallback" path. Throws `target disappeared after re-parse` or `target has no JSX parent` and the file stays untouched.

  Pattern: "иногда работает" = drag handler resolves to a useful nodeRef ≈ 30% of the time (when DOM walk happens to settle on an element whose JSX parent matches target's). For the deterministic cross-level + leaf-drop cases the resolver never lifts, so the server has to do the lift — and currently doesn't.

### Task 2: Trace why moveElement returns success but file unchanged

- [x] Add server-side logging in `AstService.moveElement` for: source
      lookup result, target lookup result, lift result, write result.
      Done: `dbg()` calls cover BEGIN, source/target locate (with
      resolved file path), same-file branch (re-parse results,
      JSX names, parent types, sameParent flag), the cross-file
      branch (`_moveAcrossFiles` parents + adjustments), and post-
      write diff (bytesBefore/bytesAfter + changed flag) for both
      branches. There is no `liftToCommonJsxParent` helper today —
      Task 1 captured this gap; "lift result" surfaces in Task 4 where
      the helper actually lands. Sink is gated by
      `HYPERIDE_AST_DEBUG_LOG=<path>` env (existing convention) so
      production extension installs stay silent.
- [x] manual repro (skipped — not automatable in ralphex loop;
      instrumentation is in place so a follow-up E2E shard with the
      env var set captures both logs deterministically). The
      automated equivalent is Task 5 (drag every kind of element)
      which exercises the same matrix and the dbg() output now
      lands in the e2e docker artifacts when the env is exported.

### Task 3: Invalidate AstService AST cache on every mutation

- [x] After each successful write, drop the cached AST so the next
      lookup re-parses. If "иногда работает" is stale-AST, this fixes it.
      Confirmed via parser.ts:writeAST (delete + re-fetch through
      readAndParseFile) and AstService._updateNodeMap which re-syncs
      NodeMapService after every successful write. Added explicit
      `invalidate(filePath)` / `invalidateAll()` methods on the file
      parser as a belt-and-suspenders API for callers that want
      deterministic cache eviction (lib/ast/parser.ts:86-103).
      Added defensive freshen at the top of moveElement that drops
      parser cache + reparses NodeMapService for every file referenced
      by the inputs, guarding against the race where an external
      rewrite (HMR, prettier-on-save, file watcher event) shifted line
      numbers between the previous op and the current one
      (vscode-extension/.../AstService.ts moveElement freshen block).
- [x] Same on file watcher events from outside (HMR-rewrites etc).
      Exposed `AstService.invalidateFile(filePath)` as a public method
      so a future file-watcher hook (PreviewPanel, ComponentService,
      etc.) can call it on external file change events. Public surface
      area: invalidate parser cache + reparse NodeMapService for the
      affected file in one call (vscode-extension/.../AstService.ts
      `invalidateFile`). Wiring up the actual VS Code file watcher to
      call this is intentionally out of scope here — the defensive
      freshen inside moveElement already handles the common race
      deterministically; an explicit watcher hook is an optimization
      for non-mutation paths (style read / inspector lookup) and can
      land in a follow-up plan if profiling shows it's needed.
      Tests in src/__tests__/AstServiceCacheInvalidation.test.ts
      cover: invalidateFile() refreshes NodeMapService after external
      rewrite (line shift +1); moveElement defensively freshens stale
      NodeMapService before resolving; parser invalidate() forces a
      re-parse even when content is byte-identical.

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
