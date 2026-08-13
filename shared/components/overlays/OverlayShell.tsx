/**
 * @file Generic full-area overlay container. All specific overlays compose this.
 *
 * Accessed via: Preview panel overlay layer (both SaaS and VS Code extension).
 * Assumptions:
 *   - Parent container has `position: relative` — the shell uses `position: absolute; inset: 0`.
 *   - z-index 10 sits above the canvas/iframe content (transformed container is zIndex 1)
 *     but BELOW the SaaS LogsPanel (z-50) and toolbar (z-1000) — error overlays must never
 *     hide the diagnostics panel the user needs to fix the error.
 *   - `--overlay-*` CSS custom properties are defined globally by each platform
 *     (see `client/global.css` and `vscode-extension/.../webview/styles.css`).
 * Architecture: see `.serena/memories/shared-overlay-components.md`.
 */

import type { CSSProperties, ReactNode } from 'react';

interface OverlayShellProps {
  children: ReactNode;
  /** 'backdrop' = semi-transparent dark bg, 'solid' = solid bg color */
  variant?: 'backdrop' | 'solid';
  /** data-testid for the root element */
  testId?: string;
  /** ARIA role — use 'alert' for error states */
  role?: string;
  /** ARIA live region — use 'polite' for status updates */
  ariaLive?: 'polite' | 'assertive' | 'off';
}

const baseStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--overlay-font)',
  color: 'var(--overlay-fg)',
  zIndex: 10,
};

const backdropBg: CSSProperties = {
  background: 'var(--overlay-backdrop)',
};

const solidBg: CSSProperties = {
  background: 'var(--overlay-bg)',
};

export function OverlayShell({ children, variant = 'solid', testId, role, ariaLive }: OverlayShellProps) {
  const style: CSSProperties = {
    ...baseStyle,
    ...(variant === 'backdrop' ? backdropBg : solidBg),
  };

  return (
    <div style={style} data-testid={testId} role={role} aria-live={ariaLive}>
      {children}
    </div>
  );
}
