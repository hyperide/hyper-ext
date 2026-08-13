/**
 * @file Shown when the component file fails to parse.
 *
 * Accessed via: Preview panel — Priority 4 overlay.
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface ParseErrorOverlayProps {
  error: string;
  onRetry?: () => void;
  onAutoFix?: (prompt: string) => void;
}

const warningIconStyle: CSSProperties = {
  fontSize: 36,
  color: 'var(--overlay-destructive)',
  marginBottom: 16,
};

const titleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--overlay-destructive)',
  marginBottom: 8,
};

const errorStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--overlay-muted)',
  marginBottom: 16,
  wordBreak: 'break-word',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'center',
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

export function ParseErrorOverlay({ error, onRetry, onAutoFix }: ParseErrorOverlayProps) {
  const handleAutoFix = () => {
    onAutoFix?.(`Fix this parse error in my component:\n\n${error}`);
  };

  return (
    <OverlayShell testId="parse-error-overlay" role="alert" ariaLive="assertive">
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <div style={warningIconStyle}>⚠</div>
        <p style={titleStyle}>Failed to parse component</p>
        <p style={errorStyle}>{error}</p>
        <div style={buttonRowStyle}>
          {onRetry && (
            <button type="button" onClick={onRetry} style={secondaryBtnStyle}>
              Retry
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
