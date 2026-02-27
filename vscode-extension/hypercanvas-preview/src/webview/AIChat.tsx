/**
 * VS Code Extension AI Chat — thin wrapper around SharedChatPanel.
 *
 * Provides:
 * - VSCodeChatAdapter (postMessage to extension host)
 * - Inline ToolResultModal (no Dialog, no Monaco)
 */

import { useCallback, useMemo } from 'react';
import { SharedChatPanel } from '@/components/chat/SharedChatPanel';
import { createVSCodeChatAdapter } from '@/lib/platform/VSCodeChatAdapter';
import { vscode } from './vscodeApi';

interface AIChatProps {
  initialPrompt: string | null;
  onPromptConsumed: () => void;
  hasApiKey: boolean | null;
}

export function AIChat({ initialPrompt, onPromptConsumed, hasApiKey }: AIChatProps) {
  // vscode is a module-level singleton (acquireVsCodeApi()), not a reactive
  // dependency — intentionally omitted from deps. Project uses biome for
  // linting (not eslint), so eslint-disable comments are not applicable.
  const chatAdapter = useMemo(() => createVSCodeChatAdapter(vscode), []);

  const handleConfigureProvider = useCallback(() => {
    vscode.postMessage({ type: 'command:execute', command: 'hypercanvas.configureAIKey' });
  }, []);

  return (
    <SharedChatPanel
      chatAdapter={chatAdapter}
      initialPrompt={initialPrompt}
      onPromptSent={onPromptConsumed}
      hasApiKey={hasApiKey}
      onConfigureProvider={handleConfigureProvider}
    />
  );
}
