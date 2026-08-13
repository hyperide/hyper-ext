# HyperIDE development process

**Status: mandatory.** This regulation's content was folded into repo-local, always-reachable
homes (HYP-949) and this file retired to a stub:

- The generic cycle (root-cause-first diagnosis, TDD red-first, adversarial verification,
  visual proof, pre-commit gate, no `--no-verify`) lives in the provisioned skills
  `systematic-debugging`, `tdd-red-first`, `adversarial-verification`, `visual-proof-cycle`,
  and `pre-commit-gate`.
- The HyperIDE-specific and load-bearing parts — the pre-commit `advisor()` + `review diff`
  tandem, `task new` ticket creation, worktree conventions, the E2E layout, and the
  **PR body checklist gate mechanics** (workflow, the `PR Checklist` required check, the
  `pull_request_target` tamper-resistance) — live directly in
  [`AGENTS.md`](../../AGENTS.md), sections "Git Workflow", "Coding Guidelines", and
  "PR Merge Discipline". `AGENTS.md` is checked in, so it is reachable in every environment
  regardless of skill provisioning.

Related regulation: [CTO decision requests](./cto-decision-requests.md).
