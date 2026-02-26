import { useEffect, useState } from 'react';
import { AIChat } from '../webview/AIChat';

/**
 * Standalone AI Chat webview app.
 * Listens for ai:openChat messages from extension host
 * and forwards the prompt to the AIChat component.
 */
export function AIChatApp() {
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'ai:openChat' && event.data.prompt) {
        setInitialPrompt(event.data.prompt);
      }
    };
    window.addEventListener('message', handler); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, extension-controlled messages only
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AIChat initialPrompt={initialPrompt} onPromptConsumed={() => setInitialPrompt(null)} />
    </div>
  );
}
