/**
 * `state` — the living prototype of the core, driving the playground, the REPL and the benches.
 * It is the ground truth every runnable claim on the site is tested against (tools/proto-*.check.mts);
 * the site quotes its size from the file itself (data/facts.ts), never from a number typed twice.
 * Push-pull signals (three-state) + lazy per-property proxy store + transactions emitting patches.
 * NOT the real implementation — just enough to make the comparisons honest and runnable.
 */
import { useSyncExternalStore } from 'react';
import { normalizeRegions, type RegionData } from './region-input';
export { region } from './region-input';

type Listener = () => void;
let currentObserver: Computation | null = null;
let batchDepth = 0;
let flushing = false;
const pendingEffects = new Set<Computation>();
const pendingSignals = new Set<Signal>();

function enterObserver(observer: Computation): Computation | null {
  const previous = currentObserver;
  currentObserver = observer;
  return previous;
}

class Signal<T = unknown> {
  private listeners = new Map<Listener, number>();
  private observers = new Set<Computation>();
  version = 0;
  /** Derived nodes override this; ordinary signals are already current. */
  refresh: () => void = () => {};
  constructor(
    private v: T,
    public name?: string,
  ) {}
  get(): T {
    this.refresh();
    if (currentObserver) {
      this.observers.add(currentObserver);
      currentObserver.sources.set(this, this.version);
    }
    return this.v;
  }
  peek(): T {
    this.refresh();
    return this.v;
  }
  set(nv: T) {
    if (Object.is(nv, this.v)) return;
    this.v = nv;
    this.version++;
    // Complete the PUSH over every branch before any consumer can PULL.
    this.markObservers();
    if (!batchDepth && !currentObserver) flush();
  }
  subscribe(l: Listener) {
    this.refresh();
    this.listeners.set(l, this.version);
    return () => {
      this.listeners.delete(l);
    };
  }
  unobserve(c: Computation) {
    this.observers.delete(c);
  }
  markObservers() {
    for (const o of this.observers) o.markDirty();
    // An unobserved computed must stay lazy: queue only real subscribers.
    if (this.listeners.size) pendingSignals.add(this);
  }
  notify() {
    this.refresh();
    for (const [l, version] of Array.from(this.listeners)) {
      if (this.listeners.has(l) && version !== this.version) {
        this.listeners.set(l, this.version);
        l();
      }
    }
  }
}

class Computation {
  sources = new Map<Signal, number>();
  dirty = true;
  active = true;
  running = false;
  constructor(public fn: () => void) {}
  markDirty() {
    if (!this.active || this.dirty) return;
    this.dirty = true;
    pendingEffects.add(this);
  }
  changed() {
    for (const [source, version] of this.sources) {
      source.refresh();
      if (source.version !== version) return true;
    }
    return false;
  }
  run() {
    if (!this.active) return;
    if (this.running) throw new Error('Reactive cycle: a computation read itself');
    this.running = true;
    for (const s of this.sources.keys()) s.unobserve(this);
    this.sources.clear();
    const prev = enterObserver(this);
    this.dirty = false;
    try {
      this.fn();
    } finally {
      currentObserver = prev;
      this.running = false;
    }
  }
  dispose() {
    this.active = false;
    pendingEffects.delete(this);
    for (const s of this.sources.keys()) s.unobserve(this);
    this.sources.clear();
  }
}

function flush() {
  if (flushing || batchDepth) return;
  flushing = true;
  try {
    let iterations = 0;
    while (pendingEffects.size || pendingSignals.size) {
      if (++iterations > 10000) throw new Error('Reactive feedback did not settle');
      const effects = [...pendingEffects];
      pendingEffects.clear();
      for (const c of effects) {
        if (!c.active || !c.dirty) continue;
        // A marked branch may settle to the old value; do not run its sink then.
        if (c.changed()) c.run();
        else c.dirty = false;
      }
      const signals = [...pendingSignals];
      pendingSignals.clear();
      for (const s of signals) s.notify();
    }
  } finally {
    flushing = false;
  }
}

export function signal<T>(v: T, name?: string) {
  return new Signal(v, name);
}
/** Eager sink: a UI binding or reaction pulls a marked dependency chain at
 * publication time. Dispose to remove subscriptions and pending work. */
export function watch(fn: () => void) {
  const c = new Computation(fn);
  c.run();
  if (!batchDepth) flush();
  return () => c.dispose();
}
/** Lazy cached read. Invalidation propagates without running the body; an
 * observed sink makes progress without polling. Equal outputs stop propagation. */
export function derive<T>(fn: () => T, name?: string): { (): T; peek(): T; subscribe(l: Listener): () => void } {
  const out = new Signal<T>(undefined as T, name);
  let initialized = false;
  const c = new Computation(() => {
    const next = fn();
    initialized = true;
    out.set(next);
  });
  c.markDirty = () => {
    if (c.dirty) return;
    c.dirty = true;
    out.markObservers();
  };
  out.refresh = () => {
    if (c.running) throw new Error(`Reactive cycle in ${name ?? 'derive'}`);
    if (!c.dirty) return;
    if (!initialized || c.changed()) {
      try {
        c.run();
      } catch (error) {
        c.dirty = true;
        throw error;
      }
    } else c.dirty = false;
  };
  const read = () => out.get();
  read.peek = () => out.peek();
  read.subscribe = (l: Listener) => out.subscribe(l);
  return read;
}
/** Synchronous publication batch. This is NOT rollback or snapshot isolation:
 * explicit reads inside the callback see writes so far; await ends its boundary. */
export function tx<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    if (!--batchDepth) flush();
  }
}

// ---- proxy store: lazy per-property signals + patch log ----
export type Patch = { op: 'replace' | 'add' | 'remove'; path: string; value?: unknown };
/** Somewhere patches can be written and read back. A Map, IndexedDB, a file — the
 *  store does not care, which is the point of specifying persistence as patches. */
export type PersistAdapter = { write(patches: Patch[]): void; read(): Patch[] };

/** An adapter over any Storage-shaped object (localStorage, sessionStorage, a stub). */
export function storageAdapter(
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void },
  key = 'state',
): PersistAdapter {
  return {
    write(patches) {
      const prior = JSON.parse(storage.getItem(key) ?? '[]') as Patch[];
      storage.setItem(key, JSON.stringify([...prior, ...patches]));
    },
    read() {
      return JSON.parse(storage.getItem(key) ?? '[]') as Patch[];
    },
  };
}

export type Tx = {
  id: number;
  name: string;
  /** what changed */
  patches: Patch[];
  /** how to put it back — the same edit, reversed (§4.4). Undo is applying these. */
  inverse: Patch[];
  ts: number;
};

/** §4.16 — a region is not a new concept, it is a name for a bundle of policy defaults.
 *  Declaring one replaces several option lines; declaring none changes nothing. */
export type Region = 'domain' | 'session' | 'view' | 'draft';

/** What each region means for the policies that already exist. Persistence is the one
 *  implemented here; the rest of the row is what the same table would drive (§4.16.1). */
export const REGION_POLICY: Record<Region, { persist: boolean; note: string }> = {
  domain: { persist: true, note: 'the business truth — persisted, synced, undoable' },
  session: { persist: false, note: 'identity and context — its own store, never in undo or a bug report' },
  view: { persist: false, note: 'what is open and selected — free to lose, free to evict' },
  draft: { persist: true, note: 'typed and not yet committed — persisted crash-safe, never evicted' },
};

/** Create state from ordinary data or inline region.view/region.draft markers.
 * Markers compile to policy metadata and never appear in snapshots or patches. */
