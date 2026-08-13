# vecli — path / boolean ops gap audit vs Figma + Inkscape

> **SUPERSEDED IN PART (2026-06-11 reconciliation, HYP-469).** Several findings here
> are stale: GAP-1 (CLI ran ops through MockPathOps) is FIXED — `src/backend.ts` +
> `bin/vecli.ts` boot the real CanvasKit/Clipper backend and throw on WASM failure (no
> silent mock). GAP-4 (reverse/close node-name mismatch) is FIXED (HYP-512, chainable.ts
> emits `reverse-path`/`close-open-path`). Visvalingam-Whyatt is now wired and exposed
> (`.simplify(1, {method:'vw'})`). The still-open gaps — Division/Break-Apart/Combine/Cut-Path,
> offset join-type, and splitPath wiring — share one root cause and are blocked on the
> multi-output DSL decision (HYP-532). See HYP-469 for the live status.


Date: 2026-06-03
Author: Alex Ultra + Claude
Status: Draft
Linear: HYP-507 (this audit) — parent epic HYP-469
Spec: `docs/specs/2026-06-03-vecli-vector-cli-decomposition.md` §VECLI-4 (audit row)

## Scope

AUDIT ONLY. This doc inventories the **actual** path/boolean op surface of
`vector-engine` + `vector-cli` (every entry grounded in `file:line`), gap-analyzes it
against Figma's vector/boolean operations and Inkscape's Path menu + Live Path Effects,
and names the genuine gaps. **No engine code is changed here.**

> **Figma/Inkscape behavior is from documented knowledge, NOT a live run.** The two
> reference columns describe what those tools' menus do per their docs; I did not launch
> Figma or Inkscape against the engine. Treat the reference columns as "per docs", and
> the vecli column as "per code, file-referenced".

## Method / what "in vecli?" means

vecli is a CLI front-end (`bin/vecli.ts`) over a graph engine (`vector-engine`) whose
path/boolean nodes are registered in `nodes/register-all.ts`. The user-facing surface
is two layers:

- **chainable methods** — `packages/vector-cli/src/chainable.ts` (fluent `.op()` calls).
- **multi-input globals** — `union/subtract/intersect/xor/clip/group/join` exposed via
  `packages/vector-cli/src/globals.ts:243-249`, documented in
  `packages/vector-cli/src/help.ts:134-154`.

An op is **"in vecli"** only if it is reachable from one of those two layers. An
algorithm that exists in the engine/WASM but is not wired to a node or a chainable/global
is marked **partial (engine-only)** — present as code, not reachable from the CLI.

### Backend caveat that colors every WASM-backed row

The CLI builds its registry with **no backend argument**:
`packages/vector-cli/src/context.ts:50` calls `createDefaultRegistry()`, and
`nodes/register-all.ts` falls back to `new MockPathOps()` when no backend is passed.
`MockPathOps` (`packages/vector-wasm/src/mock-pathops.ts`) is a **pass-through stub**:

- `boolean()` — naive `Float64Array` **concat** of both inputs, no real union/subtract
  (`mock-pathops.ts:12-17`).
- `offset()`, `dash()`, `simplify()` (geometric) — **identity no-ops**
  (`mock-pathops.ts:36-46`, each `return path`).
- `strokeToPath()` — only flips `closed: true`, no outline geometry
  (`mock-pathops.ts:27-34`).

The real geometry exists — CanvasKit boolean/simplify/strokeToPath/dash
(`packages/vector-wasm/src/canvaskit-pathops.ts`) and Clipper offset with a selectable
join type (`packages/vector-wasm/src/clipper-offset.ts`) — but it is **not wired into the
CLI**. So today, in the shipped CLI, every WASM-backed op below is geometrically a
no-op/concat. This is the single biggest finding and is tracked as a candidate ticket
(GAP-1). The pure-TS ops (round-corners, chamfer, smooth, trim, join, subdivide,
add/remove/convert-point, enforce-winding, RDP decimation) DO run for real because they
don't touch the backend. Exception: `.reverse()` and `.close()` are also pure-TS but are
**broken in the CLI** by a node-type-name mismatch (GAP-4) — they never reach their
registered node.

## Current op inventory (grounded in code)

### Boolean / combine

