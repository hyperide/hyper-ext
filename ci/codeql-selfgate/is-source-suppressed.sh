#!/usr/bin/env bash
# ci/codeql-selfgate/is-source-suppressed.sh — in-source suppression matcher
# for .github/workflows/codeql.yml's "Gate on SARIF findings" step.
#
# WHAT: is_source_suppressed <ruleId> <src> <startLine> -> rc 0 if suppressed.
# A finding is suppressed iff the flagged line, OR the contiguous block of
# comment lines directly above it, carries a `codeql[<ruleId>]` marker —
# either comment style: `// codeql[...]` (JS/TS convention) or
# `# codeql[...]` (YAML/shell/Python convention). The scan walks upward from
# the flagged line and stops at the first line that isn't `#`-led or
# `//`-led (code, or a blank line — blank lines don't match either prefix),
# so a marker can't leak across an unrelated step above it.
#
# KNOWN LIMITATION (inherited verbatim from upstream, not introduced by this
# port): a `#`-led line is always treated as a comment, with no per-language
# awareness. Two consequences, both accepted trade-offs:
#   - A JS/TS private class field/method (`#field = 1;`, `#method() {}`) also
#     starts with `#` and would be walked through as if it were a comment.
#     An earlier version of this file tried to reject that shape with a
#     stricter `comment_re` (require whitespace/`!`/`#` right after `#`) —
#     that MISMATCHED the marker regex below (which allows a marker written
#     with zero spaces, e.g. `#codeql[rule]`) and broke recognizing ordinary
#     space-less YAML/shell comments (`#---`, `#123`) inside a suppression's
#     comment block — i.e. it traded an unreachable risk (no JS/TS marker
#     exists in this repo today) for a live one on the files this actually
#     protects. Reverted. If a JS/TS suppression marker is ever added near a
#     private-field-heavy class, verify by hand that no unrelated marker sits
#     above the field.
#   - The walk can't tell a top-level YAML comment from a `#`-led comment
#     line inside a PRECEDING step's `run: |` script body — both are
#     `#`-led, so a long trailing comment chain in one step could carry the
#     walk from the next step's flagged line through the boundary into it.
#     Low-likelihood (needs a coincidentally-matching rule-id marker placed
#     in that unrelated script) and any real marker addition goes through
#     code review; not worth a full YAML-aware parser for this gate.
#
# ASSUMPTION this matcher inherits from the OLD one-line matcher it replaces:
# the flagged line is directly adjacent to the comment block (no other code
# sits between them). CodeQL's `actions` queries report at the step's own
# `- name:` line for the two rule ids this repo currently suppresses
# (`actions/untrusted-checkout/medium`, `actions/cache-poisoning/poisonable-step`)
# — confirmed by this repo's own CI history running green under the OLD
# strict 1-line matcher for a long time before HYP-1182. If a future rule
# reports on a line buried deeper inside a step, this won't find a comment
# block placed above the step declaration; that fails closed (over-gates,
# not over-suppresses), same direction as before.
#
# WHY sourced from its own file instead of inlined in codeql.yml: this exact
# function used to live inline in the workflow YAML as an exact-substring,
# single-line-only match on `// codeql[...]`. HYP-1182: a routine
# `rig apply --only ci` moved the upstream marker convention (used by this
# repo's own dependency-review.yml and leftover-grep.yml, both rig-managed)
# to a bare `# codeql[...]` line placed ABOVE a multi-line "Justified: ..."
# comment block — several lines removed from the flagged step, not directly
# above it. The old matcher silently stopped recognizing the still-valid,
# still-reviewed suppression and started gating already-safe findings, with
# no error — CI just went red for no real reason. It happened once already
# (main commit a17c0195), was hand-reverted by changing the marker TEXT back
# (f0d5ecca) while leaving the matcher itself brittle and the two gates
# rig-managed, so the next `rig apply --only ci` would silently reintroduce
# the exact same break.
#
# Fix: port agent-tools' own already-fixed CodeQL self-gate matcher
# (ci/codeql/workflow-selfgate.yml in alex-mextner/agent-tools, as of commit
# f7fb03fb0b771c346dc87a3938ee18b40f396627 — that's the known baseline for a
# future manual re-sync) verbatim — it already accepts both comment styles
# and walks the full contiguous comment block. Extracting it into its own
# file (sourced by codeql.yml, not duplicated) makes it unit-testable
# (is-source-suppressed.test.sh) and gives the two copies (this one and
# agent-tools') one obvious place to stay in sync, instead of drifting apart
# silently the way the marker format did.
#
# This file itself is NOT exposed to the recurrence this fixes: rig.yaml's
# `ci.items` (the only CI gates rig-cli's catalog-driven model will ever
# touch) lists exactly `secret-scan`, `dependency-review`, `leftover-grep`,
# `review-threads` — no `codeql` entry, matching the scope note at the top of
# rig.yaml that calls codeql/pr-checklist/security-scan hand-tuned. rig-cli's
# `_validate_item_names` fails closed on any config item name absent from its
# catalog, and `codeql-selfgate` has no catalog entry at all — so neither
# `.github/workflows/codeql.yml` nor this directory can be silently rewritten
# by `rig apply`, unlike dependency-review.yml/leftover-grep.yml.
# This file is meant to be SOURCED (`. path/to/is-source-suppressed.sh`),
# never executed directly — it only defines a function, so a mis-wired step
# that runs it directly (`bash is-source-suppressed.sh`) would silently exit
# 0 having done nothing: a vacuous, always-green no-op CI step, the exact
# failure class this repo already had to repair once (HYP-1186). Fail loudly
# instead if invoked directly.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  echo "is-source-suppressed.sh must be SOURCED, not executed — e.g. '. $0' (see this file's header)." >&2
  exit 1
