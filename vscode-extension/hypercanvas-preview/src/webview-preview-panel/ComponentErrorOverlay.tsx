/**
 * @file Renders the preview error overlay and auto-creates an empty sample for components with no props.
 *
 * Accessed via: VS Code extension preview panel when a component render fails inside the iframe
 * Assumptions: `propsSchema` is `undefined` while loading, `[]` when the component truly has no props
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TID } from '../shared/data-testid-map';
import { PropsForm, type SimplePropInfo } from './PropsForm';

/** Per-component prop values cache — persists across component switches, cleared on sample creation */
const propsCache = new Map<string, Record<string, unknown>>();

interface ComponentErrorOverlayProps {
  componentPath: string;
  errorSeq?: number;
  error: string;
  propsSchema?: SimplePropInfo[] | null;
  onCreateSample: (sampleName: string, propValues?: Record<string, unknown>) => void;
  onConfigureAIKey: () => void;
  onClose: () => void;
}

/**
 * Extract prop names from common React error messages.
 * - "Cannot read properties of undefined (reading 'likes')" → ['likes']
 * - "Cannot read properties of null (reading 'name')" → ['name']
 * - "tweet is not defined" → ['tweet']
 * - "props.title is not a function" → ['title']
 * - Multiple "reading 'x'" in one message → all extracted
 */
function extractPropsFromError(errorMsg: string): string[] {
  // "Cannot read properties of undefined/null (reading 'propName')"
  const readingMatches = [...errorMsg.matchAll(/reading '(\w+)'/g)];
  if (readingMatches.length > 0) {
    return [...new Set(readingMatches.map((m) => m[1]))];
  }

  // "someVar is not defined" / "someVar is undefined"
  const undefinedMatch = errorMsg.match(/(\w+) is (?:not defined|undefined)/);
  if (undefinedMatch) return [undefinedMatch[1]];

  // "props.X is not a function" / "Cannot read X of undefined"
  const propsDotMatch = errorMsg.match(/props\.(\w+)/);
  if (propsDotMatch) return [propsDotMatch[1]];

  return [];
}

function shouldAutoCreateEmptySample(
  propsSchema: SimplePropInfo[] | null | undefined,
  extractedProps: string[],
): boolean {
  return Array.isArray(propsSchema) && propsSchema.length === 0 && extractedProps.length === 0;
}

export function shouldAutoCreateEmptySampleFromError(
  propsSchema: SimplePropInfo[] | null | undefined,
  error: string,
): boolean {
  return shouldAutoCreateEmptySample(propsSchema, extractPropsFromError(error));
}

