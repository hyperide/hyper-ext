import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useReconnectingEventSource, type SSEStatus } from '@/hooks/useReconnectingEventSource';
import { authFetch } from '@/utils/authFetch';

export interface NotificationActor {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface NotificationProject {
  id: string;
  name: string;
}

export interface NotificationComment {
  id: string;
  content: string;
  componentPath: string | null;
}

export interface Notification {
  id: string;
  type: 'new_comment' | 'comment_reply' | 'comment_resolved' | 'comment_mention';
  title: string;
  body: string | null;
  projectId: string | null;
  commentId: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
  actor: NotificationActor | null;
  project: NotificationProject | null;
  comment: NotificationComment | null;
}

interface UseNotificationsOptions {
  enabled?: boolean;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { enabled = true } = options;
  const { accessToken, refreshAuth } = useAuthStore();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if token refresh is in progress to avoid multiple parallel calls
  const refreshingRef = useRef(false);

  // SSE URL for notifications stream (auth via httpOnly cookie)
  const notificationsUrl = useMemo(() => {
    if (!enabled || !accessToken) return null;
    return '/api/notifications/stream';
  }, [enabled, accessToken]);

  // Connect to SSE stream with auto-reconnect
  useReconnectingEventSource({
    url: notificationsUrl,
    withCredentials: true,
    onMessage: useCallback((data: unknown) => {
      const event = data as { type?: string; unreadCount?: number; notification?: Notification };
      if (event.type === 'init') {
        setUnreadCount(event.unreadCount || 0);
      } else if (event.type === 'notification' && event.notification) {
        const notification = event.notification;
        setNotifications((prev) => [notification, ...prev]);
        setUnreadCount((prev) => prev + 1);
      }
    }, []),
    onError: useCallback(async () => {
      // Don't try to refresh if we're offline - network error, not auth error
      if (!navigator.onLine) {
        console.log('[Notifications] SSE error while offline, skipping refresh');
        return;
      }

      // SSE error might be 401 - try to refresh token once
      // EventSource API doesn't expose HTTP status, so we refresh on any error
      if (!refreshingRef.current) {
        refreshingRef.current = true;
        console.log('[Notifications] SSE error, attempting token refresh...');
        await refreshAuth();
        refreshingRef.current = false;
      }
    }, [refreshAuth]),
    onStatusChange: useCallback((status: SSEStatus) => {
      setIsConnected(status === 'connected');
      if (status === 'connected') {
        setError(null);
      } else if (status === 'disconnected') {
        setError('Connection lost. Reconnecting...');
      }
    }, []),
  });

  // Fetch notifications list
  const fetchNotifications = useCallback(
    async (params: { limit?: number; offset?: number; unreadOnly?: boolean } = {}) => {
      if (!accessToken) return [];

      setIsLoading(true);
      try {
        const searchParams = new URLSearchParams();
        if (params.limit) searchParams.set('limit', params.limit.toString());
        if (params.offset) searchParams.set('offset', params.offset.toString());
        if (params.unreadOnly) searchParams.set('unreadOnly', 'true');

        const response = await authFetch(`/api/notifications?${searchParams}`);
        if (!response.ok) {
          throw new Error('Failed to fetch notifications');
        }

        const data = await response.json();
        setNotifications(data.notifications);
        return data.notifications;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [accessToken],
  );

  // Mark single notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!accessToken) return;

      try {
        const response = await authFetch(`/api/notifications/${notificationId}/read`, {
          method: 'PATCH',
        });

        if (!response.ok) {
          throw new Error('Failed to mark notification as read');
        }

        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (err) {
        console.error('[Notifications] Failed to mark as read:', err);
      }
    },
    [accessToken],
  );

  // Mark all notifications as read
  const markAllAsRead = useCallback(async () => {
    if (!accessToken) return;

    try {
      const response = await authFetch('/api/notifications/read-all', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Failed to mark all notifications as read');
      }

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() })),
      );
      setUnreadCount(0);
    } catch (err) {
      console.error('[Notifications] Failed to mark all as read:', err);
    }
  }, [accessToken]);

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!accessToken) return 0;

    try {
      const response = await authFetch('/api/notifications/unread-count');
      if (!response.ok) {
        throw new Error('Failed to fetch unread count');
      }

      const data = await response.json();
      setUnreadCount(data.count);
      return data.count;
    } catch (err) {
      console.error('[Notifications] Failed to fetch unread count:', err);
      return 0;
    }
  }, [accessToken]);

  // Fetch initial notifications on mount (when token available)
  useEffect(() => {
    if (enabled && accessToken) {
      fetchNotifications({ limit: 20 });
    }
  }, [enabled, accessToken, fetchNotifications]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isConnected,
    error,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    fetchUnreadCount,
  };
}
