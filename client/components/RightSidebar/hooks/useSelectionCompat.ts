import { useEffect, useState } from 'react';
import type { CanvasEngine } from '@/lib/canvas-engine';
import { createSharedDispatch, useSharedEditorState } from '@/lib/platform/shared-editor-state';

/**
 * Get selected IDs from engine (SaaS) or shared editor state (VS Code).
 * Both hooks always run — no conditional hook violation.
 */
export function useSelectionCompat(engine: CanvasEngine | null): string[] {
  const [engineIds, setEngineIds] = useState<string[]>([]);
  const sharedIds = useSharedEditorState((s) => s.selectedIds);

  useEffect(() => {
    if (!engine) return;
    setEngineIds(engine.getSelection().selectedIds);
    return engine.events.on('selection:change', (event) => {
      setEngineIds([...event.selectedIds]);
    });
  }, [engine]);

  return engine ? engineIds : sharedIds;
}

/** Get component file path from engine (SaaS) or shared editor state (VS Code). */
export function useComponentPathCompat(engine: CanvasEngine | null): string | null {
  const sharedComponent = useSharedEditorState((s) => s.currentComponent);

  if (engine) {
    return (engine.getRoot().metadata?.filePath as string) ?? null;
  }

  return sharedComponent?.path ?? null;
}
