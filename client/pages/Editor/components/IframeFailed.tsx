import type { ProjectData } from '@/pages/Editor/components/hooks/useProjectControl';
import { authFetch } from '@/utils/authFetch';

type Props = {
  activeProject: ProjectData;
  setIsStarting: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveProject: React.Dispatch<React.SetStateAction<ProjectData | null>>;
  onOpenSettings: () => void;
  runtimeError?: string | null;
  onRetry?: () => void;
};

export function IframeFailed({
  activeProject,
  setIsStarting,
  setActiveProject,
  onOpenSettings,
  runtimeError,
  onRetry,
}: Props) {
  const isNodePod = activeProject.clientSideRuntime === true;

  const handleDockerRetry = async () => {
    setIsStarting(true);
    try {
      await authFetch(`/api/docker/start/${activeProject.id}`, { method: 'POST' });
      const res = await authFetch('/api/projects/active');
      if (res.ok) {
        const updated = await res.json();
        setActiveProject(updated);
      }
    } catch (err) {
      console.error('Failed to retry start:', err);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div data-testid="IframeFailed" className="flex flex-col items-center gap-4 max-w-md text-center">
      <p className="text-lg text-destructive">Failed to start project "{activeProject.name}"</p>
      {isNodePod ? (
        <p className="text-sm text-muted-foreground">{runtimeError ?? 'Browser runtime failed to start'}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Failed to start the container</p>
      )}
      <div className="flex gap-2 justify-center flex-wrap">
        {!isNodePod && (
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await authFetch(`/api/docker/logs/${activeProject.id}?lines=50`);
                const data = await res.json();
                alert(`Docker Logs:\n\n${data.logs}`);
              } catch (_err) {
                alert('Failed to fetch logs');
              }
            }}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded-md text-sm"
          >
            View Logs
          </button>
        )}
        <button
          type="button"
          onClick={isNodePod && onRetry ? onRetry : handleDockerRetry}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-sm"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-md text-sm"
        >
          Settings
        </button>
      </div>
    </div>
  );
}
