import type { RuntimeError } from '@shared/runtime-error';
import { memo, useCallback } from 'react';
import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { DragResizeHandle } from '@/components/ui/drag-resize-handle';
import { useDiagnosticSync } from '@/hooks/useDiagnosticSync';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface LogsPanelProps {
  projectId: string;
  containerStatus?: string;
  proxyError?: string | null;
  runtimeError?: RuntimeError | null;
  height: number;
  onHeightChange: (height: number) => void;
}

/**
 * Panel for displaying diagnostic logs with resize handle.
 * Shown when gateway/runtime error is detected.
 */
export const LogsPanel = memo(function LogsPanel({
  projectId,
  containerStatus,
  proxyError,
  runtimeError,
  height,
  onHeightChange,
}: LogsPanelProps) {
  const openAIChat = useOpenAIChat();

  // Connect data sources to diagnosticStore
  const { clear: persistedClear } = useDiagnosticSync({ projectId, containerStatus, runtimeError, proxyError });

  const handleAutoFix = useCallback(
    (prompt: string) => {
      openAIChat({ prompt, forceNewChat: true });
    },
    [openAIChat],
  );

  return (
    <div
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
      <DiagnosticLogsViewer height="100%" onAutoFix={handleAutoFix} onClear={persistedClear} collapsible />
    </div>
  );
});
