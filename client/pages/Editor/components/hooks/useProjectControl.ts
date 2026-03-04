/**
 * Hook for project control operations (start/stop/restart)
 * Handles auto-start logic and project update handling
 */

import { useCallback, useEffect, useRef } from 'react';
import { loadPersistedState, resetStateForProject, savePersistedState } from '@/lib/storage';
import { useProjectActivationStore } from '@/stores/projectActivationStore';
import { authFetch } from '@/utils/authFetch';

export interface ProjectData {
  id: string;
  name: string;
  status: 'stopped' | 'building' | 'running' | 'error';
  path?: string;
  port?: number;
  framework?: string;
  devCommand?: string;
  userRole?: 'owner' | 'editor' | 'viewer';
}

interface UseProjectControlProps {
  activeProject: ProjectData | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setProjectRole: (role: 'owner' | 'editor' | 'viewer') => void;
}

interface UseProjectControlReturn {
  handleStartProject: () => Promise<void>;
  handleStopProject: () => Promise<void>;
  handleRestartProject: () => Promise<void>;
  handleProjectUpdate: (project: ProjectData) => Promise<void>;
  startAttemptedRef: React.MutableRefObject<boolean>;
  wasRunningRef: React.MutableRefObject<boolean>;
}

/**
 * Manages project control operations and auto-start logic
 */
export function useProjectControl({
  activeProject,
  setActiveProject,
  setIsStarting,
  setProjectRole,
}: UseProjectControlProps): UseProjectControlReturn {
  const startAttemptedRef = useRef(false);
  const wasRunningRef = useRef(false);
  const activatedProjectIdRef = useRef<string | null>(null);

  // Handle manual start
  const handleStartProject = useCallback(async () => {
    if (!activeProject) return;
    console.log('[useProjectControl] Manual start project:', activeProject.id);
    setIsStarting(true);
    try {
      await authFetch(`/api/docker/start/${activeProject.id}`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Failed to start project:', err);
      setIsStarting(false);
    }
  }, [activeProject, setIsStarting]);

  // Handle manual stop
  const handleStopProject = useCallback(async () => {
    if (!activeProject) return;
    console.log('[useProjectControl] Manual stop project:', activeProject.id);

    // Optimistically clear loading state so UI responds immediately
    setIsStarting(false);

    try {
      await authFetch(`/api/docker/stop/${activeProject.id}`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Failed to stop project:', err);
    }
  }, [activeProject, setIsStarting]);

  // Handle manual restart
  const handleRestartProject = useCallback(async () => {
    if (!activeProject) return;
    console.log('[useProjectControl] Manual restart project:', activeProject.id);

    // Keep loading state - we're restarting, not stopping
    setIsStarting(true);

    try {
      await authFetch(`/api/docker/restart/${activeProject.id}`, {
        method: 'POST',
      });
    } catch (err) {
      console.error('Failed to restart project:', err);
      setIsStarting(false);
    }
  }, [activeProject, setIsStarting]);

  // Handle project updates and auto-start logic
  const handleProjectUpdate = useCallback(
    async (project: ProjectData) => {
      console.log(
        '[useProjectControl] Project update:',
        project.name,
        'status:',
        project.status,
        'userRole:',
        project.userRole,
      );

      // Check if project changed - reset state if it did
      const persistedState = loadPersistedState();
      if (persistedState.projectId !== project.id) {
        console.log('[useProjectControl] Project changed, resetting state');
        resetStateForProject(project.id);
        startAttemptedRef.current = false; // Reset auto-start flag for new project
      } else {
        // Same project - save projectId to ensure it's persisted
        savePersistedState({ projectId: project.id });
      }

      setActiveProject(project);

      // Notify listeners only on initial activation or project change,
      // not on every status update (stopped → building → running)
      if (project.id !== activatedProjectIdRef.current) {
        activatedProjectIdRef.current = project.id;
        useProjectActivationStore.getState().setActivatedProject(project.id);
        window.dispatchEvent(new Event('project-activated'));
      }

      // Set user's role for this project (editor or viewer)
      if (project.userRole) {
        setProjectRole(project.userRole);
      }

      // Stop local loading state when Docker responds (building, running, or error)
      if (project.status === 'building' || project.status === 'running' || project.status === 'error') {
        setIsStarting(false);
      }

      // Auto-start if stopped (only once per project)
      if (project && project.status === 'stopped' && !startAttemptedRef.current) {
        console.log('[useProjectControl] Auto-starting project...');
        startAttemptedRef.current = true;
        setIsStarting(true);
        try {
          await authFetch(`/api/docker/start/${project.id}`, { method: 'POST' });
          // SSE will update the status automatically
        } catch (err) {
          console.error('Failed to auto-start project:', err);
          startAttemptedRef.current = false; // Allow retry on error
          setIsStarting(false);
        }
      }
    },
    [setActiveProject, setProjectRole, setIsStarting],
  );

  // Track if project was running to preserve iframe during SSE disconnect
  useEffect(() => {
    if (activeProject?.status === 'running') {
      wasRunningRef.current = true;
    }
    // Reset when project actually stops (not due to SSE disconnect)
    if (activeProject?.status === 'stopped' || activeProject?.status === 'error') {
      wasRunningRef.current = false;
    }
  }, [activeProject?.status]);

  return {
    handleStartProject,
    handleStopProject,
    handleRestartProject,
    handleProjectUpdate,
    startAttemptedRef,
    wasRunningRef,
  };
}
