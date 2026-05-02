/**
 * Type-aware props form for the ComponentErrorOverlay.
 *
 * Standalone version using inline styles (VSCode CSS variables).
 * Supports: string, number, boolean, enum, array, object (recursive with schema or JSON fallback), unknown.
 * Does NOT depend on shadcn/Tailwind — consistent with overlay's inline style approach.
 */

import type { PropTypeInfo } from '@shared/types/props';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Simplified prop info from extension's ComponentService (lib/types.ts PropInfo) */
export interface SimplePropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  /** Nested object field schema (for inline object types like { user: string; count: number }) */
  objectFields?: SimplePropInfo[];
}

interface PropsFormProps {
  /** Prop schema from extension (ComponentService.getComponentDefinitions) */
  propsSchema: SimplePropInfo[] | null;
  /** Prop names extracted from error message (fallback when schema unavailable) */
  extractedPropNames: string[];
  /** Called when any prop value changes. Key = prop name, value = typed value. */
  onChange: (values: Record<string, unknown>) => void;
  /** Called when the "all required filled" status changes */
  onAllRequiredFilled?: (allFilled: boolean) => void;
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

  if (typeStr.startsWith('{') || typeStr === 'object') {
    const objectSchema = prop.objectFields
      ? objectFieldsToSchema(prop.objectFields)
      : parseInlineObjectType(prop.type.trim());
    return { type: 'object', required: prop.required, objectSchema: objectSchema || undefined };
  }

  // Named type reference (e.g. "Tweet", "UserInfo") — likely an object, check for objectFields
  if (prop.objectFields && prop.objectFields.length > 0) {
    return {
      type: 'object',
      required: prop.required,
      objectSchema: objectFieldsToSchema(prop.objectFields),
    };
  }

  return { type: 'unknown', required: prop.required };
}

/** Convert SimplePropInfo[] (flat list) to Record<string, PropTypeInfo> (nested schema) */
function objectFieldsToSchema(fields: SimplePropInfo[]): Record<string, PropTypeInfo> {
  const schema: Record<string, PropTypeInfo> = {};
  for (const field of fields) {
    schema[field.name] = toPropTypeInfo(field);
  }
  return schema;
}

/**
 * Attempt to parse an inline TS object type string like "{ user: string; count: number; active: boolean }"
 * into a PropTypeInfo objectSchema. Returns null if parsing fails.
 */
function parseInlineObjectType(typeStr: string): Record<string, PropTypeInfo> | null {
  if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) return null;

  const inner = typeStr.slice(1, -1).trim();
  if (!inner) return null;

  // Split on semicolons (TS object type syntax)
  const parts = inner
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const schema: Record<string, PropTypeInfo> = {};
  for (const part of parts) {
    // Match "name: type" or "name?: type"
    const match = part.match(/^(\w+)(\?)?\s*:\s*(.+)$/);
    if (!match) continue;
    const [, fieldName, optional, fieldType] = match;
    schema[fieldName] = toPropTypeInfo({
      name: fieldName,
      type: fieldType.trim(),
      required: !optional,
    });
  }

  return Object.keys(schema).length > 0 ? schema : null;
}

/**
 * PropsForm renders typed form fields for component props.
 *
 * When propsSchema is available (from extension), renders type-appropriate inputs.
 * When only extractedPropNames is available (from error parsing), renders text inputs.
 */
