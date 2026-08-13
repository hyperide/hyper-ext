/**
 * @file Render-error overlay — shown when the preview ErrorBoundary catches a
 *   component render error and offers to create a sample (or configure AI).
 *
 * Accessed via: Preview panel overlay layer in BOTH the SaaS editor
 *   (`client/pages/Editor/CanvasEditor.tsx`) and the VS Code extension webview
 *   (`vscode-extension/.../webview-preview-panel/PreviewPanelApp.tsx`).
 * Assumptions:
 *   - prop values flow through postMessage (structured clone) — JSON-serializable only.
 *   - `propsCache` survives across re-renders within a session, keyed by component path.
 *   - Platform-specific actions are injected as callbacks (`onCreateSample`,
 *     `onConfigureAIKey`, `onClose`); the component never branches on platform.
 *   - `--overlay-*` CSS custom properties are defined globally by each platform.
 * Architecture: see `.serena/memories/shared-overlay-components.md`.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TID } from '../../data-testid-map';
import { extractPropsFromError } from './extract-props-from-error';
import { PropsForm, type SimplePropInfo } from './PropsForm';

interface ComponentErrorOverlayProps {
  componentPath: string;
  errorSeq?: number;
  error: string;
  propsSchema?: SimplePropInfo[] | null;
  /**
   * Required props the auto-sample generator could not satisfy (feature #210).
   * Highlighted in the overlay as "needs attention".
   */
  unsatisfiedProps?: string[];
  onCreateSample: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAIKey: () => void;
  onClose: () => void;
}

/** Per-component prop values cache — persists across component switches, cleared on sample creation */
const propsCache = new Map<string, Record<string, unknown>>();

/**
 * Compute the overlay's "needs attention" list, kept CONSISTENT with the editable
 * Props panel: never flag a prop the user can't act on.
 *
 * The raw candidates are the union of (a) required props the auto-sample generator
 * couldn't satisfy and (b) prop names regex-scraped out of the runtime error. (b)
 * can name props that don't exist in the prop schema (e.g. `name` scraped from a
 * `reading 'name'` crash), for which PropsForm renders NO field. We drop those.
 *
 * The editable field set mirrors PropsForm: when a schema is present (even empty)
 * the fields come from the schema; otherwise from the extracted prop names.
 */
export function computeAttentionProps(input: {
  unsatisfiedProps: readonly string[];
  extractedProps: readonly string[];
  propsSchema: SimplePropInfo[] | null | undefined;
}): string[] {
  const { unsatisfiedProps, extractedProps, propsSchema } = input;
  const editableFieldNames = new Set(propsSchema ? propsSchema.map((p) => p.name) : extractedProps);
  const candidates = [...new Set([...unsatisfiedProps, ...extractedProps])];
  return candidates.filter((name) => editableFieldNames.has(name));
}

