import { Runtime } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';

const runtime = new Runtime();

// Declaring string failures while the loader throws Error must be rejected:
// without a real normalizer the Failure generic is unsound, so the API keeps
// failures unknown and takes no such parameter.
// @ts-expect-error failure payloads are unknown: no Failure generic is accepted.
const unsound = createAsyncResource<string, string, string>(runtime, {
  load: () => Promise.reject(new Error('boom')),
});
void unsound;

// Positive control: with the default unknown failure, narrowing is required
// and instanceof narrowing works idiomatically.
const resource = createAsyncResource<string, string>(runtime, { load: (input) => input });
const snapshot = resource.getSnapshot();
if (snapshot.status === 'error') {
  // @ts-expect-error failure payloads are unknown and need narrowing.
  const label: string = snapshot.error;
  void label;
  if (snapshot.error instanceof Error) {
    const message: string = snapshot.error.message;
    void message;
  }
}
resource.dispose();
runtime.dispose();
