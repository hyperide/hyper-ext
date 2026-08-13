#!/usr/bin/env bash
# ci/codeql-selfgate/is-source-suppressed.test.sh — tests for
# is-source-suppressed.sh, run directly with bash (plain assertions, no test
# framework — bats isn't installed anywhere in this repo/toolchain; this is
# the first shell-level test in it, so there's no existing framework choice
# to follow).
#
# HYP-1182: these fixtures exist because the OLD matcher (exact `// codeql[...]`
# substring, checked on the flagged line or exactly one line above) silently
# stopped recognizing suppressions the moment the upstream rig CI templates
# switched to a bare `# codeql[...]` marker placed above a multi-line
# "Justified: ..." comment block. Case 3 below is that exact regression.
#
# TWO MODES, run by two different callers with two different jobs:
#   - `bash is-source-suppressed.test.sh`               -> everything below,
#     including in-situ checks against OTHER repo files (the real workflow
#     files' markers, rig.yaml's ci.items). Run by the standalone, fast,
#     NAMED `test-suppression-matcher` job in codeql.yml — its whole point
#     is to be a comprehensive canary for drift (matcher bugs AND
#     upstream-template/rig.yaml drift alike) that fails BY NAME instead of
#     the slow CodeQL matrix going unexplainedly red.
#   - `bash is-source-suppressed.test.sh --matcher-only` -> only the pure
#     is_source_suppressed behavior assertions on synthetic fixtures; skips
#     everything that depends on the CONTENT of dependency-review.yml,
#     leftover-grep.yml, or rig.yaml. Run duplicated INSIDE `analyze`'s own
#     steps (the enforcement copy — see that job's comment for why a bare
#     `needs:` isn't enough) so the REQUIRED CodeQL check only goes red for
#     an actual matcher regression, never for an unrelated, legitimate edit
#     to those other files (e.g. a suppressed step being removed, or
#     rig.yaml being reformatted) landing in the same PR.
#
# Run: bash ci/codeql-selfgate/is-source-suppressed.test.sh [--matcher-only]
set -uo pipefail

matcher_only=0
case "${1:-}" in
  "") ;;
  --matcher-only) matcher_only=1 ;;
  *)
    # Fail loudly on an unrecognized flag instead of silently degrading to
    # the full suite — a typo'd/renamed flag here (e.g. from a future edit
    # to codeql.yml's call site) would otherwise re-run the in-situ and
    # rig.yaml checks inside the REQUIRED `analyze` check, exactly the
    # unrelated-file coupling the --matcher-only split exists to prevent.
    echo "is-source-suppressed.test.sh: unrecognized argument '${1}' (expected no argument, or --matcher-only)" >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
# shellcheck source=./is-source-suppressed.sh
source "$script_dir/is-source-suppressed.sh"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

failures=0
total=0

# assert_suppressed <want 0|1> <label> <fixture-content> <ruleId> <line>
assert_suppressed() {
  local want="$1" label="$2" content="$3" rid="$4" line="$5"
  local fixture="$work_dir/fixture.txt"
  printf '%s' "$content" > "$fixture"
  total=$((total + 1))
  if is_source_suppressed "$rid" "$fixture" "$line"; then
    got=0
  else
    got=1
  fi
  if [ "$got" -eq "$want" ]; then
    echo "  ok    $label"
  else
    echo "  FAIL  $label (want rc=$want, got rc=$got)"
    failures=$((failures + 1))
  fi
}

