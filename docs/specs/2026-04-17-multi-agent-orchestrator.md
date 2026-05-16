# Multi-Agent Collaboration Protocol v2

**Date:** 2026-04-17
**Status:** Draft
**Scope:** Autonomous turn-based collaboration between LLM agents on shared spec
documents, with structured findings, convergence detection, and minimal observer
involvement.

## 1. Goal

Replace the ad-hoc observer-as-message-bus pattern used during style-write
unification with a machine-driven orchestrator that reads a structured findings
ledger, decides whose turn it is, invokes agents headless, detects convergence,
and escalates only when agents disagree or get stuck. The observer should receive
notifications, not relay messages.

## 2. Roles

```text
Elaboration agent (Claude):
  Deepens spec, fixes findings assigned to it, proposes designs,
  verifies fixes made by other agents.

Review agent (Codex):
  Adversarial review. Finds contradictions, missing cases,
  type-level bugs, stale decisions. Raises findings.

Observer (human):
  Adjudicates disputes, makes product decisions, receives
  convergence and escalation notifications. Does not relay
  messages between agents.

Orchestrator (script/daemon):
  Reads structured ledger, decides whose turn it is, invokes
  agents headless, detects convergence, notifies observer.
  Has no opinion on spec content.
```

## 3. Structured Ledger

Two files per collaboration, co-located with the spec being worked on.

### 3.1 Workprocess file (prose)

Existing `*-workprocess.md` pattern. Each turn is a heading block:

```text
## 📍 Review Session 2026-04-17 14:30 CEST author: claude

<prose description of what was done, what was found, what changed>
```

Rules:

```text
- Append-only. Agents never delete or rewrite another agent's turn.
- Each turn must include: what findings were addressed, what new
  findings were raised, what validation commands were actually run.
- The Agent Status Board at the top is updated by each agent at
  the start and end of its turn.
```

### 3.2 Findings file (machine-readable)

New `*-findings.yaml` alongside the workprocess file.

Schema:

```text
findings:
  - id: F-001
    title: string
    severity: P1 | P2 | P3
    status: open | closed | dispute | wontfix | deferred
    raised_by: claude | codex | observer
    raised_at: ISO 8601 with timezone
    fix_owner: claude | codex | observer
    fixed_at: ISO 8601 (set when status -> closed)
    verified_by: claude | codex | observer (set after verification pass)
    verified_at: ISO 8601
    notes: multiline string (optional)
    related_findings: list of F-NNN ids (optional)
    spec_file: relative path to affected spec
    spec_lines: line range hint (optional, may drift after edits)
```

Example entry:

```text
findings:
  - id: F-004
    title: PlainCssFilePlan missing discriminated union tag
    severity: P1
    status: closed
    raised_by: codex
    raised_at: 2026-04-15T15:09:00+02:00
    fix_owner: claude
    fixed_at: 2026-04-16T14:54:00+02:00
    verified_by: codex
    verified_at: 2026-04-16T16:22:00+02:00
    notes: |
      Claude added `kind: 'plain-css-file'` to the union.
      Codex verified discriminant is present in all plan kinds.
    spec_file: docs/specs/2026-04-14-style-write-unification-plan.md
    spec_lines: 420-435
```

Rules:

```text
- Agents MUST NOT delete or rewrite findings entries.
- Only these fields may be updated on existing entries:
    status, fixed_at, verified_by, verified_at, notes
- New findings are always appended at the end.
- ID is sequential: next ID = max existing ID + 1.
- `dispute` status means the fix_owner disagrees with the finding.
  Disputes block convergence and trigger observer notification.
```

## 4. Orchestrator Protocol

### 4.1 Cycle

```text
 1. Read findings.yaml
 2. Count open findings per fix_owner
 3. If any finding has status = dispute -> notify observer, pause cycle
 4. If open findings exist for claude -> invoke claude headless
 5. Else if open findings exist for codex -> invoke codex headless
 6. Else -> invoke codex for a review pass on the latest claude turn
 7. After invocation: re-read findings.yaml
 8. Diff findings against pre-invocation snapshot
 9. If changes detected -> reset quiet counter to 0
10. If no changes -> increment quiet counter
11. If quiet counter >= ORCHESTRATOR_MAX_QUIET -> convergence
12. If stuck detection triggered (see 4.5) -> notify observer, pause
13. Sleep ORCHESTRATOR_SLEEP seconds, repeat from step 1
```

### 4.2 Agent invocation templates

Claude invocation:

