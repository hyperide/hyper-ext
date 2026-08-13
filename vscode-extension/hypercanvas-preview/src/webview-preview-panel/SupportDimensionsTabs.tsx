/**
 * Support-dimension tabs for the VS Code preview panel (HYP-788).
 *
 * Accessed via: PreviewPanelApp — rendered when the currently-open repo (or the active
 * monorepo sub-repo) has one or more BLOCKING support dimensions (unsupported |
 * needs-setup). One tab per dimension; each tab is a TABLE of WHY (reason + evidence rows),
 * plus an optional Fix action for auto-fixable needs-setup dimensions (react-native-web).
 *
 * Scope: the active (sub-)repo ONLY — the canvas does NOT crawl the whole monorepo (that
 * traversal is a separate capture tool, explicitly NOT this feature). CSS-in-JS / inspect-only
 * style systems are NEVER passed here as a hard "unsupported" tab — they are inspect-only and
 * filtered out upstream (selectDimensionTabs).
 */

import { useState } from 'react';
import { TID } from '@shared/data-testid-map';
import type { SupportDimension, SupportStatus } from '../types';

const STATUS_LABEL: Record<SupportStatus, string> = {
  supported: 'Supported',
  'inspect-only': 'Inspect only',
  'needs-setup': 'Needs setup',
  unsupported: 'Not supported',
  unknown: 'Unknown',
};

const STATUS_COLOR: Record<SupportStatus, string> = {
  supported: '#3fb950',
  'inspect-only': '#d29922',
  'needs-setup': '#d29922',
  unsupported: '#f85149',
  unknown: '#8b949e',
};

export function SupportDimensionsTabs({
  dimensions,
  onFix,
}: {
  /** Already filtered to BLOCKING dimensions (selectDimensionTabs), worst-first. */
  dimensions: SupportDimension[];
  /** Invoked with the dimension id when its Fix action is clicked. */
  onFix?: (dimensionId: SupportDimension['id']) => void;
}) {
  const [activeId, setActiveId] = useState<SupportDimension['id'] | null>(dimensions[0]?.id ?? null);
  if (dimensions.length === 0) return null;

  const active = dimensions.find((d) => d.id === activeId) ?? dimensions[0];

  return (
    <div data-testid={TID.preview.supportTabsRoot} style={rootStyle}>
      <div style={headerStyle}>
        <h2 style={headingStyle}>This project needs attention</h2>
        <p style={subtextStyle}>
          HyperIDE checks each project across several dimensions. The tabs below show where the currently-open project
          is not yet fully supported, and why.
        </p>
      </div>

      <div role="tablist" style={tabBarStyle}>
        {dimensions.map((d) => (
          <DimensionTab key={d.id} dimension={d} active={d.id === active.id} onSelect={() => setActiveId(d.id)} />
        ))}
      </div>

      <DimensionPanel dimension={active} onFix={onFix} />
    </div>
  );
}

function DimensionTab({
  dimension,
  active,
  onSelect,
}: {
  dimension: SupportDimension;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={TID.preview.supportTab(dimension.id)}
      onClick={onSelect}
      style={{
        ...tabStyle,
        borderBottomColor: active ? STATUS_COLOR[dimension.status] : 'transparent',
        color: active ? 'var(--vscode-editor-foreground)' : 'var(--vscode-descriptionForeground, #999)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <span style={{ ...dotStyle, background: STATUS_COLOR[dimension.status] }} />
      {dimension.title}
    </button>
  );
}

function DimensionPanel({
  dimension,
  onFix,
}: {
  dimension: SupportDimension;
  onFix?: (dimensionId: SupportDimension['id']) => void;
}) {
  return (
    <div role="tabpanel" data-testid={TID.preview.supportTabPanel(dimension.id)} style={panelStyle}>
      <div style={statusRowStyle}>
        <span style={{ ...statusBadgeStyle, color: STATUS_COLOR[dimension.status] }}>
          {STATUS_LABEL[dimension.status]}
        </span>
        <span style={reasonStyle}>{dimension.reason}</span>
      </div>

      <table style={tableStyle}>
        <tbody>
          {dimension.evidence.map((row) => (
            <tr key={`${row.label}:${row.detail}`}>
              <td style={evidenceLabelCell}>{row.label}</td>
              <td style={evidenceDetailCell}>{row.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {dimension.fixLabel && onFix && (
        <button
          type="button"
          data-testid={TID.preview.supportFixButton}
          style={fixButtonStyle}
          onClick={() => onFix(dimension.id)}
        >
          {dimension.fixLabel}
        </button>
      )}
    </div>
  );
}

// ── styles (VS Code CSS variables — no Tailwind in this webview) ──────────────

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: 'var(--vscode-editor-background)',
  color: 'var(--vscode-editor-foreground)',
  fontFamily: 'var(--vscode-font-family)',
  padding: 20,
  boxSizing: 'border-box',
  overflow: 'auto',
};

const headerStyle: React.CSSProperties = { marginBottom: 12 };

const headingStyle: React.CSSProperties = { margin: '0 0 6px 0', fontSize: 16, fontWeight: 600 };

const subtextStyle: React.CSSProperties = { margin: 0, fontSize: 12, opacity: 0.75, maxWidth: 520 };

const tabBarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid var(--vscode-panel-border, #333)',
  marginBottom: 12,
  flexWrap: 'wrap',
};

const tabStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'none',
  border: 'none',
  borderBottom: '2px solid transparent',
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 13,
};

const dotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  display: 'inline-block',
};

const panelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };

const statusRowStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };

const statusBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const reasonStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500 };

const tableStyle: React.CSSProperties = {
  borderCollapse: 'collapse',
  fontSize: 12,
  width: '100%',
  maxWidth: 560,
};

const evidenceLabelCell: React.CSSProperties = {
  padding: '4px 12px 4px 0',
  verticalAlign: 'top',
  whiteSpace: 'nowrap',
  fontWeight: 600,
  color: 'var(--vscode-descriptionForeground, #aaa)',
  borderBottom: '1px solid var(--vscode-panel-border, #2a2a2a)',
};

const evidenceDetailCell: React.CSSProperties = {
  padding: '4px 0',
  verticalAlign: 'top',
  borderBottom: '1px solid var(--vscode-panel-border, #2a2a2a)',
};

const fixButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'var(--vscode-button-background)',
  color: 'var(--vscode-button-foreground)',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
  marginTop: 4,
};
