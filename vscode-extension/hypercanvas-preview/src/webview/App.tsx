/**
 * Main webview app — diagnostic logs panel.
 *
 * Wraps with PlatformProvider to receive diagnostic:* messages
 * from the extension host (DiagnosticHub).
 */

import { DiagnosticLogsViewer } from '@/components/DiagnosticLogsViewer';
import { useDiagnosticSyncExt } from '@/hooks/useDiagnosticSyncExt';
import { PlatformProvider, usePlatformCanvas } from '@/lib/platform';

export function App() {
  return (
    <PlatformProvider>
      <LogsPanelContent />
    </PlatformProvider>
  );
}

function LogsPanelContent() {
  const canvas = usePlatformCanvas();
  useDiagnosticSyncExt();

  const handleAutoFix = (prompt: string) => {
    canvas.sendEvent({ type: 'ai:openChat', prompt });
  };

  const handleClear = () => {
    canvas.sendEvent({ type: 'diagnostic:clear' });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <DiagnosticLogsViewer height="100%" onAutoFix={handleAutoFix} onClear={handleClear} />
    </div>
  );
}
