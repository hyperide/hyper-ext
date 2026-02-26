import { IconLoader2 } from '@tabler/icons-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DisplayMessage, DisplayToolCall } from '../../../shared/ai-chat-display';
import { EmptyState } from './EmptyState';
import { MessageBubble } from './MessageBubble';
import { StreamingContent } from './StreamingContent';

interface ChatMessagesProps {
  messages: DisplayMessage[];
  isStreaming: boolean;
  isLoadingMessages: boolean;
  currentAssistantMessage: string;
  currentToolCalls: Map<string, DisplayToolCall>;
  scrollAreaRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onViewToolResult: (toolName: string, content: string) => void;
}

export function ChatMessages({
  messages,
  isStreaming,
  isLoadingMessages,
  currentAssistantMessage,
  currentToolCalls,
  scrollAreaRef,
  onScroll,
  onViewToolResult,
}: ChatMessagesProps) {
  if (isLoadingMessages) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <IconLoader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1" onScrollCapture={onScroll}>
      <div className="p-3 space-y-3">
        {messages.length === 0 && !isStreaming && !currentAssistantMessage && <EmptyState />}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onViewToolResult={(name, content) => onViewToolResult(name, content)}
          />
        ))}

        <StreamingContent
          currentAssistantMessage={currentAssistantMessage}
          currentToolCalls={currentToolCalls}
          isStreaming={isStreaming}
        />
      </div>
    </ScrollArea>
  );
}
