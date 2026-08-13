/**
 * ReadableSurfaceBadge — shown when the readability aid flips the preview canvas surface
 * (HYP-1002). Makes the automatic flip visible ("Preview background adjusted for readability") so
 * a dark-for-one / light-for-the-next canvas never reads as "my code changed", and gives the user
 * an escape hatch that pins the real background for this component. Styled with VS Code theme
 * variables so it looks native in any theme.
 */
import type { CSSProperties } from 'react';

const badgeStyle: CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 950,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--vscode-foreground)',
  background: 'var(--vscode-editorWidget-background, var(--vscode-dropdown-background))',
  border: '1px solid var(--vscode-widget-border, rgba(128, 128, 128, 0.2))',
  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
  pointerEvents: 'auto',
};

const dismissStyle: CSSProperties = {
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground)',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};

interface ReadableSurfaceBadgeProps {
  minContrast: number;
  onDismiss: () => void;
}

export function ReadableSurfaceBadge({ minContrast, onDismiss }: ReadableSurfaceBadgeProps) {
  return (
    <div style={badgeStyle} data-testid="readable-surface-badge" role="status">
      <span>
        Preview background adjusted for readability
        <span style={{ color: 'var(--vscode-descriptionForeground)', marginLeft: 4 }}>(was {minContrast.toFixed(1)}:1)</span>
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss and keep the real background" style={dismissStyle}>
        &times;
      </button>
    </div>
  );
}
