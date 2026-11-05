/** Validated, immutable record adapter for UI settings. The Runtime remains the sole commit owner. */
import { StateError, type Dispose, type Runtime } from './core.js';
export interface RecordStore<T> {
  get(): Readonly<T>;
  set(value: T): void;
  update(recipe: (draft: T) => void): void;
  subscribe(listener: (value: Readonly<T>, previous: Readonly<T>) => void): Dispose;
}
function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value && typeof value === 'object' && !seen.has(value)) {
    // Object.freeze cannot make Map/Set/Date/ArrayBuffer/typed-array state immutable: allow plain objects and arrays only.
    const prototype: unknown = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      throw new StateError('STATE_RECORD_UNSUPPORTED', 'Records hold plain objects, arrays and primitives only');
    seen.add(value);
    for (const child of Object.values(value)) freeze(child, seen);
    Object.freeze(value);
  }
  return value;
}
/** structuredClone failures (functions, proxies) surface as the adapter's own typed error, not a DOMException. */
function clone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'DataCloneError')) throw error;
    throw new StateError('STATE_RECORD_UNSUPPORTED', 'Records must be structured-cloneable plain data');
  }
}
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
/** The validator owns the allowed schema. Only plain JSON-like data (objects, arrays, primitives) is suitable; other value types (Map, Set, Date, ArrayBuffer, typed arrays) are rejected. A recipe mutates its draft in place; a returned value is ignored (an expression-bodied arrow such as `d => (d.x = 1)` is therefore fine). */
export function createRecord<T extends object>(
  runtime: Runtime,
  initial: T,
  validate: (value: unknown) => T,
): RecordStore<T> {
  // Pre-validation copy protects callers. Post-validation copy isolates references retained by the validator.
  const validated = (value: unknown): T => {
    const result: unknown = validate(value);
    if (isThenable(result)) {
      void Promise.resolve(result).catch(() => {});
      throw new StateError('STATE_RECORD_ASYNC', 'Record validators must be synchronous');
    }
    return result as T;
  };
  const normalized = (value: unknown): T => freeze(clone(validated(clone(value))));
  let writing = false;
  const write = (action: () => void) => {
    if (writing) throw new StateError('STATE_RECORD_REENTRANT', 'Record writes cannot be reentrant');
    // Enter the runtime boundary before invoking trusted recipes, so purity guards run before effects.
    runtime.transaction(() => {
      writing = true;
      try {
        action();
      } finally {
        writing = false;
      }
    });
  };
  const state = runtime.signal<T>(normalized(initial));
  return Object.freeze({
    get: () => state.get(),
    set(value: T) {
      write(() => state.set(normalized(value)));
    },
    update(recipe: (draft: T) => void) {
      write(() => {
        const draft = clone(state.get());
        const result: unknown = recipe(draft);
        if (isThenable(result)) {
          // Absorb a later rejection, as the Runtime's own purity guards do, so it cannot crash the process.
          void Promise.resolve(result).catch(() => {});
          throw new StateError(
            'STATE_RECORD_ASYNC',
            'Record recipes must be synchronous; asynchronous side effects are not rolled back',
          );
        }
        state.set(normalized(draft));
      });
    },
    subscribe: (listener: (value: Readonly<T>, previous: Readonly<T>) => void) => state.subscribe(listener),
  });
}
