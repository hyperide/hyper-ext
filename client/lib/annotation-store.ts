import { useSyncExternalStore } from 'react';
import type { AnnotationElement } from '@/../../shared/types/annotations';
import { authFetch } from '@/utils/authFetch';

export interface AnnotationStoreApi {
  // Getters
  getAll(): AnnotationElement[];
  get(id: string): AnnotationElement | undefined;

  // Mutators (each triggers a server request)
  add(annotation: AnnotationElement): void;
  update(id: string, updates: Partial<AnnotationElement>): void;
  remove(id: string): void;
  removeBatch(ids: string[]): void;

  // Bulk operations (load/reload — no server calls)
  replaceAll(annotations: AnnotationElement[]): void;
  clear(): void;

  // React integration
  subscribe(listener: () => void): () => void;
  getSnapshot(): AnnotationElement[];
}

/**
 * Factory that creates a Map-based annotation store.
 * Each mutation immediately notifies subscribers and fires a server request.
 */
export function createAnnotationStore(projectId: string, componentPath: string): AnnotationStoreApi {
  const map = new Map<string, AnnotationElement>();
  const listeners = new Set<() => void>();
  let snapshot: AnnotationElement[] = [];

  function emitChange() {
    snapshot = [...map.values()];
    for (const listener of listeners) {
      listener();
    }
  }

  // Fire-and-forget server calls — errors are logged, not thrown
  function serverAdd(annotation: AnnotationElement) {
    authFetch(`/api/canvas-composition/${projectId}/annotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentPath, annotation }),
    }).catch((err) => console.error('[AnnotationStore] POST failed:', err));
  }

  function serverUpdate(id: string, annotation: AnnotationElement) {
    authFetch(`/api/canvas-composition/${projectId}/annotation/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentPath, annotation }),
    }).catch((err) => console.error('[AnnotationStore] PUT failed:', err));
  }

  function serverRemove(id: string) {
    authFetch(
      `/api/canvas-composition/${projectId}/annotation/${encodeURIComponent(id)}?componentPath=${encodeURIComponent(componentPath)}`,
      { method: 'DELETE' },
    ).catch((err) => console.error('[AnnotationStore] DELETE failed:', err));
  }

  function serverBatchDelete(ids: string[]) {
    authFetch(`/api/canvas-composition/${projectId}/annotations/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ componentPath, ids }),
    }).catch((err) => console.error('[AnnotationStore] batch-delete failed:', err));
  }

  const store: AnnotationStoreApi = {
    getAll() {
      return snapshot;
    },

    get(id: string) {
      return map.get(id);
    },

    add(annotation: AnnotationElement) {
      map.set(annotation.id, annotation);
      emitChange();
      serverAdd(annotation);
    },

    update(id: string, updates: Partial<AnnotationElement>) {
      const existing = map.get(id);
      if (!existing) return;

      const updated = {
        ...existing,
        ...updates,
        version: (existing.version || 1) + 1,
      } as AnnotationElement;

      map.set(id, updated);
      emitChange();
      serverUpdate(id, updated);
    },

    remove(id: string) {
      if (!map.has(id)) return;
      map.delete(id);
      emitChange();
      serverRemove(id);
    },

    removeBatch(ids: string[]) {
      let changed = false;
      for (const id of ids) {
        if (map.delete(id)) changed = true;
      }
      if (changed) {
        emitChange();
        serverBatchDelete(ids);
      }
    },

    replaceAll(annotations: AnnotationElement[]) {
      map.clear();
      for (const ann of annotations) {
        map.set(ann.id, ann);
      }
      emitChange();
    },

    clear() {
      map.clear();
      emitChange();
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },
  };

  return store;
}

/**
 * React hook to subscribe to annotation store changes via useSyncExternalStore.
 */
export function useAnnotationStoreSnapshot(store: AnnotationStoreApi): AnnotationElement[] {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
