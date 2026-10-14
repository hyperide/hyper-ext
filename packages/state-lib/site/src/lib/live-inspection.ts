import { scopeValues, inspectionOf, changedValuePaths } from './repl-inspection';
export type InspectionSource = { scope: Record<string, unknown>; subscribe: (notify: () => void) => () => void };
export type InspectionUpdate = { data: Record<string, unknown>; paths: string[]; revision: number };
/** One observer per session; checkpoint scope replacements do not reset its history. */
export function observeLiveInspection(
  source: InspectionSource,
  publish: (update: InspectionUpdate) => void,
): () => void {
  let active = true,
    queued = false,
    revision = 0;
  let data = scopeValues(source.scope);
  const adapters = new Map<unknown, () => void>();
  const reconcile = () => {
    const current = new Set(
      Object.values(Object.getOwnPropertyDescriptors(source.scope)).flatMap((descriptor) =>
        'value' in descriptor && inspectionOf(descriptor.value) ? [descriptor.value] : [],
      ),
    );
    for (const [value, stop] of adapters)
      if (!current.has(value)) {
        stop();
        adapters.delete(value);
      }
    for (const value of current) if (!adapters.has(value)) adapters.set(value, inspectionOf(value)!.subscribe(changed));
  };
  function changed() {
    if (!active || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!active) return;
      reconcile();
      const next = scopeValues(source.scope),
        paths = changedValuePaths(data, next);
      data = next;
      if (paths.length) publish({ data, paths, revision: ++revision });
    });
  }
  reconcile();
  const stopSource = source.subscribe(changed);
  publish({ data, paths: [], revision });
  return () => {
    active = false;
    stopSource();
    adapters.forEach((stop) => stop());
    adapters.clear();
  };
}
