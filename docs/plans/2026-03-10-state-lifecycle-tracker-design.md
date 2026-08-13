# `/state` — Lifecycle Progress Tracker

## Summary

Compact ASCII progress bar that tracks the current development lifecycle state.
Shows all phases, sub-steps, commits with their review status, and parallel agents.
Integrates into `/what` as the top section. Auto-displays via hook on `AskUserQuestion`.

## Problem

Two lifecycle paths exist (`/task` and superpowers), each with nested sub-steps
(`/commit` has TDD/codex/hygiene, `/pr` has review/security-review/CI, SDD has
implement/spec-review/quality-review). No persistent tracking of which steps are
done — context is lost between messages and sessions.

## Architecture

```text
Skills/Commands ──▸ state.sh ──▸ .claude/state.json ──▸ render-state.py ──▸ terminal
(/task /commit /pr    (CLI)        (gitignored)          (ASCII output)
 superpowers)

Hook: PostToolUse(AskUserQuestion) → render-state.py → auto-show
```

### Components

| File                              | Purpose                       |
| --------------------------------- | ----------------------------- |
| `.claude/state.json`              | Persistent state (gitignored) |
| `.claude/scripts/state.sh`        | CLI for writing state         |
| `.claude/scripts/render-state.py` | ASCII renderer                |
| `.claude/commands/state.md`       | `/state` skill definition     |
| `.claude/commands/what.md`        | Updated to include `/state`   |
| `.claude/settings.local.json`     | AskUserQuestion hook          |
| `.gitignore`                      | Add `.claude/state.json`      |

## State File Schema

### `/task` lifecycle

```json
{
  "lifecycle": "task",
  "ticket": "HYP-283",
  "description": "generic mcp styling tools",
  "branch": "HYP-283-generic-mcp-styling-tools",
  "started_at": "2026-03-10T10:00:00Z",

  "phases": {
    "linear": "done",
    "plan": "done",
    "worktree": "done",
    "impl": "active",
    "pr": "pending",
    "cleanup": "pending"
  },

  "commits": [
    {
      "hash": "a1b2c3f",
      "message": "feat: add color picker (HYP-283)",
      "steps": {
        "tdd": "done",
        "codex": "done",
        "hygiene": "done",
        "stage": "done",
        "commit": "done"
      }
    },
    {
      "hash": null,
      "message": "refactor: extract color utils",
      "steps": {
        "tdd": "done",
        "codex": "active",
        "hygiene": "pending",
        "stage": "pending",
        "commit": "pending"
      }
    }
  ],

  "pr": {
    "steps": {
      "assess": "pending",
      "prep": "pending",
      "create": "pending",
      "review": "pending",
      "security_review": "pending",
      "ci": "pending",
      "pre_merge": "pending",
      "merge": "pending",
      "cleanup": "pending"
    }
  }
}
```

### Superpowers lifecycle

```json
{
  "lifecycle": "superpowers",
  "ticket": null,
  "description": "companion UX",
  "branch": "worktree-companion-ux",
  "started_at": "2026-03-10T10:00:00Z",

  "phases": {
    "brainstorm": "done",
    "plan": "done",
    "sdd": "active",
    "finish": "pending",
    "cleanup": "pending"
  },

  "tasks": [
    {
      "name": "Hook installation script",
      "status": "done",
      "steps": {
        "implement": "done",
        "spec_review": "done",
        "quality_review": "done"
      },
      "retries": {}
    },
    {
      "name": "CLI integration",
      "status": "active",
      "steps": {
        "implement": "done",
        "spec_review": "active",
        "quality_review": "pending"
      },
      "retries": { "spec_review": 2 },
      "agents": [
        { "name": "parse config", "status": "done" },
        { "name": "validate input", "status": "active" }
      ]
    },
    {
      "name": "Documentation",
      "status": "pending",
      "steps": {
        "implement": "pending",
        "spec_review": "pending",
        "quality_review": "pending"
      }
    }
  ],

  "final_review": "pending",

  "finish": {
    "steps": {
      "verify_tests": "pending",
      "present_options": "pending",
      "execute": "pending",
      "cleanup": "pending"
    }
  }
}
```

### Field semantics

