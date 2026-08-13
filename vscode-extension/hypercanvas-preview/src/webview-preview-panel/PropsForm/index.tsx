import type { PropTypeInfo } from '@shared/types/props';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { humanize, toPropTypeInfo } from './prop-type-utils';
import { generateObjectValues, getGenerateAllAvailability, getStringFieldGenerator } from './prop-generators';
import {
  arrayAddButtonStyle,
  arrayContainerStyle,
  arrayItemRowStyle,
  arrayRemoveButtonStyle,
  calloutLinkStyle,
  calloutStyle,
  calloutTextStyle,
  checkboxLabelStyle,
  checkboxStyle,
  checkboxTextStyle,
  fieldColumnStyle,
  fieldNameStyle,
  fieldRowStyle,
  formContainerStyle,
  formLabelStyle,
  generateAllButtonDisabledStyle,
  generateAllButtonStyle,
  generateAllTooltipWrapperStyle,
  genButtonInlineStyle,
  inputStyle,
  jsonErrorStyle,
  jsonTextareaStyle,
  nonEditableStyle,
  popoverCloseButtonStyle,
  popoverContainerStyle,
  popoverFieldsStyle,
  popoverHeaderStyle,
  popoverTitleStyle,
  popoverTriggerActiveStyle,
  popoverTriggerArrowStyle,
  popoverTriggerCountStyle,
  popoverTriggerStyle,
  selectStyle,
  typeBadgeStyle,
} from './styles';

export type { SimplePropInfo } from './prop-type-utils';
export { canGenerateSomeValue, getGenerateAllAvailability } from './prop-generators';

interface PropsFormProps {
  propsSchema: import('./prop-type-utils').SimplePropInfo[] | null;
  extractedPropNames: string[];
  onChange: (values: Record<string, unknown>) => void;
  onAllRequiredFilled?: (allFilled: boolean) => void;
  resetKey?: number;
  initialValues?: Record<string, unknown>;
}

export function PropsForm({
  propsSchema,
  extractedPropNames,
  onChange,
  onAllRequiredFilled,
  resetKey,
  initialValues,
}: PropsFormProps) {
  const rawFields: Array<{ name: string; typeInfo: PropTypeInfo }> = propsSchema
    ? propsSchema.map((p) => ({ name: p.name, typeInfo: toPropTypeInfo(p) }))
    : extractedPropNames.map((name) => ({ name, typeInfo: { type: 'unknown' as const, required: true } }));
  const seen = new Set<string>();
  const fields = rawFields.filter((f) => {
    if (seen.has(f.name)) return false;
    seen.add(f.name);
    return true;
  });

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    if (initialValues && Object.keys(initialValues).length > 0) return initialValues;
    const hasRequired = fields.some((f) => f.typeInfo.required);
    if (hasRequired && fields.length > 0) {
      return generateObjectValues(fields);
    }
    return {};
  });
  const [focusPath, setFocusPath] = useState<string | null>(null);

  const initialNotifiedRef = useRef(false);
  useEffect(() => {
    if (!initialNotifiedRef.current && Object.keys(values).length > 0) {
      initialNotifiedRef.current = true;
      onChange(values);
    }
  }, [values, onChange]);

  const prevSchemaLenRef = useRef(propsSchema?.length ?? 0);
  useEffect(() => {
    const newLen = propsSchema?.length ?? 0;
    if (newLen > prevSchemaLenRef.current) {
      prevSchemaLenRef.current = newLen;
      const hasRequired = fields.some((f) => f.typeInfo.required);
      if (hasRequired) {
        const generated = generateObjectValues(fields);
        setValues(generated);
        onChange(generated);
      }
    }
  }, [propsSchema, fields, onChange]);

  const prevResetKeyRef = useRef(resetKey);
  useEffect(() => {
    if (resetKey !== prevResetKeyRef.current) {
      prevResetKeyRef.current = resetKey;
      const hasRequired = fields.some((f) => f.typeInfo.required);
      if (hasRequired && fields.length > 0) {
        const generated = generateObjectValues(fields);
        setValues(generated);
        onChange(generated);
      } else {
        setValues({});
      }
    }
  }, [resetKey, fields, onChange]);

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

  const handleGenerateAll = useCallback(() => {
    const generated = generateObjectValues(fields);
    setValues(generated);
    onChange(generated);
  }, [fields, onChange]);

  const generateAllAvailability = useMemo(() => getGenerateAllAvailability(fields), [fields]);

  const unfilledRequired = useMemo(() => {
    const result: Array<{ path: string; label: string }> = [];
    collectUnfilledRequired(fields, values, '', result);
    return result;
  }, [fields, values]);

  const allRequiredFilled = unfilledRequired.length === 0;

  const prevAllFilledRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevAllFilledRef.current !== allRequiredFilled) {
      prevAllFilledRef.current = allRequiredFilled;
      onAllRequiredFilled?.(allRequiredFilled);
    }
  }, [allRequiredFilled, onAllRequiredFilled]);

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
        <span title={generateAllAvailability.tooltip} style={generateAllTooltipWrapperStyle}>
          <button
            type="button"
            aria-disabled={generateAllAvailability.disabled}
            disabled={generateAllAvailability.disabled}
            onClick={handleGenerateAll}
            style={{
              ...generateAllButtonStyle,
              ...(generateAllAvailability.disabled ? generateAllButtonDisabledStyle : {}),
            }}
          >
            Generate values
          </button>
        </span>
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
      {unfilledRequired.length > 0 && <MissingFieldsCallout items={unfilledRequired} onFocus={setFocusPath} />}
    </div>
  );
}

