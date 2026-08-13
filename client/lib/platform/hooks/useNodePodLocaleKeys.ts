/**
 * @file useNodePodLocaleKeys — the FULL locale dictionary keys for the browser i18n combobox in
 *   NodePod (serverless) mode (HYP-372 Phase 2 item 4 / HYP-746).
 *
 * Why: in browser mode the Phase-1 combobox candidate set was only the IN-FILE retargetable keys
 *   (useBrowserI18nText.retargetableKeys). That lets the user retarget onto a key already bound
 *   somewhere in the same file, but not onto an arbitrary existing dictionary key. This hook returns
 *   EVERY key in the active locale (via the shared listKeysForBinding over OPFS), so the combobox
 *   offers the whole set — and, with create, any new key the user types. NO-OPS (returns []) outside
 *   NodePod mode, so the Docker/VS-Code paths are untouched.
 */
import { useEffect, useState } from 'react';
import type { I18nLibrary } from '@shared/i18n-text/types';
import { listNodePodLocaleKeys } from '../nodepod/nodepodRetargetTransport';
import { getActiveRuntime, useNodePodRuntimeStore } from '../nodepod/nodepodRuntimeStore';

export interface UseNodePodLocaleKeysOptions {
  /** Whether the browser i18n path is active (engine present, not VS Code). */
  enabled: boolean;
  library: I18nLibrary | null;
  namespace?: string;
  activeLocale: string;
  /** Bump to re-read after a create (the dictionary gained a key). */
  refreshKey?: number;
}

export function useNodePodLocaleKeys(options: UseNodePodLocaleKeysOptions): string[] {
  const { enabled, library, namespace, activeLocale, refreshKey } = options;
  // Subscribe to runtime changes so a docker→nodepod switch re-runs the effect.
  const mode = useNodePodRuntimeStore((s) => s.mode);
  const projectId = useNodePodRuntimeStore((s) => s.projectId);
  const [keys, setKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled || mode !== 'nodepod') {
      setKeys([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const runtime = getActiveRuntime();
      const result = await listNodePodLocaleKeys(
        { library, namespace, activeLocale },
        { projectId: runtime.projectId ?? '' },
      );
      if (!cancelled) setKeys(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, mode, projectId, library, namespace, activeLocale, refreshKey]);

  return keys;
}
