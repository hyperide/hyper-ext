/**
 * @file Shown when framework needs router patching or is unsupported.
 * Merges SaaS PreviewSetupOverlay + extension UnsupportedProjectScreen.
 *
 * Accessed via: Preview panel — Priority 2 overlay. The VS Code extension's
 *   UnsupportedFrameworkScreen is a thin wrapper over the `unsupported`
 *   variant (HYP-647): it passes a detection-specific `description` and the
 *   e2e-pinned root testId. Framework rows always carry
 *   `TID.preview.unsupportedFrameworkRow(name)` testids on both platforms.
 *
 * `FrameworkUnsupportedContent` (the icon + heading + compatibility table, no
 * OverlayShell/buttons) is exported separately so `SupportDimensionsTabs`
 * (VS Code preview panel) can embed the SAME markup for its 'framework'
 * dimension instead of a differently-shaped per-dimension evidence table
 * (HYP-913 — the tab surface must never look like a "new screen" for the
 * single most common unsupported case).
 */

import type { CSSProperties } from 'react';
import { TID } from '../../data-testid-map';
import { buildSupportedFrameworksLine, type SupportLevel } from '../../framework-support';
import { OverlayShell } from './OverlayShell';

/** Shared with `FrameworkUnsupportedContent`'s default description AND the Auto Fix prompt's
 * fallback context (HYP-917) — one string, so the two never drift apart. */
const DEFAULT_FRAMEWORK_DETECTION_MESSAGE = 'HyperIDE could not detect a supported framework in this project.';

interface PreviewSetupOverlayProps {
  status: 'needs-patch' | 'unsupported';
  frameworkSupport?: Array<{ name: string; level: SupportLevel }>;
  /** Overrides the default explanatory paragraph of the active variant */
  description?: string;
  /** data-testid override for the root element */
  testId?: string;
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

/**
 * Builds the Auto Fix prompt for the 'unsupported' framework screen (HYP-917). Unlike
 * FALLBACK_PROMPT this is a function, not a constant, because it must embed the
 * per-project `description` HyperIDE detected plus the list of currently-supported
 * frameworks, so the AI agent has the same context the user is looking at. Asks the agent
 * to find a real workaround (or confirm there isn't one) rather than guessing/faking support.
 */
export function buildUnsupportedFrameworkPrompt(
  description: string | undefined,
  frameworkSupport?: Array<{ name: string; level: SupportLevel }>,
): string {
  const detected = description ?? DEFAULT_FRAMEWORK_DETECTION_MESSAGE;
  const supportedLine = buildSupportedFrameworksLine(frameworkSupport);

  return `HyperIDE's component preview does not support this project's current framework/setup.

**Context:** ${detected}${supportedLine ? `\n${supportedLine}` : ''}

**Task:** Look for a real way to make this project previewable in HyperIDE — a config change, an adapter, or a supported framework already present alongside the unsupported one. If you find one, apply it and explain what changed.

**If there truly is no way** to make this project's current framework/setup previewable, say so clearly — do not guess or fake support.`;
}

export function PreviewSetupOverlay({
  status,
  frameworkSupport,
  description,
  testId = 'preview-setup-overlay',
  onDismiss,
  onAutoFix,
  onManualFix,
}: PreviewSetupOverlayProps) {
  if (status === 'needs-patch') {
    return (
      <OverlayShell testId={testId}>
        <div style={cardStyle}>
          <div style={{ ...warningStyle, color: 'var(--overlay-warning)' }}>⚠</div>
          <h2 style={headingStyle}>Router setup required</h2>
          {description ? (
            <p style={descStyle}>{description}</p>
          ) : (
            <p style={descStyle}>
              HyperIDE could not find a React Router configuration file. To enable component preview, a{' '}
              <code style={{ fontFamily: 'var(--overlay-font-mono)', fontSize: 12 }}>/test-preview</code> route must be
              added to your router.
            </p>
          )}
          <div style={btnRowStyle}>
            {onDismiss && (
              <button type="button" onClick={onDismiss} style={secondaryBtnStyle}>
                Dismiss
              </button>
            )}
            {onAutoFix && (
              <button
                type="button"
                data-testid={TID.preview.supportAutoFixButton}
                onClick={() => onAutoFix(FALLBACK_PROMPT)}
                style={primaryBtnStyle}
              >
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
    <OverlayShell testId={testId}>
      <div style={{ ...cardStyle, overflowY: 'auto', maxHeight: '100%' }}>
        <FrameworkUnsupportedContent description={description} frameworkSupport={frameworkSupport} />
        <div style={btnRowStyle}>
          {onDismiss && (
            <button type="button" onClick={onDismiss} style={secondaryBtnStyle}>
              Dismiss
            </button>
          )}
          {onAutoFix && (
            <button
              type="button"
              data-testid={TID.preview.supportAutoFixButton}
              onClick={() => onAutoFix(buildUnsupportedFrameworkPrompt(description, frameworkSupport))}
              style={primaryBtnStyle}
            >
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

/**
 * The "framework not supported" identity — warning icon, heading, description, and the
 * full cross-framework compatibility table (every entry in `frameworkSupport`, not just
 * the one detected in the current project). This is the exact pre-HYP-788 screen content;
 * kept as its own component (no OverlayShell, no buttons) so `SupportDimensionsTabs` can
 * embed it unchanged for the 'framework' dimension (HYP-913).
 */
export function FrameworkUnsupportedContent({
  description,
  frameworkSupport,
}: {
  description?: string;
  frameworkSupport?: Array<{ name: string; level: SupportLevel }>;
}) {
  return (
    <>
      <div style={{ ...warningStyle, color: 'var(--overlay-destructive)' }}>⚠</div>
      <h2 style={headingStyle}>Framework not supported</h2>
      <p style={descStyle}>{description ?? DEFAULT_FRAMEWORK_DETECTION_MESSAGE}</p>
      {frameworkSupport && frameworkSupport.length > 0 && (
        <div style={tableStyle}>
          <div style={tableHeaderStyle}>
            <span style={{ textAlign: 'left' }}>Framework</span>
            <span>Status</span>
          </div>
          {frameworkSupport.map(({ name, level }) => (
            <div key={name} data-testid={TID.preview.unsupportedFrameworkRow(name)} style={tableRowStyle}>
              <span style={{ textAlign: 'left' }}>{name}</span>
              <span style={{ fontSize: 12, color: BADGE_COLORS[level] ?? 'var(--overlay-muted)' }}>
                {BADGE_LABELS[level] ?? level}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
