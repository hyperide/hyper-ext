import {
  NotificationError,
  StateError,
  latestTask,
  type LatestOutcome,
  type Runtime,
} from '../../runtime/src/index.js';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'cancelled';

export type AsyncSnapshot<Result> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly data: Result | undefined; readonly hasData: boolean }
  | { readonly status: 'success'; readonly data: Result }
  | { readonly status: 'empty'; readonly data: Result }
  | {
      readonly status: 'error';
      readonly error: unknown;
      readonly data: Result | undefined;
      readonly hasData: boolean;
    }
  | { readonly status: 'cancelled'; readonly data: Result | undefined; readonly hasData: boolean };

export interface AsyncResourceOptions<Input, Result> {
  load: (input: Input, signal: AbortSignal) => Result | PromiseLike<Result>;
  isEmpty?: (value: Result, input: Input) => boolean;
}

export interface AsyncResource<Input, Result> {
  getSnapshot(): AsyncSnapshot<Result>;
  subscribe(listener: () => void): () => void;
  run(input: Input): Promise<LatestOutcome>;
  retry(): Promise<LatestOutcome>;
  cancel(): void;
  dispose(): void;
  readonly lastInput: Input | undefined;
}

function priorData<Result>(snapshot: AsyncSnapshot<Result>): { data: Result | undefined; hasData: boolean } {
  switch (snapshot.status) {
    case 'idle':
      return { data: undefined, hasData: false };
    case 'loading':
    case 'error':
    case 'cancelled':
      return { data: snapshot.data, hasData: snapshot.hasData };
    case 'success':
    case 'empty':
      return { data: snapshot.data, hasData: true };
  }
}

/**
 * Private origin tag: a NotificationError thrown BY the loader (or by the
 * domain isEmpty callback before any publication) must not be mistaken for a
 * committed publication. The wrapper never escapes this module: the rejection
 * handler unwraps it, publishes the ORIGINAL error in the error snapshot and
 * rethrows that same object outward.
 */
class DomainNotificationFailure {
  constructor(readonly original: NotificationError) {}
}

/** Framework-neutral request state on the current public Runtime/latestTask surface.
 * Cancellation, latest-wins ownership and kernel boundary probes come from
 * `latestTask`; this module adds only the discriminated snapshot, refresh/empty
 * policy and retry/dispose ownership. No retry, dedupe, cache or mutation logic.
 *
 * Failure payloads stay `unknown`: callers narrow with `instanceof` instead of
 * declaring a payload type no runtime normalizer enforces. State records are
 * frozen shallowly: the discriminated record is immutable, caller-owned result
 * payloads are not deep-frozen. */
