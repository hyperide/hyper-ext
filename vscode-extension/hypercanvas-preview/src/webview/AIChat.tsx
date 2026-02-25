import { useState, useRef, useEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  IconSend,
  IconLoader2,
  IconPlus,
  IconSquare,
  IconEye,
} from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import cn from 'clsx';
import { vscode } from './vscodeApi';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

interface AIChatProps {
  initialPrompt: string | null;
  onPromptConsumed: () => void;
}

let messageIdCounter = 0;
function generateMessageId() {
  return `msg-${Date.now()}-${++messageIdCounter}`;
}

export function AIChat({ initialPrompt, onPromptConsumed }: AIChatProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState('');
  const [currentToolCalls, setCurrentToolCalls] = useState<
    Map<string, ToolCall>
  >(new Map());
  const [toolResultModal, setToolResultModal] = useState<{
    isOpen: boolean;
    toolName: string;
    content: string;
  }>({ isOpen: false, toolName: '', content: '' });

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);

  // Handle initial prompt from auto-fix
  useEffect(() => {
    if (initialPrompt) {
      handleSendMessage(initialPrompt);
      onPromptConsumed();
    }
  }, [initialPrompt]);

  // Listen for AI stream events from extension
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (!message || !message.type) return;
      if (message.requestId !== requestIdRef.current) return;

      switch (message.type) {
        case 'ai:delta':
          flushSync(() => {
            setCurrentAssistantMessage((prev) => prev + message.text);
          });
          break;

        case 'ai:toolUse':
          // Save accumulated text as a message first
          setCurrentAssistantMessage((prev) => {
            if (prev.trim()) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: generateMessageId(),
                  role: 'assistant',
                  content: prev,
                },
              ]);
            }
            return '';
          });

          setCurrentToolCalls((prev) => {
            const updated = new Map(prev);
            updated.set(message.toolUseId, {
              id: message.toolUseId,
              name: message.toolName,
              input: message.input,
            });
            return updated;
          });
          break;

        case 'ai:toolResult':
          setCurrentToolCalls((prev) => {
            const updated = new Map(prev);
            const toolCall = updated.get(message.toolUseId);
            if (toolCall) {
              toolCall.result = message.result;
              setMessages((msgs) => [
                ...msgs,
                {
                  id: generateMessageId(),
                  role: 'assistant',
                  content: '',
                  toolCalls: [{ ...toolCall }],
                },
              ]);
              updated.delete(message.toolUseId);
            }
            return updated;
          });
          break;

        case 'ai:done':
          // Save any remaining text
          setCurrentAssistantMessage((prev) => {
            if (prev.trim()) {
              setMessages((msgs) => [
                ...msgs,
                {
                  id: generateMessageId(),
                  role: 'assistant',
                  content: prev,
                },
              ]);
            }
            return '';
          });
          setCurrentToolCalls(new Map());
          setIsStreaming(false);
          requestIdRef.current = null;
          break;

        case 'ai:error':
          setMessages((msgs) => [
            ...msgs,
            {
              id: generateMessageId(),
              role: 'assistant',
              content: `Error: ${message.error}`,
            },
          ]);
          setCurrentAssistantMessage('');
          setCurrentToolCalls(new Map());
          setIsStreaming(false);
          requestIdRef.current = null;
          break;
      }
    };

    window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    return () => window.removeEventListener('message', handler);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!isUserScrolledUpRef.current && scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]',
      );
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages, currentAssistantMessage, currentToolCalls]);

  const handleSendMessage = useCallback(
    (content?: string) => {
      const text = content || inputValue.trim();
      if (!text || isStreaming) return;

      const requestId = `req-${Date.now()}`;
      requestIdRef.current = requestId;

      // Add user message to display
      setMessages((prev) => [
        ...prev,
        {
          id: generateMessageId(),
          role: 'user',
          content: text,
        },
      ]);

      setInputValue('');
      setIsStreaming(true);
      setCurrentAssistantMessage('');
      setCurrentToolCalls(new Map());
      isUserScrolledUpRef.current = false;

      // Send to extension
      vscode.postMessage({
        type: 'ai:chat',
        requestId,
        messages: [{ role: 'user', content: text }],
      });
    },
    [inputValue, isStreaming],
  );

  const handleStopStreaming = () => {
    if (requestIdRef.current) {
      vscode.postMessage({
        type: 'ai:abort',
        requestId: requestIdRef.current,
      });
    }
    setIsStreaming(false);
    setCurrentAssistantMessage((prev) => {
      if (prev.trim()) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: generateMessageId(),
            role: 'assistant',
            content: prev + '\n\n*[Stopped]*',
          },
        ]);
      }
      return '';
    });
    setCurrentToolCalls(new Map());
    requestIdRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleScroll = useCallback(() => {
    if (!scrollAreaRef.current) return;
    const viewport = scrollAreaRef.current.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    isUserScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  const handleNewChat = () => {
    setMessages([]);
    setInputValue('');
    setIsStreaming(false);
    setCurrentAssistantMessage('');
    setCurrentToolCalls(new Map());
    requestIdRef.current = null;
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/30">
          <span className="text-xs font-medium">AI Chat</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleNewChat}
              >
                <IconPlus size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New Chat</TooltipContent>
          </Tooltip>
        </div>

        {/* Messages */}
        <ScrollArea
          ref={scrollAreaRef}
          className="flex-1"
          onScrollCapture={handleScroll}
        >
          <div className="p-3 space-y-3">
            {messages.length === 0 &&
              !isStreaming &&
              !currentAssistantMessage && (
                <div className="text-muted-foreground text-center py-8 text-xs">
                  Ask me anything about your code, or use Auto Fix from the logs
                  panel.
                </div>
              )}

            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onViewToolResult={(name, content) =>
                  setToolResultModal({ isOpen: true, toolName: name, content })
                }
              />
            ))}

            {/* Streaming content */}
            {(currentAssistantMessage || currentToolCalls.size > 0) && (
              <div className="bg-muted/50 rounded-lg p-3 text-sm">
                {currentAssistantMessage && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{currentAssistantMessage}</ReactMarkdown>
                  </div>
                )}
                {Array.from(currentToolCalls.values()).map((tc) => (
                  <ToolCallDisplay key={tc.id} toolCall={tc} />
                ))}
                <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <div className="p-3 border-t border-border">
          {isStreaming && (
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <IconLoader2 size={12} className="animate-spin" />
              <span>AI is thinking...</span>
            </div>
          )}

          <div className="flex gap-2">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your code..."
              className="min-h-[36px] text-xs resize-none"
              autoResize
              maxRows={5}
            />
            {isStreaming ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-9 w-9 p-0 shrink-0"
                onClick={handleStopStreaming}
              >
                <IconSquare size={14} />
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-9 w-9 p-0 shrink-0"
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim()}
              >
                <IconSend size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* Tool result modal */}
        {toolResultModal.isOpen && (
          <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={() =>
              setToolResultModal({
                isOpen: false,
                toolName: '',
                content: '',
              })
            }
          >
            <div
              className="bg-background border border-border rounded-lg w-[90%] max-h-[80%] overflow-auto p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-sm font-medium mb-2">
                {toolResultModal.toolName} — Output
              </div>
              <pre className="text-xs whitespace-pre-wrap font-mono bg-muted p-3 rounded">
                {toolResultModal.content}
              </pre>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

function MessageBubble({
  message,
  onViewToolResult,
}: {
  message: DisplayMessage;
  onViewToolResult: (name: string, content: string) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="bg-primary/10 rounded-lg p-3 ml-8">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">
          You
        </div>
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="bg-muted/50 rounded-lg p-3 mr-8">
      {message.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
      )}

      {message.toolCalls?.map((tc) => (
        <ToolCallDisplay
          key={tc.id}
          toolCall={tc}
          onViewResult={
            tc.result?.output
              ? () => onViewToolResult(tc.name, tc.result!.output!)
              : undefined
          }
        />
      ))}
    </div>
  );
}

function ToolCallDisplay({
  toolCall,
  onViewResult,
}: {
  toolCall: ToolCall;
  onViewResult?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="border border-amber-500/20 bg-amber-500/5 rounded p-2 my-1 text-xs">
      <div
        className="font-medium text-amber-700 dark:text-amber-400 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {toolCall.name}
        {toolCall.result && (
          <span
            className={cn(
              'ml-2',
              toolCall.result.success
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400',
            )}
          >
            {toolCall.result.success ? 'Done' : 'Failed'}
          </span>
        )}
        {!toolCall.result && (
          <IconLoader2
            size={12}
            className="inline-block ml-1 animate-spin text-amber-500"
          />
        )}
      </div>

      {isExpanded && (
        <div className="mt-1">
          <pre className="text-[10px] whitespace-pre-wrap font-mono bg-muted p-1.5 rounded overflow-auto max-h-32">
            {JSON.stringify(toolCall.input, null, 2)}
          </pre>
        </div>
      )}

      {toolCall.result?.output && onViewResult && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1"
          onClick={onViewResult}
        >
          <IconEye size={10} />
          View output
        </button>
      )}

      {toolCall.result?.error && (
        <div className="text-red-500 text-[10px] mt-1">
          {toolCall.result.error}
        </div>
      )}
    </div>
  );
}
