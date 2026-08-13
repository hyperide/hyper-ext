/**
 * DevServerUnreachableOverlay
 *
 * Rendered over the iframe by PreviewPanelApp when the raw dev-server-unreachable
 * response page announces that `/test-preview` is a permanent dead end. The raw
 * iframe page only posts the condition; the trusted webview layer owns the buttons.
 */

import type React from 'react';
import { TID } from '../shared/data-testid-map';

interface Props {
  proxyPath: string;
  statusCode: number | null;
  targetPort: number;
  onAutoFix: (prompt: string) => void;
  onDismiss: () => void;
}

export function buildDevServerUnreachablePrompt(
  proxyPath: string,
  statusCode: number | null,
  targetPort: number,
): string {
  return `HyperIDE's preview dev server did not respond at localhost:${targetPort} for \`${proxyPath}\` (returned ${statusCode ?? 'no response'}).

**Reason:** The dev server likely has no fallback/catch-all route for this path, or isn't running/healthy.

**Task:** Find a real way to make the dev server serve this path — e.g. add a catch-all/SPA-fallback route, check the dev server config, or verify the dev server process is actually running. If you find the fix, apply it and explain what changed.

**If there truly is no way to fix this right now**, say so clearly — do not guess or fake success.`;
}

export function DevServerUnreachableOverlay({ proxyPath, statusCode, targetPort, onAutoFix, onDismiss }: Props) {
  const statusText = statusCode ?? 'no response';
  const prompt = buildDevServerUnreachablePrompt(proxyPath, statusCode, targetPort);

  return (
    <div data-testid={TID.preview.devServerUnreachable} style={backdropStyle}>
      <div style={cardStyle}>
        <div style={iconStyle}>⚠</div>
        <h2 style={headingStyle}>HyperCanvas can't reach this preview route</h2>
        <p style={subtextStyle}>
          The dev server on <code style={codeStyle}>localhost:{targetPort}</code> returned <b>{statusText}</b> for{' '}
          <code style={codeStyle}>{proxyPath}</code> and never started serving it.
        </p>
        <p style={mutedTextStyle}>
          This usually means the dev server has no fallback/catch-all route for this path and is not a temporary glitch,
          so retrying will not help.
        </p>
        <div style={buttonRowStyle}>
          <button
            type="button"
            data-testid={TID.preview.devServerUnreachableDismiss}
            style={linkButtonStyle}
            onClick={onDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            data-testid={TID.preview.devServerUnreachableAutoFix}
            style={buttonStyle}
            onClick={() => onAutoFix(prompt)}
          >
            Auto Fix
          </button>
        </div>
      </div>
    </div>
  );
}

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
  maxWidth: 520,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
};

const iconStyle: React.CSSProperties = {
  fontSize: 36,
  marginBottom: 12,
  color: '#d29922',
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
  opacity: 0.9,
  maxWidth: 460,
  lineHeight: 1.5,
};

const mutedTextStyle: React.CSSProperties = {
  ...subtextStyle,
  color: 'var(--vscode-descriptionForeground, #8b949e)',
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: 12,
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