# assert_real_markers_are_recognized <path-relative-to-repo-root>
# In-situ counterpart to the synthetic fixtures below: walks the REAL,
# currently-committed file, finds every `codeql[<rule>]` marker, and asserts
# the matcher recognizes it at the actual line the walk would treat as
# "flagged" (the first line at/after the marker that isn't `#`/`//`-led).
# This is what directly guards the recurrence HYP-1182 is about: if a future
# `rig apply --only ci` moves the marker format or position again, THIS
# fails by name in the fast `test-suppression-matcher` job instead of the
# slow CodeQL matrix going unexplainedly red.
assert_real_markers_are_recognized() {
  local relpath="$1"
  local file="$repo_root/$relpath"
  local marker_lines n rid flagged_line
  marker_lines="$(grep -nE '^[[:space:]]*(#|//)[[:space:]]*codeql\[[^]]+\]' "$file" | cut -d: -f1)"
  if [ -z "$marker_lines" ]; then
    total=$((total + 1))
    echo "  FAIL  $relpath has no codeql[...] markers to check (fixture rotted — did the marker move or get removed?)"
    failures=$((failures + 1))
    return
  fi
  for n in $marker_lines; do
    rid="$(sed -n "${n}p" "$file" | sed -E 's/.*codeql\[([^]]+)\].*/\1/')"
    # Skip comment lines AND blank lines to land on the real first line of
    # actual content — a blank-line stop would falsely match here even
    # though the real matcher (walking up from the true, non-blank flagged
    # line) would correctly see the blank line as a break and fail closed.
    flagged_line="$(awk -v start="$((n + 1))" \
      'NR >= start && $0 !~ /^[[:space:]]*(#|\/\/)/ && $0 !~ /^[[:space:]]*$/ { print NR; exit }' "$file")"
    total=$((total + 1))
    if [ -z "$flagged_line" ]; then
      echo "  FAIL  $relpath:$n marker for '$rid' has no non-comment line below it to check"
      failures=$((failures + 1))
    elif is_source_suppressed "$rid" "$file" "$flagged_line"; then
      echo "  ok    $relpath:$n marker for '$rid' is recognized at its real flagged line $flagged_line"
    else
      echo "  FAIL  $relpath:$n marker for '$rid' is NOT recognized at its real flagged line $flagged_line"
      failures=$((failures + 1))
    fi
  done
}

echo "=== is_source_suppressed ==="

assert_suppressed 0 "old format: // marker directly above the flagged line" \
'# setup comment
// codeql[my-rule]
- name: something' "my-rule" 3

assert_suppressed 0 "new format: bare # marker directly above the flagged line" \
'# codeql[my-rule]
- name: something' "my-rule" 2

# The regression this ticket exists for: the upstream template puts the
# marker above a multi-line "Justified: ..." block, several lines removed
# from the flagged step — not directly above it.
assert_suppressed 0 "new format: # marker above a multi-line Justified block" \
'# codeql[my-rule]
# Justified: reason line 1
# Justified: reason line 2, continued
# Justified: reason line 3, continued
- name: step' "my-rule" 5

assert_suppressed 0 "marker inline on the flagged line itself" \
'- name: step  # codeql[my-rule]' "my-rule" 1

assert_suppressed 0 "// marker above a multi-line Justified block (both comment styles support the block-walk, not just #)" \
'// codeql[my-rule]
// Justified: reason line 1
// Justified: reason line 2, continued
- name: step' "my-rule" 4

assert_suppressed 1 "marker separated from the flagged line by a blank line does not leak across steps" \
'# codeql[my-rule]

- name: step' "my-rule" 3

# The header's actual claim: a marker can't leak across an unrelated STEP
# above it. A blank line (case above) already stops the comment-only walk,
# but the real HYP-1182 shape is a CODE line (a preceding step) sitting
# between an unrelated step's trailing comment and the flagged step.
assert_suppressed 1 "marker on an unrelated earlier step does not leak across a code line into the next step" \
'# codeql[my-rule]
- name: unrelated earlier step
  run: echo hi
- name: step' "my-rule" 4

assert_suppressed 1 "wrong rule id does not match" \
'# codeql[other-rule]
- name: step' "my-rule" 2

assert_suppressed 1 "no marker at all" \
'- name: step' "my-rule" 1

assert_suppressed 0 "rule id with regex-special characters matches literally" \
'# codeql[actions/untrusted-checkout/medium]
- name: step' "actions/untrusted-checkout/medium" 2

assert_suppressed 1 "rule id sharing a prefix with the marker does not falsely match" \
'# codeql[my-rule-extended]
- name: step' "my-rule" 2

