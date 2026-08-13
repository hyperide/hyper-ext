/**
 * @file Shown when the iframe fails to load or the dev server disconnects.
 *
 * Accessed via: Preview panel — highest-priority overlay (Priority 1).
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface ConnectionErrorOverlayProps {
  message: string;
  retryCount?: number;
  maxRetries?: number;
}

const errorTextStyle: CSSProperties = {
  color: 'var(--overlay-destructive)',
  marginBottom: 8,
  fontSize: 14,
};

const hintStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--overlay-muted)',
  marginBottom: 4,
};

const retryStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--overlay-muted)',
  marginTop: 8,
};

export function ConnectionErrorOverlay({ message, retryCount, maxRetries }: ConnectionErrorOverlayProps) {
  return (
    <OverlayShell testId="connection-error-overlay" role="alert" ariaLive="assertive">
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <p style={errorTextStyle}>{message}</p>
        <p style={hintStyle}>Make sure the project is running and the component exists</p>
        {retryCount != null && retryCount > 0 && (
          <p style={retryStyle}>
            Connection attempts: {retryCount}
            {maxRetries != null ? `/${maxRetries}` : ''}
          </p>
        )}
      </div>
    </OverlayShell>
  );
}