export function createStore<T extends object>(initial: T, opts?: { regions?: Record<string, Region> }) {
  const normalized = normalizeRegions(initial);
  if (!normalized.data || typeof normalized.data !== 'object') throw new TypeError('The store root must be an object');
  return createPlainStore<RegionData<T> & object>(normalized.data as RegionData<T> & object, {
    regions: { ...normalized.regions, ...opts?.regions },
  });
}
function createPlainStore<T extends object>(initial: T, opts?: { regions?: Record<string, Region> }) {
  const signals = new Map<string, Signal<unknown>>();
  const log: Tx[] = [];
  const logListeners = new Set<Listener>();
  const txListeners = new Set<(t: Tx) => void>();
  /** Optimistic writes awaiting confirmation (§4.11). */
  const pending = new Set<number>();
  const rejected = new Map<number, unknown>();
  // Settlement retains later writes independently of the bounded undo log.
  const settlement = new Map<number, Tx>();
  const exactWrites = new Map<string, Set<number>>();
  const descendantWrites = new Map<string, Set<number>>();
  const containerTypes = new WeakMap<Patch[], Map<string, boolean>>();
  const prefixes = (path: string) => {
    const keys = path.split('/').filter(Boolean);
    return keys.map((_key, index) => `/${keys.slice(0, index + 1).join('/')}`);
  };
  const indexSettlement = (entry: Tx, add: boolean) => {
    for (const patch of entry.patches) {
      const paths = prefixes(patch.path);
      for (const [index, pathsToIndex] of [
        [exactWrites, [patch.path]],
        [descendantWrites, paths],
      ] as const) {
        for (const path of pathsToIndex) {
          if (add) {
            let ids = index.get(path);
            if (!ids) index.set(path, (ids = new Set()));
            ids.add(entry.id);
          } else {
            const ids = index.get(path);
            ids?.delete(entry.id);
            if (!ids?.size) index.delete(path);
          }
        }
      }
    }
  };
  const retainSettlement = (entry: Tx) => {
    const copy = structuredClone(entry);
    containerTypes.set(copy.patches, containerTypes.get(entry.patches) ?? new Map());
    settlement.set(copy.id, copy);
    indexSettlement(copy, true);
  };
  const forgetSettlement = (entry: Tx) => {
    indexSettlement(entry, false);
    settlement.delete(entry.id);
  };
  const conflictCone = (id: number) => {
    const selected = new Set([id]);
    const scanned = new Set<Set<number>>();
    let rootWrites: Set<number> | undefined;
    // A min-heap visits predecessors first, so the first scan of a bucket has
    // its lowest reachable cutoff. Later visits cannot discover additional ids.
    const queue = [id];
    const enqueue = (value: number) => {
      if (selected.has(value)) return;
      selected.add(value);
      let index = queue.length;
      queue.push(value);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (queue[parent] <= value) break;
        queue[index] = queue[parent];
        index = parent;
      }
      queue[index] = value;
    };
    while (queue.length) {
      const current = queue[0];
      const last = queue.pop()!;
      if (queue.length) {
        let index = 0;
        while (index * 2 + 1 < queue.length) {
          let child = index * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1] < queue[child]) child++;
          if (queue[child] >= last) break;
          queue[index] = queue[child];
          index = child;
        }
        queue[index] = last;
      }
      const entry = settlement.get(current);
      if (!entry) continue;
      for (const patch of entry.patches) {
        const parent = patch.path.slice(0, patch.path.lastIndexOf('/'));
        const overlaps = [
          descendantWrites.get(patch.path),
          ...prefixes(patch.path)
            .slice(0, -1)
            .map((path) => exactWrites.get(path)),
        ];
        // Rewinding array growth truncates sibling indices, even when they did
        // not grow length themselves. Ordinary index writes remain path-local.
        if (
          patch.path.endsWith('/length') &&
          (containerTypes.get(entry.patches)?.get(parent) || (parent === '' && Array.isArray(raw)))
        ) {
          overlaps.push(parent === '' ? (rootWrites ??= new Set(settlement.keys())) : descendantWrites.get(parent));
        }
        for (const ids of overlaps) {
          if (!ids || scanned.has(ids)) continue;
          scanned.add(ids);
          for (const later of ids) if (later > current) enqueue(later);
        }
      }
    }
    return [...selected].sort((a, b) => a - b).map((key) => settlement.get(key)!);
  };
  // A shadowed scalar replacement changes only its immediate follower's
  // predecessor. Structural writes require the general rewind/replay path.
  const detachOverwritten = (entry: Tx) => {
    const path = entry.patches[0]?.path;
    if (!path || path.endsWith('/length')) return false;
    const scalarReplacements = (item: Tx) =>
      item.patches.length > 0 &&
      item.patches.length === item.inverse.length &&
      [...item.patches, ...item.inverse].every(
        (patch) =>
          patch.path === path && patch.op === 'replace' && (patch.value === null || typeof patch.value !== 'object'),
      );
    if (!scalarReplacements(entry)) return false;
    const ids = exactWrites.get(path);
    if (!ids || descendantWrites.get(path)?.size !== ids.size) return false;
    for (const prefix of prefixes(path).slice(0, -1)) {
      if (exactWrites.has(prefix) || exactWrites.has(`${prefix}/length`)) return false;
    }
    if (Array.isArray(raw) && exactWrites.has('/length')) return false;
    // Restrict to the oldest indexed writer: taking two entries is constant
    // work; arbitrary ordering and multi-path followers use general replay.
    const iterator = ids.values();
    if (iterator.next().value !== entry.id) return false;
    const nextId = iterator.next().value;
    const next = nextId === undefined ? undefined : settlement.get(nextId);
    if (!next || !scalarReplacements(next)) return false;
    next.inverse[0] = structuredClone(entry.inverse[0]);
    forgetSettlement(entry);
    return true;
  };
  let settling = false;
  const pendingListeners = new Set<Listener>();
  /** path prefix → region. Longest prefix wins, so a field can override its slice. */
  const regions: [string, Region][] = Object.entries(opts?.regions ?? {}).sort((a, b) => b[0].length - a[0].length);
  const regionOf = (path: string): Region =>
    regions.find(([prefix]) => prefix === '' || path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? 'domain';
  let txId = 0;
  let currentTx: Tx | null = null;
  /** Index into `log` of the last applied transaction. Moving it is time travel. */
  let cursor = -1;
  /** Suppresses recording while history itself is writing. */
  let replaying = false;
  let version = 0;
  const versionListeners = new Set<Listener>();
  const raw = structuredClone(initial);

  const sig = (path: string, v: unknown) => {
    let s = signals.get(path);
    if (!s) {
      s = new Signal(v, path);
      signals.set(path, s);
    }
    return s;
  };
  /** Writing `/todos/byId/a/done` must also wake a subscriber watching `/todos/byId/a`.
   *
   *  Reading an object subscribes to that object, and "did anything inside it change?" is
   *  the question that read is asking — a row component reading `item` must re-render when
   *  `item.done` changes. Only ancestors are woken, never siblings, so the fine-grained
   *  claim holds where it matters: changing one item does not touch the other items or the
   *  list order. Vue and Valtio both notify ancestors for the same reason.
   */
  const notifyAncestors = (path: string) => {
    for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
      const parent = path.slice(0, i);
      const existing = signals.get(parent);
      if (existing) existing.set(pathGet(raw, parent));
    }
  };

  const captureContainerTypes = (paths: Iterable<string>, types: Map<string, boolean>) => {
    for (const path of paths) {
      for (const prefix of prefixes(path).slice(0, -1)) {
        const parent = pathGet(raw, prefix);
        if (parent && typeof parent === 'object') types.set(prefix, Array.isArray(parent));
      }
    }
  };
  const recordWrite = (patches: Patch[], inverse: Patch[]) => {
    if (!replaying) {
      // Capture types while the written path still has valid parents; a later
      // transaction may hide them before settlement starts.
      const recorded = currentTx?.patches ?? patches;
      let types = containerTypes.get(recorded);
      if (!types) containerTypes.set(recorded, (types = new Map()));
      captureContainerTypes(
        patches.map((patch) => patch.path),
        types,
      );
      if (currentTx) {
        for (const patch of patches) currentTx.patches.push(patch);
        for (const patch of inverse) currentTx.inverse.push(patch);
      } else commit(`set ${patches[patches.length - 1].path}`, patches, inverse);
    }
    for (const patch of patches) {
      sig(patch.path, patch.value).set(patch.value);
      notifyAncestors(patch.path);
    }
    version++;
    versionListeners.forEach((l) => l());
  };
  const captureMutation = (t: object, k: string, v: unknown, base: string) => {
    const p = `${base}/${String(k)}`;
    const had = Object.hasOwn(t, k);
    const prev: unknown = Reflect.get(t, k);
    const patches: Patch[] = [];
    const inverses: Patch[] = [];
    const length = Array.isArray(t) ? t.length : null;
    // Setting length deletes indices without invoking the proxy's delete trap.
    if (length !== null && k === 'length' && typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < length) {
      // Bound small shrinks to the removed range; enumerate large spans to skip sparse holes.
      const keys =
        length - v <= 1024
          ? Array.from({ length: length - v }, (_, i) => String(v + i)).filter((key) => Object.hasOwn(t, key))
          : Object.getOwnPropertyNames(t);
      for (const key of keys) {
        const i = Number(key);
        if (!Number.isInteger(i) || String(i) !== key || i < v || i >= length) continue;
        patches.push({ op: 'remove', path: `${base}/${i}` });
        inverses.push({ op: 'add', path: `${base}/${i}`, value: Reflect.get(t, String(i)) });
      }
    }
    writeProperty(t, k, v);
    // An index write can grow length before push's explicit length assignment.
    if (length !== null && k !== 'length' && Array.isArray(t) && t.length !== length) {
      patches.push({ op: 'replace', path: `${base}/length`, value: t.length });
      inverses.push({ op: 'replace', path: `${base}/length`, value: length });
    }
    const patch: Patch = { op: had ? 'replace' : 'add', path: p, value: v };
    // The inverse is produced at write time, when the old value is still in hand.
    // Reconstructing it later would need a snapshot; this needs one field.
    const inverse: Patch = had ? { op: 'replace', path: p, value: prev } : { op: 'remove', path: p };
    return { patches: [...patches, patch], inverse: [...inverses, inverse] };
  };
  const proxy = <O extends object>(obj: O, base: string): O =>
    new Proxy(obj, {
      get(t, k: string | symbol) {
        if (typeof k === 'symbol') return Reflect.get(t, k);
        const v: unknown = Reflect.get(t, k);
        const p = `${base}/${k}`;
        sig(p, v).get();
        return v && typeof v === 'object' ? proxy(v, p) : v;
      },
      set(t, k: string | symbol, v: unknown) {
        if (!replaying) flushTransient();
        if (typeof k === 'symbol') {
          writeProperty(t, k, v);
          return true;
        }
        const mutation = captureMutation(t, k, v, base);
        recordWrite(mutation.patches, mutation.inverse);
        return true;
      },
      deleteProperty(t, k) {
        if (!replaying) flushTransient();
        const had = Object.hasOwn(t, k);
        const prev: unknown = Reflect.get(t, k);
        if (!Reflect.deleteProperty(t, k)) return false;
        if (had && typeof k === 'string') {
          const path = `${base}/${k}`;
          recordWrite([{ op: 'remove', path }], [{ op: 'add', path, value: prev }]);
        }
        return true;
      },
    });
  const commit = (name: string, patches: Patch[], inverse: Patch[]) => {
    // A new write after an undo discards the redo tail, exactly as an editor does.
    if (cursor < log.length - 1) log.splice(cursor + 1);
    log.push({ id: ++txId, name, patches, inverse, ts: Date.now() });
    if (log.length > 200) log.shift();
    cursor = log.length - 1;
    const committed = log[log.length - 1];
    if (pending.size && !settling) retainSettlement(committed);
    txListeners.forEach((l) => l(committed));
    logListeners.forEach((l) => l());
  };

  /** Write patches straight to the raw tree and wake the exact signals touched.
   *  Bypasses the proxy so history writes do not become history themselves. */
  const applyPatches = (patches: Patch[], publish = true) =>
    tx(() => {
      replaying = true;
      try {
        for (const patch of patches) {
          const keys = patch.path.split('/').filter(Boolean);
          const leaf = keys[keys.length - 1];
          let o: unknown = raw;
          for (const k of keys.slice(0, -1)) o = readProperty(o, k);
          if (patch.op === 'remove') {
            if (!Reflect.deleteProperty(propertyTarget(o), leaf)) throw new TypeError('Cannot delete store property');
          } else writeProperty(o, leaf, patch.value);
          sig(patch.path, patch.value).set(patch.value);
          notifyAncestors(patch.path);
        }
      } finally {
        replaying = false;
      }
      version++;
      versionListeners.forEach((l) => l());
      // A history move is a real change to derived views, so they consume it like any other.
      if (publish) txListeners.forEach((l) => l({ id: -1, name: 'history', patches, inverse: [], ts: Date.now() }));
      logListeners.forEach((l) => l());
    });
  let pendingTransient: Patch[] = [];
  let pendingInverse: Patch[] = [];
  let pendingContainerTypes = new Map<string, boolean>();
  let transientScheduled = false;
  // Raw transient writes already happened. Journal them before another writer
  // or settlement changes their predecessors, even if the frame is still queued.
  const flushTransient = () => {
    if (!pendingTransient.length) return;
    const patches = pendingTransient;
    const inverse = pendingInverse;
    pendingTransient = [];
    pendingInverse = [];
    containerTypes.set(patches, pendingContainerTypes);
    pendingContainerTypes = new Map();
    commit('transient (coalesced/frame)', patches, inverse);
  };
  const state = proxy(raw, '');
  return {
    state: state as T,
    action<A extends unknown[]>(name: string, fn: (s: T, ...args: A) => void) {
      return (...args: A) => {
        currentTx = { id: txId + 1, name, patches: [], inverse: [], ts: Date.now() };
        try {
          tx(() => fn(state, ...args));
        } finally {
          const t = currentTx;
          currentTx = null;
          commit(name, t!.patches, t!.inverse);
        }
      };
    },
    /** subscribe to one path — the fine-grained unit the React hook uses */
    subscribePath(path: string, l: Listener) {
      return sig(path, undefined).subscribe(l);
    },
    snapshot(): T {
      return structuredClone(raw);
    },
    log,
    /** Undo/redo/time travel — all one mechanism: move the cursor, apply the patches between.
     *  O(size of the change), not O(size of the state): no snapshots are stored. */
    undo() {
      if (cursor < 0) return false;
      const patches = [...log[cursor].inverse].reverse();
      cursor--;
      applyPatches(patches);
      return true;
    },
    redo() {
      if (cursor >= log.length - 1) return false;
      cursor++;
      applyPatches(log[cursor].patches);
      return true;
    },
    /** Jump to any point in the log — forwards or backwards, one patch application per step. */
    jumpTo(index: number) {
      tx(() => {
        const target = Math.max(-1, Math.min(index, log.length - 1));
        while (cursor > target) {
          const patches = [...log[cursor].inverse].reverse();
          cursor--;
          applyPatches(patches);
        }
        while (cursor < target) {
          cursor++;
          applyPatches(log[cursor].patches);
        }
      });
    },
    get cursor() {
      return cursor;
    },
    get canUndo() {
      return cursor >= 0;
    },
    get canRedo() {
      return cursor < log.length - 1;
    },
    /** Optimistic mutation (§4.11). Apply the change now, send it, and either confirm it
     *  or put the state back — using the same inverse patches undo uses, so there is no
     *  second rollback mechanism and no snapshot of the store is taken.
     *
     *  Returns the pending entry so a UI can render "in flight" without inventing a flag. */
    optimistic<A extends unknown[]>(
      name: string,
      apply: (s: T, ...args: A) => void,
      send: (...args: A) => Promise<unknown>,
    ) {
      return (...args: A) => {
        currentTx = { id: txId + 1, name, patches: [], inverse: [], ts: Date.now() };
        let entry!: Tx;
        try {
          tx(() => apply(state, ...args));
        } finally {
          const t = currentTx;
          currentTx = null;
          commit(`${name} (optimistic)`, t!.patches, t!.inverse);
          entry = log[log.length - 1];
        }
        if (!pending.size) retainSettlement(entry);
        pending.add(entry.id);
        pendingListeners.forEach((l) => l());
        const settle = (ok: boolean, err?: unknown) =>
          tx(() => {
            flushTransient();
            pending.delete(entry.id);
            if (!ok) {
              // Rebase concrete patches, never rerun action callbacks. The journal
              // lasts until all requests settle; it is not server conflict resolution.
              const retained = settlement.get(entry.id)!;
              if (detachOverwritten(retained)) {
                settling = true;
                try {
                  commit(`${name} (rolled back)`, [], []);
                } finally {
                  settling = false;
                }
              } else {
                const suffix = conflictCone(entry.id);
                forgetSettlement(suffix[0]);
                for (const item of suffix.slice(1)) indexSettlement(item, false);
                const rollback = suffix.flatMap((item) => item.inverse).reverse();
                const inverse = suffix.flatMap((item) => item.patches).reverse();
                settling = true;
                try {
                  // Rewind later writes before removing the rejected write, then capture
                  // fresh inverses while replaying them against their new predecessors.
                  applyPatches(structuredClone(rollback), false);
                  for (const later of suffix.slice(1)) {
                    const rebased: Tx = { ...later, patches: [], inverse: [] };
                    currentTx = rebased;
                    for (const patch of structuredClone(later.patches)) {
                      const keys = patch.path.split('/').filter(Boolean);
                      let target: unknown = state;
                      for (let depth = 0; depth < keys.length - 1; depth++) {
                        const key = keys[depth];
                        const child = readProperty(target, key);
                        if (!child || typeof child !== 'object') {
                          const path = `/${keys.slice(0, depth + 1).join('/')}`;
                          // A surviving descendant owns its required container even when
                          // the rejected write was the one that originally inserted it.
                          writeProperty(target, key, containerTypes.get(later.patches)?.get(path) ? [] : {});
                        }
                        target = readProperty(target, key);
                      }
                      const leaf = keys[keys.length - 1];
                      if (patch.op === 'remove') Reflect.deleteProperty(propertyTarget(target), leaf);
                      else writeProperty(target, leaf, patch.value);
                    }
                    currentTx = null;
                    retainSettlement(rebased);
                    for (const patch of rebased.patches) rollback.push(patch);
                    for (const patch of rebased.inverse) inverse.push(patch);
                  }
                  commit(`${name} (rolled back)`, rollback, inverse);
                } finally {
                  currentTx = null;
                  settling = false;
                }
              }
              rejected.set(entry.id, err);
            }
            // Updating entries preserves chronological Map order. Drop only the
            // settled prefix, without scanning unrelated outstanding writes.
            const oldest = pending.values().next().value;
            for (const item of settlement.values()) {
              if (oldest !== undefined && item.id >= oldest) break;
              forgetSettlement(item);
            }
            pendingListeners.forEach((l) => l());
          });
        let sent: Promise<unknown>;
        try {
          sent = send(...args);
        } catch (error) {
          sent = Promise.reject(error);
        }
        return sent.then(
          (v) => {
            settle(true);
            return v;
          },
          (e) => {
            settle(false, e);
            throw e;
          },
        );
      };
    },
    /** Transaction ids still awaiting their server answer. */
    get pending() {
      return [...pending];
    },
    isPending(txIdToCheck: number) {
      return pending.has(txIdToCheck);
    },
    rejectionFor(txIdToCheck: number) {
      return rejected.get(txIdToCheck);
    },
    onPending(l: Listener) {
      pendingListeners.add(l);
      return () => {
        pendingListeners.delete(l);
      };
    },
    /** §4.5 — a keyed collection over an existing store path: `ids` + `byId`.
     *
     *  The shape is the point. `ids` is the order, `byId` holds the items, and because the
     *  proxy makes a signal per property, a write to one item wakes only that item's
     *  subscribers — the list is not re-rendered because a row changed. Insert and remove
     *  are ordinary transactions, so they undo, replicate and repair derived views like any
     *  other write; there is no separate collection mutation path.
     */
    collection<I extends { [k: string]: unknown }>(basePath: string, opts: { key: keyof I & string }) {
      const idsPath = `${basePath}/ids`;
      const byIdPath = `${basePath}/byId`;
      const read = () => pathGet(raw, byIdPath) as Record<string, I>;
      const readIds = () => pathGet(raw, idsPath) as string[];

      const write = (name: string, fn: () => void) => {
        currentTx = { id: txId + 1, name, patches: [], inverse: [], ts: Date.now() };
        try {
          tx(fn);
        } finally {
          const t = currentTx;
          currentTx = null;
          commit(name, t!.patches, t!.inverse);
        }
      };

      const api = {
        get ids() {
          return readIds();
        },
        get size() {
          return readIds().length;
        },
        get(id: string): I | undefined {
          return read()[id];
        },
        /** Subscribe to exactly one item — what a row component reads. */
        useItem<V = I>(id: string): V {
          return useSyncExternalStore(
            (l) => sig(`${byIdPath}/${id}`, read()[id]).subscribe(l),
            () => read()[id] as unknown as V,
            () => read()[id] as unknown as V,
          );
        },
        /** Subscribe to the order alone — what a list component reads. A row changing
         *  does not touch this, which is the whole reason ids and byId are separate. */
        useIds(): string[] {
          return useSyncExternalStore(
            (l) => sig(idsPath, readIds()).subscribe(l),
            () => readIds(),
            () => readIds(),
          );
        },
        insert(item: I, at?: number) {
          const id = String(item[opts.key]);
          write(`${basePath}.insert`, () => {
            const byId = pathGet(state, byIdPath) as Record<string, I>;
            byId[id] = item;
            const ids = readIds();
            const next = at === undefined ? [...ids, id] : [...ids.slice(0, at), id, ...ids.slice(at)];
            (pathGet(state, basePath) as Record<string, unknown>).ids = next;
          });
          return id;
        },
        remove(id: string) {
          write(`${basePath}.remove`, () => {
            const byId = pathGet(state, byIdPath) as Record<string, I | undefined>;
            byId[id] = undefined;
            (pathGet(state, basePath) as Record<string, unknown>).ids = readIds().filter((x) => x !== id);
          });
        },
        /** Insert or patch in one transaction — the shape a sync adapter writes with. */
        upsert(id: string, produce: (prev: I | undefined) => I) {
          const exists = read()[id] !== undefined;
          write(basePath + (exists ? '.update' : '.insert'), () => {
            const byId = pathGet(state, byIdPath) as Record<string, I>;
            byId[id] = produce(read()[id]);
            if (!exists) (pathGet(state, basePath) as Record<string, unknown>).ids = [...readIds(), id];
          });
        },
      };
      return api;
    },
    /** The region a path belongs to (§4.16). Unlabelled paths are `domain`, because
     *  over-persisting view state is untidy while under-persisting real data is loss. */
    regionOf,
    /** §8.5 — persistence driven by the patch stream, not by snapshotting the store.
     *
     *  A commit is filtered to the paths this persister cares about and only those
     *  patches are written. Which paths those are is normally not spelled out: the
     *  region already says. `include`/`exclude` remain for the exceptions.
     *
     *  Returns a handle so a test or a REPL can see exactly what was written. */
    persist(where: PersistAdapter, options?: { regions?: Region[]; include?: string[]; exclude?: string[] }) {
      const allow =
        options?.regions ?? (Object.keys(REGION_POLICY) as Region[]).filter((r) => REGION_POLICY[r].persist);
      const wanted = (path: string) => {
        if (options?.exclude?.some((p) => p === '' || path === p || path.startsWith(`${p}/`))) return false;
        if (options?.include) return options.include.some((p) => p === '' || path === p || path.startsWith(`${p}/`));
        return allow.includes(regionOf(path));
      };
      let writes = 0;
      const off =
        txListeners.size >= 0
          ? (() => {
              const l = (t: Tx) => {
                const keep = t.patches.filter((patch) => wanted(patch.path));
                if (!keep.length) return;
                writes++;
                where.write(keep);
              };
              txListeners.add(l);
              return () => txListeners.delete(l);
            })()
          : () => {};
      return {
        /** How many commits actually reached the adapter — the evidence that a `view`
         *  write costs nothing rather than being written and ignored. */
        get writes() {
          return writes;
        },
        wanted,
        dispose: off,
      };
    },
    /** Apply everything a persister stored, as one transaction, without re-recording it. */
    hydrate(where: PersistAdapter) {
      const stored = where.read();
      if (!stored.length) return 0;
      applyPatches(stored);
      return stored.length;
    },
    /** Observe each committed transaction, with its patches — what derived views consume. */
    onCommit(l: (t: Tx) => void) {
      txListeners.add(l);
      return () => {
        txListeners.delete(l);
      };
    },
    onLog(l: Listener) {
      logListeners.add(l);
      return () => {
        logListeners.delete(l);
      };
    },
    /** transient write: updates subscribers immediately, coalesces log entries per frame (R6) */
    setTransient(path: string, v: unknown) {
      const keys = path.split('/').filter(Boolean);
      let o: unknown = raw;
      for (const k of keys.slice(0, -1)) o = readProperty(o, k);
      const base = `/${keys.slice(0, -1).join('/')}`.replace(/^\/$/, '');
      const mutation = captureMutation(propertyTarget(o), keys[keys.length - 1], v, base);
      captureContainerTypes(
        mutation.patches.map((patch) => patch.path),
        pendingContainerTypes,
      );
      // Only consecutive scalar writes can collapse without losing structural ordering.
      const last = pendingTransient.at(-1);
      if (mutation.patches.length === 1 && last?.path === path && last.op !== 'remove') {
        last.value = v;
      } else {
        for (const patch of mutation.patches) pendingTransient.push(patch);
        for (const patch of mutation.inverse) pendingInverse.push(patch);
      }
      for (const patch of mutation.patches) {
        sig(patch.path, patch.value).set(patch.value);
        notifyAncestors(patch.path);
      }
      if (!transientScheduled) {
        transientScheduled = true;
        requestAnimationFrame(() => {
          transientScheduled = false;
          flushTransient();
        });
      }
    },
    /** React: subscribe to exactly one path */
    usePath<V>(path: string): V {
      return useSyncExternalStore(
        (l) => sig(path, pathGet(raw, path)).subscribe(l),
        () => pathGet(raw, path) as V,
        () => pathGet(raw, path) as V,
      );
    },
    /** coarse hook for comparison: any change re-renders */
    useAll(): T {
      useSyncExternalStore(
        (l) => {
          versionListeners.add(l);
          return () => {
            versionListeners.delete(l);
          };
        },
        () => version,
        () => version,
      );
      return state;
    },
    raw,
  };
}
/** A filtered, sorted view over a keyed collection, maintained from patches (§4.5, R66).
 *
 *  The view is built once. After that a write does not re-run filter or sort over the
 *  collection — it inspects the patches of the committed transaction, works out which
 *  items those touched, and repairs only those positions. Cost is O(changed · log n)
 *  rather than O(n log n), which is the whole claim, measured on the Bench page.
 */
