# vecli Path-Operations Gap Audit (VECLI-4)

> **SUPERSEDED IN PART (2026-06-11 reconciliation, HYP-469).** Several findings here
> are stale: GAP-1 (CLI ran ops through MockPathOps) is FIXED — `src/backend.ts` +
> `bin/vecli.ts` boot the real CanvasKit/Clipper backend and throw on WASM failure (no
> silent mock). GAP-4 (reverse/close node-name mismatch) is FIXED (HYP-512, chainable.ts
> emits `reverse-path`/`close-open-path`). Visvalingam-Whyatt is now wired and exposed
> (`.simplify(1, {method:'vw'})`). The still-open gaps — Division/Break-Apart/Combine/Cut-Path,
> offset join-type, and splitPath wiring — share one root cause and are blocked on the
> multi-output DSL decision (HYP-532). See HYP-469 for the live status.


Audit of `packages/vector-cli` + `packages/vector-engine` path/boolean/shape ops
against Figma's vector/boolean tooling and Inkscape's Path menu + LPE set.
Gates VECLI-3 and any new boolean/path-op tickets: new work must target a named
gap here, not re-implement an op that already exists (DSL or engine-only).

**TL;DR** — The op set is already rich. There are **no large boolean gaps**. The
two genuinely-missing-but-cheap booleans are **Division** and **Cut Path**. The two
cheap-wiring wins are surfacing **`splitPath`** and **`meshFromPath`** in the DSL.
Everything else is either present, redundant with an existing op, or out of scope
for a CLI.

---

## 1. Method & sources

Files read (all paths relative to repo root):

- `packages/vector-cli/src/globals.ts` — user-facing DSL: generators, multi-node ops
  (`union`/`subtract`/`intersect`/`xor`/`clip`/`group`/`join`), canvas/history/DAG/IO.
- `packages/vector-cli/src/chainable.ts` — chainable per-node ops (the authoritative
  DSL list of path effects).
- `packages/vector-cli/src/helpers.ts` — word-art / convenience shapes (no path ops).
- `packages/vector-engine/src/nodes/register-all.ts` — authoritative registry of the
  **53** built-in node types (`createDefaultRegistry`).
- Node impls cross-checked: `path-ops/boolean.ts`, `path-ops/clip.ts`,
  `path-ops/split-path.ts`, `structural/alpha-mask.ts`, `structural/group.ts`,
  `mesh/mesh-from-path-node.ts`.
- `packages/vector-wasm/src/types.ts` — `PathOpsBackend` contract; `BooleanOp` =
  `'union' | 'subtract' | 'intersect' | 'xor'`. Backend also exposes `simplify`,
  `flatten` (curve→polyline tessellation), `strokeToPath`, `dash`, `offset`,
  `removeSelfIntersections`.

**Reference op sets** — from working knowledge of the apps; NOT re-fetched.
Confidence: **high** for the Inkscape Path menu (6 boolean-family ops + Combine/Break
Apart/Inset/Outset/Offset/Simplify/Reverse) and Figma boolean+Flatten+Outline-Stroke;
**medium** for the exact roster of Inkscape Live Path Effects (LPE is large and version-
dependent). Where confidence is medium it is flagged in the matrix.

**Caveats / traps avoided** (each verified against source, not assumed):

- Engine `flatten` (backend tessellation `flatten(path, maxError)`) is **not** Figma
  "Flatten" (merge selection into one region). Treated as separate rows.
- `splitPath` divides at one arc-length offset (`split-path.ts` flattens then walks to
  the split point) — it is **not** Inkscape Break Apart (decompose a compound path into
  its subpaths). Different op.
- `join` concatenates two paths into one command stream — it is **not** Inkscape Combine
  (build an even-odd _compound_ path). Marked partial.
- `types.ts` `'difference' | 'exclusion'` are **blend modes**, not booleans — ignored.

---

## 2. Current vecli op inventory

