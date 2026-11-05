/**
 * @file Synchronous publication authority for operations (HYP-1507/HYP-1536).
 * Framework-neutral; async execution remains owned by latestTask or the writer.
 * Exported in the unpublished toolkit package; no renderer or writer is implied.
 * Dispose this scope before its Runtime. Gates authorize synchronous invocation,
 * not arbitrary code, remote rollback, or work already started by a callback.
 */
import { StateError, type Runtime } from '../../runtime/src/index.js';

export type OperationLane = string | symbol;
export type RevocationReason = 'superseded' | 'scope-changed' | 'scope-disposed' | 'cancelled' | 'finished';
type Sync<T> = T extends PromiseLike<unknown> ? never : T;
export type GateResult<T> =
  | { readonly status: 'applied'; readonly value: T }
  | { readonly status: 'dropped'; readonly reason: RevocationReason };
export type OperationEventKind =
  | 'begin'
  | 'revoke'
  | 'advance'
  | 'dispose'
  | 'commit'
  | 'notify'
  | 'drop-commit'
  | 'drop-notify'
  | 'commit-failed'
  | 'notify-failed';
export interface OperationEvent {
  readonly sequence: number;
  readonly generation: number;
  readonly operationId: number | null;
  readonly kind: OperationEventKind;
  readonly reason?: RevocationReason;
  readonly published?: boolean;
}
export interface OperationDiagnostics {
  readonly generation: number;
  readonly disposed: boolean;
  readonly activeOperations: number;
  readonly droppedEvents: number;
  readonly trace: readonly OperationEvent[];
}
export interface OperationLease {
  readonly id: number;
  readonly generation: number;
  /** Advisory snapshot; use a gate again after every await. */
  readonly current: boolean;
  commit<T>(fn: () => T & Sync<T>): GateResult<T>;
  notify<T>(fn: () => T & Sync<T>): GateResult<T>;
  /** Bind once; every later invocation independently checks feedback authority. */
  bind<Args extends unknown[], T>(fn: (...args: Args) => T & Sync<T>): (...args: Args) => GateResult<T>;
  finish(): void;
  cancel(): void;
}
export interface OperationScope {
  begin(lane: OperationLane): OperationLease;
  advance(): void;
  dispose(): void;
  diagnostics(): OperationDiagnostics;
}
export interface OperationScopeOptions {
  readonly traceCapacity?: number;
}

