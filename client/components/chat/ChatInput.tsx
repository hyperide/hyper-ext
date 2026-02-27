import { IconSend, IconSquare } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { QueuedMessage } from '../../../shared/ai-agent';
import type { PendingAskUser } from '../../hooks/chat/useChatStream';
import { AskUserPrompt } from './AskUserPrompt';
import { QueueIndicator } from './QueueIndicator';
import { StreamingIndicator } from './StreamingContent';

interface ChatInputProps {
  inputValue: string;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  pendingAskUser: PendingAskUser | null;
  onRespondToAskUser: (response: string) => void;
  messageQueue: QueuedMessage[];
  onCancelQueued: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}

export function ChatInput({
  inputValue,
  onInputChange,
  onKeyDown,
  onSend,
  onStop,
  isStreaming,
  pendingAskUser,
  onRespondToAskUser,
  messageQueue,
  onCancelQueued,
  placeholder,
  disabled,
}: ChatInputProps) {
  if (disabled) {
    return (
      <div className="p-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">Configure an API key to start chatting.</p>
      </div>
    );
  }

  return (
    <div className="p-3 border-t border-border">
      <QueueIndicator queue={messageQueue} onCancel={onCancelQueued} />

      {pendingAskUser && (
        <AskUserPrompt
          question={pendingAskUser.question}
          options={pendingAskUser.options}
          onSubmit={onRespondToAskUser}
        />
      )}

      <StreamingIndicator isStreaming={isStreaming && !pendingAskUser} />

      <div className="flex gap-2">
        <Textarea
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-h-[36px] text-xs resize-none"
          autoResize
          maxRows={5}
        />
        {isStreaming && !pendingAskUser ? (
          <Button variant="destructive" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={onStop}>
            <IconSquare size={14} />
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-9 w-9 p-0 shrink-0"
            onClick={() => {
              if (pendingAskUser && inputValue.trim()) {
                onRespondToAskUser(inputValue.trim());
                onInputChange('');
                return;
              }
              onSend();
            }}
            disabled={!inputValue.trim()}
          >
            <IconSend size={14} />
          </Button>
        )}
      </div>
    </div>
  );
}