Surface legend: **DSL** = callable in CLI expressions; **engine-only** = registered in
`register-all.ts` but no DSL binding; **both** = DSL method backed by a registered node.
Backend legend: **pure** = pure TS on svgPath commands; **PathOps** = needs the injected
`PathOpsBackend` (CanvasKit/Clipper WASM); **none** = pure routing/structural.

### Generators (all `both`, pure)

`rect`, `ellipse`/`circle`, `polygon`, `star`, `line`, `arc`, `spiral`, `arrow`, `path`
(svgPath), `text` (textToPath), `mesh` (gradientMesh). — `globals.ts:22-61`.

### Boolean / multi-node ops

| Op                | Surface         | Backend        | Source                                   |
| ----------------- | --------------- | -------------- | ---------------------------------------- |
| `union`           | both            | PathOps        | `globals.ts:74`, `path-ops/boolean.ts`   |
| `subtract`        | both            | PathOps        | `globals.ts:77`, `path-ops/boolean.ts`   |
| `intersect`       | both            | PathOps        | `globals.ts:80`, `path-ops/boolean.ts`   |
| `xor` (Exclusion) | both            | PathOps        | `globals.ts:83`, `path-ops/boolean.ts`   |
| `clip`            | both            | none (routing) | `globals.ts:86`, `path-ops/clip.ts`      |
| `group`           | both            | none           | `globals.ts:92`, `structural/group.ts`   |
| `join`            | both            | pure           | `globals.ts:99`, `path-ops/basic-ops.ts` |
| `alphaMask`       | **engine-only** | none           | `structural/alpha-mask.ts`               |

### Chainable path effects (`chainable.ts`)

| Op                | Surface | Backend        | Source                                                |
| ----------------- | ------- | -------------- | ----------------------------------------------------- |
| `roundCorners`    | both    | pure           | `chainable.ts:84`, `round-corners.ts`                 |
| `chamfer`         | both    | pure           | `chainable.ts:88`, `chamfer.ts`                       |
| `smooth`          | both    | pure           | `chainable.ts:92`, `smooth.ts`                        |
| `offset`          | both    | PathOps        | `chainable.ts:96`, `offset.ts` (Clipper)              |
| `simplify`        | both    | PathOps (+RDP) | `chainable.ts:105`, `simplify.ts`                     |
| `trim`            | both    | pure           | `chainable.ts:109`, `trim-path.ts`                    |
| `reverse`         | both    | pure           | `chainable.ts:113`, `basic-ops.ts`                    |
| `close`           | both    | pure           | `chainable.ts:117`, `basic-ops.ts`                    |
| `dash`            | both    | PathOps        | `chainable.ts:121`, `dash-path.ts`                    |
| `strokeToPath`    | both    | PathOps        | `chainable.ts:125`, `stroke-to-path.ts`               |
| `roughen`         | both    | pure           | `chainable.ts:131`, `deformation/roughen.ts`          |
| `zigzag`          | both    | pure           | `chainable.ts:135`, `deformation/zigzag.ts`           |
| `puckerBloat`     | both    | pure           | `chainable.ts:139`, `deformation/pucker-bloat.ts`     |
| `twist`           | both    | pure           | `chainable.ts:143`, `deformation/twist.ts`            |
| `warp`            | both    | pure           | `chainable.ts:147`, `deformation/warp.ts`             |
| `variableStroke`  | both    | pure           | `chainable.ts:151`, `stroke/variable-stroke.ts`       |
| `envelopeDistort` | both    | pure           | `chainable.ts:155`, `deformation/envelope-distort.ts` |
| `subdivide`       | both    | pure           | `chainable.ts:159`, `subdivide.ts`                    |
| `addPoint`        | both    | pure           | `chainable.ts:163`, `add-point.ts`                    |
| `removePoint`     | both    | pure           | `chainable.ts:167`, `remove-point.ts`                 |
| `convertPoint`    | both    | pure           | `chainable.ts:171`, `convert-point.ts`                |
| `enforceWinding`  | both    | pure           | `chainable.ts:175`, `enforce-winding.ts`              |

### Style / transform (`both`, pure)

