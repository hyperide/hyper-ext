# state-lib — agent handoff

Working home of `state`, a universal client-state toolkit (ambition: the default choice for client-side state, the way Postgres is for databases). This file orients a fresh Claude/agent session. Read it first; then `REQUIREMENTS.md` and `DECISIONS.md` are the law.

## Canonical files (in precedence order)

1. `REQUIREMENTS.md` — R1–R98 + F1–F3, every requirement the product owner stated, in his own intent, cleaned into English. **The source of truth for ids.** New asks get new R-numbers, never silent edits.
2. `DECISIONS.md` — 32 numbered decisions with reasons (reasons cite R-ids, never people) and explicit supersessions (see #8 → #12). Overturn by adding a row, never by deleting.
3. `docs/2026-09-01-state-master-spec.md` — master spec v0.6: core model (§4), compiler (§5), adapters (§6), SSR/RSC (§7), data layer (§8), remote protocol (§9 + Appendix B wire protocol), devtools (§10), CLI/analyzer/MCP (§11), testing (§12), budgets (§13), packaging (§14), Hyper migration (§15), risks (§16), API sketches (§17 + Appendix A), roadmap/spike (§18), open decisions (§19). §2 carries a second traceability table saying where each of R27–R84 actually lives today (spec section / site page / adopter doc / backlog) — R1–R26 are the only ones that are wholly spec material. It is a **living doc**: kept in sync with DECISIONS (decision #21).
4. `docs/2026-09-01-state-management-research-brief.md` — the research brief. §3/§4 were merged into the site's Landscape/Compare pages (single source, R64).
5. `docs/research/` — **research documents live here, one topic per file, with a short summary and a link in the spec (decision #24)**. Present: structured concurrency and cancellation; the R34 illustration-comprehension protocol and its results; the state-regions brainstorm; the first measured R66 run; the normalisation-and-conversion landscape (R83); useEffect patterns and their declarative equivalents (R84); a corpus of twenty-two production selector chains mapped onto Datalog (R66/R32 — the one that moved the query layer's boundary: Datalog has no sort, and sorting is in six of them). The five original research passes predate this convention and were **absorbed** into the brief, the Landscape data (`site/src/data/landscape.ts` + `insights.ts`) and the two source-level deep dives — there are no standalone files for them, and those artifacts ARE that research record.
6. `docs/state-landscape.html` — standalone matrix mirror (also published as a Claude artifact); the **canonical data** is `site/src/data/landscape.ts` + `insights.ts`.
7. `site/` — the docs site (Vite + React). `src/content/*.md` are **copies** of the docs above for bundling — when a doc changes, re-copy it there and rebuild. `site-v0/` is the archived static predecessor.
8. Adopter-side (Hyper-specific — never on the site, R55): `../../docs/specs/2026-09-03-hyper-state-adoption.md`.

## The site

- Dev: `bun install && bun run dev` in `site/`. Build: `bun run build` → single-file `dist/index.html` (opens from disk; ES modules are CORS-blocked on file://, hence vite-plugin-singlefile).
- Deploy: Vercel project `state-lib.vercel.app` (owner's account). `site/vercel.json` carries the SPA rewrite — **required** for direct URLs; root when linking the repo in Vercel: `packages/state-lib/site`.
- Routing: History API when served, hash fallback on file:// (`src/lib/router.ts`); `#` is reserved for in-page anchors (`/requirements#R40`, `/spec#s4-8`, `/concepts#g-<term>`).
- Reference system (R54): `src/lib/linkify.ts` — single-pass tokenizer (NEVER re-scan generated HTML; the multi-pass version corrupted attributes) turning R-ids/§-refs/glossary terms into calm tooltip links; terms reset per section; definitions get backlink chips instead of self-links. Glossary: `src/data/glossary.ts` (R63). JSX pages use `<T>` (`src/lib/T.tsx`).
- Pages: Home, Concepts (twelve illustrated explainers + interactive push-pull + glossary), Landscape (7 layers incl. validation, per-layer insights), Compare (**36 features × 6 categories**, hover detail panel, status tags prototyped/spec/planned, every prototyped row naming the REPL example that demonstrates it), **REPL** (`/repl` and `/playground` are one page: examples grouped by task, each a `Pane` — scaffolding, a CodeMirror editor with a step debugger and hover, a JSX block that mounts a real component you click, output — and a switcher that opens a second identical pane running the same task in Zustand/Valtio/Immer with their real React bindings; two columns on desktop, stacked on a phone), Bench, CLI, **No useEffect** (`/effects`, the R84 catalogue with the Compare hover layout), Devtools, Deep dives, and md-rendered Requirements/Decisions/Spec/Brief.
- `src/lib/proto.ts` is the **ground truth the site's claims are tested against**, not a toy: signals with `derive`/`watch` (the primitive is `watch`, decision #27 — `effect` is the phase-4 declared reaction and the name had to stop being overloaded), `derive.collection`, undo/redo with a cursor, persistence adapters, optimistic overlay, regions, **tasks and scopes** (`createScope`/`run`/`spawn`/`all`/`race`/`shield`, typed cancel reasons, four supersession policies — §4.15) and **conversion at the two boundaries** (`customType`, `presented`, `field` — §4.13.5). Every claim it backs has a `tools/proto-*.check.mts` beside it.
- **Two lessons the prototype paid for, both found by a test and neither visible by reading:** a task's status transition and its _settlement_ are separate — collapsing them made `settled` a lie for anything holding a `shield`; and a locale-blind `parse` read the presenter's own `04.09.2026` back as 8 April with `ok: true`, which is the exact corruption §4.13.5 argues about, committed by its own code. Assume neither is obvious to the next person.
- Code rendering (R80): `src/lib/highlight.ts` is a dependency-free lexer, and `highlightHtml` runs it over marked's output so **every** fenced block on the documentation pages is highlighted too (terminal transcripts and ASCII diagrams are deliberately skipped). `<Code repl="...">` adds the run button — and it must render `exampleById(...)`, never a literal, because a button that showed one snippet and opened another shipped once; `tools/run-buttons.check.mts` enforces it.
- The step debugger (R81) records rather than pauses: `src/lib/instrument.ts` splits top-level statements and captures every value in scope after each, so stepping is scrubbing frames. Only top-level statements are steps — an honest boundary. Click a line in the editor to stop on its statement; there is no separate step list (it duplicated the editor and broke on phones).
- **The editor is CodeMirror 6 behind `import()`** (`src/lib/LazyEditor.tsx`), not Monaco — and the reason is not size alone: Monaco's type intelligence is a separate worker carrying the TypeScript compiler, and the owner's own prior Monaco (vibeflow) disabled that worker too. Signatures in the hover and completion come from **the real compiler at build time**: `tools/gen-api-docs.mts` runs the TypeScript API over `proto.ts` → `src/lib/api-docs.generated.ts` (313 entries: exports, `store.<method>`, `TaskContext.<member>`…); `api-docs-fresh.check.mts` fails when it is stale. `src/lib/api-docs.ts` keeps the hand-written sentence per name and routes `store.undo` / `ctx.spawn` to the right generated key.
- **Examples with a UI** (`ui:` on an example): JSX, transpiled in the browser by sucrase (lazy chunk), evaluated with React and the sandbox's scope, mounted in `UiSlot` on a fresh root per run. Declarations inside the UI block are NOT in the sandbox's `return { … }` — the scan covers scaffolding + code only, or the run throws `ReferenceError`. Zustand lists need `zustand.useShallow`; without it `Object.keys` in a selector is React #185, not an extra render.
- **Two builds from one source**: `bun run build` → single-file `dist/` (opens from disk; every harness drives this; `import()` inlined). `bun run build:served` (`SITE_SPLIT=1`) → `dist-served/` with editor/transpiler/others as real chunks — this is what `deploy.sh` publishes and what `vercel.json` points at. Served entry ≈ 353 kB gz, same as before CodeMirror existed.
- Sidebar TOC (R82): `src/lib/Toc.tsx`. Heading ids are slug + collision suffix, deliberately **not** ordinal-prefixed — an earlier `h-<ordinal>-<slug>` scheme renumbered every anchor below any inserted heading and silently broke inbound links.

## Non-negotiable conventions

- **Honesty tags**: anything unbuilt is labeled (budget vs measurement, prototyped/spec/planned). No claimed numbers without a source or a harness run (R66).
- **Prior art** (R65): every mechanism cites its lineage; assembled-well is the craft claim.
- **No adopter internals on the site** (R55); the partner's name is **Danny**.
- Danny's Datomic-like Rust→wasm DB is the intended query layer (R32); Datomic query reference: https://docs.datomic.com/query/query-data-reference.html
- Attribution footers for commits/PRs: see the repo's existing state-lib commits.

## State of play (2026-09-04, second pass)

**Spec is v0.6 and structurally complete**: every requirement R1–R84 names a destination in §2's
traceability table — a spec section, a research document, a site page, or the adopter doc. **There
is no remaining unassigned design section in that R1–R84 inventory**; R32 (the Danny-DB query layer) is now §8.10 —
our half of the contract is specified and the six questions that are genuinely Danny's are listed
as open questions. This records design coverage, not implementation completion; the query planner and migration tooling remain pending under HYP-1457. Sections added across this pass: §4.13 data modelling
(incl. §4.13.5 conversion at the two boundaries, R83), §4.14 layers and automations, §4.15 tasks and
cancellation, §4.16 regions, §5.6 output optimisation, §5.7 declared component dependencies, §8.9
retention and eviction, §8.10 the query layer, §10.6 devtools maps, §11.2 lint rules (R84), §12.5
two-way binding, §12.6 capture, §13.1 the benchmark harness, §14.1 the reactivity package split,
and chapter 20 (`statec`).

**Site**: front page rewritten to sell and to derive every count from its source, so it cannot go
stale. Head-to-head `/lib/<id>` pages per competitor. **Twelve concepts**, each illustrated and put
through the R34 comprehension protocol (2.8/10 → 8.2/10 on the first five; the second five at 7.1;
structured concurrency 6 → 7 and regions 6 → shipped, both after fixing the picture rather than the
caption — that is the protocol working, and it is worth running on every new figure rather than
trusting your own reading of one you just drew). First real measured numbers exist with provenance
(`site/tools/bench-results.json`).

**Two harnesses are committed and are meant to be re-run, not admired**: `site/tools/render-figures.mts`
renders each figure in isolation for a cold read, and `site/tools/run-bench.mts` drives the site's own
benchmark suites headlessly and writes a results file recording machine, browser, CPU, commit and method.

**Next, in rough order**: the two-week core spike (§18) with the go/no-go bars in §13 — everything
above is design and the spike is what turns it into evidence; per-library Compare pages deepened from
the dive material; the R66 fixture re-run against a real engine against the real `@tanstack/db-ivm` behind an explicit state query bridge (not a published `@state/db-ivm` package); the
Danny conversation on §8.10.7's six questions; Hyper adoption per `hyper-state-adoption.md`.

**One command runs every gate: `bun run check` in `site/`** (`tools/check-all.mts`) — 26 of them, unit
tests first, then the build, then the harnesses that drive the built page. Adding a `*.check.mts` is
picked up automatically; a page harness needs one line in its list. `bun run figures` renders the
concept figures for a cold read and is deliberately not a gate.

**Six of those gates exist because a whole class of bug was invisible**, and each is worth knowing
about before you re-discover it:
`facts-freshness` — every number the site states about itself matches its source, **and** the
markdown under `src/content/` is byte-identical to the documents it mirrors (a forgotten `cp` leaves
the spec page stale with everything else green).
`served-mode` — serves `dist/` over http and drives real navigation, because every other harness
loads `file://` where the router falls back to hash routing; a link that works from disk and does
nothing when served is invisible to all of them, and one shipped.
`responsive` — 16 routes × 3 widths plus dark mode, plus the sticky header's height on a phone (15
links once wrapped to five rows, 182px) and that the phone menu opens/navigates/closes. The site was
broken on a phone for weeks (/landscape overflowed by 1040px) and no desktop harness could see it.
The cause is always a grid or flex child defaulting to `min-width:auto` — or, on document pages, a
`<table>`/`<pre>`/raw-URL `<a>` with no scroll box or break opportunity (`Doc.tsx` wraps each table;
`.md pre` scrolls; `.md a, .md code` may break anywhere).
`prose-escaping` — `<T>` injects HTML, so a sentence mentioning an `<input …/>` rendered a live text
field mid-paragraph. Prose is escaped; `linkifyCell` is the separate entry point for cells that are
deliberately markup.
`compare-axes` — ids unique (two rows once shared one, so hovering either highlighted both), every
row rates every column, every prototyped row names a demo, and the word "measured" may not appear
without provenance.
`traceability` — the spec's own front-page claim that every requirement names a destination.

**Deploying is authorised and gated**: the owner said to deploy regularly without asking. `site/deploy.sh`
runs every gate and refuses on red; `--skip-checks` only right after a green `bun run check`. Deploys
are manual (`vercel --prod`), nothing is git-triggered. **After every deploy, cold-load a two-segment
route on the live URL** (`https://state-lib.vercel.app/repl/queries`) and check `body.innerText` is
non-empty — the site shipped blank on every such route once, and a green suite did not prevent it.

**The disk build and the served build are different artefacts, and only one ships.** `dist/` is one
inlined file with a relative base (`./`), because file:// has no origin; `dist-served/` has split
chunks and an ABSOLUTE base (`/`). Every gate but `served-mode` drives `dist/`, and so did the audit
agents — which is exactly why a served-only failure (a relative asset path resolving against
`/repl/queries`, the SPA rewrite answering with `index.html`, the browser refusing HTML as a module
script) was invisible to all of them. `served-mode` now serves `dist-served/` when it exists and
cold-loads two-segment routes. If you add a harness that matters for production, point it at
`dist-served/`, and remember that navigating TO a route from a loaded page proves nothing about
loading that route cold.

**Standing conventions worth not rediscovering**: prose never goes inside an `<svg>` (the site renders
`svg text` monospace and it will not wrap — use `<figcaption>`); a figure shows the failure the
mechanism prevents, next to the mechanism; no number without provenance; and the repo's
`check-react-hooks-import` hook does not recognise `import React, { useX }`, so site files use
named-only React imports.

## Documentation implementation update — 2026-09-08

R85–R92 and decision #30 add the `/learning` guide, actual cooperative Step sessions, protocol laboratories, inline region declarations and responsive reading/navigation. `site/src/lib/proto.ts` now uses version-checked graph invalidation before observer flush; `tools/reactivity-boundaries.check.mts` covers diamonds, equality, batching and direct reads. `tools/step-session.check.mts` proves Run does not introduce an await between synchronous writes. Every example has custom UI or ScopeWorkbench. JSX hovers are static API help plus captured top-level values, not a TS language server.

The served build now also runs `tools/prerender.mts` using Playwright to generate route HTML and full-source Markdown, llms.txt/full, robots and sitemap. Install Chromium before `npm run build:served`. Use file-first hosting/cleanUrls, not an unconditional SPA rewrite that returns HTML for missing text files. `tools/static-reading.mts` checks no-JS pages and exports. The disk build is still one SPA file. `npm run check` and `bun run check` use declared site dependencies; both build with npm internally. Production must not deploy with failing gates.

Read `docs/research/2026-09-08-reactivity-sync-and-reading.md` for source-backed explanations and limits. Protocol labs are educational, not an embedded Electric server; the real HTTP reader requires a user-configured authorised endpoint and intentionally is not a production SDK. Browser controls cannot guarantee OS window geometry or orientation lock. Earlier claims about an uncommitted archive from a chat response are not a source of truth; only tracked code and executed gates count.

## Documentation refresh (2026-09-08)

R93–R98 and decisions 30–32 add practical concepts (`/concepts/practical`), native-versus-state framework ownership (`/adapters`), a complete prototype API inventory (`/api`), and query-engine research (`/query-research`). The query comparison now publishes the full 22-record corpus and historical method, with corrections called out, plus five normalized tasks with eleven syntax choices and 33 executable comparisons. Reference-only dialects are visibly marked; the fluent view facade is a full-recompute prototype, not IVM. Danny's implementation remains unaudited; do not infer its guarantees from Datomic's.

Every code block has an exact-source Try path. `/repl/snippet#code-…` stores UTF-8 source in the URL fragment, never executes it automatically, and uses an explicitly started, cancellable worker for allowlisted JS imports. It is not a security sandbox. Framework/server/CLI examples without a loaded runtime remain editable references; do not substitute a different runnable example behind their Try buttons.

`packages/vector-cli/src/diagram.ts` supplies real dependency-free SVG frames, tables, arrows and ASCII conversion. `vecli diagram` runs before the normal CLI backend initializes. The same module powers `/diagrams`; the master-spec architecture figure is generated from `packages/vector-cli/examples/diagrams/architecture.txt`.

Header motion: R96 supersedes the old immediate entry-relative snap-back. Edge dwell reaches the actual endpoint, leave-reset has a grace interval, quick re-entry cancels it, keyboard focus and reduced-motion are respected. Far-edge lens transforms never shrink the focused hit target. The responsive test encodes this contract.

`bun run check` now includes typechecking, both builds, the existing browser suites and `docs-refresh.mts`. Browser fixtures explicitly fulfil only Google Fonts requests with an empty stylesheet to test the system-font fallback deterministically; application assets and console errors are not stubbed. Generated screenshots live in ignored `tools/artifacts/`. New canonical-document mirrors and full API signatures are covered by freshness gates.
