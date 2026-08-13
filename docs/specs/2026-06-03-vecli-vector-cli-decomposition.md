# vecli / vector-cli — decomposition

Date: 2026-06-03
Author: Alex Ultra + Claude
Status: Draft
Linear: NEEDS LINEAR (epic) — no single ticket exists; this spec proposes the parent epic and sub-tickets

## Context

`packages/vector-cli` (`vecli`) is the CLI front-end to a headless vector engine
(`packages/vector-engine`) backed by a WASM path-ops layer (`packages/vector-wasm`,
CanvasKit + Clipper). The CLI's command language IS JavaScript evaluated in a sandbox
with pre-injected vector API functions (`packages/vector-cli/src/sandbox.ts`,
`src/globals.ts`).

What ships today, verified in code:

- **Batch mode works** — `bin/vecli.ts` parses `-e/--exec`, `-o/--output`,
  `--format svg|png`, `--canvas WxH`, stdin pipe, `--help`. Example:
  `vecli 'rect(100,50).fill("#f00").svg()'`.
- **Chainable API** — `src/chainable.ts` exposes ~30 methods: `fill stroke opacity
blend shadow blur translate rotate scale skew roundCorners chamfer smooth offset
trim reverse close dash strokeToPath roughen zigzag puckerBloat twist warp
variableStroke envelopeDistort subdivide addPoint removePoint convertPoint
enforceWinding` plus terminals `export/svg/json/bounds`.
- **Engine** — 49 nodes registered (`vector-engine/src/nodes/register-all.ts`):
  generators, path-ops, boolean, transforms, deformation, mesh, text, style,
  structural. Plus full subsystems: `path/` (flatten, fit, bounds, hit-test,
  merge, geometry), `curve/` (fit, bezier-intersect), `graph/` (executor, history,
  scene-builder), `persistence/`, `sync/`, `import/` (svg + .fig), `export/svg.ts`,
  `network/`, `reconcile/`, `migration/`.
- **WASM backend** — `vector-wasm/src/canvaskit-pathops.ts` implements `boolean`,
  `simplify`, `flatten`, `strokeToPath`, `dash`, `removeSelfIntersections`;
  `clipper-offset.ts` implements true `offset`. `mock-pathops.ts` is the test double.
- **Word-art helpers** — `src/helpers.ts:151-172` `arcText`/`wavyText`,
  plus ribbon/badge/starburst/heart/cowsay/speech-bubble decorative helpers.
- **PNG export** — `src/png.ts` shells out to `rsvg-convert` via `execSync`.
- **Live preview** — `src/preview.ts` debounced SVG write-on-change.
- **Specs already exist** — `docs/specs/2026-03-13-vector-engine-design.md` (77 KB),
  `docs/specs/2026-03-17-vector-cli-design.md` (15 KB). The CLI spec already
  describes the unbuilt ink TUI and the flag set.

The package backlog (from project memory) lists MCP wrapper, d3 integration,
tracing, simplification, word-art/text-on-path, boolean/path-ops audit, ink TUI,
resvg-js, and visual testing — and asserts **none are built**. That assertion is
wrong for several items and is the thing this spec exists to correct.

## Reality check — assumed vs actual

This is the inverse of the usual ticket-vs-reality gap (HYP-372 assumed a SaaS i18n
path that never existed; HYP-300 assumed StyleAdapters that were never built). Here the
backlog **under-claims** — it says "NONE built" while a large engine, WASM backend, and
working CLI already exist. Decomposing without this correction would file greenfield
tickets for things that are 80% done.