`fill`, `stroke`, `opacity`, `blend`, `shadow`, `blur`; `translate`, `rotate`, `scale`,
`skew` — `chainable.ts:40-80`.

### Registered but not surfaced in the DSL (engine-only)

| Node           | Source                        | Note                                                                                                                          |
| -------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `splitPath`    | `path-ops/split-path.ts`      | Divide path at normalized arc-length offset. **Cheap wiring win.**                                                            |
| `meshFromPath` | `mesh/mesh-from-path-node.ts` | Build a gradient mesh from a path. **Cheap wiring win.**                                                                      |
| `alphaMask`    | `structural/alpha-mask.ts`    | Routes content+mask → clipPath. **Redundant** — a strict subset of `clip` (which also forwards style/transform). Do NOT wire. |

### Backend capability present but no node at all

| Capability                      | Source                    | Note                                                                                                                            |
| ------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `flatten(path, maxError)`       | `vector-wasm/types.ts:14` | Curve→polyline tessellation. No engine node, no DSL. Candidate `.flatten()` chainable — small wiring, but low demand for a CLI. |
| `removeSelfIntersections(path)` | `vector-wasm/types.ts:23` | Used internally by `simplify`; no standalone node. Niche; skip.                                                                 |

---

## 3. Gap matrix (Figma + Inkscape → vecli)

Status: **exists** / **partial** / **missing**. Build-cost for missing:
trivial-wiring / small / large.

### Booleans

| Ref op                  | In vecli?   | Build cost | Redundant?                                            | Priority | Rationale                                                                                                          |
| ----------------------- | ----------- | ---------- | ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Union (Figma/Inkscape)  | exists      | —          | —                                                     | —        | `union`                                                                                                            |
| Subtract / Difference   | exists      | —          | —                                                     | —        | `subtract`                                                                                                         |
| Intersection            | exists      | —          | —                                                     | —        | `intersect`                                                                                                        |
| Exclusion / Exclude     | exists      | —          | —                                                     | —        | `xor`                                                                                                              |
| **Division** (Inkscape) | **missing** | small      | partial — compose `intersect`+`subtract`, two outputs | **P1**   | Only true boolean gap with real demand: cut lower object into pieces by upper. Backend already has the primitives. |
| **Cut Path** (Inkscape) | **missing** | small      | no                                                    | **P2**   | Splits the lower path's _stroke_ at intersections, drops fill. Useful but narrower than Division; pure-svgPath.    |
| **Flatten** (Figma)     | **partial** | trivial    | yes — `union` of a group flattens to one region       | **P3**   | Approximated by `union`/`group`+`union`. Document the recipe; not a separate op. NOT engine `flatten`.             |

### Path-menu structural ops

| Ref op                      | In vecli?                  | Build cost | Redundant?                                           | Priority | Rationale                                                                                                                               |
| --------------------------- | -------------------------- | ---------- | ---------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Combine** (Inkscape)      | **partial**                | small      | partial — `join` concatenates, not even-odd compound | **P2**   | `join` merges command streams; Combine needs even-odd compound semantics for proper holes. Real gap for donut shapes. Confidence: high. |
| **Break Apart** (Inkscape)  | **missing**                | small      | no — `splitPath` is arc-length split, different op   | **P1**   | Decompose a compound path into separate subpaths. Pure-svgPath (walk `M` commands). Natural inverse of Combine; high utility.           |
| Inset / Outset              | exists                     | —          | —                                                    | —        | `offset` (negative/positive distance)                                                                                                   |
| **Dynamic / Linked Offset** | **exists (architectural)** | —          | yes — DAG re-executes `offset` on param change       | —        | The graph already gives live-editable offset. NOT a gap; do not build.                                                                  |
| Simplify                    | exists                     | —          | —                                                    | —        | `simplify` (tolerance)                                                                                                                  |
| Reverse                     | exists                     | —          | —                                                    | —        | `reverse`                                                                                                                               |
| Trace Bitmap                | out of scope               | —          | —                                                    | —        | Raster; covered by VECLI-9/10, not this audit.                                                                                          |