function MissingFieldsCallout({
  items,
  onFocus,
}: {
  items: Array<{ path: string; label: string }>;
  onFocus: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const maxVisible = 4;
  const remaining = items.length - maxVisible;
  const showAll = expanded || remaining <= 2;
  const visible = showAll ? items : items.slice(0, maxVisible);

  return (
    <div style={calloutStyle}>
      <span style={calloutTextStyle}>
        {items.length} required field{items.length > 1 ? 's' : ''} missing:{' '}
      </span>
      {visible.map((item, i) => (
        <span key={item.path}>
          {i > 0 && <span style={calloutTextStyle}>, </span>}
          <button type="button" onClick={() => onFocus(item.path)} style={calloutLinkStyle}>
            {item.label}
          </button>
        </span>
      ))}
      {!showAll && remaining > 2 && (
        <span>
          <span style={calloutTextStyle}>, </span>
          <button type="button" onClick={() => setExpanded(true)} style={calloutLinkStyle}>
            {remaining} more...
          </button>
        </span>
      )}
    </div>
  );
}

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

interface PropFieldProps {
  name: string;
  typeInfo: PropTypeInfo;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  depth?: number;
  focusPath?: string | null;
  fieldPath?: string;
  onPopoverToggle?: (open: boolean) => void;
}

function PropField({
  name,
  typeInfo,
  value,
  onChange,
  depth = 0,
  focusPath,
  fieldPath,
  onPopoverToggle,
}: PropFieldProps) {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (focusPath && fieldPath && focusPath === fieldPath) {
      inputRef.current?.focus();
    }
  }, [focusPath, fieldPath]);

  if (depth > 5) {
    return (
      <div style={fieldRowStyle}>
        <span style={nonEditableStyle}>Max nesting depth reached</span>
      </div>
    );
  }

  if (typeInfo.type === 'function' || typeInfo.type === 'reactNode') {
    return (
      <div style={fieldRowStyle}>
        <span style={fieldNameStyle}>{humanize(name)}</span>
        <span style={nonEditableStyle}>Not editable ({typeInfo.type})</span>
      </div>
    );
  }

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

  if (typeInfo.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return (
      <div style={fieldColumnStyle}>
        <span style={fieldNameStyle}>
          {humanize(name)} <span style={typeBadgeStyle}>array</span>
        </span>
        <div style={arrayContainerStyle}>
          {items.map((item, index) => (
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
                onClick={() =>
                  onChange(
                    name,
                    items.filter((_, i) => i !== index),
                  )
                }
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
        onPopoverToggle={onPopoverToggle}
      />
    );
  }

  if (typeInfo.type === 'object') {
    return <ObjectJsonFallback name={name} value={value} onChange={onChange} />;
  }

  const generator = getStringFieldGenerator(name);
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

function ObjectPropPopover({
  name,
  typeInfo,
  value,
  onChange,
  depth,
  focusPath,
  fieldPath,
  onPopoverToggle,
}: {
  name: string;
  typeInfo: PropTypeInfo;
  value: unknown;
  onChange: (name: string, value: unknown) => void;
  depth: number;
  focusPath?: string | null;
  fieldPath?: string;
  onPopoverToggle?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const objValue = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const schema = typeInfo.objectSchema!;

  useEffect(() => {
    onPopoverToggle?.(open);
  }, [open, onPopoverToggle]);

  const myPath = fieldPath || name;
  useEffect(() => {
    if (focusPath?.startsWith(`${myPath}.`)) {
      setOpen(true);
    }
  }, [focusPath, myPath]);

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
  const showCloseButton = !childOpen;

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
            {showCloseButton && (
              <button type="button" onClick={() => setOpen(false)} style={popoverCloseButtonStyle}>
                &times;
              </button>
            )}
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
                onPopoverToggle={setChildOpen}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

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
