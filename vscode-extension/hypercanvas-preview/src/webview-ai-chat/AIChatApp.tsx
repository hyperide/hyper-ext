import { useEffect, useState } from 'react';
import { AIChat } from '../webview/AIChat';
import { vscode } from '../webview/vscodeApi';

/**
 * Standalone AI Chat webview app.
 * Listens for ai:openChat and ai:keyStatus messages from extension host.
 */
export function AIChatApp() {
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  // Default to false so the "Configure AI Provider" banner shows immediately
  // while we wait for the extension host to confirm key status.
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(false);

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

    // Request key status from extension host — resolves race condition where
    // the host sends ai:keyStatus before the webview JS is ready to listen.
    vscode.postMessage({ type: 'ai:checkKey' });

    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <AIChat initialPrompt={initialPrompt} onPromptConsumed={() => setInitialPrompt(null)} hasApiKey={hasApiKey} />
    </div>
  );
}
