import type { CSSProperties } from 'react';

export const formContainerStyle: CSSProperties = {
  background: 'var(--vscode-input-background, #252525)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  border: '1px solid var(--vscode-widget-border, #333)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

export const formLabelStyle: CSSProperties = {
  color: 'var(--vscode-editor-foreground, #a0aec0)',
  fontSize: 12,
  fontWeight: 500,
};

export const generateAllButtonStyle: CSSProperties = {
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
  border: '1px solid var(--vscode-textLink-foreground, #a78bfa)',
  borderRadius: 4,
  cursor: 'pointer',
};

export const generateAllButtonDisabledStyle: CSSProperties = {
  color: 'var(--vscode-disabledForeground, #777)',
  borderColor: 'var(--vscode-widget-border, #444)',
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
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontSize: 12,
  minWidth: 100,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
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
  background: 'var(--vscode-button-secondaryBackground, #3a3d41)',
  color: 'var(--vscode-button-secondaryForeground, #ccc)',
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  opacity: 0.7,
};

export const typeBadgeStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--vscode-descriptionForeground, #718096)',
  background: 'var(--vscode-badge-background, #333)',
  padding: '1px 4px',
  borderRadius: 3,
  fontFamily: 'var(--vscode-font-family, system-ui)',
  fontWeight: 400,
};

export const nonEditableStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontStyle: 'italic',
};

export const inputStyle: CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--vscode-input-background, #1e1e1e)',
  color: 'var(--vscode-input-foreground, #e2e8f0)',
  border: '1px solid var(--vscode-input-border, #444)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

export const selectStyle: CSSProperties = {
  flex: 1,
  padding: '4px 8px',
  fontSize: 12,
  background: 'var(--vscode-input-background, #1e1e1e)',
  color: 'var(--vscode-input-foreground, #e2e8f0)',
  border: '1px solid var(--vscode-input-border, #444)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

export const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

export const checkboxStyle: CSSProperties = {
  accentColor: 'var(--vscode-button-background, #3182ce)',
  width: 14,
  height: 14,
  cursor: 'pointer',
};

export const checkboxTextStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

export const arrayContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingLeft: 12,
  borderLeft: '2px solid var(--vscode-widget-border, #333)',
};

export const arrayItemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export const arrayRemoveButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-errorForeground, #f44747)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

export const arrayAddButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px dashed var(--vscode-widget-border, #444)',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
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
  background: 'var(--vscode-input-background, #1e1e1e)',
  border: '1px solid var(--vscode-input-border, #444)',
  borderRadius: 4,
  cursor: 'pointer',
  padding: '3px 8px',
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontSize: 12,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  flex: 1,
};

export const popoverTriggerActiveStyle: CSSProperties = {
  borderColor: 'var(--vscode-focusBorder, #007fd4)',
  background: 'var(--vscode-list-activeSelectionBackground, #094771)',
};

export const popoverTriggerCountStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--vscode-descriptionForeground, #718096)',
  flex: 1,
};

export const popoverTriggerArrowStyle: CSSProperties = {
  fontSize: 9,
  color: 'var(--vscode-descriptionForeground, #718096)',
  userSelect: 'none',
};

export const popoverContainerStyle: CSSProperties = {
  position: 'fixed',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  background: 'var(--vscode-editorWidget-background, #252526)',
  border: '1px solid var(--vscode-editorWidget-border, #454545)',
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
  borderBottom: '1px solid var(--vscode-widget-border, #333)',
};

export const popoverTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

export const popoverCloseButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground, #718096)',
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
  background: 'var(--vscode-input-background, #1e1e1e)',
  color: 'var(--vscode-input-foreground, #e2e8f0)',
  border: '1px solid var(--vscode-input-border, #444)',
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  resize: 'vertical' as const,
  minHeight: 60,
};

export const jsonErrorStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--vscode-errorForeground, #f44747)',
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
  color: 'var(--vscode-editorWarning-foreground, #cca700)',
};

export const calloutLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};
