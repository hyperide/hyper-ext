/**
 * Network status indicator component.
 *
 * Three display variants:
 * - badge: Small "Offline" pill (for headers, next to titles)
 * - banner: Full-width warning with retry button
 * - inline: Small inline text (for inline error messages)
 */

import { IconWifiOff, IconRefresh } from '@tabler/icons-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

export interface NetworkStatusIndicatorProps {
  /** Display variant */
  variant: 'badge' | 'banner' | 'inline';
  /** Whether browser reports being offline (shows different message) */
  isOffline?: boolean;
  /** Optional retry callback */
  onRetry?: () => void;
  /** Additional className */
  className?: string;
}

/**
 * Displays network status with appropriate styling.
 *
 * @example
 * ```tsx
 * // In a page header
 * <div className="flex items-center gap-2">
 *   <h1>Projects</h1>
 *   {isNetworkError && <NetworkStatusIndicator variant="badge" isOffline={isOffline} />}
 * </div>
 *
 * // As a prominent warning
 * {isNetworkError && (
 *   <NetworkStatusIndicator variant="banner" isOffline={isOffline} onRetry={refetch} />
 * )}
 *
 * // Inline in error text
 * <NetworkStatusIndicator variant="inline" />
 * ```
 */
export function NetworkStatusIndicator({
  variant,
  isOffline = false,
  onRetry,
  className,
}: NetworkStatusIndicatorProps) {
  const message = isOffline ? 'Offline' : 'Connection error';
  const fullMessage = isOffline ? 'No internet connection' : 'Failed to connect to server';

  if (variant === 'badge') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
          'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
          className,
        )}
      >
        <IconWifiOff size={12} />
        {message}
      </span>
    );
  }

  if (variant === 'banner') {
    return (
      <div
        className={cn(
          'flex items-center justify-between gap-4 rounded-lg border p-4',
          'border-amber-200 bg-amber-50 text-amber-900',
          'dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200',
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <IconWifiOff size={20} className="shrink-0" />
          <div>
            <p className="font-medium">{fullMessage}</p>
            <p className="text-sm opacity-80">
              {isOffline ? 'Check your network settings' : 'Will retry automatically when connection is restored'}
            </p>
          </div>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
            <IconRefresh size={16} />
            Retry
          </Button>
        )}
      </div>
    );
  }

  // inline variant
  return (
    <span className={cn('inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400', className)}>
      <IconWifiOff size={14} />
      {message}
    </span>
  );
}
