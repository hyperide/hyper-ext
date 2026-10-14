import { StateError } from '../../runtime/src/index.js';
import type { AsyncSnapshot } from './async-resource.js';

export interface AsyncStateHandlers<Result, Return> {
  idle: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'idle' }>) => Return;
  loading: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'loading' }>) => Return;
  success: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'success' }>) => Return;
  empty: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'empty' }>) => Return;
  error: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'error' }>) => Return;
  cancelled: (snapshot: Extract<AsyncSnapshot<Result>, { status: 'cancelled' }>) => Return;
}

const CASES = ['idle', 'loading', 'success', 'empty', 'error', 'cancelled'] as const;

/** Exhaustive, framework-neutral dispatch over an async snapshot. Every case is
 * required by the types and validated at runtime before dispatch, so an
 * incomplete handler table fails loudly instead of rendering nothing. Pure:
 * handlers receive the narrowed snapshot and must start no network work.
 * Error payloads are `unknown`: narrow them with `instanceof` in the handler. */
export function matchAsyncState<Result, Return>(
  snapshot: AsyncSnapshot<Result>,
  handlers: AsyncStateHandlers<Result, Return>,
): Return {
  if (!handlers || typeof handlers !== 'object') {
    throw new StateError('STATE_ASYNC_MATCH', 'matchAsyncState needs a complete handler table');
  }
  for (const name of CASES) {
    if (typeof handlers[name] !== 'function') {
      throw new StateError('STATE_ASYNC_MATCH', `matchAsyncState: missing handler for "${name}"`);
    }
  }
  switch (snapshot.status) {
    case 'idle':
      return handlers.idle(snapshot);
    case 'loading':
      return handlers.loading(snapshot);
    case 'success':
      return handlers.success(snapshot);
    case 'empty':
      return handlers.empty(snapshot);
    case 'error':
      return handlers.error(snapshot);
    case 'cancelled':
      return handlers.cancelled(snapshot);
    default:
      throw new StateError('STATE_ASYNC_MATCH', 'matchAsyncState: unknown async status');
  }
}
