# Periodic test & review cadence

Heavyweight checks that are NOT run on every PR but must happen on a regular cadence.
This file is the source of truth for "when did we last run X". Update the `Last run` date
(and link the run/report) every time one of these is performed.

Agents: at the start of a session, or before picking up non-urgent work, check this table.
If any item is **overdue** (today − last-run > cadence) and there is no urgent task in flight,
proactively remind the user (via `tg`) and offer to run it. Do not let these silently lapse.

| Check | Cadence | Last run | Next due | Run report / link |
|-------|---------|----------|----------|-------------------|
| Penetration test (auth / OAuth AS / proxy / file-access boundaries) | Quarterly | 2026-06-11 | 2026-09-11 | [2026-06-11 run](#2026-06-11-penetration-test) |
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

## Run reports

### 2026-06-11 penetration test

Read-only adversarial review of `main` (HEAD `fc7c1de3`) across **4 surfaces**: auth-session,
oauth-as, proxy-ssrf, file-access / input-injection. **10 substantiated findings** (3 P1, 7 P2).

**UNGATED and exploitable today:** the two proxy-data-plane P1s plus the session-cookie P1. The
`/ide/*` and `/project-preview/*` routes are top-level Bun routes outside Hono, so `authMiddleware` /
`checkProjectAccess` never run — a known `projectId` yields cross-tenant code-server (RCE + terminal)
and cross-tenant source read with no auth at all.

Findings filed as Linear tickets:

- **HYP-669** (P1) — unauthenticated `/ide/*` + `/project-preview/*` proxy → cross-tenant code-server RCE & source read (no `checkProjectAccess`).
- **HYP-670** (P1) — session cookies (`access_token`/`refresh_token`) forwarded verbatim to untrusted project/IDE containers → account takeover.
- **HYP-671** (P2) — AST "data" routes emit raw JS expressions / JSX identifiers → code injection (`text`/`propName`/`newType`/`componentType`).
- **HYP-672** (P2) — `codeEditorSaved` scopes writes to global `getActiveProject()` instead of the authenticated user's `checkedProject`.
- **HYP-673** (P2) — refresh-token rotation without old-token revocation; stolen token replayable for full 7-day TTL, no reuse detection.
- **HYP-674** (P2) — cross-provider account linking trusts unverified email (Google `email_verified` ignored) → account takeover.
- **HYP-675** (P2, **gated** — blocks the `MCP_OAUTH_ENABLED` flip) — MCP refresh tokens are unrevocable stateless JWTs (30d, no denylist, no rotation reuse-detection). Parent HYP-262; related HYP-666.
- **HYP-676** (P2) — `getTamaguiTokens` runs AI-generated script + project `tamagui.config` with `node` on the HyperIDE host (sandbox bypass / malicious-project RCE).

Deduped / not re-filed:

- Three file-mutating routes (`insertElement`, `editMap`, `editCondition`) still bypass project-root
  validation post-#255 → **commented on HYP-279** (the existing umbrella ticket) with the residual,
  rather than duplicating.
- MCP-token revocation gate → **commented on HYP-666** (registration-access-token TOCTOU) cross-linking
  HYP-675 (the distinct refresh-token-lifecycle mechanism).
- Skipped (already landed): the #346 open-redirector/CSRF fix and the #594 SaaS-tracer fix.
