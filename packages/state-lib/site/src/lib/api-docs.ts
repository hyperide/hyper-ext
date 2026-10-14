/**
 * What the editor's hover knows (R81).
 *
 * A one-line signature and a sentence for every name the playground puts in
 * scope. This is a hand-kept index rather than a language server, and the
 * trade is stated plainly on the page: the site is one self-contained file that
 * opens from disk, and a real TypeScript service is several megabytes and a
 * pool of workers. What a reader actually wants at a hover — what is this, what
 * does it do, and what does it hold right now — is answerable without one, and
 * the third part is answerable *better*, because the frames know the value at
 * the step being looked at rather than at the end of the run.
 */
import { GENERATED_API } from './api-docs.generated';

export type ApiDoc = { sig: string; doc: string; spec?: string };

/**
 * Which generated key a `receiver.member` hover should try. The generator emits
 * `store.<method>` for the store's methods and `<Type>.<member>` for interface
 * members, so `ctx.spawn` has to be routed to `TaskContext.spawn`. Anything not
 * listed falls back to the bare member name, which is right for module exports.
 */
const RECEIVERS: Record<string, string> = {
  store: 'store',
  ctx: 'TaskContext',
  child: 'TaskContext',
  scope: 'Scope',
  route: 'Scope',
  task: 'Task',
  f: 'Field',
  field: 'Field',
  view: 'DerivedCollection',
};

/**
 * The hover's one entry point. The signature always comes from the compiler's
 * output when it has one — that is the point of generating it — and the sentence
 * comes from the hand-written index where one exists, because a sentence written
 * for a reader beats a JSDoc paragraph written for a maintainer; the JSDoc is the
 * fallback. `spec` is only ever hand-written.
 */
export function lookup(name: string, receiver?: string): ApiDoc | undefined {
  const hand = API_DOCS[name];
  const candidates: string[] = [];
  if (receiver) {
    const mapped = RECEIVERS[receiver];
    if (mapped) candidates.push(`${mapped}.${name}`);
    candidates.push(`${receiver}.${name}`);
    // A member of any interface, when the receiver is a name we do not know.
    const anyMember = Object.keys(GENERATED_API).find((k) => k.endsWith(`.${name}`));
    if (anyMember) candidates.push(anyMember);
  }
  candidates.push(name);
  const gen = candidates.map((k) => GENERATED_API[k]).find(Boolean);
  if (!gen && !hand) return undefined;
  return {
    sig: gen?.sig ?? hand!.sig,
    doc: hand?.doc ?? gen?.doc ?? '',
    spec: hand?.spec,
  };
}

/** Everything completion may offer after `receiver.` — the generated members of that type. */
export function membersOf(receiver: string): { label: string; sig: string; doc: string }[] {
  const prefix = `${RECEIVERS[receiver] ?? receiver}.`;
  return Object.entries(GENERATED_API)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ label: k.slice(prefix.length), sig: v.sig, doc: v.doc }));
}

