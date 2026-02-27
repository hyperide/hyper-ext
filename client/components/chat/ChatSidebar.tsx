import { IconPlus, IconTrash } from '@tabler/icons-react';
import cn from 'clsx';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { ChatSidebarRenderProps } from './SharedChatPanel';

export function ChatSidebar({
  chats,
  currentChatId,
  isLoadingChats,
  isStreaming,
  onSelectChat,
  onNewChat,
  onDeleteChat,
}: ChatSidebarRenderProps) {
  return (
    <TooltipProvider>
      <div className="w-48 shrink-0 border-r border-border flex flex-col">
        <div className="p-2 border-b border-border">
          <Button onClick={onNewChat} disabled={isStreaming} size="sm" variant="outline" className="w-full">
            <IconPlus className="w-4 h-4 mr-1" />
            New Chat
          </Button>
        </div>

        <ScrollArea className="flex-1">
          {isLoadingChats ? (
            <div className="p-4 text-center text-xs text-muted-foreground">Loading...</div>
          ) : chats.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">No chats yet</div>
          ) : (
            <div className="p-2 space-y-1">
              {chats.map((chat) => {
                const chatItem = (
                  <div key={chat.id} className="group relative">
                    <button
                      type="button"
                      className={cn(
                        'flex items-center p-2 pr-7 rounded cursor-pointer text-xs w-full text-left',
                        currentChatId === chat.id ? 'bg-accent' : 'hover:bg-muted',
                      )}
                      onClick={() => {
                        if (!isStreaming) onSelectChat(chat.id);
                      }}
                    >
                      <span className="truncate">{chat.title}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteChat(chat.id)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash className="w-3 h-3" />
                    </button>
                  </div>
                );

                return chat.title.length > 20 ? (
                  <Tooltip key={chat.id}>
                    <TooltipTrigger asChild>{chatItem}</TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="max-w-xs">{chat.title}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  chatItem
                );
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </TooltipProvider>
  );
}