export function createOperationScope(runtime: Runtime, options: OperationScopeOptions = {}): OperationScope {
  // Only absence selects the default: null from a JavaScript caller is invalid.
  const requestedCapacity = options.traceCapacity;
  const capacity = requestedCapacity === undefined ? 0 : requestedCapacity;
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 4096) {
    throw new RangeError('traceCapacity must be an integer from 0 to 4096');
  }
  type Ticket = { id: number; generation: number; lane: OperationLane; reason?: RevocationReason };
  const active = new Map<OperationLane, Ticket>();
  const events: OperationEvent[] = [];
  let generation = 0;
  let nextId = 0;
  let sequence = 0;
  let droppedEvents = 0;
  let disposed = false;
  // Public Runtime probes are version-neutral and preserve its purity,
  // transaction, notification and disposed guards before changing authority.
  const probe = () => {
    if (runtime.inTransaction) {
      throw new StateError('STATE_OPERATION_BOUNDARY', 'Change operation authority outside transactions');
    }
    runtime.transaction(() => undefined);
  };
  const assertLive = () => {
    if (disposed) throw new StateError('STATE_OPERATION_DISPOSED', 'The operation scope was disposed');
  };
  const record = (kind: OperationEventKind, ticket?: Ticket, reason?: RevocationReason, published?: boolean) => {
    if (capacity === 0) return;
    events.push(
      Object.freeze({
        sequence: ++sequence,
        generation: ticket?.generation ?? generation,
        operationId: ticket?.id ?? null,
        kind,
        ...(reason === undefined ? {} : { reason }),
        ...(published === undefined ? {} : { published }),
      }),
    );
    if (events.length > capacity) {
      events.shift();
      droppedEvents++;
    }
  };
  const revoke = (ticket: Ticket, reason: RevocationReason) => {
    if (ticket.reason !== undefined) return;
    ticket.reason = reason;
    if (active.get(ticket.lane) === ticket) active.delete(ticket.lane);
    record('revoke', ticket, reason);
  };
  probe();
  return Object.freeze({
    begin(lane: OperationLane): OperationLease {
      assertLive();
      probe();
      if (typeof lane !== 'string' && typeof lane !== 'symbol') {
        throw new TypeError('Operation lane must be a string or symbol');
      }
      const previous = active.get(lane);
      if (previous) revoke(previous, 'superseded');
      const ticket: Ticket = { id: ++nextId, generation, lane };
      active.set(lane, ticket);
      record('begin', ticket);
      const gate = <T>(kind: 'commit' | 'notify', fn: () => T & Sync<T>): GateResult<T> => {
        try {
          probe();
        } catch (error) {
          // Ordered teardown already revoked this lease. Do not manufacture a
          // late error or mutate trace when the Runtime can no longer probe purity.
          if (
            ticket.reason !== undefined &&
            error instanceof StateError &&
            (error.code === 'STATE_DISPOSED' ||
              error.code === 'STATE_IMPURE_DERIVE' ||
              error.code === 'STATE_REENTRANT_WRITE' ||
              error.code === 'STATE_OPERATION_BOUNDARY')
          ) {
            // A revoked call has no work left to perform. In a forbidden phase
            // even trace recording is a side effect, so return a read-only drop.
            // Live leases still propagate every Runtime boundary refusal.
            return { status: 'dropped', reason: ticket.reason };
          }
          throw error;
        }
        if (ticket.reason !== undefined) {
          record(kind === 'commit' ? 'drop-commit' : 'drop-notify', ticket, ticket.reason);
          return { status: 'dropped', reason: ticket.reason };
        }
        const before = runtime.version;
        try {
          const value = kind === 'commit' ? runtime.transaction<T>(fn) : fn();
          if (
            kind === 'notify' &&
            value !== null &&
            (typeof value === 'object' || typeof value === 'function') &&
            'then' in value
          ) {
            const then = value.then;
            if (typeof then === 'function') {
              // Cache the method: a lazy then getter is itself an effect. Drain
              // exactly once in a microtask with the original receiver.
              void new Promise<unknown>((resolve, reject) => {
                queueMicrotask(() => {
                  try {
                    Reflect.apply(then, value, [resolve, reject]);
                  } catch (error) {
                    reject(error);
                  }
                });
              }).catch(() => {});
              throw new StateError(
                'STATE_ASYNC_FEEDBACK',
                'Feedback must be synchronous; gate again after awaiting work',
              );
            }
          }
          record(kind, ticket);
          return { status: 'applied', value };
        } catch (error) {
          // The callback itself may throw NotificationError before publication.
          // Record this Runtime's publication fact, not the exception's class.
          record(
            kind === 'commit' ? 'commit-failed' : 'notify-failed',
            ticket,
            undefined,
            kind === 'commit' ? runtime.version !== before : undefined,
          );
          throw error;
        }
      };
      const end = (reason: 'finished' | 'cancelled') => {
        if (ticket.reason !== undefined) return;
        probe();
        revoke(ticket, reason);
      };
      return Object.freeze({
        id: ticket.id,
        generation: ticket.generation,
        get current() {
          return ticket.reason === undefined;
        },
        commit: <T>(fn: () => T & Sync<T>) => gate<T>('commit', fn),
        notify: <T>(fn: () => T & Sync<T>) => gate<T>('notify', fn),
        bind:
          <Args extends unknown[], T>(fn: (...args: Args) => T & Sync<T>) =>
          (...args: Args) =>
            gate<T>('notify', () => fn(...args)),
        finish: () => end('finished'),
        cancel: () => end('cancelled'),
      });
    },
    advance() {
      assertLive();
      probe();
      for (const ticket of active.values()) revoke(ticket, 'scope-changed');
      generation++;
      record('advance');
    },
    dispose() {
      if (disposed) return;
      probe();
      disposed = true;
      for (const ticket of active.values()) revoke(ticket, 'scope-disposed');
      record('dispose');
    },
    diagnostics: () =>
      Object.freeze({
        generation,
        disposed,
        activeOperations: active.size,
        droppedEvents,
        trace: Object.freeze([...events]),
      }),
  });
}
