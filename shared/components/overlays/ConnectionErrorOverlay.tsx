/**
 * @file Shown when the iframe fails to load or the dev server disconnects.
 *
 * Accessed via: Preview panel — highest-priority overlay (Priority 1).
 *   SaaS renders it message-only (auto-retry with retryCount); the VS Code
 *   extension passes `action` (Start Dev Server) for its disconnected state,
 *   where recovery is a manual user decision (HYP-647).
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface ConnectionErrorAction {
  label: string;
  onClick: () => void;
  /** data-testid for the action button */
  testId?: string;
}

interface ConnectionErrorOverlayProps {
  message: string;
  retryCount?: number;
  maxRetries?: number;
  /** Optional recovery action — rendered as a primary button below the hint */
  action?: ConnectionErrorAction;
  /** data-testid override for the root element */
  testId?: string;
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

const actionBtnStyle: CSSProperties = {
  marginTop: 16,
  padding: '8px 16px',
  background: 'var(--overlay-accent)',
  color: 'var(--overlay-accent-fg)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

export function ConnectionErrorOverlay({
  message,
  retryCount,
  maxRetries,
  action,
  testId = 'connection-error-overlay',
}: ConnectionErrorOverlayProps) {
  return (
    <OverlayShell testId={testId} role="alert" ariaLive="assertive">
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        <p style={errorTextStyle}>{message}</p>
        <p style={hintStyle}>Make sure the project is running and the component exists</p>
        {retryCount != null && retryCount > 0 && (
          <p style={retryStyle}>
            Connection attempts: {retryCount}
            {maxRetries != null ? `/${maxRetries}` : ''}
          </p>
        )}
        {action && (
          <button type="button" data-testid={action.testId} style={actionBtnStyle} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </OverlayShell>
  );
}