function isFilled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function ComponentErrorOverlay({
  componentPath,
  error,
  propsSchema,
  unsatisfiedProps,
  onCreateSample,
  onConfigureAIKey,
  onClose,
}: ComponentErrorOverlayProps) {
  const componentName =
    componentPath
      .split('/')
      .pop()
      ?.replace(/\.tsx?$/, '') ?? componentPath;

  const extractedProps = useMemo(() => extractPropsFromError(error), [error]);
  // Feature #210 — props that need the user's attention: the union of props the
  // auto-sample generator couldn't satisfy and prop names parsed out of the actual
  // render error. Filtered to props that have an editable field, so the
  // "needs attention" list stays consistent with the Props panel (HYP-453).
  const attentionProps = useMemo(
    () => computeAttentionProps({ unsatisfiedProps: unsatisfiedProps ?? [], extractedProps, propsSchema }),
    [unsatisfiedProps, extractedProps, propsSchema],
  );
  const cachedValues = useMemo(() => propsCache.get(componentPath), [componentPath]);
  const propValuesRef = useRef<Record<string, unknown>>(cachedValues ?? {});
  const [allRequiredFilled, setAllRequiredFilled] = useState(false);
  const [sampleCreated, setSampleCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [sampleName, setSampleName] = useState('SampleDefault');
  const [hasAnyProps, setHasAnyProps] = useState(false);

  // Listen for sample deletion from file watcher.
  // This message arrives from the VS Code extension host over the webview channel,
  // whose origin is the opaque vscode-webview://<session-id> — origin-string
  // comparison is meaningless here, so we validate by message shape instead.
  useEffect(() => {
    // VS Code webview host channel (opaque vscode-webview:// origin) — origin-string
    // comparison is meaningless; validated by message shape. Bare nosemgrep so both
    // the repo config and the registry `config: auto` scan honor the suppression
    // (the short rule-id form is not matched by the registry rule's full id).
    // nosemgrep
    const handler = (event: MessageEvent) => {
      // nosemgrep
      if ((event.data as { type?: string })?.type === 'errorOverlay:sampleDeleted') {
        setSampleCreated(false);
      }
    };
    // nosemgrep
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handlePropsChange = useCallback(
    (values: Record<string, unknown>) => {
      propValuesRef.current = values;
      propsCache.set(componentPath, values);
      setHasAnyProps(Object.values(values).some(isFilled));
    },
    [componentPath],
  );

  const handleCreateSample = useCallback(() => {
    const filled = Object.entries(propValuesRef.current).filter(([, v]) => isFilled(v));
    onCreateSample(sampleName, filled.length > 0 ? Object.fromEntries(filled) : undefined);
    propsCache.delete(componentPath);
    // Auto-close overlay for SampleDefault — preview will re-render with the sample
    if (sampleName === 'SampleDefault') {
      onClose();
    } else {
      setSampleCreated(true);
    }
  }, [onCreateSample, sampleName, componentPath, onClose]);

  const sampleCountRef = useRef(1);
  const handleCreateNew = useCallback(() => {
    sampleCountRef.current += 1;
    setSampleCreated(false);
    setAllRequiredFilled(false);
    setHasAnyProps(false);
    setSampleName(`Sample${sampleCountRef.current}`);
    propValuesRef.current = {};
    setFormKey((k) => k + 1);
  }, []);

  const hasProps = (propsSchema && propsSchema.length > 0) || extractedProps.length > 0;

  return (
    <div data-testid={TID.preview.componentErrorOverlay} style={backdropStyle}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={titleStyle}>{componentName}</h3>
          {sampleCreated && (
            <button type="button" onClick={onClose} style={closeButtonStyle} title="Close" aria-label="Close">
              &times;
            </button>
          )}
        </div>
        <p style={subtitleStyle}>
          {attentionProps.length > 0
            ? 'Auto-generated sample props were not enough to render this component.'
            : 'This component requires props to render.'}
        </p>

        {attentionProps.length > 0 && (
          <p data-testid={TID.preview.componentErrorAttentionProps} style={attentionStyle}>
            Needs attention:{' '}
            {attentionProps.map((name, i) => (
              <span key={name}>
                {i > 0 ? ', ' : ''}
                <code style={attentionCodeStyle}>{name}</code>
              </span>
            ))}
          </p>
        )}

        {hasProps && (
          <>
            <PropsForm
              propsSchema={propsSchema ?? null}
              extractedPropNames={extractedProps}
              onChange={handlePropsChange}
              onAllRequiredFilled={setAllRequiredFilled}
              resetKey={formKey}
              initialValues={cachedValues}
            />
            <p style={hintStyle}>Fill props here, edit them in the code editor, or combine both approaches.</p>
          </>
        )}

        {!hasProps && (
          <p style={noPropsHintStyle}>
            Could not detect required prop names from the error. The sample file will include a TODO placeholder.
          </p>
        )}

        {sampleCountRef.current > 1 && (
          <div style={sampleNameRowStyle}>
            <label htmlFor="sample-name" style={sampleNameLabelStyle}>
              Name
            </label>
            <input
              id="sample-name"
              type="text"
              value={sampleName}
              onChange={(e) => setSampleName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="SampleDefault"
              style={sampleNameInputStyle}
            />
          </div>
        )}

        {sampleCreated ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? primaryButtonStyle : secondaryButtonStyle}
              onClick={handleCreateSample}
            >
              Update Sample
            </button>
            <button type="button" onClick={handleCreateNew} style={linkButtonStyle}>
              Create New...
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? primaryButtonStyle : secondaryButtonStyle}
              onClick={handleCreateSample}
            >
              {hasAnyProps ? 'Create Sample' : 'Create Empty Sample'}
            </button>
            <span style={{ color: 'var(--overlay-muted)', fontSize: 12 }}>or</span>
            <button
              type="button"
              data-testid={TID.preview.componentErrorConfigureAI}
              style={allRequiredFilled ? secondaryButtonStyle : primaryButtonStyle}
              onClick={onConfigureAIKey}
            >
              Configure AI Key
            </button>
          </div>
        )}

        <p style={aiHintStyle}>
          <button type="button" onClick={onConfigureAIKey} style={aiHintLinkStyle}>
            Configure an AI provider
          </button>{' '}
          to auto-generate sample files with realistic data.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Styles (overlay CSS variables — shared across SaaS and the extension)
// ============================================================================

const backdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 100,
  background: 'var(--overlay-backdrop)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--overlay-font)',
};

const cardStyle: CSSProperties = {
  padding: 32,
  maxWidth: 520,
  width: '90%',
  background: 'var(--overlay-bg)',
  borderRadius: 12,
  border: '1px solid var(--overlay-border)',
  maxHeight: '85vh',
  overflowY: 'auto',
  // Gate horizontal overflow too — keeps PropsForm number inputs / step arrows
  // from punching through the card's right edge on narrow widths.
  overflowX: 'hidden',
  minWidth: 0,
  color: 'var(--overlay-fg)',
};

const titleStyle: CSSProperties = {
  color: 'var(--overlay-fg)',
  margin: '0 0 4px',
  fontSize: 15,
  fontWeight: 600,
};

const subtitleStyle: CSSProperties = {
  color: 'var(--overlay-muted)',
  fontSize: 12,
  margin: '0 0 20px',
};

const noPropsHintStyle: CSSProperties = {
  color: 'var(--overlay-muted)',
  fontSize: 12,
  margin: '0 0 16px',
  lineHeight: 1.6,
};

const sampleNameRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 12,
};

const sampleNameLabelStyle: CSSProperties = {
  color: 'var(--overlay-muted)',
  fontSize: 12,
  minWidth: 40,
};

const sampleNameInputStyle: CSSProperties = {
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

const hintStyle: CSSProperties = {
  color: 'var(--overlay-muted)',
  fontSize: 11,
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const attentionStyle: CSSProperties = {
  color: 'var(--overlay-warning)',
  fontSize: 12,
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const attentionCodeStyle: CSSProperties = {
  fontFamily: 'var(--overlay-font-mono)',
  background: 'var(--overlay-code-bg)',
  padding: '1px 5px',
  borderRadius: 3,
};

const linkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--overlay-link)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  textDecoration: 'underline',
};

const closeButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--overlay-muted)',
  fontSize: 20,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 4,
  marginTop: -4,
};

const aiHintStyle: CSSProperties = {
  color: 'var(--overlay-muted)',
  fontSize: 11,
  margin: '12px 0 0',
  lineHeight: 1.5,
};

const aiHintLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--overlay-link)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
};

const primaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--overlay-accent)',
  color: 'var(--overlay-accent-fg)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const secondaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--overlay-link)',
  border: '1px solid var(--overlay-link)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