export const API_DOCS: Record<string, ApiDoc> = {
  createStore: {
    sig: 'createStore<T>(initial: T, opts?: { regions }): Store<T>',
    doc: 'Makes a store. Reads through `store.state` are tracked per path; writes go through actions and commit one transaction each.',
    spec: '§4.2',
  },
  action: {
    sig: 'store.action(name, (draft, ...args) => void): (...args) => void',
    doc: 'Wraps a mutation as a named command. Calling it commits one transaction: a new snapshot, its patches, their inverses, and the name.',
    spec: '§4.4',
  },
  state: {
    sig: 'store.state: T',
    doc: 'The tracked proxy. Reading a path inside `derive` or `watch` subscribes to exactly that path — this is what a snapshot cannot do.',
    spec: '§4.1',
  },
  snapshot: {
    sig: 'store.snapshot(): T',
    doc: 'An untracked plain snapshot copied with structuredClone on every call. It is detached, but not frozen or structurally shared; structural sharing is a production design goal, not implemented here. Reading it subscribes to nothing.',
    spec: '§4.4',
  },
  log: { sig: 'log(...args): void', doc: 'Prints into the output panel on the right. The playground’s console.' },
  derive: {
    sig: 'derive<T>(fn: () => T, name?): () => T',
    doc: 'A lazy cached computed. Recomputes only when a path it read actually changed, and only when something reads it.',
    spec: '§4.3',
  },
  watch: {
    sig: 'watch(fn: () => void): () => void',
    doc: 'Runs now and again whenever a signal it read changes. The low-level subscription — not the declared `effect`, which is a different thing on purpose.',
    spec: '§4.3',
  },
  signal: {
    sig: 'signal<T>(value, name?): Signal<T>',
    doc: 'One reactive cell. `.get()` subscribes, `.peek()` does not, `.set(v)` notifies.',
    spec: '§4.1',
  },
  deriveCollection: {
    sig: 'deriveCollection(store, basePath, { filter, sort, key })',
    doc: 'A filtered, sorted view maintained from patches: a write repairs the positions it touched instead of re-running the whole query.',
    spec: '§4.5',
  },
  createScope: {
    sig: 'createScope(name, parent?): Scope',
    doc: 'A lifetime that owns tasks. Ending it cancels everything under it — this is what a route scope does when the user navigates away.',
    spec: '§4.15.2',
  },
  run: {
    sig: 'scope.run(name, async (ctx) => T, opts?): Task<T>',
    doc: 'Starts a task in this scope. `opts` takes `policy` (latest | leading | queue | every), `timeout`, and a supersession `key`.',
    spec: '§4.15.3',
  },
  ctx: {
    sig: 'TaskContext',
    doc: 'What a task body is handed: `signal` for fetch, `reason()` for why it was cancelled, `progress()`, `spawn()`, `all()`, `race()`, `shield()`, `onCancel()`.',
    spec: '§4.15.3',
  },
  spawn: {
    sig: 'ctx.spawn(name, fn): Task',
    doc: 'A child task. Cancelling the parent cancels it; a failing sibling does not.',
    spec: '§4.15.2',
  },
  shield: {
    sig: 'ctx.shield(fn): Promise<T>',
    doc: 'A region cancellation may not interrupt. The cancel lands after it returns.',
    spec: '§4.15.3',
  },
  onCancel: {
    sig: 'ctx.onCancel(fn): void',
    doc: 'A finaliser. They run last-in-first-out, which is the order cleanup has to happen in.',
    spec: '§4.15.5',
  },
  delay: {
    sig: 'delay(ms, signal?): Promise<void>',
    doc: 'A cancellable wait. Stands in for a request in these examples.',
  },
  undo: {
    sig: 'store.undo(): void',
    doc: 'Applies the last transaction’s inverse patches. Costs the size of the change, not the size of the state.',
    spec: '§4.10',
  },
  redo: { sig: 'store.redo(): void', doc: 'Moves the history cursor forward again.', spec: '§4.10' },
  persist: {
    sig: 'store.persist(adapter, opts?)',
    doc: 'Writes selected patches to the configured adapter when transactions commit. `regions`, `include` and `exclude` choose what travels; declaring a region alone performs no storage I/O.',
    spec: '§8.5',
  },
  optimistic: {
    sig: 'store.optimistic(name, apply, send)',
    doc: 'Applies the change immediately, sends it, and rolls back with inverse patches if the server refuses.',
    spec: '§4.11',
  },
  REGION_POLICY: {
    sig: 'Record<Region, { persist, note }>',
    doc: 'What each of the four regions implies. Declaring a region replaces several option lines rather than adding one.',
    spec: '§4.16',
  },
  customType: {
    sig: 'customType(name, { codec, present })',
    doc: 'One declaration, two contracts: the codec crosses the wire and takes no locale; the presenter crosses to the view and needs one.',
    spec: '§4.13.5',
  },
  presented: {
    sig: 'presented(read, type, ctx): () => string',
    doc: 'The outward half of the view boundary, as a derived node — change the locale and every string recomputes.',
    spec: '§4.13.5',
  },
  field: {
    sig: 'field(initial, type, ctx): Field',
    doc: 'The inward half. Holds the raw text and the last good value at once, so a half-typed entry is not data loss.',
    spec: '§4.13.5, R77',
  },
  DateType: {
    sig: 'CustomType<Date, string, { locale }>',
    doc: 'The Date example of the general custom-type boundary: Date in the store, ISO on the wire, locale-dependent text in the view. Money, units and identifiers need their own codecs and presenters.',
    spec: '§4.13.5',
  },
  zustand: {
    sig: 'import * as zustand from "zustand/vanilla"',
    doc: 'The real library, running in this tab. `createStore(fn)` returns a store with `getState`, `setState` and `subscribe`.',
  },
  valtio: {
    sig: 'import * as valtio from "valtio/vanilla"',
    doc: 'The real library. `proxy(obj)` makes a tracked object, `snapshot(p)` takes a stable read, `subscribe(p, fn)` notifies on a microtask.',
  },
  immer: {
    sig: 'import * as immer from "immer"',
    doc: 'The real library. `produceWithPatches` returns the next state plus forward and inverse patches — the half of a transaction we build on.',
  },
  sleep: {
    sig: 'sleep(ms): Promise<void>',
    doc: 'A plain wait, with no cancellation. Use `delay(ms, ctx.signal)` inside a task.',
  },
};

/** The router question this page keeps being asked. */
export const ROUTER_NOTE =
  'A scope is not tied to any router. `createScope` is a plain object with a lifetime, and an adapter opens one per route and ends it on leave — twelve lines against React Router, TanStack Router, Vue Router or a hand-rolled one, because all any of them has to do is call `scope.end()`. That is deliberate: the store cannot depend on a router, and a router that the store had to know about would be the one thing a framework-agnostic toolkit must not require.';
