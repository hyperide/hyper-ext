import { memo } from 'react';
import cn from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import {
  IconMessage,
  IconMessageReply,
  IconCheck,
  IconAt,
} from '@tabler/icons-react';
import type { Notification } from './useNotifications';

interface NotificationItemProps {
  notification: Notification;
  onClick?: () => void;
}

const typeIcons = {
  new_comment: IconMessage,
  comment_reply: IconMessageReply,
  comment_resolved: IconCheck,
  comment_mention: IconAt,
};

const typeColors = {
  new_comment: 'text-blue-500',
  comment_reply: 'text-green-500',
  comment_resolved: 'text-purple-500',
  comment_mention: 'text-orange-500',
};

export const NotificationItem = memo(function NotificationItem({
  notification,
  onClick,
}: NotificationItemProps) {
  const Icon = typeIcons[notification.type] || IconMessage;
  const iconColor = typeColors[notification.type] || 'text-muted-foreground';
  const isUnread = !notification.readAt;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full p-3 flex items-start gap-3 text-left transition-colors',
        'hover:bg-muted border-b border-border last:border-b-0',
        isUnread && 'bg-blue-50/50',
      )}
    >
      {/* Avatar or icon */}
      <div className="flex-shrink-0">
        {notification.actor?.avatarUrl ? (
          <img
            src={notification.actor.avatarUrl}
            alt={notification.actor.name || notification.actor.email}
            className="h-8 w-8 rounded-full"
          />
        ) : notification.actor ? (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {(notification.actor.name || notification.actor.email)
              .charAt(0)
              .toUpperCase()}
          </div>
        ) : (
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full bg-muted',
              iconColor,
            )}
          >
            <Icon className="w-4 h-4" stroke={1.5} />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm line-clamp-2',
              isUnread ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {notification.title}
          </p>
          {isUnread && (
            <span className="flex-shrink-0 w-2 h-2 mt-1.5 rounded-full bg-blue-500" />
          )}
        </div>

        {notification.body && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
            {notification.body}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1">
          {notification.project && (
            <span className="text-xs text-muted-foreground truncate max-w-[150px]">
              {notification.project.name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(notification.createdAt), {
              addSuffix: true,
            })}
          </span>
        </div>
      </div>
    </button>
  );
});