export function PropsForm({ propsSchema, extractedPropNames, onChange, onAllRequiredFilled }: PropsFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [focusPath, setFocusPath] = useState<string | null>(null);

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

  // Build field list: prefer schema, fall back to extracted names. Deduplicate by name.
  const rawFields: Array<{ name: string; typeInfo: PropTypeInfo }> = propsSchema
    ? propsSchema.map((p) => ({ name: p.name, typeInfo: toPropTypeInfo(p) }))
    : extractedPropNames.map((name) => ({ name, typeInfo: { type: 'unknown' as const, required: true } }));
  const seen = new Set<string>();
  const fields = rawFields.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });

  const handleGenerateAll = useCallback(() => {
    const generated = generateObjectValues(fields);
    setValues(generated);
    onChange(generated);
  }, [fields, onChange]);

  // Compute unfilled required fields recursively
  const unfilledRequired = useMemo(() => {
    const result: Array<{ path: string; label: string }> = [];
    collectUnfilledRequired(fields, values, '', result);
    return result;
  }, [fields, values]);

  const allRequiredFilled = unfilledRequired.length === 0;

  // Notify parent about required status
  const prevAllFilledRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevAllFilledRef.current !== allRequiredFilled) {
      prevAllFilledRef.current = allRequiredFilled;
      onAllRequiredFilled?.(allRequiredFilled);
    }
  }, [allRequiredFilled, onAllRequiredFilled]);

  // Clear focusPath after it's been consumed
  useEffect(() => {
    if (focusPath) {
      const timer = setTimeout(() => setFocusPath(null), 300);
      return () => clearTimeout(timer);
    }
  }, [focusPath]);

  if (fields.length === 0) return null;

  return (
    <div style={formContainerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={formLabelStyle}>Props</div>
        <button type="button" onClick={handleGenerateAll} style={generateAllButtonStyle}>
          Generate values
        </button>
      </div>
      {fields.map(({ name, typeInfo }) => (
        <PropField
          key={name}
          name={name}
          typeInfo={typeInfo}
          value={values[name]}
          onChange={handleChange}
          focusPath={focusPath}
          fieldPath={name}
        />
      ))}
      {unfilledRequired.length > 0 && (
        <div style={calloutStyle}>
          <span style={calloutTextStyle}>
            {unfilledRequired.length} required field{unfilledRequired.length > 1 ? 's' : ''} missing:{' '}
          </span>
          {unfilledRequired.map((item, i) => (
            <span key={item.path}>
              {i > 0 && <span style={calloutTextStyle}>, </span>}
              <button type="button" onClick={() => setFocusPath(item.path)} style={calloutLinkStyle}>
                {item.label}
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Recursively collect unfilled required fields with their dot-paths */
function collectUnfilledRequired(
  fields: Array<{ name: string; typeInfo: PropTypeInfo }>,
  values: Record<string, unknown>,
  prefix: string,
  result: Array<{ path: string; label: string }>,
): void {
  for (const { name, typeInfo } of fields) {
    const path = prefix ? `${prefix}.${name}` : name;
    const v = values[name];

    if (typeInfo.type === 'object' && typeInfo.objectSchema) {
      // Recurse into object fields
      const objVal = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
      const nestedFields = Object.entries(typeInfo.objectSchema).map(([n, ti]) => ({ name: n, typeInfo: ti }));
      collectUnfilledRequired(nestedFields, objVal, path, result);
    } else if (typeInfo.required) {
      const isEmpty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
      if (isEmpty) {
        result.push({ path, label: prefix ? `${prefix} > ${humanize(name)}` : humanize(name) });
      }
    }
  }
}

/** Convert camelCase/PascalCase to human-readable: quoteTweet → quote tweet */
function humanize(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** Generate a random ID string */
function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

const NAMES = [
  'John Doe',
  'Jane Smith',
  'Alex Johnson',
  'Maria Garcia',
  'David Chen',
  'Sarah Kim',
  'James Wilson',
  'Emma Brown',
  'Michael Lee',
  'Olivia Taylor',
];
const USERNAMES = [
  '@johndoe',
  '@janesmith',
  '@alexj',
  '@mgarcia',
  '@dchen',
  '@sarahk',
  '@jwilson',
  '@emmab',
  '@mlee',
  '@otaylor',
];
const EMAILS = ['john@example.com', 'jane@test.com', 'alex@mail.com', 'maria@demo.com', 'david@sample.com'];
const TITLES = ['Hello World', 'Getting Started', 'My First Post', 'Breaking News', 'Update v2.0', 'Quick Note'];
const DESCRIPTIONS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
  'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum.',
  'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.',
];
const URLS = ['https://example.com', 'https://test.com/page', 'https://demo.app/resource'];
const COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

/** 1x1 pixel placeholder PNG as data URL */
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect width=%22100%22 height=%22100%22 fill=%22%23666%22/%3E%3Ctext x=%2250%22 y=%2255%22 text-anchor=%22middle%22 fill=%22%23fff%22 font-size=%2214%22%3Eplaceholder%3C/text%3E%3C/svg%3E';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Recursively generate values for a list of fields (handles nested objects) */
function generateObjectValues(fields: Array<{ name: string; typeInfo: PropTypeInfo }>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const { name, typeInfo } of fields) {
    const gen = getFieldGenerator(name);
    if (gen) {
      result[name] = gen();
    } else if (typeInfo.type === 'object' && typeInfo.objectSchema) {
      const nestedFields = Object.entries(typeInfo.objectSchema).map(([n, ti]) => ({ name: n, typeInfo: ti }));
      result[name] = generateObjectValues(nestedFields);
    } else if (typeInfo.type === 'number') {
      result[name] = Math.floor(Math.random() * 1000);
    } else if (typeInfo.type === 'boolean') {
      result[name] = Math.random() > 0.5;
    } else if (typeInfo.type === 'string' || typeInfo.type === 'unknown') {
      result[name] = `sample-${name}`;
    }
  }
  return result;
}

/** Detect field purpose from name and return a generator, or null */
function getFieldGenerator(name: string): (() => string) | null {
  const n = name.toLowerCase();
  if (/^id$|id$/i.test(name)) return generateId;
  if (n === 'name' || n === 'fullname' || n === 'displayname' || n === 'username' || n === 'author')
    return () => pick(NAMES);
  if (n === 'handle' || n === 'screenname' || n === 'nickname') return () => pick(USERNAMES);
  if (n === 'email' || n === 'mail') return () => pick(EMAILS);
  if (n === 'title' || n === 'subject' || n === 'heading') return () => pick(TITLES);
  if (n === 'description' || n === 'bio' || n === 'summary' || n === 'text' || n === 'content' || n === 'body')
    return () => pick(DESCRIPTIONS);
  if (n === 'url' || n === 'href' || n === 'link' || n === 'website') return () => pick(URLS);
  if (n === 'color' || n === 'bgcolor' || n === 'background') return () => pick(COLORS);
  if (/avatar|photo|image|pic|thumbnail|icon|logo|src/i.test(n)) return () => PLACEHOLDER_IMAGE;
  if (/count|total|amount|quantity|num/i.test(n)) return () => String(Math.floor(Math.random() * 1000));
  if (/^(ts|timestamp|createdAt|updatedAt)$/i.test(n)) return () => String(Date.now());
  if (/price|cost/i.test(n)) return () => (Math.random() * 100).toFixed(2);
  if (/^(date|created|updated)$/i.test(n)) return () => new Date().toISOString().split('T')[0];
  // timestamp — returns ISO string for string fields, unix ms will be handled by number generator
  if (/timestamp|^ts$/i.test(n)) return () => new Date().toISOString();
  if (/phone|tel/i.test(n)) return () => `+1 555-${Math.floor(1000 + Math.random() * 9000)}`;
  if (/verified|active|enabled|visible|published/i.test(n)) return () => 'true';
  return null;
}

// ============================================================================
// PropField — renders a single typed field
// ============================================================================

interface PropFieldProps {
  name: string;
  typeInfo: PropTypeInfo;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  depth?: number;
  focusPath?: string | null;
  fieldPath?: string;
}

function PropField({ name, typeInfo, value, onChange, depth = 0, focusPath, fieldPath }: PropFieldProps) {
  // Hooks must be called unconditionally before any early returns
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusPath && fieldPath && focusPath === fieldPath) {
      inputRef.current?.focus();
    }
  }, [focusPath, fieldPath]);

  // Prevent infinite recursion
  if (depth > 5) {
    return (
      <div style={fieldRowStyle}>
        <span style={nonEditableStyle}>Max nesting depth reached</span>
      </div>
    );
  }

  // Non-editable types
  if (typeInfo.type === 'function' || typeInfo.type === 'reactNode') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>{humanize(name)}</span>
        <span style={nonEditableStyle}>Not editable ({typeInfo.type})</span>
      </div>
    );
  }

  // Boolean — checkbox
  if (typeInfo.type === 'boolean') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>{humanize(name)}</span>
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
        <span style={fieldNameStyle}>{humanize(name)}</span>
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

  // Number — number input with rand button
  if (typeInfo.type === 'number') {
    const numId = `prop-${name}-${depth}-num`;
    return (
      <div style={fieldRowStyle}>
        <label htmlFor={numId} style={fieldNameStyle}>
          {humanize(name)}
        </label>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            id={numId}
            type="number"
            value={value != null ? String(value) : ''}
            onChange={(e) => {
              const num = Number.parseFloat(e.target.value);
              onChange(name, Number.isNaN(num) ? undefined : num);
            }}
            placeholder={typeInfo.required ? '' : 'optional'}
            style={{ ...inputStyle, width: '100%', paddingRight: 40 }}
          />
          <button
            type="button"
            onClick={() => onChange(name, Math.floor(Math.random() * 1000))}
            style={genButtonInlineStyle}
            title="Random number 0-1000"
          >
            rand
          </button>
        </div>
      </div>
    );
  }

  // Array — add/remove items
  if (typeInfo.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return (
      <div style={fieldColumnStyle}>
        <span style={fieldNameStyle}>
          {humanize(name)} <span style={typeBadgeStyle}>array</span>
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

  // Object with schema — floating popover with nested fields
  if (typeInfo.type === 'object' && typeInfo.objectSchema) {
    return (
      <ObjectPropPopover
        name={name}
        typeInfo={typeInfo}
        value={value}
        onChange={onChange}
        depth={depth}
        focusPath={focusPath}
        fieldPath={fieldPath}
      />
    );
  }

  // Object without schema — JSON textarea fallback
  if (typeInfo.type === 'object') {
    return <ObjectJsonFallback name={name} value={value} onChange={onChange} />;
  }

  // String / Unknown — text input with smart generator, converts to textarea at 80+ chars
  const generator = getFieldGenerator(name);
  const fieldId = `prop-${name}-${depth}`;
  const strValue = String(value ?? '');
  const isLong = strValue.length > 80;

  if (isLong) {
    return (
      <div style={{ ...fieldColumnStyle, gap: 4 }}>
        <label htmlFor={fieldId} style={fieldNameStyle}>
          {humanize(name)}
        </label>
        <textarea
          ref={inputRef as React.Ref<HTMLTextAreaElement>}
          id={fieldId}
          value={strValue}
          onChange={(e) => onChange(name, e.target.value)}
          placeholder={typeInfo.required ? '' : 'optional'}
          rows={3}
          style={{ ...inputStyle, width: '100%', resize: 'vertical', minHeight: 60 }}
        />
      </div>
    );
  }

  return (
    <div style={fieldRowStyle}>
      <label htmlFor={fieldId} style={fieldNameStyle}>
        {humanize(name)}
      </label>
      <div style={{ position: 'relative', flex: 1 }}>
        <input
          ref={inputRef as React.Ref<HTMLInputElement>}
          id={fieldId}
          type="text"
          value={strValue}
          onChange={(e) => onChange(name, e.target.value)}
          placeholder={typeInfo.required ? '' : 'optional'}
          style={{ ...inputStyle, width: '100%', paddingRight: generator ? 40 : undefined }}
        />
        {generator && (
          <button
            type="button"
            onClick={() => onChange(name, generator())}
            style={genButtonInlineStyle}
            title={`Generate ${humanize(name)}`}
          >
            gen
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// ObjectPropPopover — floating popover with nested object fields (recursive)
// ============================================================================

function ObjectPropPopover({
  name,
  typeInfo,
  value,
  onChange,
  depth,
  focusPath,
  fieldPath,
}: {
  name: string;
  typeInfo: PropTypeInfo;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  depth: number;
  focusPath?: string | null;
  fieldPath?: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const objValue = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  // biome-ignore lint/style/noNonNullAssertion: caller guarantees objectSchema exists
  const schema = typeInfo.objectSchema!;

  // Auto-open when focusPath targets a child of this object
  const myPath = fieldPath || name;
  useEffect(() => {
    if (focusPath?.startsWith(`${myPath}.`)) {
      setOpen(true);
    }
  }, [focusPath, myPath]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const entries = Object.entries(schema);
  const fieldCount = entries.length;
  const requiredCount = entries.filter(([, ti]) => ti.required).length;
  const filledCount = entries.filter(([fn]) => {
    const v = objValue[fn];
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
  }).length;

  return (
    <div style={fieldRowStyle}>
      <span style={fieldNameStyle}>{humanize(name)}</span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          ...popoverTriggerStyle,
          ...(open ? popoverTriggerActiveStyle : {}),
        }}
      >
        <span style={popoverTriggerCountStyle}>
          {filledCount}/{requiredCount > 0 && filledCount <= requiredCount ? requiredCount : fieldCount}{' '}
          {requiredCount > 0 && filledCount <= requiredCount ? 'required' : 'fields'}
        </span>
        <span style={popoverTriggerArrowStyle}>{open ? '\u25BC' : '\u25B6'}</span>
      </button>
      {open && (
        <div ref={popoverRef} style={popoverContainerStyle}>
          <div style={popoverHeaderStyle}>
            <span style={popoverTitleStyle}>{humanize(name)}</span>
            <button type="button" onClick={() => setOpen(false)} style={popoverCloseButtonStyle}>
              &times;
            </button>
          </div>
          <div style={popoverFieldsStyle}>
            {Object.entries(schema).map(([fieldName, fieldTypeInfo]) => (
              <PropField
                key={fieldName}
                name={fieldName}
                typeInfo={fieldTypeInfo}
                value={objValue[fieldName]}
                onChange={(nestedName, nestedValue) => {
                  onChange(name, { ...objValue, [nestedName]: nestedValue });
                }}
                depth={depth + 1}
                focusPath={focusPath}
                fieldPath={`${myPath}.${fieldName}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ObjectJsonFallback — JSON textarea for objects without schema
// ============================================================================

function ObjectJsonFallback({
  name,
  value,
  onChange,
}: {
  name: string;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
}) {
  const [jsonText, setJsonText] = useState(() => {
    if (typeof value === 'object' && value !== null) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return '';
      }
    }
    return typeof value === 'string' ? value : '';
  });
  const [parseError, setParseError] = useState<string | null>(null);

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    if (!text.trim()) {
      setParseError(null);
      onChange(name, undefined);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      onChange(name, parsed);
    } catch {
      setParseError('Invalid JSON');
    }
  };

  return (
    <div style={fieldColumnStyle}>
      <span style={fieldNameStyle}>
        {humanize(name)} <span style={typeBadgeStyle}>object (JSON)</span>
      </span>
      <textarea
        value={jsonText}
        onChange={(e) => handleJsonChange(e.target.value)}
        placeholder={'{\n  "key": "value"\n}'}
        style={jsonTextareaStyle}
        rows={4}
      />
      {parseError && <span style={jsonErrorStyle}>{parseError}</span>}
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

const generateAllButtonStyle: CSSProperties = {
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 500,
  background: 'transparent',
  color: 'var(--vscode-textLink-foreground, #a78bfa)',
  border: '1px solid var(--vscode-textLink-foreground, #a78bfa)',
  borderRadius: 4,
  cursor: 'pointer',
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

const genButtonInlineStyle: CSSProperties = {
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

const popoverTriggerStyle: CSSProperties = {
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

const popoverTriggerActiveStyle: CSSProperties = {
  borderColor: 'var(--vscode-focusBorder, #007fd4)',
  background: 'var(--vscode-list-activeSelectionBackground, #094771)',
};

const popoverTriggerCountStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--vscode-descriptionForeground, #718096)',
  flex: 1,
};

const popoverTriggerArrowStyle: CSSProperties = {
  fontSize: 9,
  color: 'var(--vscode-descriptionForeground, #718096)',
  userSelect: 'none',
};

const popoverContainerStyle: CSSProperties = {
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

const popoverHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: '1px solid var(--vscode-widget-border, #333)',
};

const popoverTitleStyle: CSSProperties = {
  fontWeight: 600,
  fontSize: 12,
  color: 'var(--vscode-editor-foreground, #e2e8f0)',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};

const popoverCloseButtonStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--vscode-descriptionForeground, #718096)',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
  lineHeight: 1,
  borderRadius: 3,
};

const popoverFieldsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  overflowY: 'auto',
  maxHeight: 340,
};

const jsonTextareaStyle: CSSProperties = {
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

const jsonErrorStyle: CSSProperties = {
  fontSize: 10,
  color: 'var(--vscode-errorForeground, #f44747)',
  fontStyle: 'italic',
};

const calloutStyle: CSSProperties = {
  background: 'rgba(250, 204, 21, 0.12)',
  border: '1px solid rgba(250, 204, 21, 0.3)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 11,
  lineHeight: 1.6,
};

const calloutTextStyle: CSSProperties = {
  color: 'var(--vscode-editorWarning-foreground, #cca700)',
};

const calloutLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--vscode-textLink-foreground, #3794ff)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 11,
  textDecoration: 'underline',
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
};
