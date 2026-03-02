/**
 * Overlay shown when project is starting or building
 */

import type { ContainerPhase, ProjectStatus } from '@shared/types/statuses';
import { IconPlayerPlay, IconRefresh } from '@tabler/icons-react';
import { useCallback } from 'react';
import { Panel, Group as PanelGroup } from 'react-resizable-panels';
import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { Button } from '@/components/ui/button';
import { ResizeHandle } from '@/components/ui/resize-handle';
import { useDiagnosticSync } from '@/hooks/useDiagnosticSync';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';
import type { ProjectData } from './hooks/useProjectControl';

interface ProjectStartOverlayProps {
  project: ProjectData | null;
  isStarting: boolean;
  onRestart: () => void;
  onStart: () => void;
  pollStatus: {
    lastPoll: Date | null;
    lastResult: { running: boolean; status: ProjectStatus; phase?: ContainerPhase } | null;
    isPolling: boolean;
  };
}

export function ProjectStartOverlay({ project, isStarting, onRestart, onStart, pollStatus }: ProjectStartOverlayProps) {
  const openAIChat = useOpenAIChat();
  const { clear: persistedClear } = useDiagnosticSync({ projectId: project?.id, containerStatus: project?.status });

  const handleAutoFix = useCallback((prompt: string) => openAIChat({ prompt, forceNewChat: true }), [openAIChat]);

  // Show spinner with logs while starting/building
  if (isStarting || project?.status === 'building') {
    return (
      <PanelGroup orientation="vertical" id="startup-logs-panel" className="h-full">
        <Panel id="startup-spinner" defaultSize="75%" minSize="30%">
          <div className="h-full flex items-center justify-center">
            <div className="text-center space-y-4">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
              <p className="text-lg text-muted-foreground">Starting project "{project?.name || 'Project'}"...</p>
              <p className="text-sm text-muted-foreground">Waiting for dev server...</p>
              <Button variant="outline" size="sm" onClick={onRestart} className="mt-4">
                <IconRefresh className="w-4 h-4 mr-1" />
                Restart
              </Button>
            </div>
          </div>
        </Panel>

        <ResizeHandle />

        <Panel id="startup-logs" defaultSize="25%" minSize="10%" maxSize="70%">
          <div
            className="h-full"
            style={{
              borderTop: '1px solid var(--border)',
              paddingBottom: '80px',
            }}
          >
            <DiagnosticLogsViewer height="100%" onAutoFix={handleAutoFix} onClear={persistedClear} />
          </div>
        </Panel>
      </PanelGroup>
    );
  }

  // Show stopped state with start button
  return (
    <div data-uniq-id="3ae5d415-2b23-4611-aa49-49f9be686100" className="h-full flex items-center justify-center">
      <div data-uniq-id="90c45f36-57af-487f-9a9b-4708dd7a2bfb" className="text-center space-y-4">
        <p data-uniq-id="ad066f8c-0edc-46de-baf3-1ac5c9ef769f" className="text-lg text-muted-foreground">
          {project ? `Project "${project.name}" is stopped` : 'No active project'}
        </p>
        <p data-uniq-id="6d7e53bb-eaaa-425d-ba75-b2703160c34c" className="text-sm text-muted-foreground">
          {project ? 'Click Start to run the project' : 'Add a project in settings to get started'}
        </p>
        {project && pollStatus.lastPoll && (
          <div className="text-xs text-muted-foreground/70 mt-2 p-2 bg-muted/50 rounded">
            <div className="flex items-center gap-2 justify-center">
              {pollStatus.isPolling ? (
                <>
                  <span className="animate-spin h-3 w-3 border border-current border-t-transparent rounded-full" />
                  <span>Checking pod status...</span>
                </>
              ) : (
                <span>Last check: {pollStatus.lastPoll.toLocaleTimeString()}</span>
              )}
            </div>
            {pollStatus.lastResult && (
              <div className="mt-1">
                Pod: {pollStatus.lastResult.running ? 'running' : 'not running'} | Status:{' '}
                {pollStatus.lastResult.status}
                {pollStatus.lastResult.phase && ` | Phase: ${pollStatus.lastResult.phase}`}
              </div>
            )}
          </div>
        )}
        {project && (
          <Button
            data-uniq-id="57c057c7-47d8-4f00-b9db-33e240c42de8"
            variant="outline"
            size="sm"
            onClick={onStart}
            className="mt-4"
          >
            <IconPlayerPlay data-uniq-id="13c1c0a2-2911-4a85-bc75-63f6cbedfa68" className="w-4 h-4 mr-1" />
            Start
          </Button>
        )}
      </div>
    </div>
  );
}