| Backlog item                                          | Reality                                                                                                                                                                                                                                                                                                                                                                                                                  | Verdict                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| MCP wrapper                                           | No MCP server file exists. But node doc-comments already assume MCP tools (`mesh-from-path.ts`, `gradient-mesh.ts`, `variable-stroke.ts`: "Accessed via: MCP tool vector_create_mesh").                                                                                                                                                                                                                                  | **Real work.** Wrap the **engine** API, not the CLI eval.                                                       |
| d3 integration (d3-shape/scale/path)                  | No d3 dependency anywhere. Engine already has arc/ellipse/line/polygon/rect/spiral/star/arrow generators (`nodes/generators/`).                                                                                                                                                                                                                                                                                          | **Scope-question first.** Justify what d3 adds over existing generators before building; much overlaps.         |
| Tracing (Potrace/VTracer/Kopf-Lischinski)             | None present. AND there is **no raster import path** — `import/` handles SVG and `.fig` only.                                                                                                                                                                                                                                                                                                                            | **Prerequisite-blocked** on raster ingestion. Sequence last.                                                    |
| Simplification (RDP / Visvalingam-Whyatt / Schneider) | Three different things hide here: (1) Schneider curve-fit **EXISTS** — `curve/fit.ts` uses `fit-curve`, which is Schneider's algorithm. (2) Geometric simplify + `removeSelfIntersections` **EXIST** at WASM layer (`canvaskit-pathops.ts:172,278`) but are **not exposed** as a chainable `.simplify()` and **ignore tolerance** (`_tolerance`). (3) RDP / Visvalingam-Whyatt point-decimation is **genuinely absent**. | **Split.** Schneider = done, drop it. Geometric simplify = wire-up + tolerance fix. RDP/VW = real new geometry. |
| Word art / text-on-path                               | `arcText`/`wavyText` **EXIST** (`helpers.ts:151-172`) but the comment at `helpers.ts:126` says they **position individual characters** — not glyph-outline-on-path. Real building blocks exist: `nodes/text/text-to-path.ts` (opentype.js) and `nodes/text/shaper.ts` (harfbuzz).                                                                                                                                        | **Upgrade, not greenfield.** Compose existing primitives into true text-on-path.                                |
| Boolean / path-ops audit (Figma+Inkscape)             | The path-op set is already rich: boolean (union/subtract/intersect/xor), offset, stroke-to-path, clip, dash, chamfer, trim, round-corners, smooth, split-path, subdivide, add/remove/convert-point, enforce-winding. The chainable list IS the inventory.                                                                                                                                                                | **Audit, not build.** Gap-analysis vs Figma/Inkscape; ticket only named gaps.                                   |
| ink TUI mode                                          | Stubbed — `vecli.ts` prints "Interactive TUI mode (coming soon)". `ink` is not a dependency. CLI spec already describes the panels.                                                                                                                                                                                                                                                                                      | **Clean greenfield**, self-contained.                                                                           |
| resvg-js as a library                                 | `png.ts` shells out to `rsvg-convert` (`execSync`), requiring `brew install librsvg`.                                                                                                                                                                                                                                                                                                                                    | **Cleanest standalone ticket**, ships now.                                                                      |
| Icon/infographic iterative visual testing             | `gallery/` has exactly 2 SVGs; **zero** snapshot/visual tests in `test/` (grep for snapshot/toMatchImage/visual returns nothing).                                                                                                                                                                                                                                                                                        | **Real work**, depends on a reliable PNG path (resvg, VECLI-1).                                                 |

## Scope / Decomposition

Grouped by theme. Each is independently shippable except where a dependency is stated.
All work is in `packages/vector-{cli,engine,wasm}`; TDD per `docs/rules/development.md`
(`bun run test`, never `bun test`).

### Theme A — Quick wins (ship independently, no shared-infra risk)

**VECLI-1: resvg-js library for PNG**

- Files: `packages/vector-cli/src/png.ts`, `bin/vecli.ts` (drop the
  `isRsvgAvailable()` guard), `packages/vector-cli/package.json` (add `@resvg/resvg-js`).
- Replace `execSync('rsvg-convert ...')` with in-process `@resvg/resvg-js`.
- Acceptance: `svgToPng(svg)` returns a valid PNG buffer with no external binary
  installed; test asserts PNG magic bytes and dimensions; remove the
  "rsvg-convert not found" stderr path.

**VECLI-2: Expose `.simplify()` and honor tolerance**

- Files: `packages/vector-wasm/src/canvaskit-pathops.ts` (use `_tolerance`, currently
  ignored at line 172), `packages/vector-cli/src/chainable.ts` (add `simplify()`),
  `src/globals.ts`/help.
- Wire the EXISTING WASM `simplify` through to the chainable API; make tolerance real.
- Acceptance: `rect(...).simplify(t)` reduces self-overlap; a path with a known
  redundant collinear run shrinks its command count; tolerance=0 is near-identity.

### Theme B — Geometry (new algorithms on existing inputs)

**VECLI-3: Polyline point-decimation — RDP + Visvalingam-Whyatt**

- Files: new `packages/vector-engine/src/path/decimate.ts` + node(s) under
  `nodes/path-ops/`, register in `register-all.ts`, expose via chainable.
- Inputs already exist: `path/flatten.ts` (path→polyline), `curve/fit.ts` (re-fit after
  decimation). This is point-reduction, distinct from VECLI-2's geometric simplify.
- Acceptance: RDP on a dense polyline with epsilon E keeps endpoints and drops points
  within E of the simplified hull; VW removes lowest-area vertices first; both have
  deterministic unit tests on fixed point arrays.

**VECLI-4: Path-ops audit vs Figma/Inkscape**

- Deliverable: a comparison doc (`docs/specs/`) listing the existing op set against
  Figma + Inkscape menus, naming concrete gaps (e.g. join-rounding modes, outline-stroke
  variants, simplify-with-tolerance UI). Each named gap becomes its own follow-up ticket.
- Acceptance: a checklist where every Figma/Inkscape boolean/path op is marked
  exists / partial / missing, with file references for the existing ones.

**VECLI-5: True text-on-path**

- Files: `packages/vector-engine/src/nodes/text/` (new text-on-path node using
  `text-to-path.ts` + `shaper.ts`), expose via CLI word-art helpers; upgrade
  `helpers.ts` arcText/wavyText to optionally emit real outlines.
