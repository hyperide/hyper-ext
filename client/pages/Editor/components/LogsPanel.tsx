import type { RuntimeError } from '@shared/runtime-error';
import { memo, useCallback } from 'react';
import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface LogsPanelProps {
  projectId: string;
  runtimeError?: RuntimeError | null;
  height: number;
  onHeightChange: (height: number) => void;
  onDismiss?: () => void;
  onClear?: () => void;
}

export const LogsPanel = memo(function LogsPanel({
  projectId: _projectId,
  runtimeError: _runtimeError,
  height,
  onHeightChange,
  onDismiss,
  onClear,
}: LogsPanelProps) {
  const openAIChat = useOpenAIChat();

  const handleAutoFix = useCallback(
    (prompt: string) => {
      openAIChat({ prompt, forceNewChat: true });
    },
    [openAIChat],
  );

  return (
    <div
      data-testid="LogsPanel"
      data-logs-panel
      className="absolute bottom-20 left-0 right-0 bg-background border-t border-border shadow-lg z-50"
      style={{ height: `${height}px` }}
    >
      <DragResizeHandle
        orientation="horizontal"
        value={height}
        onChange={onHeightChange}
        minValue={100}
        maxValue={600}
        inverted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      />
      <DiagnosticLogsViewer height="100%" onAutoFix={handleAutoFix} onClear={onClear} onDismiss={onDismiss} />
    </div>
  );
});