fi

is_source_suppressed() {
  local rid="$1" src="$2" line="$3" n txt
  # Match `//` or `#` (optional leading indent), then `codeql[<exact rule id>]`.
  # The rule id is escaped so literal ERE metacharacters in it (CodeQL rule
  # ids commonly contain `/`; none currently use the rest, but escape the
  # full ERE set — `. * + ? ( ) [ ] { } ^ $ | \` — so a future rule id with
  # one can't silently false-match or false-no-match, which would be exactly
  # the failure class this file exists to prevent).
  local escaped_rid
  escaped_rid="$(printf '%s' "$rid" | sed 's/[][\.*^$/+?(){}|]/\\&/g')"
  # `re` (unanchored) is for the flagged line ONLY, which may legitimately
  # carry the marker inline after code (`- name: step  # codeql[rule]`).
  # `re_at_comment_start` (anchored right after the comment token, allowing
  # only leading indent) is for the WALK: every real marker line is a
  # dedicated, standalone comment with nothing else on it, so anchoring is
  # free and closes a real false-suppression path — an unrelated comment
  # that merely QUOTES a real marker as prose/documentation elsewhere on the
  # line (e.g. "# see // codeql[some/real/rule] for the syntax") would
  # otherwise be walked-through and misread as a live suppression, exactly
  # the kind of doc comment this diff just deleted from both workflow files
  # (they used to explain the marker format right next to the marker
  # itself).
  # NOTE `re` staying unanchored is a DELIBERATE, narrower trade-off, not an
  # oversight: it means arbitrary prose elsewhere on the flagged line itself
  # (e.g. a `run:` step that echoes text containing "# codeql[rule]" inside
  # a quoted string) could also self-suppress, same as the OLD matcher this
  # ports from (also an unanchored substring match on that line) — not a
  # regression. Anchoring it would break the legitimate, currently-tested
  # "marker inline after code" usage (`- name: step  # codeql[rule]`) unless
  # anchored to "start-of-line OR after whitespace", which the adversarial
  # `run: echo "# codeql[rule]"` example still satisfies anyway (there's
  # whitespace before its `#` too) — so a partial anchor wouldn't actually
  # close this path, only a full comment/string-aware parser would, which is
  # disproportionate for one line's residual, low-probability, self-inflicted
  # risk. The walk below is the one closed properly (see re_at_comment_start).
  local re="(//|#)[[:space:]]*codeql\[${escaped_rid}\]"
  local re_at_comment_start="^[[:space:]]*(//|#)[[:space:]]*codeql\[${escaped_rid}\]"
  # Any line whose first non-space char is `#` or `//` counts as a comment
  # line for the upward walk (see the KNOWN LIMITATION note above for why
  # this is intentionally not stricter).
  local comment_re='^[[:space:]]*(#|//)'

  [ -f "$src" ] || return 1
  [ "$line" -gt 0 ] 2>/dev/null || return 1

  # Flagged line itself. Here-string, not a `sed | grep -q` pipe: `grep -q`
  # can exit the instant it finds a match, and for a pipe (unlike a
  # here-string, which is fully buffered before grep ever runs) that risks
  # SIGPIPE on the writer — under `set -e -o pipefail` (as codeql.yml's gate
  # step runs) that would poison the pipeline's exit status even though grep
  # itself DID match, silently dropping `return 0`. Not reachable today
  # (single short YAML lines, well under a pipe buffer), but this is the one
  # call site the upward walk below can't recover for (it starts at
  # `line-1` and never re-examines the flagged line itself), so it's worth
  # closing here too, for good, even though it's free either way.
  grep -qE "$re" <<< "$(sed -n "${line}p" "$src" 2>/dev/null)" && return 0

  # Walk upward through the contiguous comment block directly above the
  # flagged line; stop at the first line that isn't a comment (this also
  # stops at a blank line, since blank lines don't match comment_re either).
  # Same here-string reasoning as above.
  n=$((line - 1))
  while [ "$n" -ge 1 ]; do
    txt="$(sed -n "${n}p" "$src" 2>/dev/null)"
    grep -qE "$comment_re" <<< "$txt" || break
    grep -qE "$re_at_comment_start" <<< "$txt" && return 0
    n=$((n - 1))
  done

  return 1
}
