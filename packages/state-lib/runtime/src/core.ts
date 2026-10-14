/**
 * Synchronous reactive kernel. A transaction stages all writes before publication.
 * Its commit invalidates the complete reachable graph before evaluating observers;
 * all observer values are then evaluated before any user notification is delivered.
 *
 * Transaction callbacks, derivations and equality predicates must be synchronous.
 * Effects are outside rollback: notification failures have committed=true.
 */
export type Dispose = () => void;
export type Equality<T> = (left: T, right: T) => boolean;
export type Sync<T> = T extends PromiseLike<unknown> ? never : T;

export interface Readable<T> {
  get(): T;
  peek(): T;
  subscribe(listener: (value: T, previous: T) => void): Dispose;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(fn: (previous: T) => T): void;
}

export interface Derived<T> extends Readable<T> {
  dispose(): void;
}

export class StateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StateError';
  }
}

export class NotificationError extends AggregateError {
  readonly committed = true;
  constructor(errors: unknown[]) {
    super(errors, 'State committed, but one or more observers failed');
    this.name = 'NotificationError';
  }
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
interface Source {
  readonly subscribers: Set<Computation>;
}
interface Computation extends Source {
  dependencies: Set<Source>;
  dirty: boolean;
  disposed: boolean;
  invalidate(): void;
}
interface Publication {
  publish(): void;
  readonly source: Source;
}
interface PendingValue {
  prepare(): Publication | undefined;
  readonly value: unknown;
}
interface Observer {
  readonly disposed: boolean;
  prepare(): (() => void) | undefined;
}

// Only the synchronous call stack is shared. Values, ownership and transaction
// journals remain request-local; finally blocks restore context before yielding.
interface ReadFrame {
  runtime: Runtime;
  node: Computation;
  dependencies: Set<Source>;
}
interface StagedRead {
  outcome: Outcome<unknown>;
  dependencies: Set<Source>;
}
let activeRead: ReadFrame | undefined;
let pureDepth = 0;

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

function finishDependencies(node: Computation, previous: Set<Source>): void {
  for (const dependency of previous) dependency.subscribers.delete(node);
  if (node.disposed) node.dependencies.clear();
  else for (const dependency of node.dependencies) dependency.subscribers.add(node);
  node.dirty = false;
}

/** Own one runtime per request/test/root when using server-side rendering. */
export class Runtime {
  private transactionDepth = 0;
  private pending = new Map<Source, PendingValue>();
  private journal: Array<{ source: Source; previous: PendingValue | undefined }> = [];
  private observers = new Set<Observer>();
  private owned = new Set<Dispose>();
  private notifying = false;
  private disposing = false;
  private closed = false;
  private revision = 0;
  private reads = new Set<ReadFrame>();
  private stagedMemo: Map<Computation, StagedRead> | undefined;

  get version(): number {
    return this.revision;
  }
  get inTransaction(): boolean {
    return this.transactionDepth !== 0;
  }

  private assertOpen(): void {
    if (this.closed) throw new StateError('STATE_DISPOSED', 'The runtime has been disposed');
  }

  private assertWrite(): void {
    this.assertOpen();
    if (pureDepth !== 0) {
      throw new StateError('STATE_IMPURE_DERIVE', 'Writing state from a derivation or equality predicate is forbidden');
    }
    if (this.notifying) {
      throw new StateError(
        'STATE_REENTRANT_WRITE',
        'Schedule a new task instead of writing during notification delivery',
      );
    }
  }

  private assertAllocation(): void {
    this.assertOpen();
    if (this.inTransaction || pureDepth !== 0) {
      throw new StateError(
        'STATE_GRAPH_BOUNDARY',
        'Create signals and derivations outside transactions and pure callbacks',
      );
    }
  }

  private track(source: Source): void {
    if (activeRead && activeRead.runtime !== this) {
      throw new StateError(
        'STATE_CROSS_RUNTIME_READ',
        'Tracked reads must use one runtime; use peek or untrack for snapshots',
      );
    }
    if (activeRead && activeRead.node !== source) activeRead.dependencies.add(source);
  }

