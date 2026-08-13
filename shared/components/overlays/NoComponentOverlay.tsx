/**
 * @file Shown when no component is selected or no components exist.
 *
 * Accessed via: Preview panel — lowest-priority informational overlay.
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

interface NoComponentOverlayProps {
  variant: 'no-selection' | 'no-components';
}

const headingStyle: CSSProperties = {
  margin: '0 0 10px 0',
  fontSize: 16,
  fontWeight: 500,
};

const subtextStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: 'var(--overlay-muted)',
};

const CONTENT = {
  'no-selection': {
    heading: 'No component selected',
    subtext: 'Open a .tsx or .jsx file to preview it',
  },
  'no-components': {
    heading: 'No components found',
    subtext: 'Add .tsx components to your project',
  },
} as const;

export function NoComponentOverlay({ variant }: NoComponentOverlayProps) {
  const { heading, subtext } = CONTENT[variant];
  return (
    <OverlayShell testId="no-component-overlay" ariaLive="polite">
      <div style={{ textAlign: 'center', padding: 20 }}>
        <h2 style={headingStyle}>{heading}</h2>
        <p style={subtextStyle}>{subtext}</p>
      </div>
    </OverlayShell>
  );
}
