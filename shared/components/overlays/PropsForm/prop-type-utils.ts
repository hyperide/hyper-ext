import type { PropTypeInfo } from '@shared/types/props';

export interface SimplePropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  objectFields?: SimplePropInfo[];
}

export function toPropTypeInfo(prop: SimplePropInfo): PropTypeInfo {
  const typeStr = prop.type.toLowerCase().trim();

  if (typeStr === 'string') return { type: 'string', required: prop.required };
  if (typeStr === 'number') return { type: 'number', required: prop.required };
  if (typeStr === 'boolean' || typeStr === 'bool') return { type: 'boolean', required: prop.required };
  if (typeStr === 'reactnode' || typeStr === 'react.reactnode' || typeStr === 'jsx.element')
    return { type: 'reactNode', required: prop.required };
  if (typeStr.startsWith('(') || typeStr.includes('=>')) return { type: 'function', required: prop.required };
  if (typeStr.endsWith('[]') || typeStr.startsWith('array'))
    return { type: 'array', required: prop.required, arrayItemType: { type: 'string', required: false } };

  if (typeStr.includes('|') && typeStr.includes('"')) {
    const values = [...typeStr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (values.length > 0) return { type: 'enum', required: prop.required, enumValues: values };
  }
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

  if (prop.objectFields && prop.objectFields.length > 0) {
    return { type: 'object', required: prop.required, objectSchema: objectFieldsToSchema(prop.objectFields) };
  }

  return { type: 'unknown', required: prop.required };
}

function objectFieldsToSchema(fields: SimplePropInfo[]): Record<string, PropTypeInfo> {
  const schema: Record<string, PropTypeInfo> = {};
  for (const field of fields) {
    schema[field.name] = toPropTypeInfo(field);
  }
  return schema;
}

function parseInlineObjectType(typeStr: string): Record<string, PropTypeInfo> | null {
  if (!typeStr.startsWith('{') || !typeStr.endsWith('}')) return null;
  const inner = typeStr.slice(1, -1).trim();
  if (!inner) return null;
  const parts = inner
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const schema: Record<string, PropTypeInfo> = {};
  for (const part of parts) {
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

export function humanize(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
