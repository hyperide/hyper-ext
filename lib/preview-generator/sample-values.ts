/**
 * @file Deterministic per-prop sample VALUE generator.
 *
 * Given a component's parsed prop schema (PropInfo[] with nested objectFields),
 * fabricate a best-effort sample value for every prop so the component can be
 * rendered automatically — BEFORE falling back to the "requires props" overlay.
 *
 * This is the "try first" half of feature #210: auto-generate sample values for
 * ALL props, attempt a render (the iframe ErrorBoundary is the actual probe),
 * and only surface the overlay — listing the props we could NOT satisfy — when
 * rendering still fails.
 *
 * Pure / framework-free / unit-testable. The render attempt itself lives in the
 * existing async iframe cycle (hypercanvas:componentRenderSucceeded vs
 * hypercanvas:componentError); there is no React renderer in the extension host.
 *
 * Accessed via: VS Code component-selection flow (extension.ts → PreviewPanel)
 */

import type { PropInfo } from '../types';

export interface SamplePropValuesResult {
  /** Generated values keyed by prop name. Props we couldn't satisfy are omitted. */
  values: Record<string, unknown>;
  /**
   * Names of REQUIRED props we could not confidently fabricate a value for
   * (e.g. an unresolved named object type, a bare `unknown`/`any`). These are
   * the props the overlay should highlight as "needs attention".
   */
  unsatisfied: string[];
}

/** Sentinel returned by valueForProp when no confident value can be produced. */
const UNSATISFIED = Symbol('unsatisfied');

/**
 * ReactNode-ish props don't need a value to render — React tolerates undefined
 * children — so they are never flagged as unsatisfied.
 */
function isReactNodeType(type: string): boolean {
  const t = type.toLowerCase().replace(/\s+/g, '');
  // SYNC: keep in lockstep with the ReactNode-ish set in
  // shared/components/overlays/PropsForm/prop-type-utils.ts (toPropTypeInfo).
  // componentSourceParser.getTypeString() serializes qualified names verbatim, so
  // React.JSX.Element is also a real emitted spelling.
  return (
    t === 'reactnode' ||
    t === 'react.reactnode' ||
    t === 'reactelement' ||
    t === 'react.reactelement' ||
    t === 'jsx.element' ||
    t === 'jsxelement' ||
    t === 'react.jsx.element'
  );
}

/**
 * True only for the BROAD `ReactNode` type, which accepts a bare string as a valid
 * child. Element-only types (`ReactElement` / `JSX.Element`) are excluded: a string
 * is the wrong shape for code that does `React.cloneElement(icon)` or reads
 * `icon.props`, so we must NOT fabricate a text placeholder for those.
 */
function acceptsTextPlaceholder(type: string): boolean {
  const t = type.toLowerCase().replace(/\s+/g, '');
  return t === 'reactnode' || t === 'react.reactnode';
}

/** Options that let the generator produce more meaningful placeholders. */
export interface SampleValueOptions {
  /**
   * The component's display name (e.g. `LocalButton`). When known, it is used —
   * humanized — as the visible `children` placeholder so a button/badge renders
   * real-looking content ("Local Button") instead of the generic "Sample".
   */
  componentName?: string;
}

/**
 * Turn a PascalCase / camelCase component identifier into spaced Title Case words
 * for use as visible placeholder content: `LocalButton` → `Local Button`,
 * `CTAButton` → `CTA Button`. Returns the input unchanged if it doesn't split.
 */
function humanizeComponentName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
}

function isFunctionType(type: string): boolean {
  const t = type.trim();
  return t.includes('=>') || /^\([^)]*\)\s*:/.test(t) || t.toLowerCase() === 'function';
}

const PRIMITIVE_KEYWORDS = new Set(['string', 'number', 'boolean', 'bool']);

/**
 * Strip nullish union members (`null`, `undefined`) so a `T | null` prop is
 * treated as `T`. Returns the trimmed members.
 */
function unionMembersWithoutNullish(type: string): string[] {
  return type
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'null' && s !== 'undefined');
}

/**
 * Parse a TS union of string/identifier literals into its members.
 * Returns null when the union is NOT an enum (e.g. a primitive union like
 * `number | null`, which the caller handles via the primitive branch instead).
 */
