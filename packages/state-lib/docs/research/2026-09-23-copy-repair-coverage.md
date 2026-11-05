# Public copy repair coverage (HYP-1489)

Scope: the 95 findings in `2026-09-23-public-copy-audit.json`, restricted to the files this pass may edit
(Home, Concepts and its HTML fragment, ResearchConcepts, Init and its wizard data, Api, api-docs, example text data,
the learning guide and its canonical copy). Findings are indexed by their position in the audit `findings` array
(0-based). Nothing was built or benchmarked; verification is source-level plus focused checks.

## What was actually inspected

- Read in full and edited: `Home.tsx`, `Init.tsx`, `Concepts.tsx`, `ResearchConcepts.tsx`, `content/concepts-fragment.html`
  (all 12 "Why it matters for us" boxes), `content/learning.md` and its canonical copy, the copy-bearing strings in
  `data/examples.ts`, `screen-examples.ts`, `learning-examples.ts`, `glossary.ts`, `init-wizard.ts`, `lib/api-docs.ts`.
- Searched (pattern grep for defensive and progress phrases, not read line by line): `examples-other.ts`, the
  `Api.tsx` planned-API table. The remaining rendered corpus (`tools/artifacts/public-copy-audit/all-copy.txt`) was
  used only through the audit classification; routes outside the editable files were not re-read by this pass.
- Not inspected at all: the `/spec` body, `/brief`, `/requirements`, `/decisions`, `/dive-*` beyond the audit quotes.

## Edits by finding

- 0-14 (homepage): removed the defensive kicker and the "not yet a universal guarantee", "Native is a foundation" and
  "still being integrated" blocks; replaced the test-pass paragraph with links to the task screen and to
  `/repl/board-commands` and `/repl/issue-triage`; kept one status line (hero: "Prototype · not published to npm")
  and moved the async gap into a short "Status" sentence; benchmark block keeps date, CPU, browser and workload and is
  labelled "Recorded run". The bench-methodology half of finding 12 could not move (Bench.tsx is owned elsewhere), so
  a one-clause condition stays on the homepage.
- 38: the API entry renders no paragraph when no description exists (signature still shown).
- 39, 40, 41, 79, 80, 81: internal ids and disclaimer tails removed from example descriptions; "designed, not built" and
  "tags alone do not enable storage or sync" kept as genuine constraints. Prior-art links for regions stay on the
  Concepts and Learning pages.
- 47-50: topic labels replace the status eyebrow; status moved into "What is implemented" as a `Status:` sentence.
- 51-53: every "Why it matters for us" box became "How state uses it" with the same mechanism, spec section links
  (`#/spec#s4-1`, `s4-4`, `s4-6`, `s4-10`, `s4-11`, `s4-15`, `s4-16`, `s7-1`, `s8-4`) and R-number traceability kept;
  "runs today" claims became "Try it" links; adopter/internal-tooling names removed; unbuilt compiler claims marked planned.
  The "redux-form post-mortem" no longer claims the expense mechanism is "gone".
- 56: glossary heading and lead reduced; `concepts v1` footer removed.
- 57-64: progress-report voice removed from the learning guide (both the served copy and the docs copy, which are now
  byte-identical); the "Runtime implementation and verification status" section was removed from the served copy.
- 65-68: init preview text, internal R-number kicker, "fabrication" notes removed; unbuilt choices carry a `planned` badge
  and the summary line links each runnable choice to its REPL example (disabled controls were not used because the
  notes and sketches on planned choices are still worth reading).
- 78: one "Simulation, no network." lead per sync example.

## Deferred (file not editable in this pass)

- 15-26 Bench copy (`Bench.tsx`, `ResearchEvidence.tsx`); 12 (methodology half).
- 27-37 Compare and `/lib/*` (`data/compare.ts`, `content/requirements.md`, `tools/facts-freshness.mts`).
- 42-46 adapters guide (`docs/guides/2026-09-08-framework-adapters.md`); 54-55 practical concepts guide.
- 69-71 `Cli.tsx`; 72 `Effects.tsx`; 73-77 REPL chrome and the duplicated "Why this matters" block (`Repl.tsx`, another agent).
- 82 `/queries`; 83-86 `/query-research` (docs and content); 87-89 selector corpus and `/dive-stores`.
- 90-91 landscape and validation (`data/landscape.ts`, `state-landscape.html`); 92-94 spec, brief and public navigation.

## Not changed on purpose

- `call Danny` in sample task data (`examples*.ts`) is example content shared with running code and tests.
- Example code sources were not edited; only description text, so code shown equals code run.
- Runtime semantics, dependencies and the audited genuine constraints (snapshot clones, no rollback, edited-code
  privileges) are untouched.

## Verification

`tools/public-copy.check.mts` asserts the known bad phrases are gone from these surfaces and that demo, spec and
constraint anchors remain. Visual review of the rendered pages was not performed in this pass.