# Proves the ERE metacharacter escaping actually does something (not just
# the `/` in the previous case, which isn't an ERE metacharacter and would
# "pass" even unescaped). If `.` in the rule id weren't escaped it would
# match ANY character as a regex wildcard — a false suppression, i.e. the
# exact silent-over-suppress failure class the escaping exists to prevent.
assert_suppressed 1 "unescaped '.' in the rule id would wrongly wildcard-match — must not" \
'# codeql[aXb]
- name: step' "a.b" 2

assert_suppressed 0 "rule id containing a literal ERE metacharacter still matches its own exact marker" \
'# codeql[a.b]
- name: step' "a.b" 2

# A space-less `#comment` (no space after `#`) is still a valid YAML/shell
# comment and must not stop the walk early — see the KNOWN LIMITATION note
# in is-source-suppressed.sh for why the matcher deliberately does NOT try
# to reject `#`-led non-comment constructs (that stricter heuristic broke
# exactly this case in an earlier revision of this file).
assert_suppressed 0 "a space-less '#comment' line inside the block does not stop the walk early" \
'# codeql[my-rule]
#---divider, no space after #---
- name: step' "my-rule" 3

total=$((total + 1))
if is_source_suppressed "my-rule" "$work_dir/does-not-exist-${RANDOM}${RANDOM}.txt" 1; then
  echo "  FAIL  a nonexistent source file is never suppressed (want rc=1, got rc=0)"
  failures=$((failures + 1))
else
  echo "  ok    a nonexistent source file is never suppressed"
fi

assert_suppressed 1 "a marker BELOW the flagged line is not matched — the walk only goes upward" \
'- name: step
# codeql[my-rule]' "my-rule" 1

assert_suppressed 0 "// marker inline on the flagged line itself (symmetry with the # case above)" \
'- name: step  // codeql[my-rule]' "my-rule" 1

# The marker regex allows zero spaces between the comment token and
# `codeql[` — the KNOWN LIMITATION note in is-source-suppressed.sh leans on
# this fact to justify keeping comment_re unrestricted. Prove the zero-space
# form actually works, both inline and via the walk, so that claim is
# checked rather than just asserted.
assert_suppressed 0 "zero-space marker (#codeql[...], no space) works inline on the flagged line" \
'- name: step  #codeql[my-rule]' "my-rule" 1

assert_suppressed 0 "zero-space marker (#codeql[...], no space) works via the upward walk" \
'#codeql[my-rule]
- name: step' "my-rule" 2

# A comment that merely QUOTES a real marker as prose (documentation
# explaining the marker syntax, not the marker itself) must NOT be treated
# as a live suppression during the walk — this is exactly the shape of the
# "Marker MUST be the line directly above..." explanatory lines this diff
# deleted from both real workflow files (they used to sit right next to the
# actual marker, quoting its exact syntax).
assert_suppressed 1 "a comment that only QUOTES the marker as documentation does not suppress" \
'# see // codeql[my-rule] for the required syntax
- name: step' "my-rule" 2

assert_suppressed 1 "line number 0 is invalid" \
'# codeql[my-rule]
- name: step' "my-rule" 0

# The sourced-only guard IS the defense against a mis-wired step silently
# no-op'ing this file into an always-green gate (see the header + the
# HYP-1186 reference). Prove it actually fires on direct execution. Pure
# self-check (no dependency on other repo files' content), so it runs in
# both modes.
total=$((total + 1))
if bash "$script_dir/is-source-suppressed.sh" >/dev/null 2>&1; then
  echo "  FAIL  direct execution ('bash is-source-suppressed.sh') must exit non-zero, not silently succeed"
  failures=$((failures + 1))
else
  echo "  ok    direct execution fails loudly instead of silently no-opping"
fi