### Point / network editing

| Ref op                                   | In vecli?   | Build cost | Redundant?                                | Priority      | Rationale                                                                                                       |
| ---------------------------------------- | ----------- | ---------- | ----------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| Add / Remove / Convert node              | exists      | —          | —                                         | —             | `addPoint`/`removePoint`/`convertPoint`                                                                         |
| Split at point                           | exists      | —          | —                                         | —             | `splitPath` (once wired)                                                                                        |
| Outline Stroke (Figma)                   | exists      | —          | —                                         | —             | `strokeToPath`                                                                                                  |
| Bend / mirror handles (Figma)            | partial     | —          | partial — `convertPoint` symmetric/smooth | P3            | Handle-level interactive editing; CLI can set point types but not drag handles. Adequate for a CLI.             |
| **Vector networks** (Figma non-manifold) | **missing** | large      | no                                        | **P3 / skip** | Non-manifold topology is a deep model change; no demand for a deterministic CLI. Explicitly not worth building. |

### Live Path Effects (Inkscape LPE) — confidence: medium

| Ref LPE                        | In vecli? | Note / priority                                                     |
| ------------------------------ | --------- | ------------------------------------------------------------------- |
| Power Stroke                   | exists    | `variableStroke` — P-none                                           |
| Bend / Envelope                | exists    | `warp` + `envelopeDistort` — P-none                                 |
| Roughen                        | exists    | `roughen` — P-none                                                  |
| Zigzag / Wave                  | exists    | `zigzag` — P-none                                                   |
| Pucker/Bloat                   | exists    | `puckerBloat` — P-none                                              |
| Twist                          | exists    | `twist` — P-none                                                    |
| Corners (fillet/chamfer)       | exists    | `roundCorners` + `chamfer` — P-none                                 |
| Dashed Stroke                  | exists    | `dash` — P-none                                                     |
| Pattern Along Path             | missing   | large; tiling-along-path. **P3 / skip** for CLI — niche, big build. |
| Gears / Spiro / specialty LPEs | missing   | P3 / skip — long tail, no demand.                                   |

---

## 4. Recommendations

### File these tickets (highest value)

1. **Division boolean** (P1, small). The only true boolean gap with real demand.
   Compose existing `intersect`+`subtract` to emit the two regions; add a `divide(a,b)`
   DSL binding. Backend primitives already exist — no new WASM.
   New node `path-ops/divide.ts` + `globals.ts` binding.

2. **Break Apart** (P1, small, pure-svgPath). Decompose a compound path into its
   subpaths by walking `M` commands. Natural inverse of a future Combine; high utility
   for editing imported SVGs. New node `path-ops/break-apart.ts` + DSL `breakApart()`.

3. **Wire engine-only `splitPath` + `meshFromPath` into the DSL** (P1, trivial-wiring).
   Both are registered and tested in the engine; they just lack a `chainable.ts` method
   (`.split(offset)`) and a `globals.ts` generator (`meshFromPath(...)`). Pure plumbing,
   no engine work. Two cheap wins in one ticket.

Secondary, if capacity allows:

4. **Combine** (P2, small) — even-odd compound-path semantics, distinct from `join`.
   Needed for correct donut/hole shapes. Pairs naturally with Break Apart.
5. **Cut Path** (P2, small) — stroke-split at intersections. Lower demand than Division.

### Explicitly NOT worth building (do not re-implement)

- **`alphaMask` DSL wiring** — redundant. `clip()` is already exposed and strictly
  richer (forwards style + transform too). Skip; consider deleting `alphaMask` only
  after confirming no graph consumer depends on it (out of scope for this audit).
- **Dynamic / Linked Offset** — already provided by the DAG re-executing `offset` on
  param change. The "live" behavior is architectural, not a missing op.
- **Figma Flatten as a new op** — `union` (optionally over a `group`) already flattens a
  selection into one region. Document the recipe; do not add a node.
