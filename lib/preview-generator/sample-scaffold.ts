/**
 * @file Scaffold generators for Sample* component exports.
 *
 * Accessed via: PreviewPanel (VS Code extension) and ensureSample (server/extension)
 * Assumptions: output is appended verbatim to TypeScript/TSX source files
 */

export interface SampleScaffoldConfig {
  /** Full source of the component file (used to infer prop types) */
  sourceCode: string;
  /** PascalCase component name, e.g. "Button" */
  componentName: string;
  /** Name of the export to generate, e.g. "SampleDefault" */
  exportName: string;
  /** Known prop values to include in the scaffold */
  propEntries: Array<[string, unknown]>;
}

/**
 * Strip path and extension from a component file name, normalize to PascalCase.
 * "/src/components/my-button.tsx" → "MyButton"
 */
export function normalizeSampleComponentName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const noExt = base.replace(/\.[^.]+$/, '');
  return noExt
    .split(/[-_\s]+/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
    .join('');
}

function serializeProp(value: unknown): string {
  if (typeof value === 'string') return `"${value.replace(/"/g, '\\"')}"`;
  if (typeof value === 'boolean') return value ? '{true}' : '{false}';
  if (typeof value === 'number') return `{${value}}`;
  return `{${JSON.stringify(value)}}`;
}

/**
 * Build a minimal Sample* function export using the supplied prop values.
 */
export function buildSampleScaffold(config: SampleScaffoldConfig): string {
  const { componentName, exportName, propEntries } = config;
  const propsStr =
    propEntries.length > 0 ? ` ${propEntries.map(([k, v]) => `${k}=${serializeProp(v)}`).join(' ')}` : '';
  return `export function ${exportName}() {\n  return <${componentName}${propsStr} />;\n}\n`;
}

/**
 * Attempt to build a deterministic scaffold for container-style components
 * (those that accept children). Returns null when the component structure
 * cannot be determined without AI assistance.
 */
export function buildDeterministicContainerSampleScaffold(config: {
  sourceCode: string;
  componentName: string;
  exportName: string;
}): string | null {
  const { componentName, exportName, sourceCode } = config;

  // Detect if component accepts a `children` prop — if so, wrap a placeholder.
  const acceptsChildren = /\bchildren\b/.test(sourceCode) || /\bPropsWithChildren\b/.test(sourceCode);

  if (!acceptsChildren) {
    return null;
  }

  return `export function ${exportName}() {\n  return <${componentName}>Sample content</${componentName}>;\n}\n`;
}
