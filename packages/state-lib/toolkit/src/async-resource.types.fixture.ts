import { Runtime } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';
import { matchAsyncState } from './match-async-state.js';

const runtime = new Runtime();
const resource = createAsyncResource<string, number>(runtime, {
  load: (input) => input.length,
});

// @ts-expect-error input type is preserved end to end.
void resource.run(42);

const fullHandlers = {
  idle: () => 'idle',
  loading: () => 'loading',
  success: (snapshot: { data: number }) => snapshot.data,
  empty: () => 'empty',
  error: () => 'error',
  cancelled: () => 'cancelled',
};

const { error: _dropped, ...withoutError } = fullHandlers;
void _dropped;

// @ts-expect-error a missing exhaustive case fails typechecking.
matchAsyncState(resource.getSnapshot(), withoutError);

// @ts-expect-error a string rendering is not a number.
const count: number = matchAsyncState(resource.getSnapshot(), {
  idle: () => 'idle',
  loading: () => 'loading',
  success: (snapshot) => snapshot.data.toFixed(),
  empty: () => 'empty',
  error: (snapshot) => String(snapshot.error),
  cancelled: () => 'cancelled',
});
void count;

// Positive control: generic handlers need no UI imports.
const label: string = matchAsyncState(resource.getSnapshot(), {
  idle: () => 'idle',
  loading: (snapshot) => `loading:${String(snapshot.data)}`,
  success: (snapshot) => `ok:${snapshot.data}`,
  empty: (snapshot) => `empty:${snapshot.data}`,
  error: (snapshot) => `error:${String(snapshot.error)}`,
  cancelled: () => 'cancelled',
});
void label;
resource.dispose();
runtime.dispose();