| op                       | reachable via                   | engine node                 | backend                              |
| ------------------------ | ------------------------------- | --------------------------- | ------------------------------------ |
| union                    | `globals.ts:243`, `help.ts:136` | `path-ops/boolean.ts:13`    | WASM (mock-stubbed in CLI)           |
| subtract                 | `globals.ts:244`, `help.ts:137` | `path-ops/boolean.ts:14`    | WASM (mock-stubbed in CLI)           |
| intersect                | `globals.ts:245`, `help.ts:138` | `path-ops/boolean.ts:15`    | WASM (mock-stubbed in CLI)           |
| xor (exclude)            | `globals.ts:246`, `help.ts:139` | `path-ops/boolean.ts:16`    | WASM (mock-stubbed in CLI)           |
| clip (mask)              | `globals.ts:247`, `help.ts:140` | `path-ops/clip.ts:13`       | pure TS (attaches clipPath to scene) |
| group (compound)         | `globals.ts:248`, `help.ts:141` | `structural/group.ts`       | pure TS                              |
| join (connect endpoints) | `globals.ts:249`, `help.ts:142` | `path-ops/basic-ops.ts:175` | pure TS                              |

### Path-geometry ops

| op                    | chainable          | engine node                     | backend                       |
| --------------------- | ------------------ | ------------------------------- | ----------------------------- |
| roundCorners          | `chainable.ts:84`  | `path-ops/round-corners.ts`     | pure TS                       |
| chamfer               | `chainable.ts:88`  | `path-ops/chamfer.ts`           | pure TS                       |
| smooth                | `chainable.ts:92`  | `path-ops/smooth.ts`            | pure TS                       |
| offset                | `chainable.ts:96`  | `path-ops/offset.ts:12`         | Clipper (mock-stubbed in CLI) |
| simplify (RDP + geom) | `chainable.ts:105` | `path-ops/simplify.ts:91`       | RDP pure-TS + WASM geom       |
| trim                  | `chainable.ts:109` | `path-ops/trim-path.ts:20`      | pure TS                       |
| reverse               | `chainable.ts:105` | `path-ops/basic-ops.ts:75`      | **BROKEN in CLI** — see GAP-4 |
| close / open          | `chainable.ts:109` | `path-ops/basic-ops.ts:136`     | **BROKEN in CLI** — see GAP-4 |
| dash                  | `chainable.ts:121` | `path-ops/dash-path.ts`         | WASM (mock-stubbed in CLI)    |
| strokeToPath          | `chainable.ts:125` | `path-ops/stroke-to-path.ts:12` | WASM (mock-stubbed in CLI)    |
| subdivide             | `chainable.ts:159` | `path-ops/subdivide.ts`         | pure TS                       |
| addPoint              | `chainable.ts:163` | `path-ops/add-point.ts`         | pure TS                       |
| removePoint           | `chainable.ts:167` | `path-ops/remove-point.ts`      | pure TS                       |
| convertPoint          | `chainable.ts:171` | `path-ops/convert-point.ts`     | pure TS                       |
| enforceWinding        | `chainable.ts:175` | `path-ops/enforce-winding.ts`   | pure TS                       |
| variableStroke        | `chainable.ts:151` | `stroke/variable-stroke.ts`     | pure TS                       |

Deformations (`roughen/zigzag/puckerBloat/twist/warp/envelopeDistort`,
`chainable.ts:131-157`) are out of the boolean/path-op scope of this audit (they're
distortion effects, not Path-menu ops), but exist.

### Algorithm present, NOT reachable from the CLI

- **Visvalingam-Whyatt decimation** — `decimateVW` is implemented, tested, and exported
  (`packages/vector-engine/src/path/decimate.ts`, exported at
  `vector-engine/src/index.ts:118`), but **no node and no chainable** use it. Only
  `decimateRDP` is wired into `.simplify()` (`path-ops/simplify.ts:127`). VW is
  engine-only — present as code, not reachable from the CLI.
- **Break apart / split** — `splitPathNode` is registered in `register-all.ts` and
  `breakApartPaths` is exported (`path-ops/basic-ops.ts:218`), but **no chainable method
  and no global** expose either. Engine-only, same class as VW above (an unwired node).

## Gap table vs Figma + Inkscape

