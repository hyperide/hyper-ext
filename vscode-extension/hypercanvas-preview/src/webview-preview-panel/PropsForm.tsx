/**
 * Type-aware props form for the ComponentErrorOverlay.
 *
 * Standalone version using inline styles (VSCode CSS variables).
 * Supports: string, number, boolean, enum, array, object (shallow), unknown.
 * Does NOT depend on shadcn/Tailwind — consistent with overlay's inline style approach.
 */

import type { PropTypeInfo } from '@shared/types/props';
import { type CSSProperties, useCallback, useState } from 'react';

/** Simplified prop info from extension's ComponentService (lib/types.ts PropInfo) */
export interface SimplePropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

interface PropsFormProps {
  /** Prop schema from extension (ComponentService.getComponentDefinitions) */
  propsSchema: SimplePropInfo[] | null;
  /** Prop names extracted from error message (fallback when schema unavailable) */
  extractedPropNames: string[];
  /** Called when any prop value changes. Key = prop name, value = typed value. */
  onChange: (values: Record<string, unknown>) => void;
}

/** Convert extension's SimplePropInfo to PropTypeInfo for rendering */
function toPropTypeInfo(prop: SimplePropInfo): PropTypeInfo {
  const typeStr = prop.type.toLowerCase().trim();

  if (typeStr === 'string') return { type: 'string', required: prop.required };
  if (typeStr === 'number') return { type: 'number', required: prop.required };
  if (typeStr === 'boolean' || typeStr === 'bool') return { type: 'boolean', required: prop.required };
  if (typeStr === 'reactnode' || typeStr === 'react.reactnode' || typeStr === 'jsx.element')
    return { type: 'reactNode', required: prop.required };
  if (typeStr.startsWith('(') || typeStr.includes('=>')) return { type: 'function', required: prop.required };
  if (typeStr.endsWith('[]') || typeStr.startsWith('array'))
    return { type: 'array', required: prop.required, arrayItemType: { type: 'string', required: false } };

  // Union of string literals: "a" | "b" | "c"
  if (typeStr.includes('|') && typeStr.includes('"')) {
    const values = [...typeStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (values.length > 0) return { type: 'enum', required: prop.required, enumValues: values };
  }
  // Union of identifiers: small | medium | large (no quotes in TS display)
  if (typeStr.includes('|') && !typeStr.includes('{')) {
    const parts = typeStr
      .split('|')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => /^[\w-]+$/.test(p))) {
      return { type: 'enum', required: prop.required, enumValues: parts };
    }
  }

  if (typeStr.startsWith('{') || typeStr === 'object') return { type: 'object', required: prop.required };

  return { type: 'unknown', required: prop.required };
}

/**
 * PropsForm renders typed form fields for component props.
 *
 * When propsSchema is available (from extension), renders type-appropriate inputs.
 * When only extractedPropNames is available (from error parsing), renders text inputs.
 */
export function PropsForm({ propsSchema, extractedPropNames, onChange }: PropsFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});

  const handleChange = useCallback(
    (name: string, value: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [name]: value };
        onChange(next);
        return next;
      });
    },
    [onChange],
  );

  // Build field list: prefer schema, fall back to extracted names
  const fields: Array<{ name: string; typeInfo: PropTypeInfo }> = propsSchema
    ? propsSchema.map((p) => ({ name: p.name, typeInfo: toPropTypeInfo(p) }))
    : extractedPropNames.map((name) => ({ name, typeInfo: { type: 'unknown' as const, required: true } }));

  if (fields.length === 0) return null;

  return (
    <div style={formContainerStyle}>
      <div style={formLabelStyle}>Props {propsSchema ? '' : '(from error)'}</div>
      {fields.map(({ name, typeInfo }) => (
        <PropField key={name} name={name} typeInfo={typeInfo} value={values[name]} onChange={handleChange} />
      ))}
    </div>
  );
}

// ============================================================================
// PropField — renders a single typed field
// ============================================================================

interface PropFieldProps {
  name: string;
  typeInfo: PropTypeInfo;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}

