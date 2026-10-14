# Research — normalisation and conversion at the store's boundaries

**Date:** 2026-09-04 · **Status:** research, nothing decided · **Requirements:** R58 (should the toolkit promote normalised data from the backend?), R83 (declarative two-way converters at both boundaries — the new ask this answers) · **Extends:** §4.13 of the master spec (tiers, models, custom types and their codecs)

**Findings in short.** normalizr, the canonical answer for a decade, is dead — archived, last released 2022-03-19, final commit `end: no longer maintained` — and still downloaded ~587,000 times a week, so the problem outlived the library. Its _schema-as-data_ idea survives everywhere. The deepest normalisation in the ecosystem is in the GraphQL clients, and what distinguishes them is not how they store entities but **how they decide what an entity is**, and what they do when they cannot tell. The closest existing thing to what R83 asks for is **effect's `Schema`**, bidirectional in its type parameters rather than by convention. The central claim below: the brief's two boundaries cannot share one mechanism — not for taste, but because merging their laws produces corruption — and this toolkit already owns most of the parts needed to keep them apart.

---

## 1. The landscape, verified

Versions and dates were read from the npm registry and the GitHub API on 2026-09-04, not from documentation prose.

| Tool                        | Latest  | Published  | Status                                                             |
| --------------------------- | ------- | ---------- | ------------------------------------------------------------------ |
| normalizr                   | 3.6.2   | 2022-03-19 | **Dead** — repo archived, final commit `end: no longer maintained` |
| `@data-client/normalizr`    | 0.18.1  | 2026-05-13 | Maintained; same schema API, inside Reactive Data Client           |
| `@reduxjs/toolkit`          | 2.12.0  | 2026-05-15 | Maintained                                                         |
| `@apollo/client`            | 4.2.12  | 2026-08-14 | Maintained                                                         |
| `@urql/exchange-graphcache` | 9.0.1   | 2026-06-15 | Maintained                                                         |
| `relay-runtime`             | 21.0.1  | 2026-05-27 | Maintained                                                         |
| `@tanstack/query-core`      | 5.102.8 | 2026-08-27 | Maintained                                                         |
| `@tanstack/db`              | 0.8.7   | 2026-08-31 | Maintained; §8.1 pins 0.8.x                                        |
| superjson                   | 2.2.6   | 2025-11-27 | Maintained, but slowing — no commit since 2026-06-18               |
| devalue                     | 5.9.2   | 2026-08-27 | Maintained                                                         |
| seroval                     | 1.6.4   | 2026-08-25 | Maintained                                                         |
| zod                         | 4.5.4   | 2026-08-29 | Maintained; codecs shipped in 4.1.0 (2025-08-23)                   |
| valibot                     | 1.4.2   | 2026-06-28 | Maintained                                                         |
| effect (`effect/Schema`)    | 3.22.1  | 2026-07-30 | Maintained; **4.0 in RC** (`4.0.0-rc.112`)                         |
| `@effect/schema`            | 0.75.5  | 2024-10-16 | **Deprecated** — "merged into the main effect package"             |
| io-ts                       | 2.2.22  | 2024-12-10 | Frozen — not archived, but no commit since                         |
| arktype                     | 2.2.3   | 2026-07-07 | Maintained                                                         |
| react-hook-form             | 7.87.0  | 2026-08-30 | Maintained                                                         |