```text
claude -p "You are the elaboration agent in a multi-agent spec collaboration.

Read these files:
  $ORCHESTRATOR_WORKPROCESS
  $ORCHESTRATOR_FINDINGS

Your role: address all findings where fix_owner = claude and status = open.
For each finding:
  1. Apply the fix in the spec file referenced by spec_file
  2. Update findings.yaml: set status = closed, fixed_at = now
  3. If you disagree with the finding, set status = dispute with notes

After addressing owned findings, you may raise new findings against codex
if you notice issues introduced by its previous review.

Append a 📍 turn to the workprocess file documenting what you did.
Update the Agent Status Board.

Do not claim done if you have unresolved P1 findings owned by you."
```

Codex invocation (fix mode, when it has open findings):

```text
codex exec "You are the review agent in a multi-agent spec collaboration.

Read these files:
  $ORCHESTRATOR_WORKPROCESS
  $ORCHESTRATOR_FINDINGS

Your role: address all findings where fix_owner = codex and status = open.
Apply fixes, set status = closed, fixed_at = now.
If you disagree, set status = dispute with notes.

Append a 📍 turn to the workprocess file."
```

Codex invocation (review mode, when no open findings exist):

```text
codex exec "You are the adversarial review agent.

Read these files:
  $ORCHESTRATOR_WORKPROCESS
  $ORCHESTRATOR_FINDINGS

Review the spec for: contradictions, missing cases, type-level bugs,
stale decisions, ambiguous semantics, untestable claims.

For each issue found, append a new finding to findings.yaml with:
  id: next sequential F-NNN
  severity: P1 (blocks correctness) | P2 (significant gap) | P3 (polish)
  fix_owner: claude (unless it is a review-side issue)
  status: open

If you find no issues, append a 📍 turn stating the spec passed review
with no new findings. This counts as a quiet cycle.

Append a 📍 turn to the workprocess file."
```

### 4.3 Convergence criterion

```text
Convergence = ORCHESTRATOR_MAX_QUIET consecutive cycles with:
  - no new findings added
  - no status changes on existing findings
  - no open findings remaining

Default: 3 consecutive quiet cycles.

On convergence:
  1. Orchestrator generates a summary:
       total findings raised, closed, disputed, wontfixed, deferred
       total cycles, total agent invocations
  2. Appends summary to workprocess file as a 📍 Convergence turn
  3. Notifies observer via Telegram
```

### 4.4 Dispute resolution

When an agent sets a finding's status to `dispute`:

```text
1. Orchestrator pauses the cycle immediately (does not invoke
   the next agent).
2. Sends dispute details to observer via Telegram:
     finding ID, title, severity, raised_by, fix_owner,
     dispute notes from both sides.
3. Observer resolves by one of:
     a. Updating findings.yaml directly (change status, fix_owner,
        add notes, set wontfix/deferred)
     b. Instructing an agent to apply the resolution
4. Orchestrator detects the dispute is resolved (status != dispute)
   and resumes the cycle.
```

### 4.5 Per-finding stuck detection

```text
If the same finding has been through the sequence:
  open -> closed -> open (reopened by verifier)
more than ORCHESTRATOR_MAX_REOPEN times (default 3):

1. Orchestrator marks the finding as stuck in its internal state
2. Notifies observer with the full reopen history
3. Pauses the cycle for observer intervention

This prevents infinite fix/review loops where one agent closes
a finding and the other immediately reopens it.
```

## 5. Orchestrator Implementation

### 5.1 Shell script pseudocode

