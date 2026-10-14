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
