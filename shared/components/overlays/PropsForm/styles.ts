/**
 * @file PropsForm inline styles. Uses `--overlay-*` CSS custom properties only
 *   (no Tailwind, no `--vscode-*`) so the form renders identically in the SaaS
 *   editor and the VS Code extension webview. Each platform maps the overlay
 *   tokens to its own palette — see `shared/components/overlays/theme.ts`.
 */

import type { CSSProperties } from 'react';

export const formContainerStyle: CSSProperties = {
  background: 'var(--overlay-input-bg)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  border: '1px solid var(--overlay-border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export const formLabelStyle: CSSProperties = {
  color: 'var(--overlay-fg)',
  fontSize: 12,
  fontWeight: 500,
};

export const generateAllButtonStyle: CSSProperties = {
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--overlay-link)',
  border: '1px solid var(--overlay-link)',
  borderRadius: 4,
  cursor: 'pointer',
};

export const generateAllButtonDisabledStyle: CSSProperties = {
  color: 'var(--overlay-disabled-fg)',
  borderColor: 'var(--overlay-border)',
  cursor: 'not-allowed',
  opacity: 0.75,
};

export const generateAllTooltipWrapperStyle: CSSProperties = {
  display: 'inline-flex',
};

export const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

export const fieldColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

export const fieldNameStyle: CSSProperties = {
  color: 'var(--overlay-fg)',
  fontSize: 12,
  minWidth: 100,
  fontFamily: 'var(--overlay-font-mono)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export const genButtonInlineStyle: CSSProperties = {
  position: 'absolute',
  right: 4,
  top: '50%',
  transform: 'translateY(-50%)',
  padding: '1px 6px',
  fontSize: 10,
  fontWeight: 500,
  background: 'var(--overlay-secondary-bg)',
  color: 'var(--overlay-secondary-fg)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  opacity: 0.7,
};

export const typeBadgeStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--overlay-muted)',
  background: 'var(--overlay-badge-bg)',
  padding: '1px 4px',
  borderRadius: 3,
  fontFamily: 'var(--overlay-font)',
  fontWeight: 400,
};

export const nonEditableStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--overlay-muted)',
  fontStyle: 'italic',
};

export const inputStyle: CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--overlay-input-bg)',
  color: 'var(--overlay-input-fg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--overlay-font-mono)',
};

export const selectStyle: CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--overlay-input-bg)',
  color: 'var(--overlay-input-fg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--overlay-font-mono)',
};

export const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

export const checkboxStyle: CSSProperties = {
  accentColor: 'var(--overlay-accent)',
  width: 14,
  height: 14,
  cursor: 'pointer',
};

export const checkboxTextStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--overlay-fg)',
  fontFamily: 'var(--overlay-font-mono)',
};

export const arrayContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingLeft: 12,
  borderLeft: '2px solid var(--overlay-border)',
};

export const arrayItemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export const arrayRemoveButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--overlay-destructive)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

export const arrayAddButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px dashed var(--overlay-border)',
  color: 'var(--overlay-link)',
  fontSize: 11,
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 4,
  textAlign: 'left' as const,
};

export const popoverTriggerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'var(--overlay-input-bg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 4,
  cursor: 'pointer',
  padding: '3px 8px',
  color: 'var(--overlay-fg)',
  fontSize: 12,
  fontFamily: 'var(--overlay-font-mono)',
  flex: 1,
};

export const popoverTriggerActiveStyle: CSSProperties = {
  borderColor: 'var(--overlay-accent)',
  background: 'var(--overlay-accent)',
};

export const popoverTriggerCountStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--overlay-muted)',
  flex: 1,
};

export const popoverTriggerArrowStyle: CSSProperties = {
  fontSize: 9,
  color: 'var(--overlay-muted)',
  userSelect: 'none',
};

export const popoverContainerStyle: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'var(--overlay-bg)',
  border: '1px solid var(--overlay-border)',
  borderRadius: 6,
  padding: 0,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
  zIndex: 10000,
  minWidth: 280,
  maxWidth: 380,
  maxHeight: 400,
  display: 'flex',
  flexDirection: 'column',
};

export const popoverHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--overlay-border)',
};

export const popoverTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--overlay-fg)',
  fontFamily: 'var(--overlay-font-mono)',
};

export const popoverCloseButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--overlay-muted)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 3,
};

export const popoverFieldsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  overflowY: 'auto',
  maxHeight: 340,
};

export const jsonTextareaStyle: CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  background: 'var(--overlay-input-bg)',
  color: 'var(--overlay-input-fg)',
  border: '1px solid var(--overlay-input-border)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--overlay-font-mono)',
  resize: 'vertical' as const,
  minHeight: 60,
};

export const jsonErrorStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--overlay-destructive)',
  fontStyle: 'italic',
};

export const calloutStyle: CSSProperties = {
  background: 'rgba(250, 204, 21, 0.12)',
  border: '1px solid rgba(250, 204, 21, 0.3)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 11,
  lineHeight: 1.6,
};

export const calloutTextStyle: CSSProperties = {
  color: 'var(--overlay-warning)',
};

export const calloutLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--overlay-link)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
  fontFamily: 'var(--overlay-font-mono)',
};
