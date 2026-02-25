import { useEffect, useState } from 'react';
import { DevServerLogsViewer } from './DevServerLogsViewer';
import { AIChat } from './AIChat';

/**
 * Main webview app — split between dev server logs and AI chat.
 * Rendered inside a VSCode webview panel.
 */
export function App() {
  const [autoFixPrompt, setAutoFixPrompt] = useState<string | null>(null);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for logs panel

  const handleAutoFix = (prompt: string) => {
    setAutoFixPrompt(prompt);
    // Give more space to AI chat when auto-fixing
    setSplitRatio(30);
  };

  // Listen for ai:openChat messages from extension host
  // (e.g. style sync error fallback from inspector panel)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ai:openChat' && event.data.prompt) {
        handleAutoFix(event.data.prompt);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Dev Server Logs */}
      <div
        className="flex-shrink-0 overflow-hidden border-b border-border"
        style={{ height: `${splitRatio}%` }}
      >
        <DevServerLogsViewer onAutoFix={handleAutoFix} />
      </div>

      {/* Resize handle */}
      <ResizeHandle onResize={setSplitRatio} />

      {/* AI Chat */}
      <div className="flex-1 overflow-hidden min-h-0">
        <AIChat
          initialPrompt={autoFixPrompt}
          onPromptConsumed={() => setAutoFixPrompt(null)}
        />
      </div>
    </div>
  );
}

/**
 * Draggable resize handle between logs and chat panels
 */
function ResizeHandle({ onResize }: { onResize: (ratio: number) => void }) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const containerHeight = document.body.clientHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const newRatio = ((startY + delta) / containerHeight) * 100;
      onResize(Math.max(15, Math.min(85, newRatio)));
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      className="h-1 flex-shrink-0 cursor-row-resize bg-border hover:bg-primary/20 transition-colors"
      onMouseDown={handleMouseDown}
    />
  );
}
