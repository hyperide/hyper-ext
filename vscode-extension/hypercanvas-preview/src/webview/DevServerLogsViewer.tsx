import { IconAlertTriangle, IconTrash, IconWand } from '@tabler/icons-react';
import cn from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { vscode } from './vscodeApi';

interface LogEntry {
  line: string;
  timestamp: number;
  isError: boolean;
}

interface ProjectInfo {
  framework: string;
  path: string;
}

interface RuntimeError {
  framework: string;
  type: string;
  message: string;
  file?: string;
  line?: number;
  codeframe?: string;
  fullText: string;
}

export function DevServerLogsViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [hasErrors, setHasErrors] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [runtimeError, setRuntimeError] = useState<RuntimeError | null>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Request initial logs on mount
  useEffect(() => {
    vscode.postMessage({ type: 'devserver:requestLogs' });
  }, []);

  // Listen for log updates from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (!message || !message.type) return;

      if (message.type === 'devserver:logs') {
        setLogs(message.logs);
        setHasErrors(message.hasErrors);
        setIsConnected(true);
      }

      if (message.type === 'devserver:projectInfo') {
        setProjectInfo(message.projectInfo);
      }

      if (message.type === 'devserver:runtimeError') {
        setRuntimeError(message.error ?? null);
      }

      if (message.type === 'devserver:logAppend') {
        setLogs((prev) => {
          const updated = [...prev, ...message.entries];
          // Keep last 200 lines
          return updated.slice(-200);
        });
        if (message.hasErrors) {
          setHasErrors(true);
        }
      }
    };

    window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll to bottom when logs change
  // biome-ignore lint/correctness/useExhaustiveDependencies: logs is intentional trigger dependency
  useEffect(() => {
    if (!userScrolledRef.current && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [logs]);

  const handleScroll = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollContainer) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    userScrolledRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  const handleClear = () => {
    setLogs([]);
    setHasErrors(false);
    vscode.postMessage({ type: 'devserver:clearLogs' });
  };

  const showAutoFix = hasErrors || runtimeError !== null;

  const handleAutoFix = () => {
    const recentLogs = logs
      .slice(-50)
      .map((l) => l.line)
      .join('\n');

    const errorLines = logs
      .filter((l) => l.isError)
      .map((l) => l.line)
      .join('\n');

    const projectContext = projectInfo
      ? `**Framework:** ${projectInfo.framework}\n**Project path:** ${projectInfo.path}\n\n`
      : '';

    const runtimeErrorContext = runtimeError
      ? `**Runtime Error (${runtimeError.framework}):** ${runtimeError.type}\n${runtimeError.message}${
          runtimeError.file ? `\n**File:** ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}` : ''
        }${runtimeError.codeframe ? `\n\`\`\`\n${runtimeError.codeframe}\n\`\`\`` : ''}\n\n`
      : '';

    const prompt = `Fix the build issues in this project.

${projectContext}${runtimeErrorContext}**Dev Server Logs (last 50 lines):**
\`\`\`
${recentLogs}
\`\`\`

${errorLines ? `**Detected errors:**\n\`\`\`\n${errorLines}\n\`\`\`\n` : ''}
Analyze the errors and fix them. After fixing, use check_build_status to verify the fix worked.`;

    vscode.postMessage({ type: 'ai:openChat', prompt });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 text-xs font-medium">
          <span>Dev Server Logs</span>
          <span className={cn('w-2 h-2 rounded-full', isConnected ? 'bg-green-500' : 'bg-muted-foreground/30')} />
        </div>
        <div className="flex items-center gap-1">
          {showAutoFix && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700"
              onClick={handleAutoFix}
            >
              <IconWand size={14} className="mr-1" />
              Auto Fix
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleClear}>
            <IconTrash size={14} />
          </Button>
        </div>
      </div>

      {/* Runtime error banner */}
      {runtimeError && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-xs">
          <div className="flex items-center gap-1.5 text-red-500 font-medium mb-1">
            <IconAlertTriangle size={14} />
            <span>
              {runtimeError.type}
              {runtimeError.file ? ` in ${runtimeError.file}${runtimeError.line ? `:${runtimeError.line}` : ''}` : ''}
            </span>
          </div>
          <div className="text-red-400/80 line-clamp-3">{runtimeError.message}</div>
        </div>
      )}

      {/* Log content */}
      <ScrollArea ref={scrollAreaRef} className="flex-1" onScrollCapture={handleScroll}>
        <div className="p-2 font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              No logs yet. Start the dev server to see output.
            </div>
          ) : (
            logs.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className={cn('whitespace-pre-wrap break-all', entry.isError && 'text-red-500 font-medium')}
              >
                {entry.line}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
