/**
 * SaaS AI Agent Chat — thin wrapper around SharedChatPanel.
 *
 * Provides:
 * - BrowserChatAdapter (REST API + SSE streaming)
 * - Canvas event dispatching (composition changes, file undo/redo)
 * - Dock/undock/close controls
 * - Dialog+Monaco tool result renderer
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { IconArrowsMaximize, IconLayoutSidebarRight, IconTerminal2, IconX } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogHeader, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { createBrowserChatAdapter } from '@/lib/platform/BrowserChatAdapter';
import type { ChatStreamEvent } from '../../shared/ai-chat-display';
import { ChatSidebar } from './chat/ChatSidebar';
import { SharedChatPanel } from './chat/SharedChatPanel';
import { LazyEditor } from './LazyMonaco';

// Detect language from content for syntax highlighting
function detectLanguageFromContent(content: string): string {
  const trimmed = content.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* not JSON */
    }
  }
  if (
    /^(import|export|const|let|var|function|class|interface|type)\s/.test(trimmed) ||
    /=>\s*\{/.test(trimmed) ||
    /<[A-Z][a-zA-Z]*/.test(trimmed)
  ) {
    return 'typescript';
  }
  if (/^<(!DOCTYPE|html|head|body|div|span|p)\b/i.test(trimmed)) return 'html';
  if (/^[.#@]?[a-zA-Z-]+\s*\{/.test(trimmed) || /@media|@keyframes/.test(trimmed)) return 'css';
  if (/^(#!\/bin\/(ba)?sh|npm |yarn |bun |git |cd |ls |mkdir |rm )/.test(trimmed)) return 'shell';
  if (/^#+\s/.test(trimmed) || /^\*{1,2}[^*]+\*{1,2}/.test(trimmed)) return 'markdown';
  return 'plaintext';
}

interface AIAgentChatProps {
  projectPath: string;
  initialChatId?: string | null;
  showSidebar?: boolean;
  initialPrompt?: string;
  forceNewChat?: boolean;
  onPromptSent?: () => void;
  onChatTitleUpdate?: (chatId: string, newTitle: string) => void;
  onChatCreated?: (chatId: string) => void;
  projectId?: string;
  componentPath?: string | null;
  selectedElementIds?: string[];
  apiEndpoint?: string;
  extraParams?: Record<string, unknown>;
  isDocked?: boolean;
  onDock?: () => void;
  onUndock?: () => void;
  onClose?: () => void;
  isLogsPanelOpen?: boolean;
  onToggleLogs?: () => void;
}

const CANVAS_TOOLS = new Set([
  'canvas_create_instance',
  'canvas_update_instance',
  'canvas_delete_instance',
  'canvas_connect_instances',
  'canvas_add_annotation',
]);

export default function AIAgentChat({
  projectPath,
  initialChatId,
  initialPrompt,
  forceNewChat = false,
  onPromptSent,
  onChatTitleUpdate,
  onChatCreated,
  projectId,
  componentPath,
  selectedElementIds,
  apiEndpoint,
  extraParams,
  showSidebar,
  isDocked = false,
  onDock,
  onUndock,
  onClose,
  isLogsPanelOpen = false,
  onToggleLogs,
}: AIAgentChatProps) {
  const shouldShowSidebar = showSidebar ?? !isDocked;
  // Ref for mutable context that changes without re-creating the adapter
  const mutableContextRef = useRef({ componentPath, selectedElementIds, extraParams });
  mutableContextRef.current = { componentPath, selectedElementIds, extraParams };

  const chatAdapter = useMemo(() => {
    if (!projectId) return null;
    return createBrowserChatAdapter({
      projectId,
      projectPath,
      apiEndpoint,
      getMutableContext: () => mutableContextRef.current,
    });
  }, [projectId, projectPath, apiEndpoint]);

  // Handle canvas-specific stream events (composition changes, file undo/redo)
  const handleStreamEvent = useCallback((event: ChatStreamEvent) => {
    if (event.type === 'tool_result') {
      // Canvas tools — trigger UI refresh
      if (event.toolName && CANVAS_TOOLS.has(event.toolName)) {
        window.dispatchEvent(new CustomEvent('canvasCompositionChanged'));
      }

      // File changes — record for undo/redo
      if ((event.undoSnapshotId !== undefined || event.redoSnapshotId !== undefined) && event.filePath) {
        window.dispatchEvent(
          new CustomEvent('hypercanvas:externalFileChange', {
            detail: {
              filePath: event.filePath,
              undoSnapshotId: event.undoSnapshotId,
              redoSnapshotId: event.redoSnapshotId,
              source: 'ai-agent',
              description: `AI: file change ${event.filePath}`,
            },
          }),
        );
      }
    }
  }, []);

  const extraHeaderControls = useMemo(
    () => (
      <div className="flex items-center gap-1 flex-shrink-0">
        {onToggleLogs && (
          <>
            <button
              type="button"
              onClick={onToggleLogs}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors',
                isLogsPanelOpen
                  ? 'bg-accent text-foreground'
                  : 'hover:bg-muted text-muted-foreground hover:text-foreground',
              )}
              title={isLogsPanelOpen ? 'Hide logs' : 'Show logs'}
            >
              <IconTerminal2 className="w-4 h-4" stroke={1.5} />
              <span>Logs</span>
            </button>
            <div className="w-px h-4 bg-border" />
          </>
        )}
        {isDocked
          ? onUndock && (
              <button
                type="button"
                onClick={onUndock}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Undock to window"
              >
                <IconArrowsMaximize className="w-4 h-4" stroke={1.5} />
              </button>
            )
          : onDock && (
              <button
                type="button"
                onClick={onDock}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Dock to sidebar"
              >
                <IconLayoutSidebarRight className="w-4 h-4" stroke={1.5} />
              </button>
            )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Close"
          >
            <IconX className="w-4 h-4" stroke={1.5} />
          </button>
        )}
      </div>
    ),
    [isDocked, onDock, onUndock, onClose, isLogsPanelOpen, onToggleLogs],
  );

  if (!chatAdapter) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Project ID required for AI chat
      </div>
    );
  }

  return (
    <SharedChatPanel
      chatAdapter={chatAdapter}
      initialChatId={initialChatId}
      initialPrompt={initialPrompt}
      forceNewChat={forceNewChat}
      onPromptSent={onPromptSent}
      onChatCreated={onChatCreated}
      onChatTitleUpdate={onChatTitleUpdate}
      onStreamEvent={handleStreamEvent}
      extraHeaderControls={extraHeaderControls}
      renderSidebar={shouldShowSidebar ? (props) => <ChatSidebar {...props} /> : undefined}
      renderToolResult={({ isOpen, toolName, content, onClose: handleClose }) => (
        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) handleClose();
          }}
        >
          <DialogPortal>
            <DialogOverlay className="!z-[1100]" />
            <DialogPrimitive.Content className="fixed left-[50%] top-[50%] z-[1100] translate-x-[-50%] translate-y-[-50%] max-w-4xl w-[90vw] h-[80vh] flex flex-col gap-4 border bg-background p-6 shadow-lg rounded-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
              <DialogHeader>
                <DialogTitle>{toolName} - Output</DialogTitle>
              </DialogHeader>
              <div className="flex-1 min-h-0 border rounded overflow-hidden">
                <LazyEditor
                  value={content}
                  language={detectLanguageFromContent(content)}
                  theme="vs-light"
                  beforeMount={(monaco) => {
                    monaco.typescript?.typescriptDefaults.setDiagnosticsOptions({
                      noSemanticValidation: true,
                      noSyntaxValidation: true,
                    });
                    monaco.typescript?.javascriptDefaults.setDiagnosticsOptions({
                      noSemanticValidation: true,
                      noSyntaxValidation: true,
                    });
                    monaco.json?.jsonDefaults.setDiagnosticsOptions({ validate: false });
                  }}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    fontSize: 12,
                    folding: false,
                    renderLineHighlight: 'none',
                    selectionHighlight: false,
                    occurrencesHighlight: 'off',
                    renderValidationDecorations: 'off',
                  }}
                />
              </div>
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <IconX className="h-4 w-4" stroke={1.5} />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </DialogPrimitive.Content>
          </DialogPortal>
        </Dialog>
      )}
    />
  );
}
