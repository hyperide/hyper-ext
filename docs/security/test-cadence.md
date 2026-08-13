# Periodic test & review cadence

Heavyweight checks that are NOT run on every PR but must happen on a regular cadence.
This file is the source of truth for "when did we last run X". Update the `Last run` date
(and link the run/report) every time one of these is performed.

Agents: at the start of a session, or before picking up non-urgent work, check this table.
If any item is **overdue** (today − last-run > cadence) and there is no urgent task in flight,
proactively remind the user (via `tg`) and offer to run it. Do not let these silently lapse.

| Check | Cadence | Last run | Next due | Run report / link |
|-------|---------|----------|----------|-------------------|
| Penetration test (auth / OAuth AS / proxy / file-access boundaries) | Quarterly | _never recorded_ | ASAP | — |
| Performance review (preview cold-start, proxy latency, dev-server load, SaaS editor TTI) | Monthly | _never recorded_ | ASAP | — |
| Dependency security sweep (full Dependabot triage, not just criticals) | Monthly | 2026-06-11 (HYP-642 / HYP-654) | 2026-07-11 | PRs #399, #421 |
| Load / chaos test of the dev-server + proxy hot path | Quarterly | _never recorded_ | ASAP | — |
| Mutation-test audit of the security-critical modules (auth, ast write, path-security) | Quarterly | _never recorded_ | ASAP | — |

## How to run

- **Pen test**: adversarial multi-lens review of the auth/proxy/file surfaces (see the security
  rules in `AGENTS.md`), plus a live probe of the running stand. Record findings as Linear tickets.
- **Perf review**: measure the documented hot paths against a baseline; file regressions as tickets.
- **Dependency sweep**: `gh api repos/{owner}/{repo}/dependabot/alerts` full triage — fix
  patch/minor, ticket majors with a reason.
- **Load / chaos**: drive the dev-server + proxy under concurrency and kill dependencies mid-flight
  (container restart, proxy drop, DB timeout); assert graceful degradation.
- **Mutation audit**: run a mutation pass over the listed modules; a surviving mutant = a missing test.

After running any item, update its `Last run` + `Next due` row above and link the report.
