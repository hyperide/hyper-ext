/**
 * Framework-compatibility screen for the VS Code preview panel.
 *
 * Accessed via: PreviewPanelApp — rendered when the project has no supported
 * bundler/framework (projectError.type === 'framework'). Replaces the old
 * "unsupported project type" warning toast (HYP-442): the toast was redundant
 * with this authoritative compatibility table, which lists every framework and
 * its HyperIDE preview-support status. Mirrors the SaaS PreviewSetupOverlay's
 * unsupported state (client/pages/Editor/components/PreviewSetupOverlay.tsx),
 * reusing the same shared FRAMEWORK_SUPPORT source of truth.
 */

import { FRAMEWORK_SUPPORT, type SupportLevel } from '@shared/framework-support';
import { TID } from '@shared/data-testid-map';
import type { CSSProperties } from 'react';

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  overflow: 'auto',
  background: 'var(--vscode-editor-background)',
  color: 'var(--vscode-editor-foreground)',
  fontFamily: 'var(--vscode-font-family)',
  textAlign: 'center',
  padding: 20,
};

const headingStyle: CSSProperties = { margin: '0 0 10px 0', fontSize: 16, fontWeight: 500 };
const messageStyle: CSSProperties = { margin: '0 0 16px 0', fontSize: 13, opacity: 0.8, maxWidth: 420 };

const tableStyle: CSSProperties = {
  width: '100%',
  maxWidth: 420,
  border: '1px solid var(--vscode-panel-border, rgba(128,128,128,0.35))',
  borderRadius: 6,
  overflow: 'hidden',
  fontSize: 13,
};

const headerRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '6px 12px',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  opacity: 0.7,
  background: 'var(--vscode-editorWidget-background, rgba(128,128,128,0.08))',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 16,
  padding: '8px 12px',
  borderTop: '1px solid var(--vscode-panel-border, rgba(128,128,128,0.2))',
  textAlign: 'left',
};

const SUPPORT_LABEL: Record<SupportLevel, { text: string; color: string }> = {
  supported: { text: '✓ Supported', color: 'var(--vscode-testing-iconPassed, #4caf50)' },
  planned: { text: '◷ Planned', color: 'var(--vscode-charts-blue, #4a9eff)' },
  'not-planned': { text: '✕ Not planned', color: 'var(--vscode-descriptionForeground, #999)' },
};

export function UnsupportedFrameworkScreen({ message }: { message: string }) {
  return (
    <div data-testid={TID.preview.unsupportedFrameworkRoot} style={rootStyle}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>⚠</div>
      <h2 style={headingStyle}>Framework not supported</h2>
      <p style={messageStyle}>{message}</p>
      <div style={tableStyle}>
        <div style={headerRowStyle}>
          <span>Framework</span>
          <span>Status</span>
        </div>
        {FRAMEWORK_SUPPORT.map(({ name, level }) => {
          const label = SUPPORT_LABEL[level];
          return (
            <div key={name} data-testid={TID.preview.unsupportedFrameworkRow(name)} style={rowStyle}>
              <span>{name}</span>
              <span style={{ color: label.color, whiteSpace: 'nowrap' }}>{label.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
