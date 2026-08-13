# Quorex — Design Spec

**Date:** 2026-05-28
**Status:** Draft

## Overview

Quorex is a fork of [ralphex](https://github.com/umputun/ralphex) that replaces its single-executor model with a multi-provider parallel execution engine and a two-pass LLM judge that synthesizes a final solution from the best parts of each provider's output.

**Core idea:** dispatch the same coding task to N providers simultaneously, evaluate results across quality categories, produce a scoring matrix, then synthesize a final solution that combines the strongest elements from each.

## What Changes vs ralphex

Ralphex supports multiple providers only via wrapper scripts (`codex-as-claude`, `copilot-as-claude`) that shim non-Claude tools into Claude's stream-json interface. This punts multi-provider complexity to the user. Quorex replaces this with:

- A named executor model (`[executor.<name>]`, roles, modes, protocols — per ralphex [#355](https://github.com/umputun/ralphex/issues/355))
- A parallel pool dispatcher (`task_executors` × `task_parallel`, goroutine per executor)
- A two-pass judge (`review_executors`, evaluate → matrix → synthesize)
- A hook system (pre + post, tests, lint, typecheck)
- A `quorex init` command (project-aware config generation)

Everything else from ralphex — plan files, review pipeline, git commits, loop mechanics — carries over unchanged.

## Architecture

```
quorex run <plan>
    │
    ├─ Plan format validation
    │   └─ on error: print detailed diagnosis + suggest "quorex plans fix"
    │
    ├─ Pre-hooks (lint, tsc, tests, …)
    │
    ├─ Pool dispatcher (task_executors × task_parallel) — each in isolated git worktree
    │   ├─ worktree quorex/claude/<run-id>  → goroutine: executor "claude"  → result A
    │   ├─ worktree quorex/codex/<run-id>   → goroutine: executor "codex"   → result B
    │   └─ worktree quorex/gemini/<run-id>  → goroutine: executor "gemini"  → result C
    │
    ├─ Post-hooks (run per worktree; providers failing post-hooks excluded from judging)
    │
    ├─ Judge — Evaluation pass
    │   └─ LLM reads git diff of each worktree → scoring matrix (provider × category)
    │
    ├─ Judge — Synthesis pass
    │   └─ New ralphex iteration: matrix + all provider outputs as context
    │
    ├─ Apply synthesized changes to main checkout; remove worktrees
    │
    └─ Output: final solution + matrix report
```

## Executor Model

Quorex adopts the named executor model from ralphex [#355](https://github.com/umputun/ralphex/issues/355).

**Built-ins** (`claude`, `codex`) exist implicitly with sane defaults. Overlay them by name to tune:

```toml
[executor.claude]
args     = ["--output-format", "stream-json", "--dangerously-skip-permissions"]
protocol = "claude-json-stream"

[executor.codex]
args     = ["--full-auto", "--quiet"]
protocol = "codex"
```

**User-defined executors** — any command-backed tool:

```toml
[executor.gemini]
command  = "gemini"
args     = ["--yolo"]
protocol = "plain"

[executor.deepseek]
command  = "opencode"
args     = ["run", "--model", "deepseek-reasoner"]
role     = "review"
mode     = "audit"
protocol = "plain"
```

**Fields:**

| Field      | Values                                     | Notes                                              |
| ---------- | ------------------------------------------ | -------------------------------------------------- |
| `command`  | path / binary name                         | Required for user-defined; inferred for built-ins  |
| `args`     | string array                               | Merged with built-in defaults if overlaying        |
| `role`     | `task` \| `review`                         | Default: `task`                                    |
| `mode`     | `edit` \| `audit`                          | `edit` may modify files; `audit` read-only         |
| `protocol` | `claude-json-stream` \| `codex` \| `plain` | Describes I/O contract, not vendor identity        |
| `enabled`  | `true` \| `false`                          | Exclude from `*` wildcard without removing section |

Each task executor runs in an isolated `git worktree` at `quorex/<name>/<run-id>`. Providers cannot see each other's writes. After judging, the winning changes are applied to the main checkout via `git apply`; all worktrees are removed.

## Pool Configuration

```toml
[pool]
task_executors   = "*"      # comma-separated names or "*" for all task-role executors
task_parallel    = 3        # how many task executors run concurrently
review_executors = "claude" # executor(s) used as judge; runs in audit mode
timeout          = "10m"    # per-executor timeout
provider_retries = 1        # retries per executor on transient failure
```

**`task_executors`:**

| Value            | Behavior                                                 |
| ---------------- | -------------------------------------------------------- |
| `"*"`            | All enabled executors with `role = task`                 |
| `"claude,codex"` | Named list; order is fallback/refill priority            |
| `"claude"`       | Single executor — degrades to ralphex single-thread mode |

**CLI overrides** (symmetric with config):

```bash
quorex run \
  --task-executors=claude,codex,gemini \
  --task-parallel=3 \
  --review-executors=claude \
  docs/plans/feature.md
```

**Strategies via `task_parallel`:**

| `task_parallel` | `task_executors` | Effective behavior                             |
| --------------- | ---------------- | ---------------------------------------------- |
| `N > 1`         | multiple         | Parallel pool → judge evaluates → synthesizes  |
| `1`             | multiple         | Fallback: try in order, use first success      |
| `1`             | single           | Ralphex single-executor mode (no judge needed) |

## Judge — Two-Pass Model

### Pass 1: Evaluation

The judge receives the `git diff` of each provider's worktree against HEAD. It scores each diff against quality categories. Output: a matrix marking which provider had the strongest approach per category.

```
              Claude   Codex   Gemini
Architecture    ★        —       —
Correctness     —        ★       —
Error handling  —        ★       —
Code style      ★        —       —
Tests           —        —       ★
Performance     —        ★       —
Security        —        —       ★
UX              ★        —       —
```

### Pass 2: Synthesis

Synthesis is a standard ralphex development iteration — the same loop mechanics, same session model — but instead of a single previous iteration's output, the judge receives the scoring matrix and all provider outputs as context. The judge produces the next iteration of the solution using the matrix to weight which provider's approach to favour per concern. No custom merge logic; the matrix is prompt context, the rest is ralphex.

### Categories

Default category set — the judge selects the relevant subset based on task type:

| Category       | Dropped when                   |
| -------------- | ------------------------------ |
| Architecture   | Single-function tasks          |
| Correctness    | Always included                |
| Error handling | Always included                |
| Code style     | Always included                |
| Tests          | Task explicitly excludes tests |
| Performance    | Simple glue code               |
| Security       | No I/O or auth involved        |
| UX             | Non user-facing code           |
| Accessibility  | Non-frontend tasks             |
| Documentation  | Internal-only code             |

User override:

```toml
[judge]
categories = ["architecture", "correctness", "error_handling", "tests"]
```

## Hooks

Hooks have two phases: `pre` (before pool dispatch) and `post` (per provider worktree, after provider finishes). Pre-hook failure aborts dispatch. Post-hook failure excludes that provider from judging; other providers proceed.

```toml
[[hook]]
name    = "typecheck"
command = "bun"
args    = ["tsc", "--noEmit"]
phase   = "pre"   # default

[[hook]]
name    = "lint"
command = "bun"
args    = ["run", "lint"]
phase   = "pre"

[[hook]]
name    = "tests"
command = "bun"
args    = ["test", "--bail"]
phase   = "post"   # validates each provider's worktree before judging
```

Hooks are optional. Recommended defaults (added by `quorex init` when applicable):

- TypeScript projects → `tsc --noEmit` (pre + post)
- Projects with ESLint/Biome → lint check (pre)
- Projects with test suite → test run with bail on first failure (post)
- Go projects → `go build ./...` + `go test ./...` (post)

## `quorex init`

Analyzes the current project and generates a tailored `quorex.toml` config.

```
quorex init [--agent claude|codex|opencode]
```

**What it does:**

1. Detects available harnesses from `$PATH` in priority order: `claude` → `codex` → `opencode`. If none found, prints install instructions and exits:
   ```
   No supported AI harness found. Install one of:
     claude   — https://claude.ai/code
     codex    — https://github.com/openai/codex
     opencode — https://opencode.ai
   Then re-run: quorex init
   ```
2. Uses the first found harness (or `--agent` override) to analyze the project and generate `quorex.toml`. The agent inspects the repo and produces a config tailored to it — executor sections, hooks, pool settings. No hardcoded templates; the agent decides what makes sense for this specific project.
3. If `package.json` exists, the agent proposes `scripts` entries relevant to this project's workflow (e.g. `ai:run`, `ai:review`). **`quorex init` is never added** — it's a one-time setup command, not a recurring workflow script.
4. Prints a summary of what was written.

## Plan Format Validation

Quorex validates plan files before dispatch. On invalid format, it exits with a descriptive error — no silent truncation or best-effort run.

**Error output format:**

````
Error: invalid plan file "plans/my-task.md"

  Line 12: task section missing required header
  Expected: ## Task: <name>
  Found:    ## <name>

  Line 34: fence block not closed
  Opened at line 28 (```toml), never closed before next section

Fix manually or run:
  quorex plans fix plans/my-task.md
````

**`quorex plans fix <file>`** — uses the default harness (claude → codex → opencode priority) to parse the error output and rewrite the plan to a valid format. Dry-run first, prints diff, asks for confirmation before writing.

## Config File Format

Full example `quorex.toml`:

```toml
# Built-ins (claude, codex) exist implicitly; overlay to tune:
[executor.claude]
args     = ["--output-format", "stream-json", "--dangerously-skip-permissions"]
protocol = "claude-json-stream"

[executor.codex]
args     = ["--full-auto", "--quiet"]
protocol = "codex"

# User-defined executor:
[executor.gemini]
command  = "gemini"
args     = ["--yolo"]
protocol = "plain"

[pool]
task_executors   = "*"    # all enabled task-role executors
task_parallel    = 3
review_executors = "claude"
timeout          = "10m"
provider_retries = 1

[judge]
# categories auto-detected if omitted
# categories = ["architecture", "correctness", "error_handling", "tests"]

[[hook]]
name    = "typecheck"
command = "bun"
args    = ["tsc", "--noEmit"]
phase   = "pre"

[[hook]]
name    = "lint"
command = "bun"
args    = ["run", "lint"]
phase   = "pre"

[[hook]]
name    = "tests"
command = "bun"
args    = ["test", "--bail"]
phase   = "post"
```

## Ralphex Loop Integration

Everything from ralphex carries over:

- Plan file format (markdown with task sections)
- Ralphex loop mechanics
- Per-task fresh sessions
- Multi-phase review pipeline
- Git commit integration
- `external_review_tool` support

### Loop retry semantics

If the synthesized result fails ralphex's review phase, the loop continues exactly as in ralphex: the judge receives its previous output + review feedback as context and produces the next iteration. Providers are not re-dispatched — the synthesis step simply becomes the executor for subsequent iterations.

**Provider failures** are handled separately from the review loop. The pool maintains its configured size (`pool.size`, default: all declared providers) for the duration of the run:

1. **Transient failure** (crash, hang, timeout) → retry the same provider up to `pool.provider_retries` times (default: 1).
2. **Quota / billing failure** (rate limit, insufficient funds, API auth error) → no retry; immediately replace with the next declared provider not currently in the pool.
3. **Retry exhausted** → same replacement logic as quota failure.
4. **No replacement available** → pool shrinks; judging proceeds with whatever succeeded. If zero providers succeed, run aborts with a per-provider failure summary.

```toml
[pool]
size             = 3    # target concurrent providers; default = all declared
provider_retries = 1    # retries per provider on transient failure
```

Quota/billing detection is best-effort: exit code + stderr pattern match against known provider error messages. Unknown failures are treated as transient.

## Non-Goals

- No web dashboard (CLI-only, like ralphex)
- No plan format changes
- No built-in LLM API calls (providers are external CLI tools, judge uses one of the declared providers)
- No provider version pinning
