/**
 * @file Shown when framework needs router patching or is unsupported.
 * Merges SaaS PreviewSetupOverlay + extension UnsupportedProjectScreen.
 *
 * Accessed via: Preview panel — Priority 2 overlay.
 */

import type { CSSProperties } from 'react';
import { OverlayShell } from './OverlayShell';

type SupportLevel = 'supported' | 'planned' | 'not-planned';

interface PreviewSetupOverlayProps {
  status: 'needs-patch' | 'unsupported';
  frameworkSupport?: Array<{ name: string; level: SupportLevel }>;
  onDismiss?: () => void;
  onAutoFix?: (prompt: string) => void;
  onManualFix?: () => void;
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  maxWidth: 400,
  width: '90%',
  textAlign: 'center',
  padding: 24,
};

const warningStyle: CSSProperties = { fontSize: 40, lineHeight: 1 };
const headingStyle: CSSProperties = { margin: 0, fontSize: 16, fontWeight: 500 };
const descStyle: CSSProperties = { margin: 0, fontSize: 13, color: 'var(--overlay-muted)' };

const tableStyle: CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid var(--overlay-border)',
  overflow: 'hidden',
  fontSize: 13,
};

const tableHeaderStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  padding: '6px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--overlay-muted)',
  fontWeight: 500,
};

const tableRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  padding: '8px 12px',
  borderTop: '1px solid var(--overlay-border)',
  alignItems: 'center',
  gap: 16,
};

const btnRowStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  justifyContent: 'center',
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
  color: 'var(--overlay-fg)',
  border: '1px solid var(--overlay-border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};

const BADGE_COLORS: Record<SupportLevel, string> = {
  supported: 'var(--overlay-badge-supported)',
  planned: 'var(--overlay-badge-planned)',
  'not-planned': 'var(--overlay-muted)',
};

const BADGE_LABELS: Record<SupportLevel, string> = {
  supported: '✓ Supported',
  planned: '⏳ Planned',
  'not-planned': '✕ Not planned',
};

const FALLBACK_PROMPT = `HyperIDE needs a \`/test-preview\` route in my JSX router to render component previews.

**Task:** Add a route at \`/test-preview\` that renders \`<CanvasPreview />\` imported from \`./src/__canvas_preview__\`.

**Rules:**
- The route must be inside the existing \`<Routes>\` (or equivalent). Do not restructure the router.
- Import \`CanvasPreview\` only when it doesn't already exist.
- Tag the import with \`// @hyperide-managed\` so HyperIDE can track it.`;

export function PreviewSetupOverlay({
  status,
  frameworkSupport,
  onDismiss,
  onAutoFix,
  onManualFix,
}: PreviewSetupOverlayProps) {
  if (status === 'needs-patch') {
    return (
      <OverlayShell testId="preview-setup-overlay">
        <div style={cardStyle}>
          <div style={{ ...warningStyle, color: 'var(--overlay-warning)' }}>⚠</div>
          <h2 style={headingStyle}>Router setup required</h2>
          <p style={descStyle}>
            HyperIDE could not find a React Router configuration file. To enable component preview, a{' '}
            <code style={{ fontFamily: 'var(--overlay-font-mono)', fontSize: 12 }}>/test-preview</code> route must be
            added to your router.
          </p>
          <div style={btnRowStyle}>
            {onDismiss && (
              <button type="button" onClick={onDismiss} style={secondaryBtnStyle}>
                Dismiss
              </button>
            )}
            {onAutoFix && (
              <button type="button" onClick={() => onAutoFix(FALLBACK_PROMPT)} style={primaryBtnStyle}>
                Auto Fix
              </button>
            )}
            {onManualFix && (
              <button type="button" onClick={onManualFix} style={primaryBtnStyle}>
                Fix Setup
              </button>
            )}
          </div>
        </div>
      </OverlayShell>
    );
  }

  // unsupported
  return (
    <OverlayShell testId="preview-setup-overlay">
      <div style={{ ...cardStyle, overflowY: 'auto', maxHeight: '100%' }}>
        <div style={{ ...warningStyle, color: 'var(--overlay-destructive)' }}>⚠</div>
        <h2 style={headingStyle}>Framework not supported</h2>
        <p style={descStyle}>HyperIDE could not detect a supported framework in this project.</p>
        {frameworkSupport && frameworkSupport.length > 0 && (
          <div style={tableStyle}>
            <div style={tableHeaderStyle}>
              <span style={{ textAlign: 'left' }}>Framework</span>
              <span>Status</span>
            </div>
            {frameworkSupport.map(({ name, level }) => (
              <div key={name} style={tableRowStyle}>
                <span style={{ textAlign: 'left' }}>{name}</span>
                <span style={{ fontSize: 12, color: BADGE_COLORS[level] ?? 'var(--overlay-muted)' }}>
                  {BADGE_LABELS[level] ?? level}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={btnRowStyle}>
          {onDismiss && (
            <button type="button" onClick={onDismiss} style={secondaryBtnStyle}>
              Dismiss
            </button>
          )}
          {onManualFix && (
            <button type="button" onClick={onManualFix} style={primaryBtnStyle}>
              Fix Setup
            </button>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
