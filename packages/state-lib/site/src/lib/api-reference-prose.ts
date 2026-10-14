/** Reader-facing contracts missing from the prototype's JSDoc. These describe
 * the current implementation, including its limits, not future spec guarantees. */
import { GENERATED_API } from './api-docs.generated';
import { API_DOCS } from './api-docs';

const REFERENCE_PROSE: Record<string, string> = {
  'region.domain': 'Marks an initial subtree as domain state. The marker is consumed by createStore/normalizeRegions and does not survive into snapshots or patches. In this prototype domain means the business-truth policy default, including persistence when a persistence adapter is configured; the marker itself performs no I/O or access control.',
  'region.view': 'Marks an initial subtree as view state. The marker is compile-time-style metadata consumed during store creation and removed from runtime data. View state defaults to non-persistent UI state; the helper does not create a separate store or perform I/O by itself.',
  'region.session': 'Marks an initial subtree as session state. The marker is removed during normalization and supplies the session policy default; it is metadata, not authentication, authorization or an implicit storage boundary.',
  'region.draft': 'Marks an initial subtree as draft state. The marker is removed before the state tree is exposed and supplies draft policy defaults. It does not itself validate, save, synchronize or commit the draft.',
  tx: 'Runs fn synchronously and returns its result. Nested calls defer the reactive flush until the outermost call exits. Use it to batch related signal writes. This prototype is notification batching, not rollback: the finally block flushes even when fn throws, and an async callback is not held open across await.',
  'store.state': 'The store’s tracked proxy. Read paths inside derive or watch to register dependencies; use named actions for logged writes. Reading snapshot() instead is untracked. Do not confuse this mutable-looking proxy with a frozen snapshot.',
  'store.action': 'Creates a named synchronous command and returns a function accepting the callback’s remaining arguments. The callback receives the tracked store proxy, not an Immer draft. Its writes are batched and recorded as patches plus inverses. Prototype limitation: the command commits in finally, so a throwing callback can leave and log partial writes; it is not rollback-on-error and must not be treated as the stronger production transaction contract.',
  'store.snapshot': 'Returns a fresh structuredClone of the raw tree on every call. Reads are untracked; the clone is detached but not frozen or structurally shared. Use it for inspection or serialization boundaries, not as a stable React getSnapshot function. The adapter guide demonstrates an explicit cached snapshot bridge.',
  'store.log': 'The prototype’s live transaction-history array, not the REPL log(...args) function. Each entry records id, name, forward patches, inverse patches and timestamp. New commits discard any redo tail and retain at most 200 entries. Treat this exposed array as read-only; mutating it bypasses store bookkeeping.',
  'store.redo': 'Applies the next recorded transaction’s forward patches and advances the cursor. Returns true when a step was replayed, false when no redo step remains. A new command after undo discards the old redo tail. Replaying local patches does not resend a network request.',
  'store.cursor': 'Zero-based index of the last applied transaction in store.log; -1 means before the first entry. Read it to display the current history position, and use undo, redo or jumpTo to move it rather than trying to assign this getter.',
  'store.canUndo': 'Whether the history cursor is at or after the first recorded entry. Use it when displaying an Undo control; undo() itself returns false at the boundary. This getter is not an independently tracked signal.',
  'store.canRedo': 'Whether the cursor precedes the last recorded entry. Use it when displaying a Redo control; redo() checks the boundary too. This getter is not an independently tracked signal.',
  'store.isPending': 'Tests whether an optimistic transaction id is still awaiting its send promise. This is a synchronous lookup, not a reactive subscription. Use onPending for changes and keep transaction ids distinct from entity ids.',
  'store.rejectionFor': 'Returns the rejection value retained for an optimistic transaction id, or undefined when no value is found. The value is unknown, not necessarily an Error. Because a promise can reject with undefined, this return alone is not a complete settlement-status discriminator.',
  'store.onPending': 'Registers a callback for optimistic pending/settlement changes and returns its unsubscribe function. It does not invoke the callback immediately. Read pending, isPending and rejectionFor to obtain values, and dispose the subscription with its owning view.',
  'store.onLog': 'Registers a callback for history notifications and returns its unsubscribe function. No initial callback is sent. Prototype caveat: during undo/redo, patch-application notifications and the final cursor update are not one atomic observer snapshot; this hook is not a production external-store consistency guarantee.',
  'store.raw': 'The actual mutable backing tree, exposed for this prototype’s internals and experiments. Reads are untracked; direct writes bypass proxy notifications, patches and history. Application writes should go through actions, and inspection should normally use snapshot().',
  encodeFor: 'Looks up an exact path in the supplied TypeMap and calls that type’s codec.encode(value); without a matching declaration it returns value unchanged. Use at a wire boundary. It does not recursively walk a snapshot, infer wildcard paths or apply locale presentation.',
  decodeFor: 'Looks up an exact path in TypeMap and calls codec.decode(wire), otherwise returns wire unchanged. Use at a transport boundary before storing the domain value. Codec errors propagate; this is not the partial-input parser used to preserve unfinished edits.',
};

export function referenceDoc(name: string): string | undefined {
  return REFERENCE_PROSE[name] || GENERATED_API[name]?.doc || API_DOCS[name]?.doc || undefined;
}
