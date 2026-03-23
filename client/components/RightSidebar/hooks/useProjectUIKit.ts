import type { ProjectStatus } from '@shared/types/statuses';
import { useEffect, useState } from 'react';
import { authFetch } from '@/utils/authFetch';
import type { UIKitType } from '../types';

export interface ConfigError {
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
            if (detectResponse.ok) {
              const detectResult = await detectResponse.json();
              setPublicDirExists(!!detectResult.publicDir);
            }
          } catch (err) {
            console.error('[useProjectUIKit] Failed to detect public dir:', err);
          }
        }

        // Check dependencies in batch
        const depsResponse = await authFetch(
          `/api/projects/${activeProject.id}/dependencies?names=tamagui,@tamagui/core,@tamagui/cli,tailwindcss`,
        );
        if (!depsResponse.ok) {
          console.error('[useProjectUIKit] Failed to check dependencies');
          // Set error for CanvasEditor to show overlay
          try {
            const errorData = await depsResponse.json();
            setConfigError({
              error: errorData.error || 'Failed to check dependencies',
              projectId: activeProject.id,
              projectName: activeProject.name,
            });
          } catch {
            setConfigError({
              error: 'Failed to read package.json',
              projectId: activeProject.id,
              projectName: activeProject.name,
            });
          }
          return;
        }

        const deps = await depsResponse.json();
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
        console.error('[useProjectUIKit] Error checking UI kit:', error);
      }
    };

    checkUIKit();
  }, [activeProject?.id]);

  return { projectUIKit, activeProjectId, activeProjectName, publicDirExists, configError };
}