- `lifecycle`: `"task"` or `"superpowers"` — determines rendering mode
- `ticket`: `"HYP-XXX"` or `null`
- `description`: free text or `null`
- `branch`: auto-detected from git
- Status values: `"done"`, `"active"`, `"pending"`, `"skipped"`
- `retries`: `{ "step_name": count }` — shown as annotation (e.g. `spec ×2`)
- `agents`: parallel subagents within a task (optional array)

### Auto-promotion

When a step is marked `done`, `state.sh` auto-promotes the next `pending` step
in the same ordered list to `active`. This eliminates explicit `active` calls:

```bash
state.sh commit-step tdd done
# state.sh internally: tdd → done, codex → active (was pending)
```

Order is defined per step group:

- commit steps: `tdd → codex → hygiene → stage → commit`
- pr steps: `assess → prep → create → review → security_review → ci → pre_merge → merge → cleanup`
- sdd task steps: `implement → spec_review → quality_review`
- finish steps: `verify_tests → present_options → execute → cleanup`

`skipped` is treated same as `done` for auto-promotion purposes.
If all remaining steps are `done`/`skipped`, no promotion happens.

### Phase mapping (`/task` → state phases)

| /task Phase                  | State phase | Notes                                                |
| ---------------------------- | ----------- | ---------------------------------------------------- |
| Phase 0: Task Identification | `linear`    | Includes input parsing, Linear lookup, status update |
| Phase 1: Planning            | `plan`      | Includes /review-plan                                |
| Phase 2: Worktree Setup      | `worktree`  |                                                      |
| Phase 3: Dev Server          | `impl`      | Folded into impl — dev server is impl infrastructure |
| Phase 4: Implementation Loop | `impl`      | Main work phase, commits tracked separately          |
| Phase 5: PR + Merge          | `pr`        | PR sub-steps tracked in `pr.steps`                   |
| Phase 6: Cleanup             | `cleanup`   |                                                      |

### Progress calculation

Progress fraction `N/M`:

- **Phases**: count of `done` + `active` / total phases
- **Commit steps**: count of `done` + `skipped` / total steps
- **PR steps**: count of `done` + `skipped` / total steps
- **SDD task steps**: count of `done` + `skipped` / total steps

`active` counts toward numerator in phases (it means "reached this phase").
`active` does NOT count toward numerator in steps (it means "in progress").
`skipped` counts as completed everywhere.

## CLI: `state.sh`

```bash
# Initialize (warns if state.json exists, use --force to overwrite)
state.sh init task HYP-283                   # ticket from arg
state.sh init task "add color picker"         # description, no ticket
state.sh init task                            # bare init
state.sh init superpowers                     # superpowers lifecycle
state.sh init superpowers "companion UX"      # with description

# Metadata
state.sh set-description "new description"    # update description after init
state.sh set-ticket HYP-283                   # set ticket after init

# Phases
state.sh phase linear done
state.sh phase impl active
state.sh phase pr active

# Commits (/task lifecycle)
state.sh commit-add "feat: add color picker"  # new commit entry, all steps pending
state.sh commit-step tdd done                 # update last commit's step (auto-promotes next)
state.sh commit-done a1b2c3f                  # set hash on last commit

# PR (/task lifecycle)
state.sh pr-step assess done                  # auto-promotes next step
state.sh pr-step review done
state.sh pr-step security_review skipped      # skipped also auto-promotes

# Tasks (superpowers lifecycle)
state.sh task-add "Hook installation script"  # new task (status=active, first step=active)
state.sh task-step implement done             # update last task's step (auto-promotes next)
state.sh task-status done                     # mark last task done
state.sh task-agent-add "parse config"        # add parallel agent
state.sh task-agent-status "parse config" done
state.sh task-retry spec_review               # increment retry counter
state.sh final-review done                    # final code review after all tasks

# Finish (superpowers lifecycle)
state.sh finish-step verify_tests done        # auto-promotes next step
state.sh finish-step present_options done

# Render
state.sh render                               # calls render-state.py internally

# Utility
state.sh exists                               # exit 0 if state.json exists
state.sh reset                                # delete state.json
state.sh check-branch                         # warn if git branch != state branch
```

Implementation: bash + `jq` for JSON manipulation.
`state.sh render` delegates to `python3 .claude/scripts/render-state.py`.

## Rendering

### Symbols

