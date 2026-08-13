/**
 * AI response feedback control (👍/👎) — extension-local, no analytics SDK.
 *
 * WHAT: a minimal, unobtrusive thumb strip shown under the AI chat once the most
 * recent assistant response finishes streaming. Clicking posts a
 * `telemetry:event` (`feedback.aiThumb`) to the extension host via the webview
 * vscode API; the host gates + forwards it to PostHog. Nothing is sent from the
 * webview directly.
 * HOW REACHED: rendered by `AIChatApp`. It listens on `window` for the host's
 * `ai:done` stream message to learn the latest response id (the request id). It
 * deliberately does NOT edit the shared `MessageBubble`/`SharedChatPanel`
 * (those live in the cross-product `client/` package); keeping the control here
 * confines the change to the extension.
 * INVARIANT: posts only `feedback.aiThumb` with `{ responseId, score, model? }`
 * — all scalars, no response text. One vote per response id; re-render-safe.
 * PII RULE: never include prompt/response text. responseId is an opaque request
 * id; model is a coarse identifier string.
 */

import { isTrustedMessageOrigin } from '@shared/utils/trusted-message-origin';
import { useEffect, useState } from 'react';
import { vscode } from '../webview/vscodeApi';

interface AiThumbStripProps {
  /** Coarse model identifier if known (optional). */
  model?: string;
}

export function AiThumbStrip({ model }: AiThumbStripProps) {
  const [responseId, setResponseId] = useState<string | null>(null);
  const [voted, setVoted] = useState<Record<string, 1 | 0>>({});

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isTrustedMessageOrigin(event)) return;
      const data = event.data as { type?: string; requestId?: string } | undefined;
      // A completed assistant response — surface the thumb for it.
      if (data?.type === 'ai:done' && typeof data.requestId === 'string') {
        setResponseId(data.requestId);
      }
      // A new request started — clear the previous thumb until it completes.
      if (data?.type === 'ai:delta' && typeof data.requestId === 'string' && data.requestId !== responseId) {
        // keep showing previous vote target until the new one finishes
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [responseId]);

  if (!responseId) return null;
  const currentVote = voted[responseId];

  const sendVote = (score: 1 | 0) => {
    if (currentVote !== undefined) return; // one vote per response
    setVoted((prev) => ({ ...prev, [responseId]: score }));
    const props: Record<string, string | number> = { responseId, score };
    if (model) props.model = model;
    vscode.postMessage({ type: 'telemetry:event', name: 'feedback.aiThumb', props });
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground border-t border-border/40">
      <span>Was this response helpful?</span>
      <button
        type="button"
        aria-label="Helpful"
        disabled={currentVote !== undefined}
        onClick={() => sendVote(1)}
        className={`px-1.5 rounded hover:bg-muted/60 ${currentVote === 1 ? 'opacity-100' : 'opacity-70'} disabled:cursor-default`}
      >
        {'\u{1F44D}'}
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        disabled={currentVote !== undefined}
        onClick={() => sendVote(0)}
        className={`px-1.5 rounded hover:bg-muted/60 ${currentVote === 0 ? 'opacity-100' : 'opacity-70'} disabled:cursor-default`}
      >
        {'\u{1F44E}'}
      </button>
      {currentVote !== undefined && <span className="ml-1">Thanks!</span>}
    </div>
  );
}