- **Vector networks / non-manifold editing** — large model change, no CLI demand. Skip.
- **Pattern Along Path & specialty LPEs** — long-tail, big build, niche for a CLI. Skip.
- **Standalone `flatten` / `removeSelfIntersections` nodes** — backend capability exists
  but demand is near-zero for a deterministic CLI; leave as internal primitives.

---

### Acceptance checklist (every Figma/Inkscape boolean/path op marked)

- Union ✅ exists · Difference ✅ exists · Intersection ✅ exists · Exclusion ✅ exists
- Division ❌ missing (P1) · Cut Path ❌ missing (P2) · Flatten 🔶 partial (recipe)
- Combine 🔶 partial (P2) · Break Apart ❌ missing (P1)
- Inset/Outset ✅ exists · Dynamic/Linked Offset ✅ exists (architectural) · Simplify ✅ · Reverse ✅
- Outline Stroke ✅ exists · Add/Remove/Convert node ✅ exists · Split ✅ exists (engine-only, wire)
- Vector networks ❌ missing (skip) · Pattern Along Path / specialty LPEs ❌ (skip)
- Trace Bitmap — out of scope (VECLI-9/10)

---

## 5. Reviewer addendum — the "cheap-wiring" wins are NOT cheap (blocking finding)

Inspecting the two engine-only nodes against the actual DSL plumbing model
(`packages/vector-cli/src/chainable.ts:32-36`) overturns §2/§4's "trivial-wiring"
classification. The `ChainableNode` chain is **single-node, single-`path`-port**:

```ts
private chain(type, params) {
  const newId = this.ctx.graph.addNode({ type, params });
  this.ctx.graph.addEdge(this.nodeId, 'path', newId, 'path'); // source port 'path' → target 'path'
  return new ChainableNode(this.ctx, newId);                  // wraps ONE nodeId
}
```

…and `executePath()` resolves a node's output by `item.id === this.nodeId` — there is
no port selector.

Neither engine-only node fits that shape:

| Node           | Ports                                                                   | Why it doesn't wire trivially                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `splitPath`    | in `path`; **out `pathA` + `pathB`** (`split-path.ts:26-29`)            | Two path outputs. A `.split(offset)` would have to return _two_ `ChainableNode`s reading distinct output ports, but `chain()` always emits/reads port `'path'` and `executePath()` keys on `nodeId` alone — it cannot distinguish `pathA` from `pathB`.   |
| `meshFromPath` | in `path`; **out `mesh`** (type `mesh`, `mesh-from-path-node.ts:15-16`) | Output is not a `path`. It can sit at the _end_ of a chain (path→mesh) and render, but any further `.fill()`/path-op would emit `addEdge(meshNodeId,'path',…)` against a port that doesn't exist. Needs terminal-only handling the model doesn't express. |

**This is the same wall behind the §4 build tickets.** Division (two regions),
Break Apart (N subpaths), Combine, Cut Path — every recommended op is **multi-output
or non-`path`-output**. The real gap is not any individual op; it is that the
`ChainableNode` DSL has **no way to expose multi-output / typed-output nodes**. The
engine already supports them (the registry nodes exist and are tested); the CLI
surface is the bottleneck.

**Corrected priority order:**

1. **DSL design decision FIRST** (shared-code change to `chainable.ts`, needs sign-off
   per `~/.claude/CLAUDE.md`): how does a chain expose a multi-output node? Options —
   (a) terminal ops returning a tuple/object of `ChainableNode`s bound to named output
   ports; (b) a `.port(name)` selector on `ChainableNode`; (c) keep single-output and
   model multi-output ops as group-producing nodes. This unblocks ALL of §4.
2. Only then implement Division / Break Apart / the splitPath+meshFromPath wiring on
   top of the chosen model. Filed as HYP-527 (Division), HYP-528 (Break Apart),
   HYP-529 (Combine), HYP-530 (Cut Path), HYP-531 (wire engine nodes) — all now
   **blocked on (1)**.

Net: the audit's headline ("op set is rich; main value is what NOT to build") stands.
But the "two cheap wins" do not exist until the multi-output DSL question is answered.
Building any of them blind would either hack the chain model or silently no-op.