// The item parameter remains part of the public type even though this view exposes only ids.
export type DerivedCollection<_I> = {
  /** Current member ids, in sort order. A signal: reading it inside a `watch` subscribes. */
  ids: Signal<string[]>;
  /** How many patch-driven repairs have run — the evidence that nothing re-ran wholesale. */
  readonly repairs: number;
  dispose(): void;
};

export function deriveCollection<I>(
  store: { raw: object; onCommit(l: (t: Tx) => void): () => void },
  basePath: string,
  opts: { filter?: (item: I) => boolean; sort?: (a: I, b: I) => number },
): DerivedCollection<I> {
  const base = () => pathGet(store.raw, basePath) as Record<string, I>;
  const admits = opts.filter ?? (() => true);
  const order = opts.sort ?? (() => 0);
  const byId = base();

  const cmp = (x: string, y: string) => order(byId[x], byId[y]) || (x < y ? -1 : x > y ? 1 : 0);
  const lower = (arr: string[], id: string) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cmp(arr[mid], id) < 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let current = Object.keys(byId)
    .filter((id) => admits(byId[id]))
    .sort(cmp);
  const ids = new Signal<string[]>(current, `${basePath}#derived`);
  let repairs = 0;

  /** Put one item where it now belongs: take it out if present, put it back if it still qualifies.
   *
   *  `indexOf` is a linear scan and looks like the obvious thing to optimise — the first measured
   *  run of the R66 fixture said so in as many words. It was tried: an `id → index` Map maintained
   *  alongside the array. It made the 10 000-row case **3.8× slower** (1.8 ms → 6.8 ms), because a
   *  splice into a sorted array shifts every element after it, so the Map has to be rewritten from
   *  the splice point to the end on every single update — strictly more work than the scan it was
   *  replacing, which at least stops when it finds the item. Beating this needs a different
   *  structure (an order-statistic tree or a skip list), not an index over an array. Measured and
   *  reverted rather than assumed; see docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md.
   */
  const repair = (id: string) => {
    const item = base()[id];
    const at = current.indexOf(id);
    const shouldBeIn = item !== undefined && admits(item);
    if (at >= 0) current.splice(at, 1);
    if (shouldBeIn) current.splice(lower(current, id), 0, id);
  };

  const off = store.onCommit((t) => {
    const touched = new Set<string>();
    for (const patch of t.patches) {
      if (!patch.path.startsWith(`${basePath}/`)) continue;
      const id = patch.path.slice(basePath.length + 1).split('/')[0];
      if (id) touched.add(id);
    }
    if (!touched.size) return;
    current = current.slice();
    for (const id of touched) repair(id);
    repairs++;
    ids.set(current);
  });

  return {
    ids,
    get repairs() {
      return repairs;
    },
    dispose: off,
  };
}