```text
#!/usr/bin/env bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────
SLEEP="${ORCHESTRATOR_SLEEP:-60}"
MAX_QUIET="${ORCHESTRATOR_MAX_QUIET:-3}"
MAX_REOPEN="${ORCHESTRATOR_MAX_REOPEN:-3}"
WORKPROCESS="${ORCHESTRATOR_WORKPROCESS}"
FINDINGS="${ORCHESTRATOR_FINDINGS}"

source ~/xp/hypercalendarbot/.env   # BOT_TOKEN, BOT_ADMIN_ID

# ── Helpers ─────────────────────────────────────────────────

count_open() {
  local owner="$1"
  yq '.findings[] | select(.status == "open" and .fix_owner == "'$owner'")' \
    "$FINDINGS" | grep -c '^  id:' || echo 0
}

has_disputes() {
  yq '.findings[] | select(.status == "dispute")' "$FINDINGS" \
    | grep -c '^  id:' || echo 0
}

snapshot_findings() {
  sha256sum "$FINDINGS" | awk '{print $1}'
}

reopen_count() {
  local fid="$1"
  # Count how many times status went open->closed->open in git history
  git log --all -p -- "$FINDINGS" \
    | grep -c "status: open" \
    | head -1 || echo 0
  # Real implementation: parse git diff hunks for the specific finding ID
  # and count open->closed transitions. Simplified here.
}

notify_observer() {
  local message="$1"
  curl -s -X POST \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d chat_id="${BOT_ADMIN_ID}" \
    -d text="${message}" \
    -d parse_mode="Markdown" > /dev/null
}

invoke_claude() {
  local prompt="$1"
  claude -p "$prompt"
}

invoke_codex() {
  local prompt="$1"
  codex exec "$prompt"
}

# ── Main loop ───────────────────────────────────────────────

quiet=0

while true; do
  echo "[orchestrator] cycle start at $(date -Iseconds)"

  pre_hash=$(snapshot_findings)

  # Step 1: Check disputes
  disputes=$(has_disputes)
  if [ "$disputes" -gt 0 ]; then
    notify_observer "⚠️ Dispute detected in findings. Cycle paused."
    echo "[orchestrator] dispute found, pausing"
    # Wait for observer to resolve
    while [ "$(has_disputes)" -gt 0 ]; do
      sleep "$SLEEP"
    done
    quiet=0
    continue
  fi

  # Step 2: Check stuck findings
  for fid in $(yq -r '.findings[].id' "$FINDINGS"); do
    reopens=$(reopen_count "$fid")
    if [ "$reopens" -ge "$MAX_REOPEN" ]; then
      notify_observer "🔁 Finding $fid stuck ($reopens reopens). Paused."
      echo "[orchestrator] $fid stuck, pausing"
      sleep "$SLEEP"
      continue 2
    fi
  done

  # Step 3: Decide who to invoke
  claude_open=$(count_open "claude")
  codex_open=$(count_open "codex")

  if [ "$claude_open" -gt 0 ]; then
    echo "[orchestrator] invoking claude ($claude_open open findings)"
    invoke_claude "<elaboration prompt with $WORKPROCESS and $FINDINGS>"
  elif [ "$codex_open" -gt 0 ]; then
    echo "[orchestrator] invoking codex fix mode ($codex_open open findings)"
    invoke_codex "<fix prompt with $WORKPROCESS and $FINDINGS>"
  else
    echo "[orchestrator] invoking codex review mode"
    invoke_codex "<review prompt with $WORKPROCESS and $FINDINGS>"
  fi

  # Step 4: Check for changes
  post_hash=$(snapshot_findings)
  if [ "$pre_hash" = "$post_hash" ]; then
    quiet=$((quiet + 1))
    echo "[orchestrator] quiet cycle $quiet/$MAX_QUIET"
  else
    quiet=0
    echo "[orchestrator] changes detected, reset quiet counter"
  fi

  # Step 5: Convergence
  if [ "$quiet" -ge "$MAX_QUIET" ]; then
    total=$(yq '.findings | length' "$FINDINGS")
    closed=$(yq '[.findings[] | select(.status == "closed")] | length' "$FINDINGS")
    notify_observer "✅ Converged after $total findings ($closed closed). Review complete."
    echo "[orchestrator] converged"
    break
  fi

  sleep "$SLEEP"
done
```

### 5.2 Environment

```text
ORCHESTRATOR_SLEEP=60            # seconds between cycles
ORCHESTRATOR_MAX_QUIET=3         # quiet cycles before convergence
ORCHESTRATOR_MAX_REOPEN=3        # max reopens before stuck escalation
ORCHESTRATOR_WORKPROCESS=docs/specs/YYYY-MM-DD-*-workprocess.md
ORCHESTRATOR_FINDINGS=docs/specs/YYYY-MM-DD-*-findings.yaml
BOT_TOKEN from ~/xp/hypercalendarbot/.env
BOT_ADMIN_ID from ~/xp/hypercalendarbot/.env
```

Note: `ORCHESTRATOR_WORKPROCESS` and `ORCHESTRATOR_FINDINGS` must resolve to
exactly one file each. The orchestrator should fail fast if the glob matches
zero or multiple files.

## 6. Agent Behavioral Rules

Rules that both agents must follow when invoked by the orchestrator. These are
injected into the agent prompt and enforced by review.

