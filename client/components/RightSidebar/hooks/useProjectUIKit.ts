import type { ProjectStatus } from '@shared/types/statuses';
import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import type { UIKitType } from '../types';

interface ConfigError {
  error: string;
  projectId: string;
  projectName: string;
}

interface UseProjectUIKitReturn {
  projectUIKit: UIKitType;
  activeProjectId: string | null;
  activeProjectName: string | null;
  publicDirExists: boolean;
  configError: ConfigError | null;
}

export interface ActiveProjectParam {
  id: string;
  name: string;
  status: ProjectStatus;
  publicDir?: string;
}

export function useProjectUIKit(activeProject: ActiveProjectParam | null): UseProjectUIKitReturn {
  const [projectUIKit, setProjectUIKit] = useState<UIKitType>('none');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectName, setActiveProjectName] = useState<string | null>(null);
  const [publicDirExists, setPublicDirExists] = useState(false);
  const [configError, setConfigError] = useState<ConfigError | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: deps tracked via id+name+publicDir; bare `activeProject` would re-run on every parent re-render
  useEffect(() => {
    // Reset when project changes
    setConfigError(null);

    // Only null check - no status check!
    // Server will return error if project is not ready
    if (!activeProject) {
      setProjectUIKit('none');
      setActiveProjectId(null);
      setActiveProjectName(null);
      setPublicDirExists(false);
      return;
    }

    // Cancel any in-flight state writes when deps change or component unmounts —
    // otherwise a slow superseded request can overwrite the fresh result.
    let cancelled = false;

    const checkUIKit = async () => {
      try {
        // Use activeProject directly instead of fetching
        setActiveProjectId(activeProject.id);
        setActiveProjectName(activeProject.name || null);

        // Check if publicDir exists, if not try to detect it
        if (activeProject.publicDir) {
          setPublicDirExists(true);
        } else {
          // Try to detect public directory
          try {
            const detectResponse = await authFetch(`/api/projects/${activeProject.id}/detect-public-dir`, {
              method: 'POST',
            });
            if (cancelled) return;
            if (detectResponse.ok) {
              const detectResult = await detectResponse.json();
              if (cancelled) return;
              setPublicDirExists(!!detectResult.publicDir);
            }
          } catch (err) {
            if (cancelled) return;
            console.error('[useProjectUIKit] Failed to detect public dir:', err);
          }
        }

        // Check dependencies in batch
        const depsResponse = await authFetch(
          `/api/projects/${activeProject.id}/dependencies?names=tamagui,@tamagui/core,@tamagui/cli,tailwindcss`,
        );
        if (cancelled) return;
        if (!depsResponse.ok) {
          console.error('[useProjectUIKit] Failed to check dependencies');
          // Set error for CanvasEditor to show overlay
          try {
            const errorData = await depsResponse.json();
            if (cancelled) return;
            setConfigError({
              error: errorData.error || 'Failed to check dependencies',
              projectId: activeProject.id,
              projectName: activeProject.name,
            });
          } catch {
            if (cancelled) return;
            setConfigError({
              error: 'Failed to read package.json',
              projectId: activeProject.id,
              projectName: activeProject.name,
            });
          }
          return;
        }

        const deps = await depsResponse.json();
        if (cancelled) return;
        console.log('[useProjectUIKit] Dependencies:', deps);

        // Determine UI kit
        if (deps.tamagui || deps['@tamagui/core'] || deps['@tamagui/cli']) {
          setProjectUIKit('tamagui');
          console.log('[useProjectUIKit] Project uses Tamagui');
        } else if (deps.tailwindcss) {
          setProjectUIKit('tailwind');
          console.log('[useProjectUIKit] Project uses Tailwind CSS');
        } else {
          setProjectUIKit('none');
          console.log('[useProjectUIKit] Project has no UI kit');
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[useProjectUIKit] Error checking UI kit:', error);
      }
    };

    checkUIKit();

    return () => {
      cancelled = true;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps tracked via id+name+publicDir; bare `activeProject` would re-run on every parent re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject?.id, activeProject?.name, activeProject?.publicDir]);

  return { projectUIKit, activeProjectId, activeProjectName, publicDirExists, configError };
}
