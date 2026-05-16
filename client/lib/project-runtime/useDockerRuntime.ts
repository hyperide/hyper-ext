import { useEffect, useRef, useState } from 'react';
import { type ProjectData, useProjectControl } from '@/pages/Editor/components/hooks/useProjectControl';
import { useProjectSSE } from '@/pages/Editor/components/hooks/useProjectSSE';
import { INERT_POLL_STATUS, type PollStatus, type ProjectRuntime, type RuntimeStatus } from './types';

interface UseDockerRuntimeOptions {
  enabled: boolean;
  accessToken: string | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setProjectRole: (role: 'owner' | 'editor' | 'viewer') => void;
  reloadComposition?: () => Promise<void>;
}

const INERT: ProjectRuntime = {
  mode: 'docker',
  status: 'idle',
  hasBeenRunning: false,
  previewUrl: null,
  logs: [],
  error: null,
  pollStatus: INERT_POLL_STATUS,
  start: async () => {},
  stop: async () => {},
  restart: async () => {},
};

export function useDockerRuntime(project: ProjectData | null, opts: UseDockerRuntimeOptions): ProjectRuntime {
  const { enabled, accessToken, setActiveProject, setIsStarting, setProjectRole, reloadComposition } = opts;

  const hasBeenRunningRef = useRef(false);
  const [hasBeenRunning, setHasBeenRunning] = useState(false);

  const { handleStartProject, handleRestartProject, handleProjectUpdate } = useProjectControl({
    activeProject: enabled ? project : null,
    setActiveProject,
    setIsStarting,
    setProjectRole,
  });

  const { pollStatus } = useProjectSSE({
    accessToken: enabled ? accessToken : null,
    activeProject: enabled ? project : null,
    setActiveProject,
    handleProjectUpdate,
    reloadComposition,
  });

  useEffect(() => {
    if (!enabled) return;
    if (project?.status === 'running') {
      if (!hasBeenRunningRef.current) {
        hasBeenRunningRef.current = true;
        setHasBeenRunning(true);
      }
    } else if (project?.status === 'stopped' || project?.status === 'error') {
      if (hasBeenRunningRef.current) {
        hasBeenRunningRef.current = false;
        setHasBeenRunning(false);
      }
    }
  }, [enabled, project?.status]);

  if (!enabled) return INERT;

  const status: RuntimeStatus = (() => {
    switch (project?.status) {
      case 'running':
        return 'running';
      case 'building':
        return 'starting';
      case 'error':
        return 'error';
      default:
        return 'idle';
    }
  })();

  return {
    mode: 'docker',
    status,
    hasBeenRunning,
    previewUrl: null,
    logs: [],
    error: project?.status === 'error' ? 'Container error' : null,
    pollStatus: (pollStatus as PollStatus) ?? INERT_POLL_STATUS,
    start: handleStartProject,
    stop: async () => {},
    restart: handleRestartProject,
  };
}
