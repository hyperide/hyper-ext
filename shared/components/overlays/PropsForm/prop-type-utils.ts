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
  // ReactNode-ish element spellings. SYNC: keep this set in lockstep with
  // isReactNodeType in lib/preview-generator/sample-values.ts — both classify the
  // type strings emitted by componentSourceParser.getTypeString() (which serializes
  // qualified names verbatim, e.g. `React.JSX.Element`). Whitespace is already
  // collapsed by getTypeString for these references, so a lowercase compare suffices.
  if (
    typeStr === 'reactnode' ||
    typeStr === 'react.reactnode' ||
    typeStr === 'reactelement' ||
    typeStr === 'react.reactelement' ||
    typeStr === 'jsx.element' ||
    typeStr === 'jsxelement' ||
    typeStr === 'react.jsx.element'
  )
    return { type: 'reactNode', required: prop.required };
  // Function spellings. SYNC: isFunctionType in sample-values.ts. The parser emits the
  // bare word `Function` for `() => void`; keep the arrow / `(args):` syntax too for
  // hand-written or alternately-stringified types.
  if (typeStr === 'function' || typeStr.startsWith('(') || typeStr.includes('=>'))
    return { type: 'function', required: prop.required };
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
    // codeql[js/remote-property-injection] -- field name parsed from the user's own component source by the local props editor; fresh local record, no cross-user trust boundary
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
    // codeql[js/remote-property-injection] -- fieldName is \w+-constrained and parsed from the user's own component type source; fresh local record, no cross-user trust boundary
    schema[fieldName] = toPropTypeInfo({
      name: fieldName,
      type: fieldType.trim(),
      required: !optional,
    });
  }
  return Object.keys(schema).length > 0 ? schema : null;
}

/**
 * Whether PropsForm renders an editable field for a prop of this type. `function`
 * and `reactNode` props show a read-only "Not editable" row (see PropField), so they
 * must never be flagged "needs attention" — there's nothing the user can do about them.
 * Single source of truth for both PropField and computeAttentionProps (HYP-485).
 */
export function isEditablePropType(type: PropTypeInfo['type']): boolean {
  return type !== 'function' && type !== 'reactNode';
}

export function humanize(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
