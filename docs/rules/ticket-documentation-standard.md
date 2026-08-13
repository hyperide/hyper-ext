# Ticket / task documentation standard

Every ticket or tracked task an agent creates MUST be self-explanatory to someone with no
prior context — the CTO reads them on a phone and other agents pick them up cold. Vague
tickets get rejected. Capture the evidence **as it surfaces**: the moment you identify a
problem worth a ticket, FIRST record what is broken and HOW, before moving on to anything else.

## Required sections (in this order)

1. **What is concretely wrong** — the specific defect/gap, pinned with `file:line` or the exact
   user action that misbehaves. Not "X is suboptimal" — "X does Y when it should do Z".
2. **Evidence — capture what & how it is broken FIRST, at creation time** (never "I'll add a
   screenshot later"):
   - User-observable UI behavior → a SCREENSHOT of the broken state, taken via Playwright /
     the Docker e2e harness (NEVER `screencapture`; local `launchVSCode` is broken — use Docker).
     "Before" (the broken state) is mandatory at creation; "after" follows once fixed.
   - CI / gate failure → the failing run output or finding count (e.g. the red Semgrep scan).
   - Pure code / logic → the offending snippet (`file:line`) plus a failing repro.
   - If a proof genuinely cannot exist yet (an unbuilt feature has no "after"), say so
     explicitly and capture the CURRENT / broken behavior instead — do not skip evidence.
3. **Where this came from** — origin: the session / audit / review / brainstorm that surfaced
   it, the related ticket or PR, and the migration or decision that caused it. So no one has to
   re-derive it.
4. **What happens if we don't do it** — the concrete consequence of leaving it unfixed, and
   **how it hurts the user** specifically (not abstract "tech debt").
5. **Acceptance criteria** — a checkbox list of verifiable conditions, each provable by a test
   or an observable behavior; name the proof method (e2e spec, CI scan, unit test).
6. **Pseudocode** — when the fix shape is non-obvious, the minimal pseudocode of the change
   (the seam, the key branch, the data flow). Omit only when the change is truly trivial.

## Do not

- Do NOT ask "should I capture a screenshot / evidence?" — capture it. Do it as the work
  surfaces the problem, not as a follow-up question.
- Do NOT file a one-liner "fix X" and move on. If it is worth a ticket, it is worth the six
  sections above.
- Do NOT claim a proof exists when it does not — be explicit about what is observable now
  versus only after the fix.

This applies to Linear tickets, `TaskCreate` tasks, and any other tracked work item.
