/**
 * PreviewLoadTimeoutOverlay
 *
 * Rendered over the iframe by PreviewPanelApp when no `load` event arrived
 * within PREVIEW_LOAD_TIMEOUT_MS (10s). Surfaces a recovery UI:
 *   - Retry: cycle the iframe `key` so the element remounts and refetches
 *   - Open output panel: focus the dev-server VS Code output channel
 *
 * Lives in its own module — the test for it can import without dragging in
 * PreviewPanelApp's PlatformProvider / preview-bridge tree (which has its own
 * heavy global side effects in the test harness).
 */

import type React from 'react';
import { TID } from '../shared/data-testid-map';

interface Props {
  onRetry: () => void;
  onOpenOutput: () => void;
}

export function PreviewLoadTimeoutOverlay({ onRetry, onOpenOutput }: Props) {
  return (
    <div data-testid={TID.preview.loadingTimeout} style={backdropStyle}>
      <div style={cardStyle}>
        <div style={iconStyle}>⏱</div>
        <h2 style={headingStyle}>Component didn't load</h2>
        <p style={subtextStyle}>
          The preview iframe never reported a load event. The dev server may still be compiling, or it may have crashed
          — open the output panel for details.
        </p>
        <div style={buttonRowStyle}>
          <button type="button" data-testid={TID.preview.loadingTimeoutRetry} style={buttonStyle} onClick={onRetry}>
            Retry
          </button>
          <button
            type="button"
            data-testid={TID.preview.loadingTimeoutOpenOutput}
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

// Same z-band as the loading spinner — replaces it when the watchdog fires,
// stays below componentError (z=100) so a real render error still wins.
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
  color: 'var(--vscode-editorWarning-foreground, #e5a100)',
  lineHeight: 1,
};

const headingStyle: React.CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 16,
  fontWeight: 500,
};

const subtextStyle: React.CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: 13,
  opacity: 0.8,
  maxWidth: 420,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
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