  private tracking<T>(node: Computation, fn: () => T, dependencies = node.dependencies): T {
    const previous = activeRead;
    const frame = { runtime: this, node, dependencies };
    activeRead = frame;
    this.reads.add(frame);
    try {
      return fn();
    } finally {
      activeRead = previous;
      this.reads.delete(frame);
    }
  }

  /** Reads are tracked only during synchronous derivations, never in listeners. */
  untrack<T>(fn: () => T): T {
    const previous = activeRead;
    activeRead = undefined;
    try {
      return fn();
    } finally {
      activeRead = previous;
    }
  }

  private pure<T>(fn: () => T): T {
    const ownsMemo = this.inTransaction && !this.stagedMemo;
    if (ownsMemo) this.stagedMemo = new Map();
    pureDepth++;
    try {
      const result = fn();
      if (isThenable(result)) {
        // The synchronous guard owns reporting; drain rejection without cancelling work.
        void Promise.resolve(result).catch(() => {});
        throw new StateError('STATE_ASYNC_DERIVE', 'A derivation cannot return a promise; use a resource');
      }
      return result;
    } finally {
      pureDepth--;
      if (ownsMemo) this.stagedMemo = undefined;
    }
  }

  /**
   * Atomic, synchronous transaction with nested savepoints. A callback failure
   * discards its writes. A notification failure occurs AFTER publication and is
   * reported as NotificationError, not as a rolled-back transaction.
   */
  transaction<T>(fn: () => T & Sync<T>): T {
    this.assertWrite();
    const savepoint = this.journal.length;
    this.transactionDepth++;
    let result: T;
    try {
      result = fn();
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => {});
        throw new StateError(
          'STATE_ASYNC_TRANSACTION',
          'Transactions cannot cross await; use a resource and commit synchronously',
        );
      }
    } catch (error) {
      this.rollback(savepoint);
      this.transactionDepth--;
      throw error;
    }
    if (this.transactionDepth > 1) {
      this.transactionDepth--;
      return result;
    }
    // Keep the staging read context alive through validation. Equality callbacks
    // may read derives; those reads must not mutate the committed cache/graph.

    // Preflight EVERY equality predicate before publishing ANY source.
    // A predicate that throws cannot leave a partly published transaction.
    const publications: Publication[] = [];
    try {
      for (const value of this.pending.values()) {
        const publication = value.prepare();
        if (publication) publications.push(publication);
      }
    } catch (error) {
      this.rollback(savepoint);
      throw error;
    } finally {
      this.transactionDepth--;
    }
    this.pending.clear();
    this.journal.length = 0;
    if (publications.length === 0) return result;
    if (!Number.isSafeInteger(this.revision + 1)) {
      throw new StateError('STATE_VERSION_OVERFLOW', 'The runtime revision cannot be represented exactly');
    }
    for (const publication of publications) publication.publish();
    this.revision++;

