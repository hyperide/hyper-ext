/**
 * Overlay shown when project configuration has an error
 */

import { useOpenAIChat } from '@/lib/platform/PlatformContext';

interface ConfigErrorOverlayProps {
  error: string;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

export function ConfigErrorOverlay({ error, onDismiss, onOpenSettings }: ConfigErrorOverlayProps) {
  const openAIChat = useOpenAIChat();

  const handleAutoFix = () => {
    const prompt = `Project configuration error:

\`\`\`json
${JSON.stringify({ error }, null, 2)}
\`\`\`

Please analyze and fix this error.`;
    openAIChat({ prompt, forceNewChat: true });
  };

  return (
    <div className="h-full flex items-center justify-center bg-slate-100 dark:bg-slate-900">
      <div className="flex flex-col items-center gap-4">
        <p className="text-lg text-destructive">Project configuration error</p>
        <p className="text-sm text-muted-foreground max-w-md text-center">{error}</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-md text-sm"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-md text-sm"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={handleAutoFix}
            className="px-4 py-2 bg-primary text-white hover:bg-primary/90 rounded-md text-sm"
          >
            Auto Fix
          </button>
        </div>
      </div>
    </div>
  );
}