/** Proxy and patch paths share JavaScript property access, including boxed primitives. */
function readProperty(value: unknown, key: PropertyKey): unknown {
  if (value == null) throw new TypeError('Cannot read a property of null or undefined');
  return Reflect.get(Object(value), key, value);
}

function propertyTarget(value: unknown): object {
  if (value == null) throw new TypeError('Cannot access a property of null or undefined');
  return Object(value);
}

function writeProperty(value: unknown, key: PropertyKey, next: unknown): void {
  if (!Reflect.set(propertyTarget(value), key, next, value)) throw new TypeError('Cannot write store property');
}

function pathGet(value: unknown, path: string): unknown {
  return path
    .split('/')
    .filter(Boolean)
    .reduce<unknown>((parent, key) => (parent == null ? undefined : readProperty(parent, key)), value);
}

/* ------------------------------------------------------------------ *
 * Tasks: async lifecycle, scopes and cancellation (§4.15, R71–R74).
 *
 * A transaction is instantaneous and has nothing to cancel. A task is the
 * asynchronous thing that commits zero, one or many transactions over its
 * lifetime, and is what has a status, a duration, children and a cancel
 * button. Everything below is the running proof of that distinction.
 * ------------------------------------------------------------------ */

export type CancelReason = 'user' | 'scope-ended' | 'superseded' | 'timeout' | 'dependency-cancelled';
export type TaskStatus = 'pending' | 'loading' | 'success' | 'error' | 'cancelled';

