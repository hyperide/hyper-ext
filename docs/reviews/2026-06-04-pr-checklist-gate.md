# Codex Review — HYP-559 PR checklist merge gate

**Date**: 2026-06-04 Europe/Belgrade
**Branch**: HYP-pr-acceptance-gate → main
**Files reviewed**: `.github/workflows/pr-checklist-gate.yml`, `.github/scripts/checklist-gate.mjs`, `.github/scripts/checklist-gate.test.mjs`, `.github/pull_request_template.md`, `docs/rules/development.md`
**Verdict**: 1× P1 — accepted with rationale (no code change)

---

## Finding

### [P1] Gate parser runs from PR-controlled checkout — `pr-checklist-gate.yml:34-35`

Codex: the workflow imports `parseUnchecked` from the checked-out PR contents, so a
PR that edits `.github/scripts/checklist-gate.mjs` can make it return `[]` and pass
the required `PR Checklist` check while leaving `- [ ]` items in the body. For a
hard merge gate the parsing logic should come from trusted base-branch code.

## Resolution: accepted, fixed by documentation (not by inlining)

Correct and real — **under the `pull_request` trigger**. Important nuance that rules
out the obvious "fix": for `pull_request`, the workflow YAML itself also runs from
the PR's version, so inlining the regex into the workflow does **not** close the hole
— it just moves the editable code from one PR-controlled file to another and breaks
the single-source-of-truth that the self-check test relies on. Inlining = pretend-fix.

The genuinely tamper-resistant option is `pull_request_target` + default checkout
(base, trusted) + import the same module — satisfies both "trusted source" and "one
source of truth". Its cost: it does **not** run on this introducing PR (main has no
workflow yet), so it goes live only on the next PR, and it is the "dangerous trigger"
requiring that PR code is never executed.

**Decision (threat model):** this is an internal repo (CTO + agents, no fork PRs). A
PR that rewrites the gate's own parser/workflow is a visible diff caught in review,
not an anonymous attacker. So we keep `pull_request` (live green check is useful
dogfood evidence) and document the boundary honestly per development.md «Честные
границы»: the gate guards against _accidental_ unchecked boxes; edits to
`.github/scripts/checklist-gate.*` or the gate workflow get extra review scrutiny and
are not a technical guarantee. Documented in the workflow header and in
development.md. If the CTO later wants hard tamper-resistance, switch to
`pull_request_target` (gate then reads the base version, activates next PR).

---

## Addendum — 2026-06-08: superseded, switched to the secure form

The CTO chose the tamper-resistant form. The "keep `pull_request`" decision above is
**superseded**: the gate now runs on **`pull_request_target`** with the default
(base-branch) checkout, so the workflow YAML and `checklist-gate.mjs` come from
trusted `main`, not from the PR. A PR that edits the gate's own parser/workflow is
now evaluated by the base version — the P1 hole is closed technically, not only by
review discipline.

Properties of the new form:

- The job reads **only** the PR body from the event payload
  (`context.payload.pull_request.body`) and **never** checks out or executes PR code
  — the checkout uses the default ref (base), no `ref: ...head.sha`.
- `pull_request_target`'s own caveat (write-scoped token + base context) is acceptable
  here precisely because no PR code runs; `permissions: contents: read` keeps the token
  minimal.
- Cost: the gate does **not** run on this introducing PR (#377) — `main` has no
  workflow yet, and `pull_request_target` evaluates the base version. It goes live from
  the next PR after merge. So there is no "live green check" on #377 by design.
