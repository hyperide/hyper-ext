# AI Edge-Case Decision Memory — RAG-Based Reuse (IDEA, not a design)

**Date:** 2026-07-04
**Recorded by:** Alex Ultra (tg#6324) — "запиши идею на будущее, не реализовывать сейчас"
**Status:** IDEA / FUTURE DIRECTION. **Not ratified, not designed, not scheduled.** No architecture
decision has been made; this note exists so the idea isn't lost before a real design pass happens.
**Scope:** Cross-cutting — any in-product AI feature that resolves an edge case during
generation/editing. Not owned by any single subsystem (see "Why this file" below).
**Related:**

- `docs/specs/2026-04-01-self-improving-templates-research.md` — closest existing analog. Already
  researches CBR / Ripple-Down Rules / semantic caching for a "self-improving decision template"
  system, currently scoped to DS Core, AI Test Runner, Component Stage, and Mock Server. This idea
  is the same retrieve-reuse-revise-retain shape applied to a different set of features (below).
- `docs/specs/2026-06-12-styles-system-master-spec.md` §10.4 item 6 (route-evidence logging —
  "the audit trail and the **future fine-tune corpus**") — the style-write engine already logs
  every AI resolution decision. This idea would extend that log into retrievable, reusable memory
  instead of a write-only audit trail.
- `vscode-extension/hypercanvas-preview/src/services/WrapperGenerator.ts` (HYP-880) — a concrete,
  currently-shipping example of an in-product AI edge-case handler with no decision memory today.

## Why this file, not an existing master spec

The idea spans at least two independent product features — style-write AI-assisted resolution
(owned by the styles system master spec, which is explicitly scoped to "the HyperIDE styles
subsystem") and WrapperGenerator / preview-wrapper scaffolding (owned by the preview/VS Code
extension surface, not the styles system at all). Neither existing master spec is scoped to cover
the other, and forcing this into the styles master spec's ratified OD-register / discrepancy-ledger
structure would misrepresent it as a styles-specific, in-flight decision, which it isn't. A short
pointer to this file has been added at the styles master spec's most relevant anchor (§10.4 item 6)
so it's discoverable from there without polluting its ratification process.

## Motivation

Several in-product AI features exist purely to resolve one-off edge cases at generation/edit time:

- **WrapperGenerator (HYP-880).** When no committed `.hyperide/preview.tsx` exists, AI is asked to
  generate a `PreviewWrapper` that wires up the detected provider stack (routers, theme providers,
  state providers) for an unfamiliar or non-standard project setup. On failure it falls back to a
  static provider-scaffold template, then to a minimal pass-through.
- **Style-write AI-assisted resolution** (styles-system-master-spec §10). AI ranks a candidate
  write target — e.g. retargeting a write onto a non-forwarding component, or choosing between a
  `className` / `cva` variant / CSS-variable channel — when the deterministic resolver alone can't
  pick one.
- Presumably others as the product grows: the general pattern is "AI as a last-resort edge-case
  solver" wherever a deterministic path runs out.

Today each of these AI calls is a one-shot decision: generated, applied (or rejected), then
forgotten. If the _same project_ hits a structurally similar edge case again — a sibling component
with the same non-standard provider shape, another instance of the same non-forwarding wrapper
pattern — the system pays for a fresh AI generation call every time, with no guarantee of
consistency between the two invocations (a non-deterministic model call can pick a different, but
equally "valid," provider order or write target on the second pass).

That's expensive (latency + tokens on every edge case, even repeated ones) and inconsistent
(near-identical inputs can yield different outputs across calls).

## The idea

Persist each AI edge-case decision in a **per-project** decision store: the pair (task context →
accepted resolution), keyed so a future structurally-similar case can be retrieved and reused via
RAG (retrieval-augmented generation) instead of generating from scratch.

Sketch of the loop (illustrative, not a spec):

1. AI resolves an edge case as it does today, and the resolution is applied — and, where the
   feature already has one (e.g. VTSWR's post-write probe), verified.
2. On successful, verified application, the (context, decision) pair is written to a per-project
   store.
3. Next time a structurally similar edge case is hit, the resolver searches the store first. A hit
   above some similarity/confidence bar short-circuits the AI generation call: the stored decision
   is replayed — still through the same deterministic edit-builders and verification gates a fresh
   AI proposal would go through. Memory replaces the _generation_ step, not the safety rails.
4. A miss falls through to a fresh AI call, whose accepted result is written back to the store.

This is the same shape already surveyed in `2026-04-01-self-improving-templates-research.md`
(Case-Based Reasoning's retrieve → reuse → revise → retain cycle, and Ripple-Down Rules'
incremental case-anchored rule accumulation), just aimed at generation/edit-time edge cases instead
of design-system validation templates. It's also a natural extension of the route-evidence log the
styles master spec already keeps for exactly this reason (§10.4 item 6 calls it "the future
fine-tune corpus").

## Open questions (deliberately unanswered)

This is an idea, not a design — these are flagged honestly as open, not pre-decided:

- **Storage engine.** A vector DB (embeddings over code/context, similarity search — e.g.
  sqlite-vec, pgvector) vs. a simpler structural/keyword store (plain SQLite or JSON keyed by a
  structural fingerprint: framework signature, component shape, error type)? A vector approach
  handles fuzzier "similar but not identical" contexts; a structural approach is cheaper, more
  predictable, and easier to invalidate — but may miss real near-duplicates that don't share exact
  structural keys. Which failure mode matters more in practice is unknown.
- **Where it lives.** Per-project and local (e.g. `.hyperide/decisions.db` — committed or
  gitignored?) vs. in HyperIDE's own cloud backend keyed by project ID? Local keeps it fully
  offline and user-inspectable; cloud-side allows cross-session/cross-machine reuse and potential,
  consent-gated cross-project learning — but raises whether project code/context ever leaves the
  user's machine, a real privacy/trust question not examined here.
- **"Context" representation for similarity.** Embedding of surrounding code? Structural features
  (detected framework/provider stack, AST shape of the target, error signature)? Some hybrid? This
  is the crux of retrieval quality — the self-improving-templates research already flags "bad
  retrieval = bad decisions" as the central lesson from the CBR literature, and it applies here
  unchanged.
- **Staleness / wrong-reuse prevention.** How would the system avoid confidently replaying a
  decision that was only correct because of code that has since changed, or that the user actually
  rejected/undid? Worth considering later, not designed: tying a stored decision to a content-hash
  of the context it was learned from (the style-write engine already has a precedent for this kind
  of precondition — §10.4 item 2's per-file content-hash / per-AST-node fingerprint check before a
  write); treating user overrides/undos as a negative signal; expiring or demoting rarely-reused or
  low-confidence entries.
- **What gets stored.** Only AI-authored resolutions the system accepted as-is, or also AI
  proposals a human corrected — arguably the more valuable signal, per Ripple-Down Rules'
  "cornerstone case" lesson (a correction anchored to the specific case that provoked it). Not
  decided.
- **Verification-gating on replay.** Should a decision replayed from memory skip re-verification
  (VTSWR probe, type-check) because "it worked before," or must every replay go through the full
  verify/rollback pipeline unconditionally — safer, but it erases most of the latency win memory
  was supposed to buy? Leans toward "never skip verification," consistent with the styles master
  spec's existing doctrine that "AI gets no verification discount" (§10.4 item 4) — but this is a
  lean, not a decision.

## Non-goals (for this note)

This document does not propose a schema, a storage choice, an API, or a rollout plan, and it does
not commit any of the features named above to adopting it. It exists so the idea survives until a
real design pass — including the open questions above — actually happens.
