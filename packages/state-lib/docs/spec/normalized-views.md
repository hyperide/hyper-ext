<span id="normalized-views" class="anchor"></span>

### Transparent normalized views and writes

**Specification revision, September 8, 2026.** Extends R2, R43, R49, R79 and R83. The access experiment implements the syntax below; it is not yet a replacement for the complete existing prototype.

```ts
store.state.invoices[1].customer.name = 'Acme Studio';
```

`invoices[1]` here means stable invoice ID 1, not position 1 in an ordered query result. Keyed entity tables and positional query results are distinct types. The apparent nesting is a generated view, not the storage representation:

```ts
invoices: { 1: { id: 1, customerId: 7 }, 2: { id: 2, customerId: 7 } }
customers: { 7: { id: 7, name: 'Acme' } }
```

Both invoices resolve to the same customer. A write through either relation changes exactly one authoritative customer row. The read/write path performs a bounded number of lookups. Complexity is O(path depth), with expected O(1) indexed lookup per hop. This does not imply O(1) sorting, reverse fan-out, subscriber notification, relation materialization, validation of arbitrarily large values or persistence.

#### No tx or drafts in ordinary application code

`tx` was shorthand for a transaction context: internal bookkeeping grouping writes into one atomic change. `drafts` meant writable views into that context. Those names described implementation machinery, not the intended public interface.

A setter outside an action performs one implicit synchronous commit. A declared action groups multiple writes without exposing a transaction parameter:

```ts
const renameCustomer = store.action('customer.rename', name => {
  store.state.invoices[1].customer.name = name;
  store.state.invoices[1].amount = 150;
});
renameCustomer('Acme Studio');
```

This experimental action factory closes over `store`; the current site's older prototype passes state as its first callback argument. A migration must reconcile the callback convention explicitly. Read-your-writes is synchronous; observers see only the committed result. An exception or failed validation publishes none of the writes. Do not keep an ambient mutable transaction across `await`: await outside, then commit against a version/precondition.

#### Compiled bracket access and generated entity views

The included TypeScript-checker-based experiment lowers `store.state.invoices[id].customer.name` to internal indexed operations. Assignment lowering resolves the left-hand target before evaluating the right-hand expression, preserving JavaScript evaluation order. Shadowed variables named `store` are not rewritten. Compound assignment and postfix increment are covered by tests.

The runtime-only fallback registers ordinary property getters for current IDs; this registration is O(N) on membership changes. The compiled path avoids registering a million object properties. Neither path uses a general-purpose Proxy. This is a narrow compiler experiment, not a complete JSX compiler; dynamic table/field paths require a stated fallback.

Cached live entity views carry a generation so a deleted/recycled ID cannot silently address a new entity. Immutable snapshot views must be explicitly version-pinned; the experiment instead exposes a separate normalized inspection snapshot. Relation dependency tracking must follow foreign-key changes. Reverse indexes are needed to make wide dependency fan-out and referential deletion checks scale; the experiment's deletion check still scans rows.

#### Typia is already the chosen validation approach

R49 adopted typia-style AOT validation. Type erasure is precisely why generation runs before erasure, not an argument against it. The same model should drive generated validators, accessors, relation metadata, action inputs and form constraints. Constraint annotations are required for limits that cannot be inferred from `string` or `number` alone. External input and action boundaries are validated; ordinary internal reads do not revalidate the whole graph.

The local tests inject fixture validators. They execute the TypeScript access transformer, but do not claim an installed typia build ran. Typia generates validation, not our relation store, indexes, transaction protocol or reactive dependency graph.

See [operator examples](/queries), [prototype API](/api), [compiler contract](/spec#compiler-contract) and [binary data ownership](/spec#binary-interop).

Sources: [Typia](https://typia.io/docs/), [constraint tags](https://typia.io/docs/validators/tags/).