- Acceptance: given a path and a string, output is a single compound `PathValue` of
  glyph outlines following the path tangent, not N positioned `<text>` annotations;
  test asserts the result is a path (not text annotations) and glyph count matches.

### Theme C — Interfaces (wrap, don't rebuild)

**VECLI-6: ink TUI mode**

- Files: new `packages/vector-cli/src/tui/` (ink components per the spec panels),
  wire into `bin/vecli.ts` replacing the "coming soon" branch; add `ink` dependency.
- Spec already written: `docs/specs/2026-03-17-vector-cli-design.md` §TUI Mode.
- Acceptance: launching `vecli` in a TTY renders node-list / graph / properties / REPL
  panels; Tab cycles panels; Ctrl+Z/Y/S/E/Q wired; tested via ink-testing-library.

**VECLI-7: MCP server wrapping the engine**

- Files: new `packages/vector-cli/src/mcp/` (or a sibling `packages/vector-mcp`),
  add `@modelcontextprotocol/sdk`.
- Wrap the **engine** node/graph API, not the CLI's JS-eval sandbox. The doc-comments
  already name the contract (`vector_create_mesh`, etc.).
- Acceptance: an MCP `tools/list` exposes create/transform/boolean/export tools; a
  round-trip "create rect → fill → export svg" via MCP returns valid SVG; tested
  against the in-process server.

### Theme D — Raster (prerequisite chain — sequence last)

**VECLI-9 (prerequisite): Raster import path**

- Files: new `packages/vector-engine/src/import/raster-import.ts`; `import/` currently
  has only `svg-import.ts` and `fig-import.ts`.
- Decode PNG/JPG into an in-memory bitmap the engine can consume. Blocks all tracing.
- Acceptance: a PNG fixture loads into a bitmap with correct dimensions/channels.

**VECLI-10 (blocked on VECLI-9): Raster tracing pipeline**

- Potrace (bitmap→bezier), VTracer (color), optionally Kopf-Lischinski (pixel-art).
- Acceptance: a known black-on-white bitmap traces to a path within a bounded vertex
  count; visually matches a committed reference SVG.

### Theme E — Quality gate

**VECLI-8: Icon/infographic visual-regression harness (depends on VECLI-1)**

- Files: `packages/vector-cli/test/`, expand `gallery/`.
- Render gallery scripts to PNG (via the new resvg path) and snapshot-compare.
- Acceptance: a deliberate change to a generator that alters output fails the visual
  diff; an unrelated refactor passes.

### Optional / gated

**VECLI-11: d3 integration — scope decision first**

- Do NOT file as build work. First answer: what do `d3-shape`/`d3-scale`/`d3-path`
  add beyond the existing arc/ellipse/line/polygon/rect/spiral/star/arrow generators
  and the chart-oriented helpers? If the answer is "scales + data-driven layouts for
  charts," scope to that and drop shape primitives as redundant.

## Risks & prerequisites

- **Raster ingestion is the long pole.** Tracing (VECLI-10) is blocked on VECLI-9;
  do not file tracing as standalone. Everything else is unblocked today.
- **Shared-code / WASM-backend changes** (VECLI-2 touches `vector-wasm` and the
  `PathOpsBackend` contract used by the engine's boolean/offset/stroke nodes). Per
  `~/.claude/CLAUDE.md`, changes to shared code need sign-off — keep VECLI-2 minimal:
  honor `tolerance`, do not reshape the interface. The interface already declares
  `simplify`/`removeSelfIntersections`; no signature change needed.
- **mock-pathops parity** — any backend behavior change (VECLI-2) must keep
  `mock-pathops.ts` consistent or engine tests using the mock will drift.
- **Audit-before-build ordering** — run VECLI-4 (path-ops audit) before committing to
  any new boolean/path-op tickets, so new work targets real Figma/Inkscape gaps rather
  than re-implementing existing ops.
- **Don't delete the "duplicate" path** — `simplify` (geometric, VECLI-2) and decimation
  (RDP/VW, VECLI-3) look similar but are different operations; keep both.
- **Recommended order:** VECLI-1, VECLI-2 (quick wins) → VECLI-8 (needs VECLI-1) →
  VECLI-4 → VECLI-3, VECLI-5 → VECLI-6, VECLI-7 → VECLI-9 → VECLI-10. VECLI-11 gated on
  the scope decision.

## Out of scope

- Schneider curve-fitting — already implemented via `fit-curve` in `curve/fit.ts`.
- Re-building any of the 49 existing engine nodes or the existing boolean/offset/
  stroke-to-path/clip/dash/chamfer/trim path ops — they exist and work.
- The CLI batch mode, chainable API, and live preview — already shipped.
- `.fig` and SVG import — already in `import/`.
- Persistence/sync/migration subsystems — out of this CLI epic.
- Any integration of `vecli` into the VS Code extension / Hyper Canvas UI — this epic
  is the headless CLI + engine only.
