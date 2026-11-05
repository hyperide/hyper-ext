<span id="compiler-contract" class="anchor"></span>

### Compiler, CLI and documentation contract

**Specification amendment.** Extends R23–R26, R34–R46, R54, R65–R66, R79–R84. The following keeps new requirements in their relevant system chapters rather than a detached ideas file.

Compile from the same TypeScript schema into accessors, relation metadata, validators, action contracts, form constraints, query plans and separate devtools maps. Use typia or an equivalent AOT generator before erasing types. Avoid Proxy on statically understood paths; a fallback is explicit and observable in explain/doctor output. The included checker-based transformer only proves static table/member paths and evaluation order, not a complete production compiler.

The CLI is the primary automation surface. State-definition search/edit, backend-to-fixture capture, snapshot/event-log mock generation and documentation search must be ordinary commands with machine-readable results. `state mcp` wraps the same command services; MCP must not hide exclusive functionality. Capture defaults to schema-driven redaction and excludes secrets. No backend credentials or unrestricted execution are embedded into the browser documentation examples.

Examples must show the same task, same fixtures and same output across compared APIs. Each executable snippet's button must run the code actually shown. A designed-only API is labelled; a snippet without an executable adapter must not pretend to run. The new operator corpus follows this contract for native JS and the experimental query algebra; jq/Ramda/Datalog/etc remain separately named adapter work. Concept references (including patch-emitting transactions and keyed collections) should link to explanations, not remain unexplained badges.

The API page reads the existing generated prototype metadata rather than inventing methods. Missing descriptions and truncated signatures are displayed honestly; completing documentation is not the same thing as enumerating entries. Spec additions are stored in `docs/spec` and composed into relevant chapters of the existing Master spec page, so the old markdown mirror remains unchanged and there is no hidden second copy of the additions.

#### Documentation UI acceptance criteria

Keep paired snippets inside two equal `minmax(0,1fr)` columns with independently scrollable code blocks and no overlap with the TOC. Show the complete selected corpus rather than hiding arbitrary cases behind a research-file reference. Each pair needs correspondence notes and, eventually, paired construct highlighting and value/type hints. The existing 22 production-selector corpus is distinct from the new 38-case executable operator corpus; migration of all older examples remains outstanding.

Header navigation needs delayed reset after genuine pointer leave, a re-entry grace period, edge-triggered smooth scrolling that can reach the final items, and an edge lens/3D effect disabled on the edge the pointer is exploring. Keyboard, coarse pointers and reduced-motion modes retain usable non-animated navigation. These behaviors are specified here but this revision does not claim to have rebuilt the menu.

The requirement destination table should use one explicit Req → Destination pair per row (or label two independent column groups visibly). Vector CLI diagram primitives belong to the separate vector tool: frames, tables, connectors/arrows and accessible color presets, plus an ASCII-box/arrow input format with an explicit supported grammar. This revision does not claim changes to an unavailable local `~/work/.../vecli.ts` checkout.

See [API](/api), [operator examples](/queries), [causal UI](/spec#causal-ui) and [binary ownership](/spec#binary-interop).

#### First executable compiler research slice — 2026-09-18

[Research report](../research/2026-09-18-compiler/REPORT.md) and [hypothesis register](../research/2026-09-18-compiler/HYPOTHESES.md) document the first Python CLI/Rust-Oxc native implementation of `state build`. This is explicit contract-preserving module specialization with conservative per-case evidence gates and static output; it does not yet implement general state lowering, inferred React modes or all R23/R24 tooling. The supplied older master-spec draft is archived by provenance, not applied over current decisions. Wasm/workers capability and numeric experiments are separate from application acceptance.

#### Generated projections and COW qualification — 2026-09-20

The [hybrid research report](../research/2026-09-20-cow-hybrid.md) documents the new Rust-generated projection boundary and the distinction between explicit application COW opt-in, compile-time module qualification and future per-command lowering. Generated modules are virtual, inspectable and source-mapped; ordinary raw/gzip and semantic-evidence gates still apply. This is not general arbitrary-callback compilation. COW historical-reference tests now pass, but whole-document promotion still fails required timing cells. The proposed combination is traced to sections 4.4/4.5/5 and primary persistence/ownership literature; it does not change the canonical contract to fit a benchmark.

#### Canonical identity of virtual generated modules — 2026-09-22

Generated ownership is keyed by the **resolved destination used by the bundler**, not the raw configuration spelling. Dot segments, contained parent segments and in-root directory symlinks cannot make two generating variants own the same destination. Authored roles use the same comparison, while ordinary containment and existing-file checks still apply. The [reproduction and regression record](../research/2026-09-22-generated-path-identity.md) covers six rejected alias cases plus distinct valid modules. Changes to this validator invalidate its existing source fingerprint; historical measurements remain historical. This strengthens the current projection preview without claiming immutable point/dense generation or whole-COW performance admission.

#### Declared immutable commands and bounded generated output — 2026-09-23

The Rust compiler recognizes a `json-command` declaration for scalar set/toggle, per-row/grouped scalar assignment (including sparse stride), move and no-op. It emits short calls into shared ownership-aware helpers, not a complete repeated engine for each command. A separate shared publication factory takes a dedicated Runtime, owns its disposal, and commits one coherent document/history value. The general callback adapter and declared commands use the same publication contract; applications that declare only commands need not import the arbitrary-draft Proxy implementation.

This is explicit command generation, not translation of unrestricted JavaScript callbacks or implicit selection of an arbitrary effectful mutation body. Atomic publication, original-root preservation, alias semantics, synchronous error/notification behavior and bounded history are conformance requirements. Dense array certificates and iterator checks are internal optimization facts, not trusted user declarations; sparse holes retain indexed-copy semantics.

The emitted-entry gate compares raw, gzip and Brotli bytes and accepts optional absolute `maxRawBytes`, `maxGzipBytes` and `maxBrotliBytes` limits. Absolute limits also constrain reference fallback; failure preserves previous output. The current scope is the actual emitted JavaScript entry graph and reachable imports, not a fictional function-only size or a completed multi-route/worker-asset audit.

The [command-builder record](../research/2026-09-23-command-builders.md) contains actual controller and growing-catalogue comparisons. Normal-workload median improvements do not hide failed tail/edge cells. The conservative admission rule is unchanged, so incomplete qualification still emits references. The [algorithm portfolio](algorithm-portfolio.md) records implemented candidates separately from prior-art proposals, and does not claim every surveyed structure has been implemented. Public marketing reports are paused; technical evidence remains available.

#### Shared native and browser compiler — 2026-09-24

`compiler/src/lib.rs` is the single Rust planner used by the CLI binary and browser Wasm export. The browser's `compile_json` boundary accepts bounded JSON source inventories and returns the same plan/generated modules; it never executes the supplied application. The host isolates compilation from the editable-program worker. Native qualification and full-entry size admission are not bypassed by publishing a workbench: the workbench explicitly compares both candidates and does not label its choice a production admission.

The profile fingerprint includes the shared planner and Cargo configuration. The [browser-compiler record](../research/2026-09-24-browser-compiler.md) documents exact parity tests and the separate library build target. Compiler and bundler artifacts are loaded on demand by the workbench and are accounted separately from the application entry they emit.