function PropField({ name, typeInfo, value, onChange }: PropFieldProps) {
  // Non-editable types
  if (typeInfo.type === 'function' || typeInfo.type === 'reactNode') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>
          {name}
          {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
        </span>
        <span style={nonEditableStyle}>Not editable ({typeInfo.type})</span>
      </div>
    );
  }

  // Boolean — checkbox
  if (typeInfo.type === 'boolean') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>
          {name}
          {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
        </span>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={Boolean(value ?? false)}
            onChange={(e) => onChange(name, e.target.checked)}
            style={checkboxStyle}
          />
          <span style={checkboxTextStyle}>{value ? 'true' : 'false'}</span>
        </label>
      </div>
    );
  }

  // Enum — native select
  if (typeInfo.type === 'enum' && typeInfo.enumValues) {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>
          {name}
          {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
        </span>
        <select value={String(value ?? '')} onChange={(e) => onChange(name, e.target.value)} style={selectStyle}>
          <option value="">Select...</option>
          {typeInfo.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Number — number input
  if (typeInfo.type === 'number') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>
          {name}
          {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
        </span>
        <input
          type="number"
          value={value != null ? String(value) : ''}
          onChange={(e) => {
            const num = Number.parseFloat(e.target.value);
            onChange(name, Number.isNaN(num) ? undefined : num);
          }}
          placeholder={`Enter ${name}`}
          style={inputStyle}
        />
      </div>
    );
  }

  // Array — add/remove items
  if (typeInfo.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return (
      <div style={fieldColumnStyle}>
        <span style={fieldNameStyle}>
          {name}
          {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
          <span style={typeBadgeStyle}>array</span>
        </span>
        <div style={arrayContainerStyle}>
          {items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: array items have no stable id
            <div key={index} style={arrayItemRowStyle}>
              <input
                type="text"
                value={String(item ?? '')}
                onChange={(e) => {
                  const newItems = [...items];
                  newItems[index] = e.target.value;
                  onChange(name, newItems);
                }}
                placeholder={`Item ${index}`}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => {
                  onChange(
                    name,
                    items.filter((_, i) => i !== index),
                  );
                }}
                style={arrayRemoveButtonStyle}
                title="Remove item"
              >
                &times;
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange(name, [...items, ''])} style={arrayAddButtonStyle}>
            + Add Item
          </button>
        </div>
      </div>
    );
  }

  // String / Unknown — text input
  return (
    <div style={fieldRowStyle}>
      <span style={fieldNameStyle}>
        {name}
        {typeInfo.required && <span style={requiredMarkerStyle}>*</span>}
        {typeInfo.type !== 'string' && typeInfo.type !== 'unknown' && (
          <span style={typeBadgeStyle}>{typeInfo.type}</span>
        )}
      </span>
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={`Enter ${name}`}
        style={inputStyle}
      />
    </div>
  );
}

// ============================================================================
// Styles (VSCode CSS variables, consistent with ComponentErrorOverlay)
// ============================================================================

const formContainerStyle: CSSProperties = {
  background: 'var(--vscode-input-background, #252525)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  border: '1px solid var(--vscode-widget-border, #333)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const formLabelStyle: CSSProperties = {
  color: 'var(--vscode-editor-foreground, #a0aec0)',
  fontSize: 12,
  fontWeight: 500,
};

const fieldRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const fieldColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const fieldNameStyle: CSSProperties = {
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontSize: 12,
  minWidth: 100,
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const requiredMarkerStyle: CSSProperties = {
  color: 'var(--vscode-errorForeground, #f44747)',
  fontWeight: 600,
};

const typeBadgeStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--vscode-descriptionForeground, #718096)',
  background: 'var(--vscode-badge-background, #333)',
  padding: '1px 4px',
  borderRadius: 3,
  fontFamily: 'var(--vscode-font-family, system-ui)',
  fontWeight: 400,
};

const nonEditableStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontStyle: 'italic',
};

const inputStyle: CSSProperties = {
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

const selectStyle: CSSProperties = {
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

const checkboxLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const checkboxStyle: CSSProperties = {
  accentColor: 'var(--vscode-button-background, #3182ce)',
  width: 14,
  height: 14,
  cursor: 'pointer',
};

const checkboxTextStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

const arrayContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  paddingLeft: 12,
  borderLeft: '2px solid var(--vscode-widget-border, #333)',
};

const arrayItemRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const arrayRemoveButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-errorForeground, #f44747)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '2px 6px',
  borderRadius: 4,
  lineHeight: 1,
};

const arrayAddButtonStyle: CSSProperties = {
  background: 'transparent',
  border: '1px dashed var(--vscode-widget-border, #444)',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
  fontSize: 11,
  cursor: 'pointer',
  padding: '3px 8px',
  borderRadius: 4,
  textAlign: 'left' as const,
};
