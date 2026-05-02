import { TID } from '@shared/data-testid-map';
import { IconLoader2 } from '@tabler/icons-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { DisplayMessage, DisplayToolCall } from '../../../shared/ai-chat-display';
import { AuthErrorBanner } from './AuthErrorBanner';
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
  hasApiKey?: boolean | null;
  onConfigureProvider?: () => void;
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
  hasApiKey,
  onConfigureProvider,
}: ChatMessagesProps) {
  if (isLoadingMessages) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <IconLoader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <ScrollArea ref={scrollAreaRef} className="flex-1" onScrollCapture={onScroll} data-testid="ChatMessages">
      <div className="p-3 space-y-3">
        {messages.length === 0 && !isStreaming && !currentAssistantMessage && (
          <EmptyState hasApiKey={hasApiKey} onConfigureProvider={onConfigureProvider} />
        )}

        {messages.length > 0 && hasApiKey === false && (
          <AuthErrorBanner onConfigure={onConfigureProvider} />
        )}

        {messages.map((msg, index) => (
          <div key={msg.id} data-testid={TID.aiChat.message(index)}>
            {isAuthError(msg) ? (
              <AuthErrorBanner onConfigure={onConfigureProvider} />
            ) : (
              <MessageBubble message={msg} onViewToolResult={(name, content) => onViewToolResult(name, content)} />
            )}
          </div>
        ))}

        {(currentAssistantMessage || currentToolCalls.size > 0) && (
          <div data-testid={TID.aiChat.message(messages.length)}>
            <StreamingContent
              currentAssistantMessage={currentAssistantMessage}
              currentToolCalls={currentToolCalls}
              isStreaming={isStreaming}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/** Detect authentication/API key errors from error message content */
function isAuthError(msg: DisplayMessage): boolean {
  if (msg.role !== 'assistant') return false;
  const text = msg.content;
  if (!text.startsWith('Error: ')) return false;
  return (
    text.includes('API key not configured') ||
    text.includes('api key') ||
    text.includes('API error 401') ||
    text.includes('API error 403') ||
    text.includes('authentication_error') ||
    text.includes('invalid_api_key') ||
    text.includes('Unauthorized')
  );
}