# HYP-1182 P2 (Codex review on #713): `gh ship` gates on EVERY check in the
# PR's statusCheckRollup (agent-tools' ci/ship/ship.sh), not just the ones
# GitHub branch-protection marks "required" — so the standalone
# test-suppression-matcher canary job is only genuinely non-blocking if the
# check run GITHUB REPORTS FOR IT is a non-failing conclusion. That requires
# `continue-on-error: true` on the STEP that runs the tests, NOT on the job:
# job-level continue-on-error only spares the workflow RUN from failing —
# the job's own check run (what `gh ship` reads) still reports `failure`
# (verified against github.com/orgs/community/discussions/15452 and
# kenmuse.com's step-vs-job continue-on-error writeup — this fix's first
# draft got this exact distinction wrong and was caught by `review diff`
# before merge, not by CI). This is a pure self-check against codeql.yml's
# own structure (no dependency on OTHER repo files' content, unlike the
# in-situ checks below), so — unlike those — it belongs OUTSIDE the
# --matcher-only branch: it runs in BOTH modes, meaning it is enforced by
# the blocking `analyze` copy too, not just by the canary whose own failures
# this fix intentionally makes non-blocking.
codeql_yml="$repo_root/.github/workflows/codeql.yml"
extract_job_block() {  # $1 = job key (2-space indented), reads $codeql_yml
  awk -v job="  ${1}:" '
    $0 == job { flag = 1; next }
    /^  [A-Za-z0-9_-]+:/ { flag = 0 }
    flag { print }
  ' "$codeql_yml"
}
extract_step_block() {  # $1 = job block (as text), $2 = exact step name
  # Terminate on ANY step boundary (`      - `), not just `- name:` — a
  # subsequent nameless step (`- uses: …` / `- run: …`, both legal YAML)
  # would otherwise get silently absorbed into this step's block, and a
  # continue-on-error that actually lives on THAT step would false-pass the
  # canary-has-continue-on-error assertion below.
  awk -v step="      - name: ${2}" '
    $0 == step { flag = 1; next }
    /^      - / { flag = 0 }
    flag { print }
  ' <<< "$1"
}

if [ ! -f "$codeql_yml" ]; then
  total=$((total + 4))
  echo "  FAIL  codeql.yml not found at $codeql_yml — can't verify the canary non-blocking invariant (4 assertions skipped as failed)"
  failures=$((failures + 4))