/** Thrown inside a task body when its signal aborts. Swallowed at the task
 *  boundary, so no `catch` in application code has to recognise it (§4.15.5). */
export class CancelError extends Error {
  constructor(public readonly reason: CancelReason) {
    super(`cancelled: ${reason}`);
    this.name = 'CancelError';
  }
}

export interface TaskContext {
  /** The leaf wire format — hand it to fetch, to a worker call, to anything. */
  readonly signal: AbortSignal;
  /** Why, not just whether. `signal.reason` is `any`; a visualiser needs the word. */
  reason(): CancelReason | null;
  progress(fraction: number, info?: unknown): void;
  spawn<R>(name: string, fn: (child: TaskContext) => Promise<R>): Task<R>;
  /** Fail-fast group: one rejects, the siblings cancel. */
  all<R>(tasks: Task<R>[]): Promise<R[]>;
  /** First to settle wins, the rest cancel. */
  race<R>(tasks: Task<R>[]): Promise<R>;
  /** A region cancellation may not interrupt. The cancel lands after it returns. */
  shield<R>(fn: () => Promise<R>): Promise<R>;
  /** Finalisers run last-in-first-out — the order `addEventListener` gets wrong. */
  onCancel(fn: () => void): void;
}

export type Task<T> = {
  readonly id: number;
  readonly name: string;
  /** Reactive: read inside `derive`/`watch` and it re-runs on transition. */
  status(): TaskStatus;
  progress(): number | null;
  error(): unknown;
  result(): T | undefined;
  /** Resolves once every finaliser has run. Never rejects — the status carries the outcome. */
  readonly settled: Promise<void>;
  cancel(reason?: CancelReason): void;
  children(): Task<unknown>[];
};

export type TaskPolicy = 'latest' | 'leading' | 'queue' | 'every';
export type RunOpts = {
  /** What happens when a run begins while a previous one is in flight. Not debounce —
   *  debounce decides whether a task starts at all, this decides what happens once two want to. */
  policy?: TaskPolicy;
  /** A cancel scope over the whole body. */
  timeout?: number;
  /** Supersession is per key; defaults to the task name. */
  key?: string;
};

