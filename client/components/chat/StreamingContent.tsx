import { IconLoader2 } from '@tabler/icons-react';
import ReactMarkdown from 'react-markdown';
import type { DisplayToolCall } from '../../../shared/ai-chat-display';
import { ToolCallCard } from './ToolCallCard';

interface StreamingContentProps {
  currentAssistantMessage: string;
  currentToolCalls: Map<string, DisplayToolCall>;
  isStreaming: boolean;
}

export function StreamingContent({ currentAssistantMessage, currentToolCalls, isStreaming }: StreamingContentProps) {
  if (!currentAssistantMessage && currentToolCalls.size === 0) return null;

  return (
    <div className="bg-muted/50 rounded-lg p-3 text-sm mr-8">
      {currentAssistantMessage && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{currentAssistantMessage}</ReactMarkdown>
        </div>
      )}
      {Array.from(currentToolCalls.values()).map((tc) => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
      {isStreaming && <span className="inline-block w-2 h-4 bg-foreground/50 animate-pulse ml-0.5" />}
    </div>
  );
}

export function StreamingIndicator({ isStreaming }: { isStreaming: boolean }) {
  if (!isStreaming) return null;

  return (
    <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
      <IconLoader2 size={12} className="animate-spin" />
      <span>AI is thinking...</span>
    </div>
  );
}
