/**
 * @file Simple spinner + message overlay.
 *
 * Accessed via: Preview panel — while the iframe or component is loading.
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface LoadingOverlayProps {
  message?: string;
}

const spinnerStyle: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  border: '2px solid transparent',
  borderBottomColor: 'var(--overlay-accent)',
  animation: 'overlay-spin 1s linear infinite',
  margin: '0 auto 16px',
};

const messageStyle: CSSProperties = {
  fontSize: 14,
  color: 'var(--overlay-muted)',
};

/** Inline keyframes — injected once via <style> */
const SPINNER_KEYFRAMES = '@keyframes overlay-spin { to { transform: rotate(360deg); } }';

export function LoadingOverlay({ message = 'Loading component...' }: LoadingOverlayProps) {
  return (
    <OverlayShell testId="loading-overlay" ariaLive="polite">
      <style>{SPINNER_KEYFRAMES}</style>
      <div style={{ textAlign: 'center' }}>
        <div style={spinnerStyle} />
        <p style={messageStyle}>{message}</p>
      </div>
    </OverlayShell>
  );
}
