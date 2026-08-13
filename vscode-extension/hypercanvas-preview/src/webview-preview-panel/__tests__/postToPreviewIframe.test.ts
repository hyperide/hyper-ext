/**
 * Unit tests for postToPreviewIframe — the single sanctioned bridge from the
 * VS Code webview to the preview iframe.
 *
 * The helper must target the iframe's real (derived) origin, never the '*'
 * wildcard, so that an unrelated cross-origin window can never receive these
 * messages. When the origin is not yet derivable (no src / about:blank), the
 * message is skipped — a wildcard post to an unloaded frame would have reached
 * nothing anyway, so skipping is behavior-preserving.
 */

import { describe, expect, it } from 'bun:test';
import { getPreviewIframeOrigin, postToPreviewIframe } from '../postToPreviewIframe';

type Sent = { message: unknown; targetOrigin: string };

function makeFrame(src: string | null): {
  frame: HTMLIFrameElement;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const contentWindow = {
    postMessage(message: unknown, targetOrigin: string) {
      sent.push({ message, targetOrigin });
    },
  };
  const frame = {
    src: src ?? '',
    getAttribute: () => src,
    contentWindow: src ? contentWindow : null,
    ownerDocument: { location: { href: 'https://vscode-webview.example/index.html' } },
  } as unknown as HTMLIFrameElement;
  return { frame, sent };
}

describe('getPreviewIframeOrigin', () => {
  it('derives origin from an absolute dev-server src', () => {
    const { frame } = makeFrame('http://localhost:3000/test-preview?component=Button.tsx');
    expect(getPreviewIframeOrigin(frame)).toBe('http://localhost:3000');
  });

  it('returns null for about:blank', () => {
    const { frame } = makeFrame('about:blank');
    expect(getPreviewIframeOrigin(frame)).toBeNull();
  });

  it('returns null for empty/unset src', () => {
    const { frame } = makeFrame(null);
    expect(getPreviewIframeOrigin(frame)).toBeNull();
  });

  it('returns null for a malformed src', () => {
    const { frame } = makeFrame(':::not a url:::');
    expect(getPreviewIframeOrigin(frame)).toBeNull();
  });
});

describe('postToPreviewIframe', () => {
  it('posts to the derived origin, not the wildcard', () => {
    const { frame, sent } = makeFrame('http://localhost:5173/test-preview?component=Card.tsx');
    const ok = postToPreviewIframe(frame, { type: 'hypercanvas:setComponent', component: 'Card.tsx' });
    expect(ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].targetOrigin).toBe('http://localhost:5173');
    expect(sent[0].targetOrigin).not.toBe('*');
    expect(sent[0].message).toEqual({ type: 'hypercanvas:setComponent', component: 'Card.tsx' });
  });

  it('does not post when frame is null', () => {
    expect(postToPreviewIframe(null, { type: 'x' })).toBe(false);
  });

  it('does not post when origin is not derivable (about:blank)', () => {
    const { frame, sent } = makeFrame('about:blank');
    expect(postToPreviewIframe(frame, { type: 'x' })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
