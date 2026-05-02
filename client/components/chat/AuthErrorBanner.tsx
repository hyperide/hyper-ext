/**
 * AuthErrorBanner — shown instead of a regular error message when an API key
 * is missing or invalid. Friendly, not scary. Has a configure button.
 */

import { TID } from '@shared/data-testid-map';
import { IconKey } from '@tabler/icons-react';

interface AuthErrorBannerProps {
  onConfigure?: () => void;
}

export function AuthErrorBanner({ onConfigure }: AuthErrorBannerProps) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 mr-8">
      <div className="flex items-start gap-2.5">
        <IconKey className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" stroke={1.5} />
        <div className="flex-1 space-y-1.5">
          <p className="text-sm font-medium text-foreground">Configure your AI key to start chatting</p>
          <p className="text-xs text-muted-foreground">
            An API key is required to use the AI assistant. Set one up to get started.
          </p>
          {onConfigure && (
            <button
              type="button"
              data-testid={TID.aiChat.configureKeyButton}
              className="mt-1 rounded bg-primary text-primary-foreground px-3 py-1 text-xs font-medium hover:bg-primary/90 transition-colors"
              onClick={onConfigure}
            >
              Configure AI Provider
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
