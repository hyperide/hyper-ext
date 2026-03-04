import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { DisplayMessage } from '../../../shared/ai-chat-display';
import { ToolCallCard } from './ToolCallCard';

interface MessageBubbleProps {
  message: DisplayMessage;
  onViewToolResult?: (toolName: string, content: string) => void;
}

export function MessageBubble({ message, onViewToolResult }: MessageBubbleProps) {
  if (message.role === 'user') {
    return (
      <div className="bg-primary/10 rounded-lg p-3 ml-8">
        <div className="text-[10px] font-semibold text-muted-foreground mb-1">You</div>
        <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    );
  }

  return (
    <div className="bg-muted/50 rounded-lg p-3 mr-8">
      {message.content && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      )}

      {message.toolCalls?.map((tc) => (
        <ToolCallCard
          key={tc.id}
          toolCall={tc}
          onViewResult={
            tc.result?.output && onViewToolResult ? () => onViewToolResult(tc.name, tc.result?.output ?? '') : undefined
          }
        />
      ))}
    </div>
  );
}
