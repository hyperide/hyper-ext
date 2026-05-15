/**
 * PreviewLoadErrorOverlay
 *
 * Rendered over the iframe by PreviewPanelApp when the iframe `error` event
 * fires (network failure, dev server crash mid-load, blocked subresource that
 * aborts the document). Surfaces the error message to the user instead of
 * letting `previewError` decay into a console.error nobody sees.
 *
 * Sibling of PreviewLoadTimeoutOverlay — same recovery actions (retry +
 * open output panel) but a distinct heading/icon and the actual error text,
 * so the user knows the difference between "still loading after 10s" and
 * "the iframe explicitly failed". Lives in its own module for the same
 * test-isolation reason (no PlatformProvider tree pulled in).
 */

import type React from 'react';
import { TID } from '../shared/data-testid-map';

interface Props {
  onRetry: () => void;
  onOpenOutput: () => void;
  /**
   * Message from the iframe `error` event. May be empty in rare browsers that
   * don't populate `ErrorEvent.message`; in that case the heading alone has to
   * carry the meaning, hence we render the line conditionally.
   */
  error?: string | null;
}

export function PreviewLoadErrorOverlay({ onRetry, onOpenOutput, error }: Props) {
  return (
    <div data-testid={TID.preview.loadingError} style={backdropStyle}>
      <div style={cardStyle}>
        <div style={iconStyle}>⚠</div>
        <h2 style={headingStyle}>Preview failed to load</h2>
        <p style={subtextStyle}>
          The preview iframe reported an error. The dev server may have crashed or returned an invalid response — open
          the output panel for details.
        </p>
        {error && (
          <p data-testid={TID.preview.loadingErrorMessage} style={errorMessageStyle}>
            {error}
          </p>
        )}
        <div style={buttonRowStyle}>
          <button type="button" data-testid={TID.preview.loadingErrorRetry} style={buttonStyle} onClick={onRetry}>
            Retry
          </button>
          <button
            type="button"
            data-testid={TID.preview.loadingErrorOpenOutput}
            style={linkButtonStyle}
            onClick={onOpenOutput}
          >
            Open output panel
          </button>
        </div>
      </div>
    </div>
  );
}

// Same z-band as the loading spinner / timeout overlay (z=15) — replaces them
// when an iframe error fires, stays below componentError (z=100) so a real
// React render error still wins. The render order in PreviewPanelApp also
// guarantees only one of {spinner, timeout, error} is in the tree at a time.
const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 15,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--vscode-editor-background, #1e1e1e)',
  fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  textAlign: 'center',
  padding: 32,
  maxWidth: 480,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
};

const iconStyle: React.CSSProperties = {
  fontSize: 36,
  marginBottom: 12,
  color: 'var(--vscode-editorError-foreground, #f48771)',
  lineHeight: 1,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 16,
  fontWeight: 500,
};

const subtextStyle: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: 13,
  opacity: 0.8,
  maxWidth: 420,
};

const errorMessageStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  padding: '8px 12px',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: 12,
  color: 'var(--vscode-editorError-foreground, #f48771)',
  background: 'var(--vscode-textCodeBlock-background, rgba(255, 255, 255, 0.04))',
  border: '1px solid var(--vscode-widget-border, #333)',
  borderRadius: 4,
  maxWidth: 420,
  // Wrap long error strings — onError messages from CSP / mixed-content failures
  // can be paragraph-length, and a single-line clip is worse than a tall card.
  wordBreak: 'break-word',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  marginTop: 8,
};

const buttonStyle: React.CSSProperties = {
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  textDecoration: 'underline',
};
