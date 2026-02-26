/**
 * VS Code Extension AI Chat — thin wrapper around SharedChatPanel.
 *
 * Provides:
 * - VSCodeChatAdapter (postMessage to extension host)
 * - Inline ToolResultModal (no Dialog, no Monaco)
 */

import { useMemo } from 'react';
import { SharedChatPanel } from '@/components/chat/SharedChatPanel';
import { createVSCodeChatAdapter } from '@/lib/platform/VSCodeChatAdapter';
import { vscode } from './vscodeApi';

interface AIChatProps {
  initialPrompt: string | null;
  onPromptConsumed: () => void;
}

export function AIChat({ initialPrompt, onPromptConsumed }: AIChatProps) {
  const chatAdapter = useMemo(() => createVSCodeChatAdapter(vscode), []);

  return <SharedChatPanel chatAdapter={chatAdapter} initialPrompt={initialPrompt} onPromptSent={onPromptConsumed} />;
}
