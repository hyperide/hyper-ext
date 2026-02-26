import { IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react';
import cn from 'clsx';
import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatSession } from '../../../shared/ai-chat-display';

interface ChatHeaderProps {
  chats: ChatSession[];
  currentChatId: string | null;
  currentChatTitle: string | undefined;
  onSelectChat: (chatId: string) => void;
  onNewChat: () => void;
  onDeleteChat: (chatId: string) => void;
  isStreaming: boolean;
  /** Extra controls (dock/undock/close for SaaS) */
  extraControls?: ReactNode;
}

export function ChatHeader({
  chats,
  currentChatId,
  currentChatTitle,
  onSelectChat,
  onNewChat,
  onDeleteChat,
  isStreaming,
  extraControls,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-medium text-foreground hover:bg-accent rounded px-2 py-1 min-w-0 flex-1 text-left"
          >
            <span className="truncate">{currentChatTitle || 'No chat selected'}</span>
            <IconChevronDown size={12} className="shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 max-h-72 overflow-auto">
          {chats.map((chat) => (
            <DropdownMenuItem
              key={chat.id}
              className={cn('flex items-center justify-between gap-2', chat.id === currentChatId && 'bg-accent')}
              onSelect={() => {
                if (!isStreaming) onSelectChat(chat.id);
              }}
            >
              <span className="truncate text-xs">{chat.title}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-destructive p-0.5 rounded"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChat(chat.id);
                }}
              >
                <IconTrash size={12} />
              </button>
            </DropdownMenuItem>
          ))}
          {chats.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={onNewChat} disabled={isStreaming}>
            <IconPlus size={12} className="mr-1.5" />
            <span className="text-xs">New Chat</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {extraControls}
    </div>
  );
}
