# Live examples, compilation and paired application builds

<span id="browser-compiler"></span>

## Browser compilation uses the same compiler

The browser loads the Rust `statec` planner as WebAssembly on demand. The native CLI and browser entry call the same planner and command generators; source is parsed, not evaluated by the compiler. A four-MiB request bound and worker cancellation limit the interactive boundary. The bundler resolves only files in the example project and includes every reachable import in the reported entry size.

Each example retains its complete editable application sources, command declarations, runtime reference implementations, generated modules and shared library sources. Changing a declaration changes the generated code. Changing runtime reference code alone must not silently change the generated candidate: behavioral comparison reports any difference. The workbench explicitly compares candidates; it does not override the normal compiler's performance-admission policy.

<span id="command-path-copying"></span>

## Copy the changed path

A declared point command copies changed ancestors and preserves untouched immutable values. Its result is published through the same transaction boundary as the reference command. The board example shows nested card state; the issue-triage example separates issue records from ordering. Source links distinguish this representation choice from the compiler's effect on either representation.

<span id="command-batch-construction"></span>

## Construct a batch once

Sparse and dense commands build changed rows within a private construction scope, preserve unchanged rows and publish once. The example exposes operation, collection size, history limit and whether construction/import belongs in the timed work. Comparing the two implementations uses the same data model, commands and visible result.

<span id="command-order-moves"></span>

## Keep order separate from payload

The normalized triage model moves ordered IDs while retaining issue records. The nested board model moves card references between column arrays. Both preserve historic snapshots and demonstrate Undo/Redo in the same workbench. An observed difference between those models is a representation result, not solely a JavaScript-versus-Wasm or compiler result.

<span id="document-publication"></span>

## One publication and history boundary

The command examples use the actual state-lib Runtime and shared document-publication module. One atomic value contains document/history and a cached public view. The source and generated alternatives have identical public capabilities and bounded retained history. Current example history stores immutable roots; this is distinct from the patch-based collaborative history contract in §4.10 and is not presented as its complete implementation.

<span id="entry-size-budget"></span>

## Account for the complete entry

Raw and gzip figures include the example's model, Runtime, publication/history and every reachable helper. Readable generated code and the final minified bundle are separately inspectable. Redundant imports, declaration count and source edits can change those figures. Compiler/bundler Wasm support assets are separate lazy-loaded tooling, not hidden inside the example's application budget; they remain counted in the site's route/download report. A smaller individual function is not enough when its full entry grows.

<span id="example-benchmark-method"></span>

## Measure the example that is being edited

The live runner uses a disposable opaque-origin worker with network access denied. It never executes edited source with the documentation page's storage or account privileges. Source and generated candidates run against identical deterministic fixtures; preflight compares the complete final state and verifies preservation of an earlier root. Timed batches include command execution, Runtime commit and bounded history. The construction option additionally times fixture import and cleanup. Interface rendering, transport and compiler startup are recorded outside the command timer.

Controls specify operation, row count, retained history, sample count and construction inclusion. Displayed P95 is a percentile of batch means, not a claim about individual input-to-paint latency. Results retain raw samples, iteration counts, source/build identity and coarse environment. Timer-limited values and losing results remain in the record. Cancellation terminates the sandbox; invalid edits retain the last working build and do not silently execute old code under new source labels.

<span id="benchmark-observation-storage"></span>

## Store observations without publishing source

Local runs are retained in IndexedDB, grouped by example/build/settings/coarse environment and a ten-percent logarithmic measurement bucket; a repeat increments its observation count. Sharing to the cross-device database requires an explicit action. Shared records exclude code, issue contents, cookies, account IDs and raw network identifiers. The explicit share request uses the same-origin session where the deployment is protected, without embedding credentials in the measurement record. The service still enforces its exact configured Origin. The service validates bounded samples and uses parameterized storage. Visitor observations are untrusted community data, never automatic qualification evidence or a replacement for reviewed reference runs.

<span id="paired-app-staging"></span>

## Compare complete application branches

Boards and Tasks keep their original implementation and a separate state-lib branch. Each pair uses pinned revisions, the same deterministic data/scenarios and separate staging deployments. Application-owned data, UI state, pending actions and lifecycle state are inventoried by owner and mapped to real source locations, replacement primitives, spec mechanisms and parity tests. Opaque editor/DOM resources remain resources; a retained external query transport must be disclosed as an adapter, not rebranded as a native library engine. No production workspace, notification channel or database is used for the comparison.