function parseEnumMembers(type: string): string[] | null {
  if (!type.includes('|')) return null;
  if (type.includes('{')) return null;

  // Quoted literal union: "a" | "b" (| null) → real enum.
  const quoted = [...type.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (quoted.length > 0) return quoted;

  const parts = unionMembersWithoutNullish(type);
  // A union that reduces to a single primitive keyword (e.g. `number | null`)
  // is NOT an enum — let the primitive branch generate a real typed value.
  if (parts.length === 1 && PRIMITIVE_KEYWORDS.has(parts[0].toLowerCase())) return null;
  // Bare identifier union: small | medium | large → real enum.
  if (parts.length > 1 && parts.every((p) => /^[\w-]+$/.test(p) && !PRIMITIVE_KEYWORDS.has(p.toLowerCase()))) {
    return parts;
  }

  return null;
}

function valueForProp(prop: PropInfo, opts?: SampleValueOptions): unknown | typeof UNSATISFIED {
  const type = (prop.type ?? '').trim();
  const lower = type.toLowerCase();

  // Recurse into nested object schemas first — most "named type" props (e.g.
  // `tweet: Tweet`) resolve to objectFields and this is what unblocks them.
  if (prop.objectFields && prop.objectFields.length > 0) {
    const nested: Record<string, unknown> = {};
    for (const field of dedupeProps(prop.objectFields)) {
      const fieldValue = valueForProp(field);
      if (fieldValue !== UNSATISFIED) nested[field.name] = fieldValue;
      else if (!field.required) continue;
      // A required nested field we can't satisfy still yields a partial object;
      // the render probe decides whether the partial is good enough. We don't
      // bubble the nested failure up as a separate top-level unsatisfied entry —
      // the top-level prop name is what the user acts on.
    }
    return nested;
  }

  // Enum / string-literal union (HYP-454): prefer the component's declared default
  // (destructuring default `variant = 'primary'` or defaultProps), captured in
  // prop.defaultValue. Only honor a default that is itself a union member — otherwise
  // fall back to the first member. Never sample the literal "unknown" for a resolvable
  // union; that would override the component's real default and render it unstyled.
  const enumMembers = parseEnumMembers(type);
  if (enumMembers) {
    const declaredDefault = prop.defaultValue;
    if (declaredDefault !== undefined && enumMembers.includes(declaredDefault)) return declaredDefault;
    return enumMembers[0];
  }

  // Normalize a `T | null` / `T | undefined` union down to `T` so the primitive
  // checks below see the bare keyword (parseEnumMembers already returned null for
  // single-primitive unions).
  const baseMembers = type.includes('|') ? unionMembersWithoutNullish(type) : [type];
  const baseLower = baseMembers.length === 1 ? baseMembers[0].toLowerCase() : lower;

  if (baseLower === 'string') return `Sample ${prop.name}`;
  if (baseLower === 'number') return 1;
  if (baseLower === 'boolean' || baseLower === 'bool') return false;

  if (type.endsWith('[]') || lower.startsWith('array')) {
    const itemType = type.endsWith('[]') ? type.slice(0, -2).trim() : 'string';
    const item = valueForProp({ name: `${prop.name}Item`, type: itemType, required: true });
    return item === UNSATISFIED ? [] : [item];
  }

  if (isFunctionType(type)) return () => undefined;

  // Inline object literal type with no parsed fields, or `object`/`Record<...>`:
  // an empty object is a reasonable best-effort that won't crash on read.
  if (type.startsWith('{') || lower === 'object' || lower.startsWith('record<')) return {};

  // ReactNode: a REQUIRED broad `ReactNode` (e.g. `children: ReactNode` on a
  // button/container) must render visible content — undefined leaves the component
  // empty. Fabricate a readable text placeholder. Element-only types
  // (ReactElement / JSX.Element) cannot take a string and are left undefined.
  // Optional ReactNode stays undefined (renderable; the component handles absence).
  // Either way ReactNode-ish props are never flagged as unsatisfied.
  if (isReactNodeType(type)) {
    if (prop.required && acceptsTextPlaceholder(type)) {
      if (prop.name === 'children') {
        // The main visible slot: prefer the (humanized) component name so the
        // component renders real-looking content; fall back to "Sample".
        return opts?.componentName ? humanizeComponentName(opts.componentName) : 'Sample';
      }
      return `Sample ${prop.name}`;
    }
    return undefined;
  }

  // Anything else (unresolved named type, unknown, any) — we cannot fabricate a
  // safe shape. Property access on undefined would crash, so refuse and flag.
  return UNSATISFIED;
}

/**
 * Generate best-effort sample values for ALL props in the schema.
 *
 * Required props we cannot satisfy are listed in `unsatisfied` (and omitted from
 * `values`). Optional unsatisfiable props are silently omitted — the component is
 * expected to handle their absence.
 */
/**
 * A prop entry is "richer" when it carries more shape information. ComponentService
 * can emit the same prop twice — once from the TS type annotation (with
 * objectFields / a real type) and once from destructuring (`unknown`). We keep the
 * richer one so the typed entry isn't shadowed by a bare `unknown` duplicate.
 */
function richness(prop: PropInfo): number {
  let score = 0;
  if (prop.objectFields && prop.objectFields.length > 0) score += 2;
  if (prop.type && prop.type.toLowerCase() !== 'unknown' && prop.type.toLowerCase() !== 'any') score += 1;
  return score;
}

function dedupeProps(props: readonly PropInfo[]): PropInfo[] {
  const byName = new Map<string, PropInfo>();
  for (const prop of props) {
    const existing = byName.get(prop.name);
    if (!existing) {
      byName.set(prop.name, { ...prop });
      continue;
    }
    // Same prop emitted twice — typed interface entry (richer type / objectFields) and
    // destructuring entry (type 'unknown', but carries defaultValue). Keep the richer
    // type but MERGE the destructuring default, so an enum prop sees both its real
    // union type AND its declared default (HYP-454). Picking one and dropping the other
    // would silently lose the default and resample the first member instead.
    const winner = richness(prop) > richness(existing) ? { ...prop } : { ...existing };
    winner.defaultValue = winner.defaultValue ?? existing.defaultValue ?? prop.defaultValue;
    byName.set(prop.name, winner);
  }
  return [...byName.values()];
}

export function generateSamplePropValues(
  props: readonly PropInfo[],
  opts?: SampleValueOptions,
): SamplePropValuesResult {
  const values: Record<string, unknown> = {};
  const unsatisfied: string[] = [];

  for (const prop of dedupeProps(props)) {
    const value = valueForProp(prop, opts);
    if (value !== UNSATISFIED) {
      // ReactNode resolves to `undefined` intentionally — don't write the key.
      if (value !== undefined) values[prop.name] = value;
      continue;
    }
    if (prop.required) unsatisfied.push(prop.name);
  }

  return { values, unsatisfied };
}
