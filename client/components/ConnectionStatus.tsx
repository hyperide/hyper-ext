import { IconCloudOff } from '@tabler/icons-react';
import cn from 'clsx';
import { useConnectionStore } from '@/stores/connectionStore';
import { Badge } from './ui/badge';

/** Unified connection status badge. Renders nothing when connected. */
export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  const retryNow = useConnectionStore((s) => s.retryNow);

  if (status === 'connected') return null;

  const labels: Record<string, string> = {
    offline: 'Offline',
    reconnecting: 'Reconnecting...',
    unavailable: 'Server Unavailable',
  };

  const pulse = status === 'offline' || status === 'reconnecting';

  return (
    <Badge variant="destructive" className={cn('flex items-center gap-1.5', pulse && 'animate-pulse')}>
      <IconCloudOff className="w-3.5 h-3.5" />
      <span>{labels[status]}</span>
      {status === 'unavailable' && (
        <button
          type="button"
          onClick={retryNow}
          className="ml-1 px-1.5 py-0.5 bg-white/15 hover:bg-white/25 rounded text-xs transition-colors"
        >
          Retry
        </button>
      )}
    </Badge>
  );
}
