/**
 * Compat hook for loading component groups.
 * SaaS: authFetch('/api/get-components') + window events.
 * VS Code: canvasRPC({ type: 'component:listGroups' }).
 */

import { useCallback, useEffect, useState } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import { canvasRPC } from '@/lib/platform/PlatformContext';
import { useProjectActivationStore } from '@/stores/projectActivationStore';
import { cancelComponentsFetch, fetchComponentsJSON } from '@/utils/fetchComponents';
import type { ComponentsData } from '../../../../lib/component-scanner/types';

type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

interface UseComponentsDataResult {
  data: ComponentsData;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setupReason: SetupReason | null;
  loadedOnce: boolean;
}

export function useComponentsData(): UseComponentsDataResult {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();
  const activatedProjectId = useProjectActivationStore((s) => s.activatedProjectId);

  const [data, setData] = useState<ComponentsData>({
    atomGroups: [],
    compositeGroups: [],
    pageGroups: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupReason, setSetupReason] = useState<SetupReason | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const loadComponents = useCallback(() => {
    setLoading(true);
    setError(null);
    setSetupReason(null);

    if (engine) {
      // SaaS path: shared deduplicating fetch (see fetchComponents.ts)
      cancelComponentsFetch();
      fetchComponentsJSON()
        .then((result) => {
          if (result.success) {
            setData({
              atomGroups: result.atomGroups || [],
              compositeGroups: result.compositeGroups || [],
              pageGroups: result.pageGroups || [],
            });
            setLoadedOnce(true);
          } else {
            console.warn('[useComponentsData] Server error:', result.error);
            // Don't set loadedOnce — allow retry on next event
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return;
          console.error('[useComponentsData] Failed to load components:', err);
          setError(String(err));
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // VS Code path: RPC
      canvasRPC<ComponentsData>(
        canvas,
        { type: 'component:listGroups', requestId: crypto.randomUUID() },
        'component:response',
      )
        .then((result) => {
          if (result.success && result.data) {
            setData(result.data);
            setLoadedOnce(true);
            const msg = result as { needsSetup?: boolean; setupReason?: SetupReason };
            if (msg.needsSetup) {
              setSetupReason(msg.setupReason ?? 'empty-scan');
            }
          } else {
            setError(result.error || 'Failed to load components');
          }
        })
        .catch((err) => {
          setError(String(err));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [engine, canvas]);

  useEffect(() => {
    // SaaS: skip fetch until project is activated on the server (avoids 404).
    // activatedProjectId is reactive — when the store updates (project-activated),
    // this effect re-runs and fetches.  Remount after activation: id is already
    // set → fetch runs immediately.  VS Code: engine is null → always fetch.
    if (engine && !activatedProjectId) return;

    loadComponents();

    if (!engine) return;

    // components_updated fires when component files change on disk
    const handleReload = () => loadComponents();
    window.addEventListener('components_updated', handleReload);

    return () => {
      window.removeEventListener('components_updated', handleReload);
      cancelComponentsFetch();
    };
  }, [loadComponents, engine, activatedProjectId]);

  return { data, loading, error, reload: loadComponents, setupReason, loadedOnce };
}