```text
1. Read the workprocess file Agent Status Board and latest 📍 turns
   before doing anything. Context from the other agent's last turn
   is mandatory input.

2. Read findings.yaml. Only address findings where fix_owner matches
   your role. Do not touch findings owned by the other agent.

3. Mark a finding closed ONLY after:
     a. Applying the fix in the spec file
     b. Verifying the fix is consistent with surrounding text
     c. Setting fixed_at to current timestamp
   Closing without fixing is a protocol violation.

4. When raising new findings, always include:
     severity (P1/P2/P3)
     spec_file (relative path)
     concrete expected correction (not just "this is wrong")
   Vague findings waste cycles.

5. When disagreeing with a finding, set status = dispute and write
   notes explaining WHY. Do not silently ignore or close-as-wontfix
   findings raised by the other agent. Only the observer may wontfix.

6. Never delete or rewrite another agent's 📍 turn in the workprocess
   file. You may reference and respond to it, never modify it.

7. Every 📍 turn must include what validation commands were actually
   run (grep, yq, search, type-check). "I reviewed it" is not
   validation.

8. Do not claim done with unresolved P1 findings owned by you.
   The orchestrator checks this and will re-invoke you.

9. Do not modify the orchestrator protocol, findings schema, or
   behavioral rules from within a spec turn. Meta-changes require
   observer approval.

10. Keep findings.yaml parseable. If you break YAML syntax, the
    orchestrator cannot read the file and the cycle halts.
```

## 7. Observer Interface

How the observer (human) interacts with the system:

```text
Receives Telegram notifications for:
  - disputes (finding ID, title, both sides' arguments)
  - convergence (summary statistics)
  - stuck findings (reopen history)
  - YAML parse errors (orchestrator cannot proceed)

Can add findings manually:
  Append to findings.yaml with raised_by = observer.
  Observer findings are authoritative and cannot be disputed.

Can change fix_owner:
  Redirect work from one agent to another by editing findings.yaml.

Can set wontfix or deferred:
  Only the observer may wontfix. Agents may request it in notes
  but must not set it themselves.

Can invoke orchestrator manually:
  Run the script with MAX_QUIET=1 for a single-cycle one-shot.

Can pause orchestrator:
  Kill the process. State is in findings.yaml, not in memory.
  Restarting the script resumes from current ledger state.

Does NOT need to:
  - relay messages between agents
  - decide whose turn it is
  - read every 📍 turn (only disputes and convergence)
```

## 8. Postmortem: Style-Write Unification Collaboration

What went wrong in v1 and how this protocol addresses it:

```text
Problem                              v2 Solution
─────────────────────────────────    ──────────────────────────────────
Codex ran as polling daemon          Orchestrator invokes agents on
(10-min blind interval)              demand based on findings state

No invocation channel between        Agents do not invoke each other.
agents                               Orchestrator reads ledger and
                                     decides.

No convergence criterion             3 quiet cycles = converged.
                                     Explicit metric, not vibes.

No disagreement protocol             dispute status + observer
                                     escalation + mandatory notes.

Observer forced to act as            Observer receives notifications.
message bus                          Intervenes only for disputes
                                     and product decisions.

Findings tracked in prose            Machine-readable findings.yaml
                                     with status lifecycle.

No stuck detection                   Reopen counter per finding
                                     with automatic escalation.
```

## 9. Limitations and Future Work

```text
Token cost:
  Each agent invocation re-reads the full workprocess and findings
  context. For large specs this is 50-100k tokens per cycle.
  Mitigation: prompt caching (Claude supports this), diff-only
  context windows, or summary-based context for older turns.

Turn-based only:
  No real-time discussion between agents. An agent cannot ask a
  clarifying question and get an immediate answer. It must raise
  a finding and wait for the next cycle.

Sequential invocation:
  Only one agent runs at a time. Parallel invocation on the same
  file risks merge conflicts in both the spec and findings.yaml.

Single spec scope:
  The orchestrator manages one spec collaboration at a time.
  Running multiple orchestrator instances for different specs
  is possible but not coordinated.

Agent capability assumptions:
  - Claude must support -p (piped prompt) for headless invocation
  - Codex must support exec subcommand
  - Both must be able to read and write files in the repo
  - Both must produce parseable YAML when editing findings

Future directions:
  - 3+ agents (e.g., security reviewer, performance reviewer)
  - Prompt caching to reduce per-cycle token cost
  - Diff-only context: feed agents only changed sections
  - Structured agent memory across invocations
  - Parallel agent invocation with file-level locking
  - Web UI for observer instead of Telegram-only
  - Automatic severity inference from finding patterns
  - Integration with Linear for finding-to-ticket pipeline
```