Legend: ✓ present · ◐ partial (engine-only or stubbed) · ✗ missing.
Figma/Inkscape columns are **per docs**, not a live run.

| op                                                   | in vecli?                        | Figma                     | Inkscape                              | notes                                                                                                                                                                                                                                |
| ---------------------------------------------------- | -------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Union                                                | ✓ `boolean.ts:13`                | ✓                         | ✓                                     | mock-stubbed in CLI (GAP-1)                                                                                                                                                                                                          |
| Subtract / Difference                                | ✓ `boolean.ts:14`                | ✓                         | ✓                                     | mock-stubbed in CLI                                                                                                                                                                                                                  |
| Intersect                                            | ✓ `boolean.ts:15`                | ✓                         | ✓                                     | mock-stubbed in CLI                                                                                                                                                                                                                  |
| Exclude / XOR                                        | ✓ `boolean.ts:16`                | ✓                         | ✓                                     | mock-stubbed in CLI                                                                                                                                                                                                                  |
| **Division** (cut A into pieces by B's edges)        | ✗                                | —                         | ✓ Path > Division                     | Inkscape-specific; one-into-many split. Genuine gap → GAP-2                                                                                                                                                                          |
| **Cut Path** (slice A's stroke at B, no fill change) | ✗                                | —                         | ✓ Path > Cut Path                     | Inkscape-specific. Related to Division → GAP-2                                                                                                                                                                                       |
| Clip / mask                                          | ✓ `clip.ts:13`                   | ✓ (Use as Mask)           | ✓ Object > Clip                       | vecli attaches clipPath to scene, doesn't flatten                                                                                                                                                                                    |
| Flatten selection (apply booleans → single vector)   | ◐                                | ✓ Flatten                 | ✓ (Combine)                           | **naming collision**: vecli's `flatten` (`canvaskit-pathops.ts`) = curve→polyline (maxError), NOT Figma's layer-flatten. `group`/`union` cover the merge intent partially                                                            |
| Outline / Stroke to Path                             | ◐ `stroke-to-path.ts:12`         | ✓ Outline Stroke          | ✓ Stroke to Path                      | cap+join params on the node (`stroke-to-path.ts:24-40`); geometry mock-stubbed in CLI                                                                                                                                                |
| Offset (inflate/deflate)                             | ◐ `offset.ts:12`                 | — (no first-class offset) | ✓ Inset/Outset, Dynamic/Linked Offset | mock-stubbed in CLI; **join type not selectable** (GAP-3)                                                                                                                                                                            |
| Round corners                                        | ✓ `round-corners.ts`             | ✓ (corner radius)         | ✓ (LPE Corners)                       | pure TS, real                                                                                                                                                                                                                        |
| Chamfer                                              | ✓ `chamfer.ts`                   | partial                   | ✓ (LPE Corners)                       | pure TS, real                                                                                                                                                                                                                        |
| Smooth                                               | ✓ `smooth.ts`                    | —                         | ✓ (smooth nodes)                      | pure TS, real                                                                                                                                                                                                                        |
| Simplify (point reduction)                           | ✓ `simplify.ts:91` (RDP)         | —                         | ✓ Path > Simplify (Ctrl+L)            | RDP real; VW present but unwired (◐ for VW)                                                                                                                                                                                          |
| Trim path                                            | ✓ `trim-path.ts:20`              | —                         | partial (no direct menu)              | After-Effects-style, pure TS                                                                                                                                                                                                         |
| Reverse direction                                    | ✓ `basic-ops.ts:74`              | —                         | ✓ Path > Reverse                      | pure TS                                                                                                                                                                                                                              |
| Break apart / split                                  | ◐ engine-only                    | ✓                         | ✓ Path > Break Apart                  | `splitPathNode` is registered in the engine and `breakApartPaths` (`basic-ops.ts:218`) is an exported utility, but **neither `chainable.ts` nor `globals.ts` exposes it** — not reachable from the CLI. See point 4 / GAP candidate. |
| Combine / Join                                       | ✓ `basic-ops.ts:175`             | ✓                         | ✓ Path > Combine                      | endpoint join, pure TS                                                                                                                                                                                                               |
| Dash                                                 | ✓ `dash-path.ts`                 | (stroke prop)             | ✓ (stroke dashes)                     | mock-stubbed in CLI                                                                                                                                                                                                                  |
| Subdivide / Insert node                              | ✓ `subdivide.ts`, `add-point.ts` | partial                   | ✓ Insert nodes                        | pure TS, real                                                                                                                                                                                                                        |
| Delete node                                          | ✓ `remove-point.ts`              | ✓                         | ✓ Delete node                         | pure TS, real                                                                                                                                                                                                                        |
| Convert node type (corner/smooth/sym)                | ✓ `convert-point.ts`             | ✓                         | ✓ node-type toolbar                   | pure TS, real                                                                                                                                                                                                                        |
| Enforce winding                                      | ✓ `enforce-winding.ts`           | —                         | partial                               | pure TS, real                                                                                                                                                                                                                        |
| Variable / pressure stroke                           | ✓ `variable-stroke.ts`           | partial                   | ✓ (Power Stroke LPE)                  | pure TS, real                                                                                                                                                                                                                        |
| **Interpolate / blend between two paths**            | ✗                                | ✓ (plugins)               | ✓ Extensions > Interpolate            | genuine gap; named only, not ticketed                                                                                                                                                                                                |
| **Pattern Along Path** (skeleton LPE)                | ✗                                | —                         | ✓ LPE Pattern Along Path              | genuine gap; named only, not ticketed                                                                                                                                                                                                |
| Bend / Spiro / Roughen LPE                           | ◐                                | —                         | ✓ several LPEs                        | `warp`/`roughen`/`zigzag` deformations cover much of this (`chainable.ts:122-140`)                                                                                                                                                   |
| Linked / dynamic (live, re-editable) offset          | ✗                                | —                         | ✓ Linked Offset                       | vecli's graph is already re-evaluable, so the offset _node_ is effectively live; no separate "linked" concept needed                                                                                                                 |

### Offset join type — concrete partial (GAP-3)

`clipper-offset.ts` fully supports an `OffsetJoinType` of `miter | round | square`
(type def `clipper-offset.ts:16`; threaded through the `offsetPath` signature
`clipper-offset.ts:239` and the `OffsetPathOps` wrapper `clipper-offset.ts:282-315`).
**But** the join type is fixed at backend-construction time
(`OffsetPathOps` constructor default `'miter'`, `clipper-offset.ts:287`) and the
`PathOpsBackend.offset(path, distance)` interface (`vector-wasm/src/types.ts:22`) carries
**no join argument**. The `offset` node (`offset.ts`) and the chainable `offset(distance)`
(`chainable.ts:96`) likewise expose only `distance`. So a CLI user cannot pick round vs
square offset corners — Inkscape's Inset/Outset and Figma's Outline Stroke both let you.
The geometry is already written; only the plumbing is missing.

## Findings summary — what is genuinely missing

vecli's boolean/path-op set is **broad and largely complete** vs both tools. The four
boolean ops, clip, group, join, offset, stroke-to-path, dash, round/chamfer/smooth, trim,
reverse, close, the full node-edit suite (add/remove/convert/subdivide), enforce-winding,
variable-stroke, and now RDP simplify are all present and file-grounded. (Break-apart and
Visvalingam-Whyatt exist in the engine but aren't yet exposed to the CLI — see point 4.)
The gaps are narrow and specific:

1. **GAP-1 (correctness, highest value)** — the CLI runs every WASM-backed op
   (boolean/offset/dash/strokeToPath/geometric-simplify) through `MockPathOps`, so they
   are no-ops/concat in the shipped CLI. The real CanvasKit/Clipper backends exist but
   aren't wired into `context.ts:50`. This is bigger than any single missing op: the
   inventory _looks_ complete but half of it is geometrically inert at the CLI. **Ticket.**
2. **GAP-2** — no **Division / Cut Path** (Inkscape one-into-many boolean split). The
   existing booleans all return a single combined path; nothing slices A into multiple
   regions along B's edges. Strongest genuinely-missing boolean op. **Ticket.**
3. **GAP-3** — **offset join type not selectable** (miter hardcoded; round/square exist in
   Clipper but aren't plumbed through the interface/node/chainable). Small, high-value,
   geometry already written. **Ticket.**
4. **GAP-4 (correctness bug, filed)** — `.reverse()` and `.close()` are **broken in the
   CLI**: `chainable.ts:105/109` emit node types `reversePath` / `closeOpen`, but the
   registry registers `reverse-path` (`basic-ops.ts:75`) and `close-open-path`
   (`basic-ops.ts:136`), so `GraphExecutor` hits "Unknown node type". Trivial fix (align
   the names) — filed as **HYP-512**.

5. **Engine-only ops not exposed to the CLI** — two ops exist as engine code but no
   `chainable.ts`/`globals.ts` surface reaches them: **Visvalingam-Whyatt** (`decimateVW`,
   implemented+tested+exported, only RDP is wired) and **Break apart / split**
   (`splitPathNode` registered + `breakApartPaths` exported, never exposed). Both are
   pure plumbing of already-landed code. **Named, not ticketed** — fold the VW wire-up
   into VECLI-3's follow-up and add break-apart to the same CLI-surface cleanup, rather
   than filing fresh tickets (no-busywork).
6. **Named-only gaps (NOT ticketed — no busywork)**: Interpolate/blend between paths,
   Pattern-Along-Path skeleton LPE, and the Figma "Flatten Selection" semantic (distinct
   from vecli's curve-flatten — naming collision, see table). These are real Inkscape/Figma
   features vecli lacks, but they are lower-value for a headless icon/infographic CLI and
   filing them would re-create the ~20-ticket sprawl the parent epic explicitly avoids.
   Revisit only if a concrete use case appears.

### Already covered by the parent decomposition — do NOT re-file

- `.simplify()` exposure + tolerance (VECLI-2) — **already landed on main**
  (`chainable.ts:105`, `simplify.ts`, `canvaskit-pathops.ts` simplify comment).
- RDP / Visvalingam-Whyatt decimation algorithms (VECLI-3) — **already landed on main**
  (`path/decimate.ts`). VW _exposure_ is the only loose end (point 4 above).
- Schneider curve-fit — already present (`curve/fit.ts`), out of scope per the epic.

## Recommended follow-up tickets

Per the no-busywork discipline, only the high-value, concrete gaps below warrant tickets
(GAP-1/2/3 here plus GAP-4, the reverse/close mismatch, already filed as HYP-512). The
named-only gaps above stay in this doc.

- **GAP-1** — Wire the real WASM PathOps backend (CanvasKit + Clipper) into the CLI's
  `createDefaultRegistry()` call so boolean/offset/dash/strokeToPath/simplify are real,
  not mock no-ops. **Not pure plumbing**: `CanvasKitPathOps` requires
  `await initCanvasKit()` (async WASM load — `canvaskit-pathops.ts:18-20`,
  `canvaskit-pathops.test.ts:21`), but `createContext()` (`context.ts`) is synchronous.
  So the mock may be a deliberate sync stopgap, not an oversight; the ticket has to make
  context creation async (or add a lazy/async backend-init path), not just swap one
  argument. Acceptance: `union(rect, circle).area()` differs from
  `rect.area() + circle.area()`; `circle(50).offset(10).bounds()` grows.
- **GAP-2** — Add **Division** (and the related **Cut Path**) boolean: split one path into
  multiple regions along a second path's edges. Acceptance: dividing a rect by a line
  yields two closed sub-paths whose union equals the original.
- **GAP-3** — Plumb **offset join type** (`miter | round | square`) through
  `PathOpsBackend.offset` → `offset` node → chainable `offset(distance, join?)`. The
  Clipper implementation already supports it (`clipper-offset.ts:239`); this is interface
  - node + chainable plumbing only. Acceptance: `offset(10, "round")` rounds outer
    corners vs the miter default.

> These are NOT yet filed as Linear tickets — they are named candidates pending CTO
> sign-off (GAP-1 touches shared WASM-backend wiring; GAP-3 changes the shared
> `PathOpsBackend` signature — both need the shared-code sign-off called out in the parent
> spec's Risks section). File on approval.

## Out of scope

- Implementing any of the gaps (this is an audit; no engine code changed here).
- Re-auditing deformation effects (roughen/zigzag/twist/warp) — not Path-menu boolean ops.
- The decomposition spec's other rows (MCP, TUI, raster/tracing, resvg, visual tests).