    // No user callbacks occur in this phase. Invalidate the whole graph first.
    const visited = new Set<Computation>();
    const stack: Computation[] = [];
    for (const publication of publications) {
      for (const subscriber of publication.source.subscribers) stack.push(subscriber);
    }
    while (stack.length !== 0) {
      const node = stack.pop();
      if (!node || node.disposed || visited.has(node)) continue;
      visited.add(node);
      node.invalidate();
      for (const subscriber of node.subscribers) stack.push(subscriber);
    }
    this.flush();
    return result;
  }

  private rollback(savepoint: number): void {
    while (this.journal.length > savepoint) {
      const entry = this.journal.pop();
      if (!entry) break;
      if (entry.previous) this.pending.set(entry.source, entry.previous);
      else this.pending.delete(entry.source);
    }
  }

  private flush(): void {
    const errors: unknown[] = [];
    const deliveries: Array<() => void> = [];
    const current = Array.from(this.observers);
    this.observers.clear();
    this.notifying = true;
    try {
      // Pull every observed result before running a user notification.
      for (const observer of current) {
        if (observer.disposed) continue;
        try {
          const delivery = observer.prepare();
          if (delivery) deliveries.push(delivery);
        } catch (error) {
          errors.push(error);
        }
      }
      this.untrack(() => {
        for (const deliver of deliveries) {
          try {
            deliver();
          } catch (error) {
            errors.push(error);
          }
        }
      });
    } finally {
      this.notifying = false;
    }
    if (errors.length !== 0) throw new NotificationError(errors);
  }

  /** Values are caller-owned; stores separately enforce immutable data boundaries. */
  signal<T>(initial: T, equals: Equality<T> = Object.is): Writable<T> {
    this.assertAllocation();
    let value = initial;
    const source: Source = { subscribers: new Set() };
    const get = (): T => {
      this.assertOpen();
      this.track(source);
      const staged = this.pending.get(source);
      // The map key uniquely identifies this signal; only set(T) populates it.
      return staged ? (staged.value as T) : value;
    };
    const set = (next: T): void => {
      this.assertWrite();
      if (!this.inTransaction) {
        this.transaction(() => set(next));
        return;
      }
      this.journal.push({ source, previous: this.pending.get(source) });
      this.pending.set(source, {
        value: next,
        prepare: () => {
          if (this.pure(() => equals(value, next))) return undefined;
          return {
            source,
            publish() {
              value = next;
            },
          };
        },
      });
    };
    return {
      get,
      peek: () => this.untrack(get),
      set,
      update: (fn) => {
        this.assertWrite();
        set(this.untrack(() => fn(get())));
      },
      subscribe: (listener) => this.observe(get, listener),
    };
  }

  /**
   * Lazy cached derivation with dynamic dependencies and cycle detection.
   * A failed evaluation still keeps its read dependencies so it can recover.
   * Dispose a manually owned derivation, or dispose its runtime/root.
   */
  derive<T>(fn: () => T & Sync<T>): Derived<T> {
    this.assertAllocation();
    let evaluating = false;
    let outcome: Outcome<T> | undefined;
    let previousDependencies: Set<Source> | undefined;
    const node: Computation = {
      subscribers: new Set(),
      dependencies: new Set(),
      dirty: true,
      disposed: false,
      invalidate() {
        node.dirty = true;
      },
    };
    const unwrap = (result: Outcome<T>): T => {
      if (!result.ok) throw result.error;
      return result.value;
    };
    const evaluate = (): T => {
      if (evaluating) throw new StateError('STATE_CYCLE', 'A derivation recursively depends on itself');
      evaluating = true;
      try {
        return this.pure(fn);
      } finally {
        evaluating = false;
      }
    };
    const get = (): T => {
      this.assertOpen();
      if (node.disposed) throw new StateError('STATE_DISPOSED', 'The derivation has been disposed');
      this.track(node);
      // Uncommitted reads never replace a committed cache or dependency graph.
      if (this.inTransaction) {
        return this.pure(() => {
          // The node identity fixes T; this memo contains only this node's outcomes.
          const cached = this.stagedMemo?.get(node)?.outcome as Outcome<T> | undefined;
          if (cached) return unwrap(cached);
          const dependencies = new Set<Source>();
          let staged: Outcome<T>;
          try {
            staged = { ok: true, value: this.tracking(node, evaluate, dependencies) };
          } catch (error) {
            staged = { ok: false, error };
          }
          this.stagedMemo?.set(node, { outcome: staged, dependencies });
          return unwrap(staged);
        });
      }
      // Preserve the outer evaluation's reads so a conditional cycle can recover.
      if (evaluating) throw new StateError('STATE_CYCLE', 'A derivation recursively depends on itself');
      if (!node.dirty && outcome) return unwrap(outcome);
      const oldDependencies = node.dependencies;
      previousDependencies = oldDependencies;
      node.dependencies = new Set();
      try {
        outcome = { ok: true, value: this.tracking(node, evaluate) };
      } catch (error) {
        outcome = { ok: false, error };
      } finally {
        finishDependencies(node, oldDependencies);
        previousDependencies = undefined;
      }
      return unwrap(outcome);
    };
    const dispose = (): void => {
      if (node.disposed) return;
      // Active reads have not installed subscriber edges yet. Keep them visible
      // through untrack, while allowing disposed observers to release their reads.
      let inFlight = Array.from(this.reads).some(
        (frame) => frame.node !== node && !frame.node.disposed && frame.dependencies.has(node),
      );
      // A completed staged consumer can still be reused by the active evaluation.
      for (const [consumer, read] of this.stagedMemo ?? []) {
        if (consumer !== node && !consumer.disposed && read.dependencies.has(node)) {
          inFlight = true;
          break;
        }
      }
      if ((node.subscribers.size !== 0 || inFlight) && !this.disposing) {
        throw new StateError(
          'STATE_OBSERVED_DISPOSE',
          'Unsubscribe dependent observers before disposing this derivation',
        );
      }
      node.disposed = true;
      for (const dependency of previousDependencies ?? []) dependency.subscribers.delete(node);
      for (const dependency of node.dependencies) dependency.subscribers.delete(node);
      node.dependencies.clear();
      this.owned.delete(dispose);
    };
    // Root disposal tears down the whole owned graph, including dynamic edges.
    this.owned.add(dispose);
    return { get, peek: () => this.untrack(get), subscribe: (listener) => this.observe(get, listener), dispose };
  }

  /** Subscribe without an initial notification. The listener is deliberately untracked. */
  watch<T>(
    read: () => T & Sync<T>,
    listener: (value: T, previous: T) => void,
    equals: Equality<T> = Object.is,
  ): Dispose {
    return this.observe(read, listener, equals);
  }

  // Internal getters are generic in T; the synchronous guard is checked at the
  // public callback boundary and again by pure() when a value is evaluated.
  private observe<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    equals: Equality<T> = Object.is,
  ): Dispose {
    this.assertOpen();
    if (this.inTransaction || pureDepth !== 0) {
      throw new StateError('STATE_OBSERVER_BOUNDARY', 'Create observers outside transactions and derivations');
    }
    let previous: T;
    const node: Computation & Observer = {
      subscribers: new Set(),
      dependencies: new Set(),
      disposed: false,
      dirty: true,
      invalidate: () => {
        node.dirty = true;
        this.observers.add(node);
      },
      prepare: () => {
        if (node.disposed || !node.dirty) return undefined;
        const next = evaluate();
        if (this.pure(() => equals(previous, next))) return undefined;
        const before = previous;
        previous = next;
        return () => {
          if (!node.disposed) listener(next, before);
        };
      },
    };
    let previousDependencies: Set<Source> | undefined;
    const evaluate = (): T => {
      const old = node.dependencies;
      previousDependencies = old;
      node.dependencies = new Set();
      try {
        return this.tracking(node, () => this.pure(read));
      } finally {
        finishDependencies(node, old);
        previousDependencies = undefined;
      }
    };
    const dispose = (): void => {
      if (node.disposed) return;
      node.disposed = true;
      // A read replaces the tracked set before its old subscriber edges detach.
      for (const dependency of previousDependencies ?? []) dependency.subscribers.delete(node);
      for (const dependency of node.dependencies) dependency.subscribers.delete(node);
      node.dependencies.clear();
      this.observers.delete(node);
      this.owned.delete(dispose);
    };
    try {
      previous = evaluate();
    } catch (error) {
      dispose();
      throw error;
    }
    this.owned.add(dispose);
    return dispose;
  }

  dispose(): void {
    if (this.closed) return;
    if (this.inTransaction || this.notifying || pureDepth !== 0) {
      throw new StateError(
        'STATE_DISPOSE_BOUNDARY',
        'Dispose the runtime outside an active transaction or notification',
      );
    }
    const errors: unknown[] = [];
    this.disposing = true;
    try {
      for (const dispose of Array.from(this.owned).reverse()) {
        try {
          dispose();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      this.disposing = false;
    }
    if (errors.length !== 0) throw new AggregateError(errors, 'Runtime cleanup failed');
    this.closed = true;
    this.pending.clear();
    this.observers.clear();
  }
}
