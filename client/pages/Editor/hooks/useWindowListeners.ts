import { useEffect } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { useGitStore } from '@/stores/gitStore';

export function useExternalFileChangeListener(engine: CanvasEngine) {
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.redoSnapshotId !== undefined || detail?.undoSnapshotId !== undefined) {
        engine.recordExternalFileChange(detail);
      }
    };
    window.addEventListener('hypercanvas:externalFileChange', handler);
    return () => window.removeEventListener('hypercanvas:externalFileChange', handler);
  }, [engine]);
}

export function useGitStatusListener(activeProjectPath: string | undefined) {
  useEffect(() => {
    if (!activeProjectPath) return;
    return useGitStore.getState().setupGitStatusListener();
  }, [activeProjectPath]);
}
