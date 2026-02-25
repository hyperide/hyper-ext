import { memo, useState, useCallback } from 'react';
import cn from 'clsx';
import { IconBell, IconCheck, IconInbox } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { NotificationItem } from './NotificationItem';
import type { Notification } from './useNotifications';

interface NotificationDropdownProps {
  notifications: Notification[];
  unreadCount: number;
  isLoading?: boolean;
  isConnected?: boolean;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onNotificationClick?: (notification: Notification) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

export const NotificationDropdown = memo(function NotificationDropdown({
  notifications,
  unreadCount,
  isLoading = false,
  isConnected = false,
  onMarkAsRead,
  onMarkAllAsRead,
  onNotificationClick,
  onLoadMore,
  hasMore = false,
}: NotificationDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filteredNotifications =
    filter === 'unread'
      ? notifications.filter((n) => !n.readAt)
      : notifications;

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.readAt) {
        onMarkAsRead(notification.id);
      }
      onNotificationClick?.(notification);
      setIsOpen(false);
    },
    [onMarkAsRead, onNotificationClick],
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative p-2 rounded-md hover:bg-muted transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          <IconBell className="w-5 h-5" stroke={1.5} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
          {!isConnected && (
            <span className="absolute bottom-1 right-1 w-2 h-2 bg-orange-400 rounded-full" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[380px] p-0"
        align="end"
        sideOffset={8}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">Notifications</h3>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onMarkAllAsRead}
                className="h-7 text-xs"
              >
                <IconCheck className="w-3 h-3 mr-1" stroke={2} />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex border-b border-border">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              filter === 'all'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('unread')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              filter === 'unread'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Unread
            {unreadCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded-full">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {/* Notification list */}
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading && notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading notifications...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <IconInbox className="w-10 h-10 text-muted-foreground/50 mb-2" stroke={1.5} />
              <p className="text-sm text-muted-foreground">
                {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
              </p>
            </div>
          ) : (
            <>
              {filteredNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onClick={() => handleNotificationClick(notification)}
                />
              ))}

              {hasMore && (
                <button
                  type="button"
                  onClick={onLoadMore}
                  className="w-full py-3 text-sm text-blue-600 hover:bg-muted transition-colors"
                >
                  Load more
                </button>
              )}
            </>
          )}
        </div>

        {/* Connection status */}
        {!isConnected && (
          <div className="px-4 py-2 bg-orange-50 border-t border-orange-200 text-xs text-orange-700">
            Connection lost. Reconnecting...
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
