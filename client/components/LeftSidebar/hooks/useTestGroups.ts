/**
 * Compat hook for loading test groups.
 * SaaS: authFetch('/api/component-tests').
 * VS Code: canvasRPC({ type: 'component:tests' }).
 */

import { useCallback, useEffect, useState } from 'react';
import { useCanvasEngineOptional } from '@/lib/canvas-engine';
import { usePlatformCanvas } from '@/lib/platform';
import { canvasRPC } from '@/lib/platform/PlatformContext';
import { authFetch } from '@/utils/authFetch';
import type { TestGroup } from '../../../../lib/component-scanner/types';

interface UseTestGroupsResult {
  testGroups: TestGroup[];
  isLoading: boolean;
  reload: () => void;
}

export function useTestGroups(componentPath: string | undefined, projectId: string | undefined): UseTestGroupsResult {
  const engine = useCanvasEngineOptional();
  const canvas = usePlatformCanvas();

  const [testGroups, setTestGroups] = useState<TestGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadTests = useCallback(async () => {
    if (!componentPath) {
      setTestGroups([]);
      return;
    }

    setIsLoading(true);
    try {
      if (engine) {
        // SaaS path
        const params = new URLSearchParams({ componentPath });
        if (projectId) {
          params.set('projectId', projectId);
        }
        const res = await authFetch(`/api/component-tests?${params.toString()}`);
        const data = await res.json();
        if (data.success && data.groups) {
          setTestGroups(data.groups);
        } else {
          setTestGroups([]);
        }
      } else {
        // VS Code path
        const result = await canvasRPC<TestGroup[]>(
          canvas,
          {
            type: 'component:tests',
            requestId: crypto.randomUUID(),
            componentPath,
          },
          'component:response',
        );
        if (result.success && result.data) {
          setTestGroups(result.data);
        } else {
          setTestGroups([]);
        }
      }
    } catch (error) {
      console.error('[Tests] Failed to load tests:', error);
      setTestGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [componentPath, projectId, engine, canvas]);

  useEffect(() => {
    loadTests();
  }, [loadTests]);

  return { testGroups, isLoading, reload: loadTests };
}
