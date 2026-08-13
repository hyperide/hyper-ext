import { useEffect, useState } from 'react';
import { AIChat } from '../webview/AIChat';

/**
 * Standalone AI Chat webview app.
 * Listens for ai:openChat and ai:keyStatus messages from extension host.
 */
export function AIChatApp() {
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ai:openChat' && event.data.prompt) {
        setInitialPrompt(event.data.prompt);
      }
      if (event.data?.type === 'ai:keyStatus') {
        setHasApiKey(!!event.data.hasApiKey);
      }
    };
    window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AIChat initialPrompt={initialPrompt} onPromptConsumed={() => setInitialPrompt(null)} hasApiKey={hasApiKey} />
    </div>
  );
}
