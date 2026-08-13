import { IconCloudOff, IconServer } from '@tabler/icons-react';
import cn from 'clsx';
import { useConnectionStore } from '@/stores/connectionStore';
import { Badge } from './ui/badge';

/** Unified connection status badge. Renders nothing when fully connected in Docker mode. */
export function ConnectionStatus() {
  const status = useConnectionStore((s) => s.status);
  const retryNow = useConnectionStore((s) => s.retryNow);
  const nodepodRunning = useConnectionStore((s) => s.nodepodRunning);

  if (nodepodRunning) {
    return (
      <Badge
        data-testid="ConnectionStatus"
        variant="outline"
        className="flex items-center gap-1.5 border-green-500/60 text-green-700 bg-green-50 dark:border-green-400/40 dark:text-green-400 dark:bg-green-950/30"
      >
        <IconServer className="w-3.5 h-3.5" />
        <span>Virtual Server</span>
      </Badge>
    );
  }

  if (status === 'connected') return null;

  const labels: Record<string, string> = {
    offline: 'Offline',
    reconnecting: 'Reconnecting...',
    unavailable: 'Server Unavailable',
  };

  const pulse = status === 'offline' || status === 'reconnecting';

  return (
    <Badge
      data-testid="ConnectionStatus"
      variant="destructive"
      className={cn('flex items-center gap-1.5', pulse && 'animate-pulse')}
    >
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