else
  # These regexes match "the token followed by whitespace-or-end", not
  # "...and then nothing else on the line" — this whole block runs in BOTH
  # modes, including inside the REQUIRED analyze job's blocking
  # --matcher-only run, so an over-anchored `$` would turn a benign future
  # edit (a trailing `# comment`, or `--matcher-only --verbose`) into a
  # merge-blocking false FAIL — exactly the failure mode this fix exists to
  # eliminate, just relocated into this test instead of the workflow.
  canary_block="$(extract_job_block test-suppression-matcher)"
  canary_step_name="Run is_source_suppressed unit tests (full suite)"

  total=$((total + 1))
  if [ -z "$canary_block" ]; then
    echo "  FAIL  'test-suppression-matcher:' job not found in codeql.yml (renamed? fix this test's job key)"
    failures=$((failures + 1))
  elif grep -qE '^ {4}continue-on-error:' <<< "$canary_block"; then
    echo "  FAIL  test-suppression-matcher has continue-on-error at JOB level — this does NOT make gh ship treat it as non-blocking (GitHub still reports the job's own check run as failure; only the workflow RUN is spared). Move it onto the '$canary_step_name' step instead."
    failures=$((failures + 1))
  else
    echo "  ok    test-suppression-matcher has no job-level continue-on-error (step-level is the mechanism that actually works)"
  fi

  total=$((total + 1))
  canary_step_block="$(extract_step_block "$canary_block" "$canary_step_name")"
  if [ -z "$canary_step_block" ]; then
    echo "  FAIL  step '$canary_step_name' not found inside test-suppression-matcher (renamed? fix this test's step name)"
    failures=$((failures + 1))
  elif grep -qE '^[[:space:]]*continue-on-error:[[:space:]]*true([[:space:]]|$)' <<< "$canary_step_block"; then
    echo "  ok    test-suppression-matcher's test step carries continue-on-error: true (the mechanism that actually reaches gh ship's statusCheckRollup)"
  else
    echo "  FAIL  test-suppression-matcher's test step is missing continue-on-error: true — without it, gh ship's green-CI gate (every check in statusCheckRollup, regardless of branch-protection 'required' status) treats a failing canary as blocking, exactly the HYP-1182 P2 regression"
    failures=$((failures + 1))
  fi

  total=$((total + 1))
  analyze_block="$(extract_job_block analyze)"
  if [ -z "$analyze_block" ]; then
    echo "  FAIL  'analyze:' job not found in codeql.yml (renamed? fix this test's job key)"
    failures=$((failures + 1))
  elif grep -qE '^[[:space:]]*continue-on-error:' <<< "$analyze_block"; then
    # NOTE this can't defend against every shape of the same regression: if
    # continue-on-error lands on the very step that runs THIS test script
    # (below), that step's own failure — including the FAIL this branch just
    # printed — gets masked too, so the job can still report success in the
    # exact run that introduces the problem. A self-check can't fully guard
    # its own blockingness; catching that specific case is what code review
    # is for. This assertion still catches every OTHER placement (job-level,
    # or continue-on-error on any other analyze step) on the NEXT run.
    echo "  FAIL  analyze job (or one of its steps) carries continue-on-error — a masked step failure would silently report the job (and hence this REQUIRED check) as passing even when the matcher-only test or the SARIF gate genuinely fails. If a truly non-gating step (e.g. artifact upload) needs tolerated failures, scope this check to exclude it by name with a comment explaining why, instead of just deleting this assertion."
    failures=$((failures + 1))
  else
    echo "  ok    analyze job has no continue-on-error anywhere (still genuinely gates on matrix/matcher failure)"
  fi

  # The whole safety argument of this fix is "the canary is non-blocking, but
  # the analyze copy still genuinely enforces the matcher" — that claim is
  # empty if analyze doesn't actually RUN the matcher tests. Guard against a
  # future edit that removes/renames that step while leaving this test suite
  # (which would then be checking nothing) green.
  total=$((total + 1))
  if [ -z "$analyze_block" ]; then
    echo "  FAIL  'analyze:' job not found in codeql.yml — can't verify it runs the matcher tests"
    failures=$((failures + 1))
  elif grep -qE 'is-source-suppressed\.test\.sh[[:space:]]+--matcher-only([[:space:]]|$)' <<< "$analyze_block"; then
    echo "  ok    analyze job actually invokes is-source-suppressed.test.sh --matcher-only (enforcement claim is real, not just non-blocking-ness)"
  else
    echo "  FAIL  analyze job no longer invokes 'is-source-suppressed.test.sh --matcher-only' — the REQUIRED job has stopped enforcing the matcher entirely while the canary above stays non-blocking, silently removing all matcher-regression coverage"
    failures=$((failures + 1))
  fi
fi