| Symbol    | Meaning                                    |
| --------- | ------------------------------------------ |
| `◆`       | done                                       |
| `◇`       | active (current step)                      |
| `○`       | pending                                    |
| `─`       | skipped                                    |
| `━`       | completed portion of progress bar          |
| `╸`       | progress bar head (boundary)               |
| `·`       | remaining portion                          |
| **bold**  | current phase in pipeline (ANSI `\033[1m`) |
| `├─` `└─` | parallel agents                            |

### `/task` renders

**Mid-implementation, two commits done, third in progress:**

```text
/task ━━━━━━━━━━━━━━━━━╸ · · · · · ·     HYP-283          4/6
      Linear → Plan → Worktree → Impl → PR → Cleanup

  a1b2c3f  feat: add color picker (HYP-283)
  /commit ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   5/5
    ◆ TDD   ◆ codex   ◆ hygiene   ◆ stage   ◆ commit

  d4e5f6a  test: edge cases (HYP-283)
  /commit ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━                   5/5
    ◆ TDD   ◆ codex   ◆ hygiene   ◆ stage   ◆ commit

  (uncommitted)  refactor: extract color utils
  /commit ━━━━━━━━━━━━━━╸ · · · · · · · ·                 2/5
    ◆ TDD   ◇ codex   ○ hygiene   ○ stage   ○ commit
```

(Active phase `Impl` rendered in **ANSI bold**.)

**PR phase active:**

```text
/task ━━━━━━━━━━━━━━━━━━━━━━━━━╸ · · ·   HYP-283          5/6
      Linear → Plan → Worktree → Impl → PR → Cleanup

  a1b2c3f  feat: add color picker (HYP-283)
  d4e5f6a  test: edge cases (HYP-283)
  g7h8i9j  refactor: extract color utils (HYP-283)

  /pr ━━━━━━━━━━━━━━━━━━╸ · · · · · · · · · · ·            3/9
      assess → prep → create → review → sec → CI → pre-merge → merge → cleanup
    ◆ /review   ○ /security-review
```

### Superpowers renders

**SDD in progress:**

```text
superpowers ━━━━━━━━━━━━━━━━━╸ · · · · · ·                3/5
            Brainstorm → Plan → SDD → Finish → Cleanup

  Task 1  Hook installation script                      done
  Task 2  Recovery modes                                done

  Task 3  CLI integration                            running
  /sdd ━━━━━━━━━━━━╸ · · · · · · · · · ·
    ◆ implement   ◇ spec-review   ○ quality-review   spec ×2
    ├─ agent A  parse config                          done
    └─ agent B  validate input                        running

  Task 4  Documentation                              pending

  ○ Final review
```

**Finishing:**

```text
superpowers ━━━━━━━━━━━━━━━━━━━━━━━╸ · ·                  4/5
            Brainstorm → Plan → SDD → Finish → Cleanup

  Task 1  Hook installation script                      done
  Task 2  Recovery modes                                done
  Task 3  CLI integration                               done
  Task 4  Documentation                                 done

  /finish ━━━━━━━━━━╸ · · · · · · · · · ·
    ◆ verify-tests   ◇ present-options   ○ execute   ○ cleanup
```

### Collapsed rules

Expansion priority (highest first):

1. Active `/pr` or `/finish` — always expanded
2. Active `/commit` (last commit with incomplete steps) — always expanded
3. Active SDD task — always expanded
4. Everything else — collapsed to single line

Completed commits → single line: `hash  message`.
Completed SDD tasks → single line: `Task N  name  done`.
If no state.json exists → render nothing (silent).

## Hook: Auto-display

Add to `.claude/settings.local.json` PostToolUse array:

```json
{
  "matcher": "AskUserQuestion",
  "hooks": [
    {
      "type": "command",
      "command": "test -f .claude/state.json && python3 .claude/scripts/render-state.py 2>/dev/null || true"
    }
  ]
}
```

Hook output goes as feedback to AI, which includes the rendered state
in the message before the question.

## Integration with existing commands

### `/state` command

New `.claude/commands/state.md`:
Runs `state.sh render`, outputs result. If no state.json — says "No active lifecycle."

### `/what` command

Update `.claude/commands/what.md`:
Step 1 additionally runs `state.sh render` if state.json exists.
The state bar appears as the first section of the dashboard, above the git/PR sections.

### `/task` command

Add `state.sh` calls at each phase transition and commit step:

