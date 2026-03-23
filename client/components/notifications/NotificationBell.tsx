import { memo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotificationDropdown } from './NotificationDropdown';
import { type Notification, useNotifications } from './useNotifications';

interface NotificationBellProps {
  onNavigateToComment?: (projectId: string, commentId: string) => void;
}

export const NotificationBell = memo(function NotificationBell({ onNavigateToComment }: NotificationBellProps) {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const { notifications, unreadCount, isLoading, isConnected, markAsRead, markAllAsRead, fetchNotifications } =
    useNotifications({ enabled: true });

  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      // Navigate based on notification type
      if (notification.projectId && notification.commentId) {
        if (onNavigateToComment) {
          onNavigateToComment(notification.projectId, notification.commentId);
        } else {
          // Default navigation to project editor
          navigate(`/projects/${notification.projectId}?comment=${notification.commentId}`);
        }
      } else if (notification.projectId) {
        navigate(`/projects/${notification.projectId}`);
      }
    },
    [navigate, onNavigateToComment],
  );

  const handleLoadMore = useCallback(async () => {
    const newOffset = offset + limit;
    await fetchNotifications({ limit, offset: newOffset });
    setOffset(newOffset);
  }, [offset, limit, fetchNotifications]);

  return (
    <NotificationDropdown
      notifications={notifications}
      unreadCount={unreadCount}
      isLoading={isLoading}
      isConnected={isConnected}
      onMarkAsRead={markAsRead}
      onMarkAllAsRead={markAllAsRead}
      onNotificationClick={handleNotificationClick}
      onLoadMore={handleLoadMore}
      hasMore={notifications.length >= offset + limit}
    />
  );
});
