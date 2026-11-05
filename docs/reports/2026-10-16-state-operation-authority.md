# State-lib operation authority — implementation scope

Part of [HYP-1507](https://tasks-ultrabricks.vercel.app/tasks/HYP-1507).
Supports [HYP-1536](https://tasks-ultrabricks.vercel.app/tasks/HYP-1536).

## Delivered boundary

The unpublished `@ultrabricks/state-toolkit-async` package now exports
`createOperationScope`. It grants revocable rights to publish synchronous state
and UI feedback. It does not execute, cancel, undo, or replace an external
writer. Runtime and latestTask remain unchanged.

A lease belongs to one lane and one scope generation. Starting another lease
in that lane revokes the old one; unrelated lanes keep working. Advancing the
scope revokes the old context, including A to B to A. An old finish or cancel
cannot release a newer lease. Binding a feedback callback preserves its
arguments but checks authority at each invocation, not when it was bound.

Commit failures record whether the Runtime actually published. A domain error
using the NotificationError class is not by itself proof of publication.
Current errors propagate unchanged, including a thrown undefined value.

## Review findings and decisions

### Late callbacks inside Runtime notification

A disposed lease initially probed the Runtime during observer delivery and
caused a NotificationError, even though no user callback would run. A new test
reproduced this. A revoked lease now returns a read-only dropped result for
known transaction, purity, notification, and disposed-runtime refusals. It
neither invokes feedback nor appends trace in such a forbidden phase.

The active-lease checks are not relaxed. The pure-phase regression checks both
an active refusal and an inert stale result. The earlier interpretation that
all stale calls must throw in those phases was rejected: a harmless late
listener must not break a newer publication.

### Thenable assimilation

Feedback from an untyped JavaScript caller can violate the synchronous API.
A lazy then getter was initially read twice. Its regression now verifies one
read, one invocation, the original receiver, and a drained rejection. Runtime
already drains a rejecting asynchronous transaction callback; a separate
positive control verifies rollback without a duplicate toolkit drain.

### Explicit diagnostic opt-out

An omitted capacity or an explicit zero disables recording. Values from 1 to
4096 enable a bounded trace. Rejecting explicit zero was not adopted: there is
no separate enabled flag whose configuration would make zero ambiguous. Null,
negative, fractional, non-finite, and oversized values remain invalid.

### Package output below node_modules

The real browser consumer exposed a compiler-layout failure for an otherwise
valid export destination. TypeScript inferred a different source root and
classified imported mirror files as external, so promised output was missing.

The exporter now pins the owned mirror root and explicitly includes promised
modules. Compiler-parsed import checks reject literal specifiers outside the declared
local modules and core peer, including literal dynamic and type imports. An additional
negative test rejects an undeclared referenced file instead of publishing a
broken package. Destination ownership, source-tree refusal, same-filesystem
promotion, and failure cleanup remain unchanged and have dedicated tests.

## Diagnostics and limitations

Trace events contain bounded identifiers and reasons, never lane names,
document identifiers, field contents, error messages, or stack traces. No
telemetry or persistence starts. Snapshot copies and events are frozen.

Numeric counters are prototype diagnostics, not indefinitely unique archival
IDs. Ticket revocation, not numeric equality, grants authority. Safe-integer
saturation remains a diagnostic-hardening follow-up. Empty Runtime transactions
currently provide public boundary probes; their cost should be measured before
introducing a new core guard API. The core API is not widened just to remove
those probes.

## Verification surface

The unit suites exercise the actual Runtime, cross-request authority, cleanup,
purity, notifications, and wrong-phase calls. The package suites install an
offline tarball pair, verify one shared core, and compile positive and negative
consumer declarations. Filesystem tests exercise actual export operations.

The optional browser acceptance command runs nine scenarios in actual Chromium
against emitted package imports. Its artifact includes browser identity,
consumer and test-script hashes, and the bundle input graph. The intentional
invalid thenable is an adversarial test fixture, not production code.

```sh
bun run test
node_modules/.bin/tsc -p packages/state-lib/toolkit/tsconfig.json
node packages/state-lib/toolkit/tools/check-operation-browser.mjs \
  /tmp/state-operation-browser-proof
```

The browser evidence directory must be new. STATE_CHROME can select an installed
Chromium executable. Executed commands and final outcomes belong in the PR's
verification record; this report does not convert an unfinished run into a pass.

## What this does not claim

This change does not enable state-lib in the real inspector, implement
protected drafts, replace the style writer, or approve wider adoption. The
historical [pilot #824](https://github.com/hyperide/hyper-saas/pull/824) and its
NO-GO measurements remain untouched. Integration must preserve the existing
[cancellation work](https://github.com/hyperide/hyper-saas/pull/805) and
[transport outcome contract](https://tasks-ultrabricks.vercel.app/tasks/HYP-1588).
Real Hyper AST, HMR, rollback, journal, undo, and cross-webview acceptance remain
separate requirements. No performance improvement is inferred from these tests.