export function ComponentErrorOverlay({
  componentPath,
  errorSeq,
  error,
  propsSchema,
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
  const cachedValues = useMemo(() => propsCache.get(componentPath), [componentPath]);
  const propValuesRef = useRef<Record<string, unknown>>(cachedValues ?? {});
  const [allRequiredFilled, setAllRequiredFilled] = useState(false);
  const [sampleCreated, setSampleCreated] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [sampleName, setSampleName] = useState('SampleDefault');

  const [hasAnyProps, setHasAnyProps] = useState(false);
  const shouldAutoCreate = shouldAutoCreateEmptySampleFromError(propsSchema, error);
  const autoCreateKeyRef = useRef<string | null>(null);

  // Listen for sample deletion from file watcher
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'errorOverlay:sampleDeleted') {
        setSampleCreated(false);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handlePropsChange = useCallback(
    (values: Record<string, unknown>) => {
      propValuesRef.current = values;
      propsCache.set(componentPath, values);
      const hasFilled = Object.values(values).some((v) => {
        if (v == null) return false;
        if (typeof v === 'string') return v.trim() !== '';
        if (Array.isArray(v)) return v.length > 0;
        return true;
      });
      setHasAnyProps(hasFilled);
    },
    [componentPath],
  );

  const handleCreateSample = useCallback(() => {
    const filled = Object.entries(propValuesRef.current).filter(([, v]) => {
      if (v == null) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.length > 0;
      return true;
    });
    onCreateSample(sampleName, filled.length > 0 ? Object.fromEntries(filled) : undefined);
    propsCache.delete(componentPath);
    // Auto-close overlay for SampleDefault — preview will re-render with the sample
    if (sampleName === 'SampleDefault') {
      onClose();
    } else {
      setSampleCreated(true);
    }
  }, [componentPath, onClose, onCreateSample, sampleName]);

  useEffect(() => {
    if (!shouldAutoCreate || sampleCreated || sampleName !== 'SampleDefault') return;

    const autoCreateKey = `${componentPath}:${errorSeq ?? 0}`;
    if (autoCreateKeyRef.current === autoCreateKey) return;

    autoCreateKeyRef.current = autoCreateKey;
    handleCreateSample();
  }, [componentPath, errorSeq, handleCreateSample, sampleCreated, sampleName, shouldAutoCreate]);

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
    <div data-testid={TID.preview.componentErrorOverlay} style={errorOverlayBackdropStyle}>
      <div style={errorOverlayCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h3 style={errorOverlayTitleStyle}>{componentName}</h3>
          {sampleCreated && (
            <button type="button" onClick={onClose} style={errorOverlayCloseButtonStyle} title="Close">
              &times;
            </button>
          )}
        </div>
        <p style={errorOverlaySubtitleStyle}>This component requires props to render.</p>

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
            <p style={errorOverlayHintStyle}>
              Fill props here, edit them in the code editor, or combine both approaches.
            </p>
          </>
        )}

        {!hasProps && (
          <p style={errorOverlayNoPropsHintStyle}>
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
              style={allRequiredFilled ? errorOverlayPrimaryButtonStyle : errorOverlaySecondaryButtonStyle}
              onClick={handleCreateSample}
            >
              Update Sample
            </button>
            <button type="button" onClick={handleCreateNew} style={errorOverlayLinkButtonStyle}>
              Create New...
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid={TID.preview.componentErrorCreateSample}
              style={allRequiredFilled ? errorOverlayPrimaryButtonStyle : errorOverlaySecondaryButtonStyle}
              onClick={handleCreateSample}
            >
              {hasAnyProps ? 'Create Sample' : 'Create Empty Sample'}
            </button>
            <span style={{ color: 'var(--vscode-descriptionForeground, #666)', fontSize: 12 }}>or</span>
            <button
              type="button"
              data-testid={TID.preview.componentErrorConfigureAI}
              style={allRequiredFilled ? errorOverlaySecondaryButtonStyle : errorOverlayPrimaryButtonStyle}
              onClick={onConfigureAIKey}
            >
              Configure AI Key
            </button>
          </div>
        )}

        <p style={errorOverlayAIHintStyle}>
          <button type="button" onClick={onConfigureAIKey} style={errorOverlayAIHintLinkStyle}>
            Configure an AI provider
          </button>{' '}
          to auto-generate sample files with realistic data.
        </p>
      </div>
    </div>
  );
}

const errorOverlayBackdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 100,
  background: 'rgba(0, 0, 0, 0.85)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'var(--vscode-font-family, system-ui, -apple-system, sans-serif)',
};

const errorOverlayCardStyle: CSSProperties = {
  padding: 32,
  maxWidth: 520,
  width: '90%',
  background: 'var(--vscode-editor-background, #1e1e1e)',
  borderRadius: 12,
  border: '1px solid var(--vscode-widget-border, #333)',
};

const errorOverlayTitleStyle: CSSProperties = {
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  margin: '0 0 4px',
  fontSize: 15,
  fontWeight: 600,
};

const errorOverlaySubtitleStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 12,
  margin: '0 0 20px',
};

const errorOverlayNoPropsHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
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
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 12,
  minWidth: 40,
};

const sampleNameInputStyle: CSSProperties = {
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

const errorOverlayHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 11,
  margin: '0 0 12px',
  lineHeight: 1.5,
};

const errorOverlayLinkButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  textDecoration: 'underline',
};

const errorOverlayCloseButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 20,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 4,
  marginTop: -4,
};

const errorOverlayAIHintStyle: CSSProperties = {
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 11,
  margin: '12px 0 0',
  lineHeight: 1.5,
};

const errorOverlayAIHintLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
};

const errorOverlayPrimaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'var(--vscode-button-background, #3182ce)',
  color: 'var(--vscode-button-foreground, white)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};

const errorOverlaySecondaryButtonStyle: CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
  border: '1px solid var(--vscode-textLink-foreground, #a78bfa)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