/** `AbortSignal.any` where it exists, hand-rolled where it does not. */
function linkAbort(parents: AbortSignal[]): AbortController {
  const anyOf = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  const ctl = new AbortController();
  if (anyOf) {
    const linked = anyOf([ctl.signal, ...parents]);
    return { signal: linked, abort: (r?: unknown) => ctl.abort(r) } as AbortController;
  }
  for (const p of parents) {
    if (p.aborted) ctl.abort(p.reason);
    else p.addEventListener('abort', () => ctl.abort(p.reason), { once: true });
  }
  return ctl;
}

let taskSeq = 0;
const terminal = (s: TaskStatus) => s === 'success' || s === 'error' || s === 'cancelled';

/** A scope owns tasks and ends them together. Route scope is the useful one:
 *  nearly every real cancellation on the client is "the user navigated away". */
export type Scope = {
  readonly name: string;
  readonly signal: AbortSignal;
  /** Reactive — true while any task in this scope or a descendant is running. */
  pending(): boolean;
  tasks(): Task<unknown>[];
  child(name: string): Scope;
  run<T>(name: string, fn: (ctx: TaskContext) => Promise<T>, opts?: RunOpts): Task<T>;
  end(reason?: CancelReason): void;
};

export function createScope(name: string, parent?: Scope): Scope {
  return parent ? parent.child(name) : createOwnedScope(name);
}

function createOwnedScope(name: string, parent?: Scope, notifyParent?: () => void): Scope {
  const ctl = linkAbort(parent ? [parent.signal] : []);
  const live = signal(0, `scope:${name}`);
  const tasks: Task<unknown>[] = [];
  const children: Scope[] = [];
  /** name/key → the task currently holding it, for supersession policies. */
  const held = new Map<string, { task: Task<unknown>; tail: Promise<unknown> }>();
  let ended = false;

  const bump = () =>
    tx(() => {
      live.set(live.peek() + 1);
      notifyParent?.();
    });

  const scope: Scope = {
    name,
    get signal() {
      return ctl.signal;
    },
    pending() {
      live.get();
      // A queued task has not started but is still owed to the caller, so it counts.
      return tasks.some((t) => !terminal(t.status())) || children.some((c) => c.pending());
    },
    tasks() {
      live.get();
      return tasks.slice();
    },
    child(childName) {
      // Idle membership cannot change pending; task publication wakes ancestors instead.
      const c = createOwnedScope(childName, scope, bump);
      children.push(c);
      return c;
    },
    end(reason = 'scope-ended') {
      if (ended) return;
      tx(() => {
        ended = true;
        for (const c of children) c.end(reason);
        for (const t of tasks) t.cancel(reason);
        ctl.abort(reason);
        bump();
      });
    },
    run(taskName, fn, opts) {
      return startTask(scope, ctl.signal, { tasks, held, bump, ended: () => ended }, taskName, fn, opts);
    },
  };
  return scope;
}

type ScopeHost = {
  tasks: Task<unknown>[];
  held: Map<string, { task: Task<unknown>; tail: Promise<unknown> }>;
  bump: () => void;
  ended: () => boolean;
};

/** Applies the supersession policy. `'drop'` means this call does not happen at
 *  all, `null` means start now, and a promise means start when it resolves —
 *  only `queue` ever returns one, so every other policy starts synchronously
 *  and a task is `loading` the instant `run()` returns. */
function applyPolicy(host: ScopeHost, key: string, policy: TaskPolicy): 'drop' | null | Promise<unknown> {
  const current = host.held.get(key);
  if (!current) return null;
  if (policy === 'queue') return current.tail;
  if (terminal(current.task.status())) return null;
  if (policy === 'every') return null;
  if (policy === 'leading') return 'drop'; // one is already running; this call is dropped
  current.task.cancel('superseded'); // 'latest'
  return null;
}

function startTask<T>(
  scope: Scope,
  scopeSignal: AbortSignal,
  host: ScopeHost,
  name: string,
  fn: (ctx: TaskContext) => Promise<T>,
  opts: RunOpts = {},
): Task<T> {
  const key = opts.key ?? name;
  const gate = applyPolicy(host, key, opts.policy ?? 'every');
  const rec = createTaskRecord<T>(name, scopeSignal);
  host.tasks.push(rec.task as Task<unknown>);
  host.bump();

  if (gate === 'drop' || host.ended()) {
    rec.finish('cancelled', undefined, new CancelError(gate === 'drop' ? 'superseded' : 'scope-ended'));
    host.bump();
    return rec.task;
  }
  // Cancelling an unstarted slot settles its task, but cannot release its predecessors.
  const tail = gate === null ? rec.settled : gate.then(() => rec.settled);
  const held = { task: rec.task as Task<unknown>, tail };
  host.held.set(key, held);
  void tail.then(() => {
    if (host.held.get(key) === held) host.held.delete(key);
  });
  if (gate === null) void runBody(rec, scope, fn, opts, host);
  else void gate.then(() => runBody(rec, scope, fn, opts, host)); // queued: stays `pending` until its turn
  return rec.task;
}

/** The status machine, the signals behind it, and the cancel plumbing —
 *  everything about a task that does not involve running its body. */
function createTaskRecord<T>(name: string, parentSignal: AbortSignal) {
  const id = ++taskSeq;
  const status = signal<TaskStatus>('pending', `task:${id}:status`);
  const progress = signal<number | null>(null, `task:${id}:progress`);
  const error = signal<unknown>(null, `task:${id}:error`);
  const ctl = linkAbort([parentSignal]);
  const finalisers: (() => void)[] = [];
  const childTasks: Task<unknown>[] = [];
  let reason: CancelReason | null = null;
  let value: T | undefined;
  let completed = false;
  /** Whether the body is running. A task cancelled before that settles at once. */
  let started = false;
  let done!: () => void;
  const settled = new Promise<void>((r) => (done = r));

  const runFinalisers = () => {
    const failures: unknown[] = [];
    while (finalisers.length) {
      try {
        finalisers.pop()!();
      } catch (e) {
        failures.push(e);
      }
    }
    // Cleanup diagnostics must not replace the body's result or cancellation reason.
    if (failures.length)
      console.error(new AggregateError(failures, `Task ${name} finalizers failed`, { cause: error.peek() }));
  };

  /** The status transition. Separate from `complete` on purpose: cancelling is
   *  immediate and visible (the button greys out now), but the task is not
   *  *settled* until its body has actually unwound — which is exactly what
   *  `shield` delays. Collapsing the two makes `settled` a lie for any task
   *  holding a non-interruptible region. */
  const transition = (s: TaskStatus, v?: T, e?: unknown) => {
    if (terminal(status.peek())) return;
    value = v;
    if (e !== undefined) error.set(e);
    status.set(s);
  };

  /** Runs the finalisers and resolves `settled`. Called once, when the body
   *  is genuinely finished — or immediately, for a task whose body never ran. */
  const complete = () => {
    if (completed) return;
    completed = true;
    try {
      runFinalisers();
    } finally {
      done();
    }
  };

  const finish = (s: TaskStatus, v?: T, e?: unknown) => {
    transition(s, v, e);
    complete();
  };

  const task: Task<T> = {
    id,
    name,
    status: () => status.get(),
    progress: () => progress.get(),
    error: () => error.get(),
    result: () => value,
    settled,
    children: () => childTasks.slice(),
    cancel(r = 'user') {
      if (terminal(status.peek())) return;
      reason = r;
      for (const c of childTasks) c.cancel(r === 'user' ? 'scope-ended' : r);
      ctl.abort(new CancelError(r));
      transition('cancelled', undefined, new CancelError(r));
      if (!started) complete(); // nothing is running, so nothing has to unwind
    },
  };

  return {
    task,
    status,
    progress,
    error,
    ctl,
    finalisers,
    childTasks,
    settled,
    finish,
    transition,
    complete,
    markStarted: () => (started = true),
    getReason: () => reason,
  };
}

type TaskRecord<T> = ReturnType<typeof createTaskRecord<T>>;