if [ "$matcher_only" -eq 0 ]; then
  # In-situ contract check against every REAL, currently-committed workflow
  # file that carries a codeql[...] marker — discovered, not hardcoded, so a
  # future third file with a marker is automatically covered too. See
  # assert_real_markers_are_recognized's own comment above for what this
  # guards against. SCOPE NOTE: this only discovers STANDALONE-comment-line
  # markers (`^[[:space:]]*(#|//)[[:space:]]*codeql\[...\]`), not the
  # inline-after-code form (`- name: step  # codeql[rule]`) — the matcher
  # itself supports both (see the synthetic fixtures above), but no real
  # file in this repo currently uses the inline form, so there is nothing
  # to discover; if one ever does, broaden this grep to match.
  marker_files="$(grep -lE '^[[:space:]]*(#|//)[[:space:]]*codeql\[[^]]+\]' \
    "$repo_root"/.github/workflows/*.yml 2>/dev/null || true)"
  if [ -z "$marker_files" ]; then
    total=$((total + 1))
    echo "  FAIL  no file in .github/workflows/ has a codeql[...] marker to check (fixture rotted — did every marker get removed?)"
    failures=$((failures + 1))
  else
    for f in $marker_files; do
      assert_real_markers_are_recognized "${f#"$repo_root"/}"
    done
  fi

  # The canary above only proves "whatever rule id the marker text CURRENTLY
  # says gets recognized" — it wouldn't notice a marker's rule-id TEXT
  # silently drifting (a future `rig apply` or a CodeQL rule rename editing
  # the id itself, not just the format). Pin it against the known inventory
  # is-source-suppressed.sh's own header names, so that specific drift also
  # fails by name here instead of showing up as an unexplained-red gate.
  total=$((total + 1))
  discovered_rids="$(grep -hoE 'codeql\[[^]]+\]' "$repo_root"/.github/workflows/*.yml 2>/dev/null \
    | sed -E 's/^codeql\[(.+)\]$/\1/' | sort -u)"
  missing_rids=""
  for expected in "actions/untrusted-checkout/medium" "actions/cache-poisoning/poisonable-step"; do
    grep -qxF "$expected" <<< "$discovered_rids" || missing_rids="$missing_rids $expected"
  done
  if [ -n "$missing_rids" ]; then
    echo "  FAIL  known suppressed rule id(s) no longer found in any .github/workflows/*.yml marker:$missing_rids (renamed, or the rule is no longer suppressed anywhere — update this list or investigate)"
    failures=$((failures + 1))
  else
    echo "  ok    both known suppressed rule ids are still present in the real marker inventory"
  fi

  # is-source-suppressed.sh's header claims rig-cli's catalog-driven `rig
  # apply` can never rewrite codeql.yml or this directory, because rig.yaml's
  # `ci.items` doesn't list a `codeql` gate. That claim is exactly the kind
  # of assumption that silently went stale once already (HYP-1182's root
  # cause). Mechanize it — with a POSITIVE CONTROL first: if rig.yaml's
  # format ever changes (different indent, list syntax, etc.), a bare
  # "codeql: absent" grep would silently keep reporting "safe" no matter
  # what the file actually says. (An earlier version of this check used a
  # stateful line-range parser tracking entry/exit of the `ci:`/`items:`
  # blocks instead of this flat grep — it had exactly that bug: it never
  # matched the 2-space-indented `items:` line, so `found` stayed 0 and it
  # silently reported "safe" no matter what the file said. Caught by testing
  # it against a synthetic fixture that DOES add a `codeql:` entry, before
  # trusting it.) So first assert the pattern still finds ALL FOUR
  # known-managed entries; only trust the "codeql absent" result if that
  # holds.
  total=$((total + 1))
  rig_yaml="$repo_root/rig.yaml"
  known_items_found="$(grep -cE '^ {4}(secret-scan|dependency-review|leftover-grep|review-threads):' "$rig_yaml" 2>/dev/null || true)"
  if [ ! -f "$rig_yaml" ]; then
    echo "  FAIL  rig.yaml not found at $rig_yaml — can't verify codeql stays unmanaged"
    failures=$((failures + 1))
  elif [ "${known_items_found:-0}" -ne 4 ]; then
    echo "  FAIL  rig.yaml's ci.items no longer matches the expected 4-space-indented format (found $known_items_found/4 known entries) — the codeql-absence check below would be BLIND, fix the pattern in this test before trusting it"
    failures=$((failures + 1))
  elif grep -qE '^ {4}codeql:' "$rig_yaml"; then
    echo "  FAIL  rig.yaml now has a 4-space-indented 'codeql:' key — likely a new ci.items entry, which would mean rig can rewrite codeql.yml and this file's safety argument no longer holds"
    failures=$((failures + 1))
  else
    echo "  ok    rig.yaml has no 'codeql:' ci.items entry (is-source-suppressed.sh's safety claim holds, and the check itself is proven non-blind)"
  fi
fi

echo
if [ "$failures" -gt 0 ]; then
  echo "FAILED: $failures/$total assertions failed"
  exit 1
fi
echo "PASSED: $total/$total assertions"
