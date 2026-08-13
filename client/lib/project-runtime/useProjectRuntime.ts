import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import type { User } from '@/stores/authStore';
import { isViteProject } from './isViteProject';
import type { ProjectRuntime, RuntimeMode } from './types';
import { useDockerRuntime } from './useDockerRuntime';
import { useNodePodRuntime } from './useNodePodRuntime';

interface UseProjectRuntimeOptions {
  accessToken: string | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setProjectRole: (role: 'editor' | 'viewer') => void;
  reloadComposition?: () => Promise<void>;
}

export function useProjectRuntime(
  project: ProjectData | null,
  user: User | null,
  opts: UseProjectRuntimeOptions,
): ProjectRuntime {
  const isNodePodEligible = !!(user?.clientSideRuntime && project && isViteProject(project));
  const mode: RuntimeMode = isNodePodEligible ? 'nodepod' : 'docker';

  const docker = useDockerRuntime(project, {
    enabled: mode === 'docker',
    accessToken: opts.accessToken,
    setActiveProject: opts.setActiveProject,
    setIsStarting: opts.setIsStarting,
    setProjectRole: opts.setProjectRole,
    reloadComposition: opts.reloadComposition,
  });

  const nodepod = useNodePodRuntime(project, { enabled: mode === 'nodepod' });

  return mode === 'nodepod' ? nodepod : docker;
}