async function runBody<T>(
  rec: TaskRecord<T>,
  scope: Scope,
  fn: (ctx: TaskContext) => Promise<T>,
  opts: RunOpts,
  host: ScopeHost,
) {
  if (rec.ctl.signal.aborted) {
    const reason = rec.ctl.signal.reason;
    rec.task.cancel(reason instanceof CancelError ? reason.reason : 'scope-ended');
    return rec.complete();
  }
  const ctx = makeContext(rec, scope);
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.timeout) timer = setTimeout(() => rec.task.cancel('timeout'), opts.timeout);
  rec.markStarted();
  rec.transition('loading');
  host.bump();
  try {
    const v = await fn(ctx);
    if (!rec.ctl.signal.aborted) rec.transition('success', v);
  } catch (e) {
    // An abort is not an error. Swallowed here so application code never
    // has to tell "the user navigated away" apart from "the server broke".
    if (e instanceof CancelError || rec.ctl.signal.aborted)
      rec.transition('cancelled', undefined, new CancelError(rec.getReason() ?? 'user'));
    else rec.transition('error', undefined, e);
  } finally {
    if (timer) clearTimeout(timer);
    rec.complete();
    host.bump();
  }
}

function makeContext<T>(rec: TaskRecord<T>, scope: Scope): TaskContext {
  let shieldDepth = 0;
  const ctx: TaskContext = {
    get signal() {
      return rec.ctl.signal;
    },
    reason: () => rec.getReason(),
    progress(f, _info) {
      if (!rec.ctl.signal.aborted) rec.progress.set(f);
    },
    onCancel(fn) {
      rec.finalisers.push(fn);
    },
    spawn(name, fn) {
      const reason = () => (rec.getReason() === 'user' ? 'scope-ended' : (rec.getReason() ?? 'scope-ended'));
      const child = scope.run(name, async (ctx) => {
        // Scope membership alone does not carry a parent task's pending cancellation.
        if (rec.ctl.signal.aborted) throw new CancelError(reason());
        return fn(ctx);
      });
      rec.childTasks.push(child as Task<unknown>);
      if (rec.ctl.signal.aborted) child.cancel(reason());
      return child;
    },
    async all(tasks) {
      try {
        return await Promise.all(tasks.map((t) => settleOf(t)));
      } catch (e) {
        for (const t of tasks) t.cancel('dependency-cancelled');
        throw e;
      }
    },
    async race(tasks) {
      try {
        return await Promise.race(tasks.map((t) => settleOf(t)));
      } finally {
        for (const t of tasks) t.cancel('superseded');
        // Cancellation is immediate, but shields must unwind before the race settles.
        await Promise.all(tasks.map((t) => t.settled));
      }
    },
    async shield(fn) {
      shieldDepth++;
      let outcome: { ok: true; value: Awaited<ReturnType<typeof fn>> } | { ok: false; error: unknown };
      try {
        outcome = { ok: true, value: await fn() };
      } catch (error) {
        outcome = { ok: false, error };
      }
      shieldDepth--;
      if (shieldDepth === 0 && rec.ctl.signal.aborted) throw new CancelError(rec.getReason() ?? 'user');
      if (!outcome.ok) throw outcome.error;
      return outcome.value;
    },
  };
  return ctx;
}

/** A task's outcome as a promise: resolves with the value, rejects with the error. */
async function settleOf<R>(t: Task<R>): Promise<R> {
  await t.settled;
  if (t.status() === 'error') throw t.error();
  if (t.status() === 'cancelled') throw new CancelError('dependency-cancelled');
  return t.result() as R;
}

/** Cancellable sleep — what the REPL examples stand in for a request with. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelError('user'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason instanceof CancelError ? signal.reason : new CancelError('user'));
      },
      { once: true },
    );
  });
}

/* ------------------------------------------------------------------ *
 * Conversion at the two boundaries (§4.13.5, R83, R77).
 *
 * A value has three representations and they are not interchangeable:
 * what the store holds, what the wire carries, and what a person reads.
 * One declaration site, two contracts — because merging them corrupts
 * data. Give a value one encode/decode pair serving both boundaries and
 * either presentation goes locale-blind or the wire format goes
 * locale-dependent, and in the second case a German user's persisted
 * record holds "1.234,56" where an English user's holds "1,234.56".
 * That is not a formatting bug; it is corruption that survives a reload.
 * ------------------------------------------------------------------ */

/** store ↔ outside world. Total, pure, no ambient input: `decode(encode(v))` equals `v`.
 *  Note the absence of a context parameter — that absence is what keeps a locale
 *  out of the wire, and in the real toolkit the type system enforces it. */
export type Codec<V, W> = { encode(v: V): W; decode(w: W): V };

/** store ↔ components. Lossy on purpose, depends on ambient state, and its
 *  inward half can fail while the user is still typing — which is why the
 *  failure is state (R77) rather than an exception. */
export type Presenter<V, C> = {
  format(v: V, ctx: C): string;
  parse(text: string, ctx: C): { ok: true; value: V } | { ok: false; error: string };
};

export type CustomType<V, W, C> = { name: string; codec: Codec<V, W>; present?: Presenter<V, C> };

export function customType<V, W, C>(name: string, def: Omit<CustomType<V, W, C>, 'name'>): CustomType<V, W, C> {
  return { name, ...def };
}

/** The example from the brief, and the one that catches people out: a Date in the
 *  store, an ISO string on the wire, a locale-dependent string in the view. */
export const DateType = customType<Date, string, { locale: string; timeZone?: string }>('Date', {
  codec: {
    encode: (d) => d.toISOString(),
    decode: (s) => new Date(s),
  },
  present: {
    format: (d, ctx) => dateFormatter(ctx).format(d),
    /** Locale-aware, and it has to be: `Date.parse` reads `04.09.2026` as 8 April,
     *  silently, so a German user committing the date their own screen showed them
     *  would move it five months. This is exactly why the inward half takes the
     *  same context the outward half does, and why `Intl` shipping formatters with
     *  no parser at all is a gap a toolkit has to fill rather than inherit. */
    parse: (text, ctx) => {
      const d = parseLocaleDate(text, ctx);
      return d ? { ok: true, value: d } : { ok: false, error: 'not a date' };
    },
  },
});

/** The order the locale writes year, month and day in, learnt from the formatter
 *  itself rather than from a table of locales that would go stale. */
const orderCache = new Map<string, ('year' | 'month' | 'day')[]>();
function localeDateOrder(ctx: { locale: string; timeZone?: string }): ('year' | 'month' | 'day')[] {
  const key = `${ctx.locale}|${ctx.timeZone ?? ''}`;
  let order = orderCache.get(key);
  if (!order) {
    order = dateFormatter(ctx)
      .formatToParts(new Date(Date.UTC(2026, 10, 22)))
      .map((p) => p.type)
      .filter((t): t is 'year' | 'month' | 'day' => t === 'year' || t === 'month' || t === 'day');
    orderCache.set(key, order);
  }
  return order;
}

/** Both long and abbreviated Gregorian month names are accepted verbatim.
 *  Abbreviations can contain punctuation and combining marks (such as Thai). */
const monthCache = new Map<string, string[][]>();
function localeMonths(ctx: { locale: string; timeZone?: string }): string[][] {
  const key = `${ctx.locale}|${ctx.timeZone ?? ''}`;
  let names = monthCache.get(key);
  if (!names) {
    const formats = (['long', 'short'] as const).map(
      (month) => new Intl.DateTimeFormat(ctx.locale, { month, calendar: 'gregory', timeZone: ctx.timeZone }),
    );
    names = Array.from({ length: 12 }, (_, m) => {
      const date = new Date(Date.UTC(2026, m, 15));
      const contextual = dateFormatter(ctx)
        .formatToParts(date)
        .find((part) => part.type === 'month')!.value;
      return [...formats.map((f) => f.format(date)), contextual].map((name) => normalizeDateText(name).toLowerCase());
    });
    monthCache.set(key, names);
  }
  return names;
}

/** Resolves a month token that may be a number or a name in any locale. */
function readMonth(token: string, ctx: { locale: string; timeZone?: string }): number | null {
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n >= 1 && n <= 12 ? n : null;
  }
  const t = token.toLowerCase().replace(/\.$/, '');
  const i = localeMonths(ctx).findIndex((names) => names.some((name) => name.replace(/\.$/, '') === t));
  return i === -1 ? null : i + 1;
}

const datePatternCache = new Map<string, RegExp>();

