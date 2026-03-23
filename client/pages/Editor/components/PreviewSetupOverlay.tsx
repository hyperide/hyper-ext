/**
 * Overlay shown in the canvas area when the project's preview routing
 * cannot be set up automatically.
 *
 * Accessed via: CanvasEditor — replaces the iframe when previewSetup is
 *               'needs-patch' (no router file found) or 'unsupported'.
 */

import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconClock } from '@tabler/icons-react';
import type { PreviewSetupStatus } from '@/contexts/ComponentMetaContext';
import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface PreviewSetupOverlayProps {
  status: PreviewSetupStatus;
  /** AI prompt pre-built by the server with project file context. Falls back to generic prompt. */
  needsPatchPrompt?: string | null;
  onDismiss: () => void;
}

type SupportLevel = 'supported' | 'planned' | 'not-planned';

const FRAMEWORK_SUPPORT: { name: string; level: SupportLevel }[] = [
  { name: 'Next.js (App Router)', level: 'supported' },
  { name: 'Next.js (Pages Router)', level: 'supported' },
  { name: 'Remix', level: 'supported' },
  { name: 'Vite SPA (file-based routing)', level: 'supported' },
  { name: 'Vite SPA (JSX router)', level: 'supported' },
  { name: 'CRA / Webpack', level: 'supported' },
  { name: 'Parcel', level: 'supported' },
  { name: 'Vue', level: 'planned' },
  { name: 'Svelte / SvelteKit', level: 'planned' },
  { name: 'Solid.js', level: 'planned' },
  { name: 'HTML/CSS (no bundler)', level: 'planned' },
  { name: 'jQuery', level: 'not-planned' },
  { name: 'Vanilla JS', level: 'not-planned' },
  { name: 'Angular', level: 'not-planned' },
];

function SupportBadge({ level }: { level: SupportLevel }) {
  if (level === 'supported') {
    return (
      <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
        <IconCircleCheck className="w-4 h-4 shrink-0" stroke={2} />
        Supported
      </span>
    );
  }
  if (level === 'planned') {
    return (
      <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400 text-xs">
        <IconClock className="w-4 h-4 shrink-0" stroke={2} />
        Planned
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-muted-foreground text-xs">
      <IconCircleX className="w-4 h-4 shrink-0" stroke={2} />
      Not planned
    </span>
  );
}

// Fallback when server-side context collection failed or is unavailable.
const FALLBACK_NEEDS_PATCH_PROMPT = `HyperIDE needs a \`/test-preview\` route in my JSX router to render component previews.

**Task:** Add a route at \`/test-preview\` that renders \`<CanvasPreview />\` imported from \`./src/__canvas_preview__\`.

**Rules:**
- The route must be inside the existing \`<Routes>\` (or equivalent). Do not restructure the router.
- Import \`CanvasPreview\` only when it doesn't already exist.
- Tag the import with \`// @hyperide-managed\` so HyperIDE can track it.`;

export function PreviewSetupOverlay({ status, needsPatchPrompt, onDismiss }: PreviewSetupOverlayProps) {
  const openAIChat = useOpenAIChat();

  const handleAutoFix = () => {
    openAIChat({ prompt: needsPatchPrompt ?? FALLBACK_NEEDS_PATCH_PROMPT, forceNewChat: true });
  };

  if (status === 'needs-patch') {
    return (
      <div className="h-full flex items-center justify-center bg-muted">
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
          <IconAlertTriangle className="w-10 h-10 text-amber-500" stroke={1.5} /* status color — no semantic token */ />
          <p className="text-base font-medium text-foreground">Router setup required</p>
          <p className="text-sm text-muted-foreground">
            HyperIDE could not find a React Router configuration file. To enable component preview, a{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">/test-preview</code> route must be added to your
            router.
          </p>
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleAutoFix}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm"
            >
              Auto Fix
            </button>
          </div>
        </div>
      </div>
    );
  }

  // unsupported
  return (
    <div className="h-full flex items-center justify-center bg-muted overflow-auto">
      <div className="flex flex-col items-center gap-4 max-w-md w-full text-center p-6">
        <IconAlertTriangle className="w-10 h-10 text-destructive" stroke={1.5} />
        <p className="text-base font-medium text-foreground">Framework not supported</p>
        <p className="text-sm text-muted-foreground">
          HyperIDE could not detect a supported framework in this project.
        </p>
        <div className="w-full rounded-lg border border-border overflow-hidden text-sm">
          <div className="grid grid-cols-[1fr_auto] bg-muted px-3 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <span className="text-left">Framework</span>
            <span>Status</span>
          </div>
          {FRAMEWORK_SUPPORT.map(({ name, level }) => (
            <div key={name} className="grid grid-cols-[1fr_auto] px-3 py-2 border-t border-border items-center gap-4">
              <span className="text-foreground text-left">{name}</span>
              <SupportBadge level={level} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md text-sm"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
