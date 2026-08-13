/**
 * @file Shown when Vite/Next.js/Bun build error detected in iframe.
 *
 * Accessed via: Preview panel — Priority 3 overlay.
 */

import type { RuntimeError } from '@shared/runtime-error';
import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface RuntimeErrorOverlayProps {
  error: RuntimeError;
  onDismiss?: () => void;
  onAutoFix?: (prompt: string) => void;
}

const cardStyle: CSSProperties = {
  padding: 24,
  maxWidth: 560,
  width: '90%',
  background: 'var(--overlay-bg)',
  borderRadius: 12,
  border: '1px solid var(--overlay-border)',
  maxHeight: '80vh',
  overflowY: 'auto',
};

const badgeStyle: CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  background: 'var(--overlay-border)',
  color: 'var(--overlay-fg)',
  marginBottom: 8,
};

const typeStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--overlay-destructive)',
  margin: '0 0 8px',
};

const messageStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--overlay-fg)',
  margin: '0 0 12px',
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

const fileStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--overlay-muted)',
  fontFamily: 'var(--overlay-font-mono)',
  margin: '0 0 12px',
};

const codeframeStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--overlay-font-mono)',
  background: 'var(--overlay-codeframe-bg)',
  padding: 12,
  borderRadius: 6,
  overflow: 'auto',
  maxHeight: 200,
  whiteSpace: 'pre-wrap',
  color: 'var(--overlay-fg)',
  margin: '0 0 12px',
};

const btnRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
};

const primaryBtnStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--overlay-accent)',
  color: 'var(--overlay-accent-fg)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

const secondaryBtnStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--overlay-link)',
  border: '1px solid var(--overlay-link)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

export function RuntimeErrorOverlay({ error, onDismiss, onAutoFix }: RuntimeErrorOverlayProps) {
  const handleAutoFix = () => {
    onAutoFix?.(`Fix this ${error.type} in my project:\n\n${error.fullText}`);
  };

  return (
    <OverlayShell variant="backdrop" testId="runtime-error-overlay" role="alert" ariaLive="assertive">
      <div style={cardStyle}>
        <div style={badgeStyle}>{error.framework}</div>
        <p style={typeStyle}>{error.type}</p>
        <p style={messageStyle}>{error.message}</p>
        {error.file && (
          <p style={fileStyle}>
            {error.file}
            {error.line != null ? `:${error.line}` : ''}
          </p>
        )}
        {error.codeframe && <pre style={codeframeStyle}>{error.codeframe}</pre>}
        <div style={btnRowStyle}>
          {onDismiss && (
            <button type="button" onClick={onDismiss} style={secondaryBtnStyle}>
              Dismiss
            </button>
          )}
          {onAutoFix && (
            <button type="button" onClick={handleAutoFix} style={primaryBtnStyle}>
              Auto Fix
            </button>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
