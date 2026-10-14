export interface ExternalStore<T> {
  getSnapshot(): T;
  subscribe(notify: () => void): () => void;
}

/** Framework-neutral bridge; values must use the kernel's immutable-update convention. */
export function toExternalStore<T>(source: {
  get(): T;
  subscribe(listener: (value: T) => void): () => void;
}): ExternalStore<T> {
  return Object.freeze({
    getSnapshot: () => source.get(),
    subscribe: (notify: () => void) => source.subscribe(() => notify()),
  });
}

/** Cached selector snapshots for external-store UI bindings; no second reactive runtime. */
export function selectExternalStore<T, Selected>(
  source: ExternalStore<T>,
  selector: (snapshot: T) => Selected,
  equal: (left: Selected, right: Selected) => boolean = Object.is,
): ExternalStore<Selected> {
  let initialized = false;
  let snapshot: T;
  let selection: Selected;
  const getSnapshot = () => {
    const next = source.getSnapshot();
    if (initialized && Object.is(next, snapshot)) return selection;
    const selected = selector(next);
    const reuse = initialized && equal(selection, selected);
    snapshot = next;
    initialized = true;
    if (!reuse) selection = selected;
    return selection;
  };
  return Object.freeze({
    getSnapshot,
    subscribe(notify: () => void) {
      let observed = getSnapshot();
      return source.subscribe(() => {
        const next = getSnapshot();
        if (!Object.is(observed, next)) {
          observed = next;
          notify();
        }
      });
    },
  });
}
