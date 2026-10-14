import { StateError, assertSideEffectsAllowed, type Runtime, type Sync } from './core.js';

export type LatestOutcome = 'committed' | 'superseded' | 'cancelled';
export interface LatestTask<Input> {
  run(input: Input): Promise<LatestOutcome>;
  cancel(): void;
  dispose(): void;
}
type Ticket = {
  controller: AbortController;
  outcome: 'superseded' | 'cancelled';
  committing: boolean;
  revoked: Promise<LatestOutcome>;
  revoke: (outcome: LatestOutcome) => void;
};
function createTicket(): Ticket {
  let revoke!: (outcome: LatestOutcome) => void;
  const revoked = new Promise<LatestOutcome>((resolve) => {
    revoke = resolve;
  });
  return { controller: new AbortController(), outcome: 'superseded', committing: false, revoked, revoke };
}
function invalidateTicket(ticket: Ticket, outcome: 'superseded' | 'cancelled'): void {
  ticket.outcome = outcome;
  // Once commit starts, its actual publication/error must win over lifecycle callbacks.
  if (!ticket.committing) ticket.revoke(outcome);
  ticket.controller.abort(outcome);
}

/** Optional reference module: await externally, then atomically commit only the latest result.
 * Cancellation revokes commit authority even for non-cooperative loaders. It is not a
 * server-side reservation, a query cache, or a promise to undo external side effects. */
export function latestTask<Input, Result, Commit>(
  runtime: Runtime,
  load: (input: Input, signal: AbortSignal) => Result | PromiseLike<Result>,
  commit: (value: Result, input: Input) => Commit & Sync<Commit>,
): LatestTask<Input> {
  let active: Ticket | undefined;
  let disposed = false;
  const assertBoundary = () => {
    if (disposed) throw new StateError('STATE_TASK_DISPOSED', 'The task owner was disposed');
    if (runtime.inTransaction) throw new StateError('STATE_TASK_BOUNDARY', 'Start async work outside transactions');
    // Reuse kernel purity, notification and root-lifetime guards before any side effect.
    runtime.transaction(() => undefined);
  };
  assertBoundary();
  const invalidate = () => {
    const previous = active;
    active = undefined;
    if (previous) {
      invalidateTicket(previous, 'cancelled');
    }
  };
  const execute = async (ticket: Ticket, input: Input): Promise<LatestOutcome> => {
    try {
      if (active !== ticket) return ticket.outcome;
      let value: Result;
      try {
        value = await load(input, ticket.controller.signal);
      } catch (error) {
        if (active !== ticket) return ticket.outcome;
        throw error;
      }
      if (active !== ticket) return ticket.outcome;
      // NotificationError means publication happened; never catch it as a stale load error.
      ticket.committing = true;
      runtime.transaction<Commit>(() => commit(value, input));
      return 'committed';
    } finally {
      if (active === ticket) active = undefined;
    }
  };
  return Object.freeze({
    run(input: Input) {
      assertBoundary();
      const previous = active;
      const ticket = createTicket();
      active = ticket;
      if (previous) {
        invalidateTicket(previous, 'superseded');
      }
      // Abort handlers may synchronously start another request; execute rechecks ownership.
      return Promise.race([execute(ticket, input), ticket.revoked]);
    },
    cancel() {
      assertBoundary();
      invalidate();
    },
    dispose() {
      if (disposed) return;
      assertSideEffectsAllowed();
      if (runtime.inTransaction) throw new StateError('STATE_TASK_BOUNDARY', 'Dispose tasks outside transactions');
      disposed = true;
      invalidate();
    },
  });
}
