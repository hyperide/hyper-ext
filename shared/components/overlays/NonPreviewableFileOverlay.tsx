/**
 * @file Shown when the opened file cannot be previewed as a component — a ReactDOM
 *   entry/bootstrap (`main.tsx`) or any file with no renderable component export.
 *
 * Accessed via: Preview panel overlay layer in BOTH the SaaS editor and the VS Code
 *   extension webview (`webview-preview-panel/PreviewPanelApp.tsx`). Replaces the
 *   infinite "Generating sample…" spinner the iframe showed for such files: that state
 *   can never converge (there is no component to generate a sample for), so this
 *   surfaces a clear, terminal error and recommends the project's renderable files as
 *   clickable suggestions instead.
 * Assumptions:
 *   - Renders OVER the iframe (OverlayShell `solid`), hiding the dead spinner beneath.
 *   - `onSelect` is injected per platform (host opens + selects the file).
 *   - `--overlay-*` CSS custom properties are defined globally by each platform.
 */

import type { CSSProperties } from 'react';
import { TID } from '../../data-testid-map';
import { OverlayShell } from './OverlayShell';

export type NonPreviewableReason = 'entry-file' | 'no-renderable-export';

export interface NonPreviewableRecommendation {
  /** Path of a renderable component file, relative to the project root. */
  path: string;
  /** PascalCase component name shown on the button. */
  name: string;
}

interface NonPreviewableFileOverlayProps {
  /** Project-relative path of the opened, non-previewable file. */
  filePath: string;
  reason: NonPreviewableReason;
  recommendations: NonPreviewableRecommendation[];
  /** Open + select a recommended component (host-injected). */
  onSelect: (recommendation: NonPreviewableRecommendation) => void;
}

const cardStyle: CSSProperties = {
  maxWidth: 460,
  padding: 24,
  textAlign: 'center',
};

const headingStyle: CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 16,
  fontWeight: 600,
};

const messageStyle: CSSProperties = {
  margin: '0 0 4px 0',
  fontSize: 13,
  color: 'var(--overlay-muted)',
};

const pathStyle: CSSProperties = {
  margin: '0 0 20px 0',
  fontSize: 12,
  fontFamily: 'var(--overlay-font-mono)',
  color: 'var(--overlay-muted)',
  wordBreak: 'break-all',
};

const listLabelStyle: CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--overlay-fg)',
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  alignItems: 'stretch',
};

const recButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 12px',
  background: 'var(--overlay-input-bg)',
  color: 'var(--overlay-input-fg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'left',
};

const recNameStyle: CSSProperties = {
  fontWeight: 600,
};

const recPathStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--overlay-font-mono)',
  color: 'var(--overlay-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const REASON_MESSAGE: Record<NonPreviewableReason, string> = {
  'entry-file': 'This is your app’s entry file — it boots the app rather than exporting a component to preview.',
  'no-renderable-export': 'This file has no renderable React component to preview.',
};

function fileName(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? filePath;
}

export function NonPreviewableFileOverlay({
  filePath,
  reason,
  recommendations,
  onSelect,
}: NonPreviewableFileOverlayProps) {
  return (
    <OverlayShell testId={TID.preview.nonPreviewableRoot} role="alert" ariaLive="assertive" variant="solid">
      <div style={cardStyle}>
        <h2 style={headingStyle}>Can’t preview {fileName(filePath)}</h2>
        <p style={messageStyle}>{REASON_MESSAGE[reason]}</p>
        <p style={pathStyle}>{filePath}</p>

        {recommendations.length > 0 && (
          <>
            <p style={listLabelStyle}>Open a component to preview instead:</p>
            <div style={listStyle}>
              {recommendations.map((rec) => (
                <button
                  key={rec.path}
                  type="button"
                  data-testid={TID.preview.nonPreviewableRecommendation(rec.path)}
                  style={recButtonStyle}
                  onClick={() => onSelect(rec)}
                >
                  <span style={recNameStyle}>{rec.name}</span>
                  <span style={recPathStyle}>{rec.path}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </OverlayShell>
  );
}