| Point in /task        | state.sh call                                    |
| --------------------- | ------------------------------------------------ |
| Phase 0 start         | `init task HYP-XXX` or `init task "description"` |
| Phase 0 Linear found  | `phase linear done`                              |
| Phase 1 Plan start    | `phase plan active`                              |
| Phase 1 Plan done     | `phase plan done`                                |
| Phase 2 Worktree done | `phase worktree done && phase impl active`       |
| Each /commit step     | delegated to /commit integration                 |
| Phase 5 PR start      | `phase pr active`                                |
| Phase 6 Cleanup done  | `phase cleanup done`                             |

### `/commit` command

Add state.sh calls at each sub-step:

| Point in /commit | state.sh call                                   |
| ---------------- | ----------------------------------------------- |
| Start commit     | `commit-add "message"`                          |
| TDD done         | `commit-step tdd done`                          |
| Codex done       | `commit-step codex done`                        |
| Hygiene done     | `commit-step hygiene done`                      |
| Stage done       | `commit-step stage done`                        |
| Commit done      | `commit-step commit done && commit-done <hash>` |
| TDD skipped      | `commit-step tdd skipped`                       |
| Codex skipped    | `commit-step codex skipped`                     |

### `/pr` command

| Point in /pr             | state.sh call                     |
| ------------------------ | --------------------------------- |
| Phase 0 done             | `pr-step assess done`             |
| Phase 1 done             | `pr-step prep done`               |
| Phase 2 done             | `pr-step create done`             |
| /review done             | `pr-step review done`             |
| /security-review done    | `pr-step security_review done`    |
| /security-review skipped | `pr-step security_review skipped` |
| CI passed                | `pr-step ci done`                 |
| Phase 5 pre-merge review | `pr-step pre_merge done`          |
| Merge done               | `pr-step merge done`              |
| Cleanup done             | `pr-step cleanup done`            |

### Superpowers skills

Superpowers skills (`brainstorm`, `writing-plans`, `SDD`, `finishing-branch`) get
equivalent `state.sh` calls. Since these are external plugin skills (not editable),
the AI is instructed to call `state.sh` at appropriate moments via CLAUDE.md or
a wrapper in `.claude/commands/`.

| Point               | state.sh call                                                |
| ------------------- | ------------------------------------------------------------ |
| Brainstorm start    | `init superpowers "description"` or `init superpowers`       |
| Brainstorm done     | `phase brainstorm done`                                      |
| Plan start          | `phase plan active`                                          |
| Plan done           | `phase plan done && phase sdd active`                        |
| SDD task dispatch   | `task-add "name"`                                            |
| Implement done      | `task-step implement done`                                   |
| Spec review done    | `task-step spec_review done`                                 |
| Spec review retry   | `task-retry spec_review`                                     |
| Quality review done | `task-step quality_review done && task-status done`          |
| Parallel agent add  | `task-agent-add "name"`                                      |
| Parallel agent done | `task-agent-status "name" done`                              |
| Final review done   | `final-review done && phase sdd done && phase finish active` |
| Finish step done    | `finish-step <step> done`                                    |
| All done            | `phase cleanup done`                                         |

### Permissions

Add to `.claude/settings.local.json` allow list:

```json
"Bash(.claude/scripts/state.sh:*)"
```

### `.gitignore`

Add to `.gitignore`:

```text
.claude/state.json
```

## Edge cases

- **No state.json**: `/state` renders nothing. Hook is silent. `/what` skips the section.
- **State from previous session**: `state.sh check-branch` compares
  `state.json` branch vs `git branch --show-current`. Called by `render`
  on every invocation. If mismatch — prints warning line above the progress bar.
- **Init safety**: `state.sh init` warns and exits 1 if state.json exists.
  Use `state.sh init --force` to overwrite. Prevents accidental state loss.
- **Mixed lifecycle**: Only one lifecycle active at a time. `init --force` overwrites.
- **Skipped steps**: `"skipped"` status, rendered as `─`. Counts as completed
  for progress calculation and auto-promotion.
- **No ticket**: Header shows description only, or nothing if both null.
- **Commit without /commit flow**: bare `git commit` is not tracked.
  `/state` tracks the structured workflow only.
- **Addressing specific commit/task**: CLI always operates on the last entry.
  To modify earlier entries, use `jq` directly (rare edge case).
- **task-add semantics**: New task gets `status: "active"` and first step
  gets `active`. Previous active task is NOT auto-completed — mark it
  explicitly with `task-status done` first.