export function createAsyncResource<Input, Result>(
  runtime: Runtime,
  options: AsyncResourceOptions<Input, Result>,
): AsyncResource<Input, Result> {
  if (!options || typeof options.load !== 'function') {
    throw new StateError('STATE_ASYNC_OPTIONS', 'createAsyncResource needs a load function');
  }
  if (options.isEmpty !== undefined && typeof options.isEmpty !== 'function') {
    throw new StateError('STATE_ASYNC_OPTIONS', 'isEmpty must be a function when provided');
  }
  const { load, isEmpty } = options;
  // Loader/domain NotificationErrors share their class with committed
  // observer failures, so origin is marked privately with a wrapper that never
  // escapes this module. The loader result is assimilated exactly once, with
  // one ordinary await: no manual thenable detection, no second observation
  // and no retained side map. latestTask performs that single assimilation, so
  // a lazy thenable runs its body exactly once. The rejection handler unwraps
  // to the ORIGINAL error.
  const guardedLoad = async (input: Input, signal: AbortSignal): Promise<Result> => {
    try {
      return await load(input, signal);
    } catch (error) {
      if (error instanceof NotificationError) throw new DomainNotificationFailure(error);
      throw error;
    }
  };
  const initial: AsyncSnapshot<Result> = Object.freeze({ status: 'idle' });
  // The kernel owns notification: observer failures surface as committed
  // NotificationError, exactly like any other staged publication.
  const state = runtime.signal<AsyncSnapshot<Result>>(initial);
  const owned = new Set<() => void>();
  const task = latestTask<Input, Result, void>(runtime, guardedLoad, (value, input) => {
    let empty: boolean;
    try {
      empty = isEmpty === undefined ? false : isEmpty(value, input);
    } catch (error) {
      // A domain failure before publication is not a committed notification,
      // even when it uses the NotificationError class.
      if (error instanceof NotificationError) throw new DomainNotificationFailure(error);
      throw error;
    }
    state.set(Object.freeze(empty ? { status: 'empty', data: value } : { status: 'success', data: value }));
  });
  let generation = 0;
  let activeTicket: number | undefined;
  let lastInput: Input | undefined;
  let hasInput = false;
  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new StateError('STATE_TASK_DISPOSED', 'The async resource was disposed');
  };
  // Mirror the kernel boundary probes that latestTask.run performs, but BEFORE
  // any toolkit authority or state change: lifecycle (start outside
  // transactions), notification delivery, pure derivations and root disposal
  // all reject here while the previous request and snapshot stay intact.
  const probeStart = () => {
    assertLive();
    if (runtime.inTransaction) {
      throw new StateError('STATE_TASK_BOUNDARY', 'Start async work outside transactions');
    }
    runtime.transaction(() => undefined);
  };
  const resource: AsyncResource<Input, Result> = {
    getSnapshot: () => state.peek(),
    subscribe: (listener: () => void) => {
      assertLive();
      const dispose = state.subscribe(() => listener());
      owned.add(dispose);
      return () => {
        owned.delete(dispose);
        dispose();
      };
    },
    run: (input: Input) => {
      // Boundary probes run before the loader starts and before any local
      // authority or state change; a rejected start leaves the previous
      // request, snapshot and remembered input untouched.
      probeStart();
      const prior = priorData(state.peek());
      // Claim toolkit authority BEFORE starting the kernel task: abort
      // listeners run synchronously inside task.run and may reenter this
      // resource with a replacement request.
      const ticket = ++generation;
      const previousTicket = activeTicket;
      const previousInput = lastInput;
      const previousHasInput = hasInput;
      activeTicket = ticket;
      hasInput = true;
      lastInput = input;
      let taskPromise: Promise<LatestOutcome>;
      try {
        taskPromise = task.run(input);
      } catch (error) {
        // The pre-start probe passed, so this path only restores the claimed
        // ticket instead of leaving authority with no job behind it.
        if (activeTicket === ticket) activeTicket = previousTicket;
        if (previousHasInput) {
          lastInput = previousInput;
        } else {
          hasInput = false;
          lastInput = undefined;
        }
        throw error;
      }
      const mapped = taskPromise.then(
        (outcome) => {
          if (ticket === activeTicket) activeTicket = undefined;
          return outcome;
        },
        (error: unknown) => {
          if (ticket === activeTicket) activeTicket = undefined;
          // Unwrap loader/domain failures first: the ORIGINAL error settles
          // the snapshot as error state and is rethrown with identity intact.
          // A bare NotificationError with no loader origin is a committed
          // publication (an observer failed AFTER this resource's state was
          // published): the committed success stays intact.
          const isLoaderOrigin = error instanceof DomainNotificationFailure;
          const failure = isLoaderOrigin ? error.original : error;
          if (!isLoaderOrigin && failure instanceof NotificationError) throw error;
          if (ticket === generation && !disposed) {
            const retained = priorData(state.peek());
            runtime.transaction(() => {
              state.set(
                Object.freeze({
                  status: 'error',
                  error: failure,
                  data: retained.data,
                  hasData: retained.hasData,
                }),
              );
            });
          }
          throw failure;
        },
      );
      // A reentrant replacement started inside an abort listener now owns the
      // snapshot; publishing our loading over it would clobber the replacement.
      if (activeTicket !== ticket) return mapped;
      // Publish loading AFTER the job owns it: a throwing loading subscriber
      // reports the committed NotificationError while the started job still
      // settles the snapshot later. Never map this into a loader error and
      // never clear the active ticket here.
      try {
        const data = prior.data;
        const hasData = prior.hasData;
        runtime.transaction(() => {
          state.set(Object.freeze({ status: 'loading', data, hasData }));
        });
      } catch (error) {
        void mapped.catch(() => {});
        throw error;
      }
      return mapped;
    },
    retry: () => {
      assertLive();
      if (!hasInput) {
        throw new StateError('STATE_ASYNC_NO_INPUT', 'No input to retry: call run(input) first');
      }
      return resource.run(lastInput as Input);
    },
    cancel: () => {
      probeStart();
      const ticketAtEntry = activeTicket;
      if (ticketAtEntry === undefined) return;
      // latestTask probes the kernel boundary before revoking authority and
      // runs abort listeners synchronously; a listener may start a
      // replacement run or dispose this resource before cancel resumes.
      task.cancel();
      if (disposed) return;
      // A replacement started inside an abort callback now owns the snapshot:
      // only the latest ticket counts as active, so cancel must not overwrite
      // replacement loading with cancelled.
      if (activeTicket !== ticketAtEntry) return;
      // Ownership is a current-request claim, not an unsettled-promise
      // counter: when the request already settled (a success committed before
      // the promise .then cleanup ran), release the claim without relabelling.
      if (state.peek().status !== 'loading') {
        activeTicket = undefined;
        return;
      }
      activeTicket = undefined;
      const prior = priorData(state.peek());
      runtime.transaction(() => {
        state.set(Object.freeze({ status: 'cancelled', data: prior.data, hasData: prior.hasData }));
      });
    },
    dispose: () => {
      if (disposed) return;
      // Guards run before any local teardown; a rejected dispose changes
      // nothing: no flag, no revoked authority, no lost subscriptions.
      if (runtime.inTransaction) {
        throw new StateError('STATE_TASK_BOUNDARY', 'Dispose tasks outside transactions');
      }
      try {
        runtime.transaction(() => undefined);
      } catch (error) {
        // Teardown touches no runtime state, so a closed runtime still gets a
        // clean local disposal; every other kernel refusal propagates intact.
        if (!(error instanceof StateError) || error.code !== 'STATE_DISPOSED') throw error;
      }
      // Claim disposal BEFORE revoking authority: abort handlers run
      // synchronously inside task.dispose and may reenter run, which must be
      // refused once disposal has started.
      disposed = true;
      task.dispose();
      activeTicket = undefined;
      for (const dispose of Array.from(owned)) dispose();
      owned.clear();
    },
    get lastInput() {
      return lastInput;
    },
  };
  return Object.freeze(resource);
}
