<span id="binary-interop" class="anchor"></span>

### Binary ingress, host references and memory ownership

**Research-backed design amendment, September 8, 2026.** Extends R14, R32, R43 and R46. The browser experiments measure compute and API behavior, not an end-to-end network pipeline.

`externref` can carry an opaque reference to an ordinary JS value. It does not make arbitrary object properties or JS-array elements accessible through Wasm linear-memory loads. JS string builtins specialize string operations; they are not a universal `object.get`/`array.load` interface. Typed WasmGC structs are also not interchangeable with arbitrary JS objects. Ordinary imported JS getters are possible, but repeated imports may replace one bulk conversion with millions of boundary calls. Our separate host-getter benchmark measures that tradeoff, rather than assuming it away.

#### PostgreSQL jsonb is not a ready-to-map transport layout

PostgreSQL's current `jsonb_send` serializes a version byte followed by JSON text, even in its binary protocol. Its on-disk jsonb representation is not what this protocol sends. A backend may define a different binary format, but calling it jsonb does not determine its layout or its read costs.

MessagePack/CBOR/BSON avoid some textual representation costs, but do not automatically provide typed, indexed, zero-deserialization tables. FlatBuffers is designed for generated access into serialized buffers. Arrow supplies columnar buffers, validity bits, offsets and dictionary encoding, which fit scans and SIMD. A custom schema-specific format is another candidate, with maintenance and compatibility costs.

#### Copy budget

| Boundary | What remains |
|---|---|
| Network to application buffer | Fetch/decompression and buffer handling; do not call this universally zero-copy |
| Existing ArrayBuffer to ordinary Wasm memory | Usually one bulk copy; the standard memory constructor does not adopt an arbitrary existing buffer |
| Wasm memory to JS TypedArray/DataView | Shared view, no duplicate payload; individual scalar loads still execute |
| UTF-8 bytes to real JS string | Decode/materialize on demand; a mutable byte span is not an immutable JS string |
| Buffer transfer to worker | Changes ownership; does not automatically make it Wasm linear memory |
| Shared memory | Shares bytes, not arbitrary JS heaps; requires synchronization and deployment support |

A practical candidate pipeline is backend normalized binary data → worker ingress → validate layout once → place in resident memory → JS/Wasm generated views → decode only visible strings. Strings can remain `(offset,length)` pairs; a bounded version-aware cache avoids decoding the same displayed label repeatedly. Binary bounds, alignment, offsets, UTF-8 and schema-version validation are separate from typia's validation of ordinary JS values.

Do not recreate JS objects for every row after receiving binary data; that would throw away the intended benefit. Also do not claim all formats are cheap to mutate: variable-length strings and array growth can require new buffers, overlays or deltas. Persistent ownership, bounded caches and explicit lifetime rules matter more than one particular serializer.

#### BYOB is not a blanket escape hatch

A standard byte-stream BYOB reader may transfer/detach its destination buffer. Wasm memory buffers have special non-detachment rules. In Chromium 144, the included ordinary `ReadableStream` test accepts an ordinary ArrayBuffer, detaches it and returns a view; passing a view of Wasm memory rejects with a TypeError. A JS DataView over that same Wasm memory works normally. This is an API experiment, not a fetch benchmark or a claim about every future browser API.

Use feature detection and preserve views correctly across memory growth. An adaptive planner must account for initial packing, validation, indexing, queue time and output materialization, not only the hot loop. Do not migrate the whole store on every action; choose execution plans and chunk sizes while keeping data ownership stable.

Sources: [PostgreSQL jsonb source](https://doxygen.postgresql.org/jsonb_8c_source.html), [JS string builtins](https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins), [Wasm JS API](https://webassembly.github.io/spec/js-api/), [WHATWG Streams](https://streams.spec.whatwg.org/), [FlatBuffers](https://flatbuffers.dev/white_paper/), [Arrow format](https://arrow.apache.org/docs/format/Columnar.html).