/** Literal words and suffixes belong at the formatter's positions, not in date fields. */
function localeDatePattern(ctx: { locale: string; timeZone?: string }): RegExp {
  const key = `${ctx.locale}|${ctx.timeZone ?? ''}`;
  let pattern = datePatternCache.get(key);
  if (!pattern) {
    const months = [
      ...new Set(
        localeMonths(ctx)
          .flat()
          .map((name) => name.replace(/\.$/, '')),
      ),
    ]
      .sort((a, b) => b.length - a.length)
      .map((name) => `${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?`)
      .join('|');
    const source = dateFormatter(ctx)
      .formatToParts(new Date(Date.UTC(2026, 10, 22)))
      .map((part) => {
        if (part.type === 'month') return `(${months}|\\d{1,2})`;
        if (part.type === 'year' || part.type === 'day') return '(\\d{1,4})';
        // Sentinels preserve boundary spaces while normalizing bidi controls and digits.
        return normalizeDateText(`x${part.value}x`)
          .slice(1, -1)
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\s+/g, '\\s+');
      })
      .join('');
    pattern = new RegExp(`^${source}$`, 'iu');
    datePatternCache.set(key, pattern);
  }
  return pattern;
}

/** ISO first — it is unambiguous, and machine-written text arrives in it — then the
 *  locale's own order. The value comes back at midnight in the presented timezone:
 *  the format dropped the time, so the parse cannot invent it, and a field bound to
 *  a timestamp truncates on commit. That is a property of a lossy presenter rather
 *  than a bug in this one, and it is the reason the wire boundary is a separate
 *  contract that never goes near a locale. */
function parseLocaleDate(text: string, ctx: { locale: string; timeZone?: string }): Date | null {
  const trimmed = normalizeDateText(text);
  if (!trimmed) return null;
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoDay) return dateAtMidnight(Number(isoDay[1]), Number(isoDay[2]), Number(isoDay[3]), ctx.timeZone);
  const isoTimestamp = /^(\d{4})-(\d{2})-(\d{2})[T ]/.exec(trimmed);
  if (isoTimestamp) {
    if (!civilDate(Number(isoTimestamp[1]), Number(isoTimestamp[2]), Number(isoTimestamp[3]))) return null;
    const t = Date.parse(trimmed);
    return Number.isNaN(t) ? null : new Date(t);
  }
  // Match whole month names before splitting separators: dots may belong to a name.
  const aliases = localeMonths(ctx)
    .flat()
    .sort((a, b) => b.length - a.length);
  const months = aliases.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const numeric = trimmed
    .toLowerCase()
    .replace(new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${months})(?![\\p{L}\\p{M}\\p{N}])`, 'gu'), (name) =>
      String(readMonth(name, ctx)),
    );
  const formatted = localeDatePattern(ctx).exec(trimmed);
  const tokens = formatted ? formatted.slice(1) : numeric.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  const order = localeDateOrder(ctx);
  if (tokens.length !== order.length) return null;

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  order.forEach((part, i) => {
    const tok = tokens[i]!;
    if (part === 'month') month = readMonth(tok, ctx);
    else if (/^\d{1,4}$/.test(tok)) {
      if (part === 'year') year = Number(tok.length === 2 ? `20${tok}` : tok);
      else day = Number(tok);
    }
  });
  if (year === null || month === null || day === null) return null;
  return dateAtMidnight(year, month, day, ctx.timeZone);
}

/** Unicode decimal digits occur in consecutive groups of ten, including adjacent
 *  mathematical alphabets. Bidi controls affect display, not the civil date. */
function normalizeDateText(text: string): string {
  return text
    .replace(/\p{Decimal_Number}/gu, (digit) => {
      const code = digit.codePointAt(0)!;
      let start = code;
      while (/\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) start--;
      return String((code - start) % 10);
    })
    .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}

const midnightFormatterCache = new Map<string, Intl.DateTimeFormat>();

/** Solve for local midnight using the offset at that instant, including DST.
 *  A civil date with no midnight is rejected rather than silently changing days. */
function civilDate(year: number, month: number, day: number): Date | null {
  const civil = new Date(0);
  civil.setUTCFullYear(year, month - 1, day);
  if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day) return null;
  return civil;
}

function dateAtMidnight(year: number, month: number, day: number, timeZone?: string): Date | null {
  const civil = civilDate(year, month, day);
  if (!civil) return null;
  const key = timeZone ?? '';
  let formatter = midnightFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    midnightFormatterCache.set(key, formatter);
  }
  let instant = civil.getTime();
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)!.value);
    const local = new Date(0);
    local.setUTCFullYear(part('year'), part('month') - 1, part('day'));
    local.setUTCHours(part('hour'), part('minute'), part('second'), 0);
    const correction = civil.getTime() - local.getTime();
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  return null;
}

/** Constructing an `Intl` formatter is 55x the cost of reusing one (§4.13.5), which
 *  is the actual defect in most codebases that have a `formatDate()` helper. The
 *  compiler hoists this; the prototype caches it by hand to make the same point. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(ctx: { locale: string; timeZone?: string }): Intl.DateTimeFormat {
  const key = `${ctx.locale}|${ctx.timeZone ?? ''}`;
  let f = formatterCache.get(key);
  if (!f) {
    // Presentation and numeric input always use Gregorian years, even when the
    // locale requests another calendar. This presenter does no calendar conversion.
    f = new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium', calendar: 'gregory', timeZone: ctx.timeZone });
    formatterCache.set(key, f);
  }
  return f;
}
export const formatterConstructions = () => formatterCache.size;

/** Outward across the view. Reactive by construction: presentation depends on ambient
 *  state that is itself store state, so changing the locale recomputes every string.
 *  A codec can never do this, which is the second reason the two are not one thing. */
export function presented<V, W, C>(read: () => V, type: CustomType<V, W, C>, ctx: () => C) {
  if (!type.present) throw new Error(`${type.name} declares no presentation`);
  return derive(() => type.present!.format(read(), ctx()), `present:${type.name}`);
}

/** Encode a snapshot for the wire, using whichever declared type owns each path.
 *  Runs at the transport edge only — the in-memory patch log behind undo holds
 *  live values and encodes nothing. */
export type TypeMap = Record<string, CustomType<never, unknown, never>>;
export function encodeFor(value: unknown, path: string, types: TypeMap): unknown {
  const t = types[path];
  return t ? (t.codec as Codec<unknown, unknown>).encode(value) : value;
}
export function decodeFor(wire: unknown, path: string, types: TypeMap): unknown {
  const t = types[path];
  return t ? (t.codec as Codec<unknown, unknown>).decode(wire) : wire;
}

/** Inward across the view, and the reason parse failure cannot be an exception:
 *  it needs both representations at once — the raw text the person is still
 *  typing, and the last value that was good (R77). A field that reformats under
 *  the caret, or that throws away "1." on its way to "1.5", is the bug this
 *  shape exists to make unwritable. */
export type Field<V> = {
  /** Exactly what the person typed. Never rewritten while they are typing. */
  text(): string;
  /** The last value that parsed. Survives every invalid keystroke. */
  value(): V;
  error(): string | null;
  /** A keystroke. */
  input(text: string): void;
  /** Blur or submit: canonicalises the text if it is valid. Returns whether it was. */
  commit(): boolean;
  /** Abandon the edit and go back to the last good value. */
  reset(): void;
};

export function field<V, W, C>(initial: V, type: CustomType<V, W, C>, ctx: () => C): Field<V> {
  if (!type.present) throw new Error(`${type.name} declares no presentation`);
  const present = type.present;
  const text = signal(present.format(initial, ctx()), `field:${type.name}:text`);
  const value = signal(initial, `field:${type.name}:value`);
  const error = signal<string | null>(null, `field:${type.name}:error`);

  return {
    text: () => text.get(),
    value: () => value.get(),
    error: () => error.get(),
    input(next) {
      text.set(next); // whatever they typed stands, valid or not
      const r = present.parse(next, ctx());
      if (r.ok) {
        value.set(r.value);
        error.set(null);
      } else {
        error.set(r.error); // the last good value is untouched
      }
    },
    commit() {
      const r = present.parse(text.peek(), ctx());
      if (!r.ok) {
        error.set(r.error);
        return false;
      }
      value.set(r.value);
      error.set(null);
      text.set(present.format(r.value, ctx())); // canonicalise, but only now
      return true;
    },
    reset() {
      text.set(present.format(value.peek(), ctx()));
      error.set(null);
    },
  };
}
