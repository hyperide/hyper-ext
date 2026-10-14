import type { Example } from '../data/examples';
export type WorkbenchDraft = { setup: string; source: string; ui: string; command: string };
export type DraftPersistence = 'saved' | 'pending' | 'memory';
const memory = new Map<string, WorkbenchDraft>();
const pending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; notify?: (status: DraftPersistence) => void }
>();
const memoryOnly = new Set<string>();
const lastWritten = new Map<string, string>();
const prefix = 'state.workbench.v1:';
export const WORKBENCH_DRAFT_LIMIT = 300_000;
const size = (draft: WorkbenchDraft) =>
  draft.setup.length + draft.source.length + draft.ui.length + draft.command.length;
function invalidateOldCopy(id: string) {
  lastWritten.delete(id);
  try {
    sessionStorage.removeItem(prefix + id);
  } catch {
    /* Keep the memory-only warning when storage is inaccessible. */
  }
}
export function readWorkbenchDraft(example: Example, defaultUi: string): WorkbenchDraft {
  const fallback = { setup: example.setup, source: example.code, ui: example.ui ?? defaultUi, command: '' };
  const cached = memory.get(example.id);
  if (cached) return cached;
  try {
    const encoded = sessionStorage.getItem(prefix + example.id);
    if (!encoded || encoded.length > WORKBENCH_DRAFT_LIMIT * 2) return fallback;
    const parsed: unknown = JSON.parse(encoded);
    if (parsed && typeof parsed === 'object') {
      const fields = ['setup', 'source', 'ui', 'command'] as const;
      if (fields.every((key) => typeof Reflect.get(parsed, key) === 'string')) {
        const draft = Object.fromEntries(fields.map((key) => [key, Reflect.get(parsed, key)])) as WorkbenchDraft;
        if (size(draft) > WORKBENCH_DRAFT_LIMIT) return fallback;
        memory.set(example.id, draft);
        lastWritten.set(example.id, encoded);
        return draft;
      }
    }
  } catch {
    /* Reading/editing remains usable when browser storage is unavailable. */
  }
  return fallback;
}
export function flushWorkbenchDraft(id: string): DraftPersistence {
  const queued = pending.get(id);
  if (queued) clearTimeout(queued.timer);
  pending.delete(id);
  const draft = memory.get(id);
  if (!draft) return 'saved';
  let status: DraftPersistence = 'memory';
  if (size(draft) <= WORKBENCH_DRAFT_LIMIT) {
    try {
      const encoded = JSON.stringify(draft);
      if (encoded.length > WORKBENCH_DRAFT_LIMIT * 2)
        throw new RangeError('Draft exceeds the persisted representation limit');
      if (lastWritten.get(id) !== encoded) sessionStorage.setItem(prefix + id, encoded);
      lastWritten.set(id, encoded);
      memoryOnly.delete(id);
      status = 'saved';
    } catch {
      invalidateOldCopy(id);
    }
  } else invalidateOldCopy(id);
  if (status === 'memory') memoryOnly.add(id);
  queued?.notify?.(status);
  return status;
}
export function saveWorkbenchDraft(
  id: string,
  draft: WorkbenchDraft,
  notify?: (status: DraftPersistence) => void,
): DraftPersistence {
  memory.set(id, { ...draft });
  const previous = pending.get(id);
  if (previous) clearTimeout(previous.timer);
  pending.set(id, { timer: setTimeout(() => flushWorkbenchDraft(id), 250), notify });
  return 'pending';
}
export function clearWorkbenchDraft(id: string): void {
  const queued = pending.get(id);
  if (queued) clearTimeout(queued.timer);
  pending.delete(id);
  memory.delete(id);
  memoryOnly.delete(id);
  lastWritten.delete(id);
  invalidateOldCopy(id);
}
function flushAll() {
  for (const id of pending.keys()) flushWorkbenchDraft(id);
}
const protectUnsaved = (event: BeforeUnloadEvent) => {
  flushAll();
  if (memoryOnly.size) {
    event.preventDefault();
    event.returnValue = '';
  }
};
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', protectUnsaved);
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      flushAll();
      window.removeEventListener('pagehide', flushAll);
      window.removeEventListener('beforeunload', protectUnsaved);
    });
}
