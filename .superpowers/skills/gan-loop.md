---
name: gan-loop
description: Use when starting an autonomous work session that needs a recurring harsh critic to prevent circular debugging, stalling, and false completion claims. Invoke at session start with an optional task description.
user-invocable: true
---

# GAN Loop — Autonomous Critic

## Overview

A GAN-style discriminator loop for autonomous work sessions. Sets up a recurring critic
(every 2-3 minutes) that audits concrete progress, demands evidence, and calls out stalling.

**Core principle:** The critic exists because you WILL lie to yourself about progress.
Optimism bias is your default mode. The critic corrects for it.

## When to Use

- Starting a long autonomous work session (30+ min)
- Debugging sessions where circular fixes are likely
- Any task where "it should work now" keeps not working
- Sessions where the user is away and can't provide feedback

## Setup

When this skill is invoked:

1. Note the task description from `$ARGUMENTS` (or from conversation context if none provided)
2. Record the start time and initial state (git status, running processes, open issues)
3. Use the `loop` skill to set up a recurring critic every 3 minutes:

```
/loop 3m /gan-loop-critic
```

If the `loop` skill is unavailable, set up the critic manually:
- After each significant action (commit, test run, build, screenshot), run the critic checklist below
- At minimum, run the critic after every 2-3 tool calls that don't produce a concrete artifact

## The Critic Prompt

Every critic cycle, evaluate the session against ALL of these. No partial checks.

### 1. Concrete Progress Audit

```
What was DONE since last check?
- Files changed (git diff --stat)
- Tests added/fixed (count)
- Screenshots taken (count, paths)
- Commits made (count, messages)

ZERO artifacts = you are stalling. Stop planning. Do something.
```

### 2. Visual Verification Demand

```
UI/CSS/layout was touched?
  -> WHERE is the screenshot? No screenshot = not verified = not done.
  -> Compare BEFORE and AFTER. "It looks right" without evidence is a lie.

Extension code was touched?
  -> Was /ext run? Was VS Code reloaded?
  -> WHERE is the screenshot from the actual extension?

No UI touched? Skip this. Don't fake busywork screenshots.
```

### 3. Circular Debugging Detector

```
Check the last 5-10 tool calls. Pattern match:
- Same file edited 3+ times without a passing test between edits
- Same error message appearing after "fix"
- Reverting a change you just made
- Adding console.log to code you already console.logged

If ANY match: "ты ходишь по кругу. Остановись."
  -> State what you know FOR CERTAIN
  -> State what you're GUESSING
  -> Pick ONE hypothesis, write ONE test, run it
  -> If it fails, your hypothesis was wrong. Pick another.
  -> Do NOT add a second fix on top of the first.
```

### 4. Infrastructure Health Check

```
Is the dev server running? (check process, check port)
Is the tunnel alive? (if applicable)
Did the bundle hash change after your last edit? (stale build = wasted debugging)
Are tests actually running against your changes? (not cached, not skipped)
Did the last build succeed? (check terminal output, not memory)
```

### 5. Bug Velocity Tracker

```
Session start: N known bugs
Current: M known bugs
Fixed since last check: F
Introduced since last check: I

Net velocity = F - I

Velocity <= 0 for 2+ checks = you are making things worse.
  -> Stop. git stash. Re-read the original issue.
  -> Start from the last known-good state.
```

### 6. Banned Excuses

The following are NOT acceptable answers to "what have you done?":

| Excuse | Response |
|--------|----------|
| "Waiting for user" | You have tools. Use them. Run tests, take screenshots, check logs. |
| "Pre-existing issue" | If it blocks your task, fix it or document it with a Linear ticket. NOW. |
| "Investigating" | Investigation without artifacts is daydreaming. Write a hypothesis. Test it. |
| "Planning next steps" | Plans without commits are fiction. Do the smallest possible thing. |
| "Reading code" | What did you learn? State it. If you can't, you weren't reading — you were scrolling. |
| "Almost done" | "Almost" is not a unit of measurement. What SPECIFICALLY remains? List it. |
| "It works locally" | Prove it. Screenshot. Test output. Curl response. Evidence or it didn't happen. |
| "Need to refactor first" | No. Make it work, then make it right. Refactoring before green tests is procrastination. |

## Critic Output Format

Each critic cycle produces a short, brutal summary:

```
--- GAN CRITIC [HH:MM] ---
Time elapsed: Xm | Checks: N

DONE: [list concrete artifacts or "NOTHING"]
BLOCKED: [specific blocker or "NOT BLOCKED"]
VELOCITY: +F/-I (net: V)
PATTERN: [ok | circular | stalling | regressing]

VERDICT: [PROGRESSING | WARNING | FAILING]
[If WARNING/FAILING: one specific instruction, not advice]
--------------------------
```

## Severity Escalation

- **Check 1-2**: Informational. Report status.
- **Check 3-4**: If velocity <= 0, demand course correction with specific action.
- **Check 5+**: If still no progress, mandate: stop current approach, `git stash`, restart from last green commit.
- **Check 8+**: If still stuck, output: "This approach is not working. State what you've tried and what failed. Ask the user for help."

## Arguments

- `$ARGUMENTS` — optional task description. Used in critic output to measure progress against the goal.
  Example: `/gan-loop Fix the inspector panel toggle animation (HYP-357)`

## Red Flags — Immediate Critic Trigger

Don't wait for the next cycle if you see:

- `git checkout -- .` or `git stash` without a clear reason
- Editing the test to make it pass (instead of fixing the code)
- Disabling a lint rule or type check
- Adding `any` or `as unknown as` to silence an error
- Removing a test that was passing before your changes
- "Let me try a completely different approach" (third time)

**All of these mean: STOP. Run the critic NOW. Something is wrong.**

## The Bottom Line

You are not here to feel productive. You are here to ship artifacts.
The critic doesn't care about your intentions, your understanding, or your plans.
It cares about diffs, screenshots, and green tests. Everything else is noise.
