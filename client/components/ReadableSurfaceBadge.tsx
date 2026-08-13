/**
 * ReadableSurfaceBadge — surfaced when the readability aid flips the preview canvas surface
 * (HYP-1002). Makes the automatic flip visible ("Preview background adjusted for readability")
 * so a dark-for-one-component / light-for-the-next canvas never reads as "my code changed", and
 * doubles as the escape hatch + the debugging affordance when someone reports a false positive.
 */
import { IconX } from '@tabler/icons-react';

interface ReadableSurfaceBadgeProps {
  /** Minimum text contrast measured on the real surface, before the flip. */
  minContrast: number;
  onDismiss: () => void;
}

export function ReadableSurfaceBadge({ minContrast, onDismiss }: ReadableSurfaceBadgeProps) {
  return (
    <div
      className="absolute top-2 right-2 z-[950] flex items-center gap-2 rounded-md border border-border bg-background/90 px-2.5 py-1.5 text-xs text-foreground shadow-sm backdrop-blur pointer-events-auto"
      data-testid="readable-surface-badge"
      role="status"
    >
      <span>
        Preview background adjusted for readability
        <span className="ml-1 text-muted-foreground">(was {minContrast.toFixed(1)}:1)</span>
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss and keep the real background"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <IconX className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