[**normalizr**](https://github.com/paularmstrong/normalizr) is dead and load-bearing anyway. What survives is that its schema was _data_, not procedure: you declared an entity with an `idAttribute`, composed entities into arrays and objects, and the same declaration drove both `normalize` and `denormalize`. Three options remain the right vocabulary — `idAttribute` (identity as a function of the row), `processStrategy` (a per-entity ingest converter) and `mergeStrategy` (the same entity arriving twice). Its mistake was being a runtime tree-walker, exactly the part a compiler replaces.

**Redux Toolkit's `createEntityAdapter`** contributes the other half: normalised state as a first-class _store shape_ (`{ ids, entities }`) with generated reducers and selectors, not a transformation run at the door. §4.5's `collection(Item, { key })` is already that shape with a reactive node per item — prior art adopted, not a decision open.

**Normalised caches in GraphQL clients** are the deepest implementations, and they differ exactly where it matters. [Apollo's `InMemoryCache`](https://www.apollographql.com/docs/react/caching/cache-configuration) normalises on `__typename` plus `id`/`_id`, overridable with `keyFields` in a `TypePolicy`: composite and nested keys (`keyFields: ["title", "author", ["name"]]`), `keyFields: []` for singletons, and a function taking `(object, context)`. `keyFields: false` disables normalisation for a type, and in Apollo's words such objects "are instead embedded within their _parent_ object in the cache. You can't access these objects directly, but you can access them via their parent." [urql's Graphcache](https://github.com/urql-graphql/urql/blob/main/docs/graphcache/normalized-caching.md) assumes the same fields and, per its docs, "if Graphcache can't find these two fields it'll issue a warning", with a `keys` config for custom keys. Relay takes the opposite stance and _enforces_ identity through its [server specification's global object identification](https://relay.dev/docs/guides/graphql-server-specification/#object-identification), so it never guesses. Graphcache's own docs draw the contrast: Relay can assume "there's an obvious primary key for each entity", while Graphcache and Apollo assume there only _may_ be one. That is the design axis. Guess-and-warn buys adoption against schemas you do not control and pays in silent embedding; requiring global ids buys correctness and demands a compliant server. Apollo's field policies are also prior art for conversion — `read` transforms a stored value on the way out, `merge` controls how incoming data combines with the cached record — but they are two independent one-way hooks, and nothing checks that `read` inverts `merge`.

**TanStack Query refuses to normalise, on the record.** Its [GraphQL guide](https://github.com/TanStack/query/blob/main/docs/framework/react/graphql.md): "React Query does not support normalized caching. While a vast majority of users do not actually need a normalized cache or even benefit from it as much as they believe they do, there may be very rare circumstances that may warrant it." If the server is authoritative and you invalidate rather than mutate, normalisation buys consistency you were going to refetch anyway, priced in identity configuration, partial-record merging and garbage collection. It is not ideological — the same team ships `@tanstack/db` with normalised collections for the cases that need them, which marks where the line sits.

[**JSON:API**](https://jsonapi.org/) is at v1.1, finalised 2022-09-30. Its `data`/`included`/`relationships` structure with `{type, id}` identifiers is genuinely normalised, but by the wrong axis for a client: you still index `included` yourself, relationships sit a level deeper than any component wants, and the format constrains the server far more than it helps the client.

**Serialisation and revival** is solved. [`structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone) handles `Date`, `Map`, `Set`, `RegExp`, `ArrayBuffer`, `BigInt` and cycles, but has no extension point and does not preserve prototypes, so a custom type returns as a plain object. All three libraries fill that gap identically — a _registry of user-declared converters_. [superjson](https://github.com/ravionhq/superjson) takes `registerCustom<Decimal, string>({ isApplicable, serialize, deserialize }, 'decimal.js')`; its own example is a money type. [devalue](https://github.com/sveltejs/devalue) takes `reducers` on `stringify` and `revivers` on `parse`, and already ships `Temporal`. seroval takes plugins. A per-type `{ encode, decode }` registered once and consulted by every boundary is the settled answer — §4.13.3's `codec` already is one.

**Schema libraries as converters** are ahead on typing, behind on symmetry. zod's `.transform()`/`.preprocess()` are one-way by construction — encoding through a transform throws — which is why 4.1 added [`z.codec()`](https://zod.dev/codecs) as a distinct type holding both sides, driven by `z.decode()`/`z.encode()`, with `isoDatetimeToDate` among the built-ins. valibot's pipelines and ArkType's morphs are one-way in the same sense. **[effect's `Schema`](https://effect.website/docs/schema/introduction/) is the closest existing thing to R83.** From its shipped types, `Schema<in out A, in out I = A, out R = never>` carries `Type: A` (decoded, in memory), `Encoded: I` (at the boundary) and `Context: R`. Every schema is a _pair_ of types with a transformation between them; `decodeUnknown` and `encode` are peers rather than a primary and an afterthought; `transform`/`transformOrFail` demand both directions, with a fallible inverse expressible rather than smuggled in. The third parameter is the idea worth stealing — a transformation can declare it _requires context_, precisely the distinction §2 draws. Caveats: 4.0 is in release candidate, so names must be checked against the major targeted, and standalone `@effect/schema` is deprecated in favour of `effect/Schema`. io-ts had the same `Type<A, O, I>` symmetry years earlier and is frozen.

**The ORM tradition solved the motivating example a decade ago.** Rails' [`ActiveModel::Type::Value`](https://api.rubyonrails.org/classes/ActiveModel/Type/Value.html) has exactly three conversion methods: `cast` (user input → Ruby object), `serialize` (Ruby object → database), `deserialize` (database → Ruby object, defaulting to `cast`). That is the three-representation problem, named and separated. Django splits the two boundaries across two class hierarchies — `Field.get_prep_value`/`from_db_value`/`to_python` on the model, `forms.Field` plus the widget's `format_value` on the presentation side. Note what neither puts on the type: an outward _display formatter_; Rails leaves that to view helpers. The client reinvents this badly because it reinvents it once per library — the serialiser knows nothing about the form library, which knows nothing about the store — so one value gets three unrelated declarations in three files.

**The view-layer half has the least prior art.** React Hook Form offers `setValueAs`, `valueAsNumber` and `valueAsDate` on `register()`: inward only, no outward counterpart, unavailable on `Controller`. Vue's `defineModel` with `modelModifiers` and get/set transformers is nearer a real pair. Angular's [`ControlValueAccessor`](https://angular.dev/api/forms/ControlValueAccessor) is the only mainstream API bidirectional by construction — `writeValue` model→view, `registerOnChange` view→model, neither implementable alone. The platform is more discouraging: `Intl.DateTimeFormat` and `Intl.NumberFormat` ship **no parse at all**, deliberately and repeatedly reaffirmed ([tc39/ecma402 #147](https://github.com/tc39/ecma402/issues/147), [#342](https://github.com/tc39/ecma402/issues/342), [#850](https://github.com/tc39/ecma402/issues/850)), because a locale-aware parser is not the mirror of a formatter. [**Temporal**](https://github.com/tc39/proposal-temporal) reached Stage 4 in March 2026 and is in ECMAScript 2026 but is not Baseline: Chrome and Edge 144 and Firefox 139 ship it and Node 26 has it unflagged, while Safari does not support it at all ([WebKit bug 223166](https://web-platform-dx.github.io/web-features-explorer/features/temporal/)). A `Temporal` custom type is therefore a reasonable target and an unreasonable assumption for at least one more browser cycle.

## 2. The two boundaries are not one boundary

Store↔outside is a **fidelity** problem: `decode(encode(v))` must equal `v`, the function depends on nothing but the value, and failure is corruption that survives a reload. Store↔component is a **presentation** problem: lossy on purpose, dependent on ambient context, and its inverse can fail on input the user is halfway through typing.

The decisive argument against merging them is what happens to the laws. Give a value one `encode`/`decode` pair serving both, and either the presentation goes locale-blind or the wire format goes locale-dependent — and a German user's persisted record holds `1.234,56` where an English user's holds `1,234.56`. That is not a formatting bug; it is corruption written to disk. Every system that has met this has split it — Rails, Django and `Intl` alike (§1).

Two consequences follow. Presentation depends on ambient state that is itself store state, so it must be **reactive** — change the locale and every formatted string recomputes; a codec never can be. And parse failure needs _both_ representations at once, the raw string and the last good value, which is exactly what R77 ("never lose user input") describes. A codec never holds two.

## 3. Performance, honestly

One machine, one run (Node 26.7.0, Apple M4 Pro; 10,000 rows with two `Date` fields each, 20 iterations — 3 for the constructed-per-row case). Indicative, not a benchmark result:

| Operation                                                     | Per payload | Per row  |
| ------------------------------------------------------------- | ----------- | -------- |
| `JSON.stringify` + `JSON.parse` (Dates degrade to strings)    | 13.85 ms    | 1.38 µs  |
| `structuredClone` (Dates preserved)                           | 5.96 ms     | 0.60 µs  |
| JSON round trip + revive two `Date` fields                    | 5.29 ms     | 0.53 µs  |
| `Intl.DateTimeFormat` **constructed** per row, then formatted | 254.46 ms   | 25.45 µs |
| `Intl.DateTimeFormat` constructed once, `.format` per row     | 4.58 ms     | 0.46 µs  |

**At a sync boundary** conversion runs once per payload at about half a microsecond per row, against a network round trip in tens of milliseconds. It is free — the owner's concession is more generous to the objection than the measurement is.

**In a component render** the cost is real, but the dominant term is not the conversion; it is constructing the formatter, at 55× the cost of reusing one. A `formatDate(d)` helper that news up an `Intl.DateTimeFormat` per call is the actual defect in most codebases that have one. The compiler can hoist construction to module scope keyed by the options object, turning the pathological row into the cheap one with no developer memoisation.

**On every read of a store path** is the case to refuse: it runs once per subscriber per read, and a `decode` returning a fresh object destroys referential stability, turning every equality check into a re-render. Conversion belongs at boundaries because boundaries are countable and reads are not.

So the compiler eliminates unused codecs, lowers a declared `encode`/`decode` into monomorphic code rather than a generic walker, and hoists formatter construction. It cannot remove the `Intl` call or the parsing of user input. Placement deserves deciding rather than defaulting: patches carry values, so a codec must run at the _transport_ edge for replication and persistence, while the in-memory patch log behind undo holds live values and needs no encoding at all.

## 4. Where identity comes from

Normalisation is only as good as the answer to "what is this thing?". The hook exists — `getKey` in the §8.1 source contract, `collection(Item, { key })` in §4.5.

**Composite keys.** Apollo takes `keyFields: ['orgId', 'sku']`, RTK a `selectId` function, normalizr an `idAttribute` that could itself be a function. A function of the row subsumes all three, and `getKey` already is one. The thing to write down is that a composite key must produce a _stable string_, because patch paths embed it (`/items/byId/<id>/done`); a key whose serialisation varies corrupts the patch log rather than merely missing a cache hit.

**No server id yet.** An optimistic insert needs a key before the server issues one. The spec already mints a ULID at the call site for `idempotencyKey` (§8.7), and that value should serve as the provisional key. What needs deciding is the acknowledgement. A silent swap to the server id is wrong here in a way it is not wrong for Apollo, because our ids live _inside patch paths_: rewriting them behind the log's back corrupts undo and replication replay. The honest choices are an explicit rekey operation inside the transaction, or keeping the client id permanently and carrying the server id as an ordinary field. The second is duller and probably right.

**The same entity in two shapes.** A list endpoint returns `{id, name}`; a detail endpoint returns `{id, name, address, orders}`. Every normalised cache merges at field level rather than replacing the record — Apollo's `merge` policies and normalizr's `mergeStrategy` are the same idea. The failure mode is that the merged record satisfies no declared type: it is a partial. This is the one place a compiled, type-driven toolkit is genuinely worse off than a runtime one, because "a `User` missing some fields" is a type nobody wrote. Field-level merge with last-write-wins per field is the right default; making partiality visible in the type system is unsolved.

**When identification fails** the three diverge, and the divergence is the most useful finding here. Apollo inlines the raw object into its parent and, on the next write, _overwrites it wholesale_ — the earlier query's fields are lost, behind a dev-only warning that fires at most once per `Type.field` per process. urql instead synthesises a key from the path (`Todo:1.image`) and stores a real record, so two queries selecting different fields merge without loss; it warns at write time. Relay does the same with `client:<parentID>:<storageKey>` and does not warn at all. **Copy the path-keyed approach**: an unidentifiable entity degrades to "reachable only through its parent" rather than to silent data loss, and it costs one synthesised key.

## 5. Recommendation

**On R58 — no, do not specify or promote a wire-format schema.** Recommending JSON:API asks a team to change the backend they have just said they cannot change, contradicting the transitional brief. Storage here is already normalised; what is missing is not a wire contract but an **ingest mapping**. Specify that: a declarative shape attached to a source, mapping a denormalised payload into one or more collections — normalizr's `schema` idea rebuilt as compiled code rather than a runtime tree-walk, with `getKey` for identity and a declared merge for the two-shapes case. JSON:API and GraphQL become one supplied shape each, not a house standard.

**Normalisation should be opt-in per collection.** Not automatic: that requires guessing identity, and every failure mode in §4 lives inside the guess. Not migration-only either, which undersells it — a denormalised REST API is a permanent condition for plenty of projects, not a phase they pass through.

**Conversion should be two concepts declared in one place.** Keep §4.13.3's `codec` and tighten its contract in writing: total, pure, no ambient input, round-trip-equal, used by persistence, SSR, replication and the wire. Add a _separate_ presentation pair declared adjacently on the same custom type, so the brief's "declared once, not scattered" holds, but typed differently — the outward half is a `derived` field (§4.13.1), because it depends on reactive ambient state; the inward half is R67's two-way binding, whose parse is partial and whose failure is R77's business. One declaration site, two contracts, and the type system is what stops a locale reaching the wire. Note how little is new mechanism: the brief's "normalisation when editing" is the existing `prepared` tier and "when using data in components" is the existing `derived` tier, so much of R83 is routing the ask onto §4.13.1 rather than inventing.

**Refuse:** conversion on every read of a store path, automatic identity inference, and one `encode`/`decode` pair serving both boundaries. **Leave to interop:** Standard Schema for runtime validators, and the serialiser registries — a project already on superjson or devalue should hand us its registered types rather than redeclare them.

## 6. Open questions

- What a partial entity _is_ in a compile-time-typed store, once field-level merge is allowed. The largest hole here.
- Whether an ingest shape that cannot express polymorphic unions and recursive graphs is worth having — normalizr expressed both cheaply, precisely because it was a runtime walker.
- Whether `prepared` (§4.13.1) is genuinely the home for write-time normalisation, or whether ingest and `prepared` are one mechanism under two names.
- Whether the presentation pair is per-type or per-call-site: a `Money` has one wire form, but a table cell, an invoice total and a text input want three different strings.
- Whether the rekey-on-acknowledgement choice in §4 can be deferred past v1 without painting the patch log into a corner.
