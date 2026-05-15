/**
 * Shared loading spinner used across the SaaS app and the VS Code preview
 * webview. Extracts the canonical Tailwind pattern that was duplicated
 * inline across CanvasEditor, ProjectStartOverlay, ProjectSettings,
 * AuthCallback, Editor/Index, WorkspaceSettings, App, Projects, etc.
 *
 * Single source of truth for the spinner styling so the VS Code preview
 * shell and the SaaS preview render exactly the same loading UI.
 */

import cn from 'clsx';

export type LoadingSpinnerSize = 'sm' | 'md' | 'lg';

interface LoadingSpinnerProps {
  /** Text shown under the spinner (e.g. "Loading component..."). Omit for spinner only. */
  label?: string;
  /** Spinner size — `lg` (h-12) is the canonical full-screen variant. */
  size?: LoadingSpinnerSize;
  /** Extra classes for the outer container — useful to override the default fill. */
  className?: string;
  /** When true, fill the parent (h-full / w-full). Defaults to true. */
  fill?: boolean;
  /** Test id for E2E assertions. */
  'data-testid'?: string;
}

const SIZE_CLASS: Record<LoadingSpinnerSize, string> = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function LoadingSpinner({
  label,
  size = 'lg',
  className,
  fill = true,
  'data-testid': testId = 'loading-spinner',
}: LoadingSpinnerProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'flex items-center justify-center bg-slate-100 dark:bg-slate-900',
        fill && 'h-full w-full',
        className,
      )}
    >
      <div className="text-center">
        <div
          className={cn(
            'animate-spin rounded-full border-b-2 border-primary mx-auto',
            SIZE_CLASS[size],
            label && 'mb-4',
          )}
        />
        {label ? <p className="text-sm text-slate-400">{label}</p> : null}
      </div>
    </div>
  );
}
