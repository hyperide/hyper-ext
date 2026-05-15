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

function _sampleTextForCompanion(name: string, componentName: string): string {
  const suffix = name.slice(componentName.length).toLowerCase();
  if (suffix.includes('title')) return 'Preview title';
  if (suffix.includes('description')) return 'This sample shows the component with visible content.';
  if (suffix.includes('content')) return 'Sample content';
  return 'Sample text';
}

function _extractCompanionComponents(componentName: string, sourceCode: string): string[] {
  const companions = new Set<string>();

  // Match named exports: export { A, B, C } or export { A as B }
  for (const m of sourceCode.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const entry of m[1].split(',')) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name.startsWith(componentName) && name !== componentName) {
        companions.add(name);
      }
    }
  }

  // Match direct exports: export const/function/class XxxYyy = ...
  for (const m of sourceCode.matchAll(/export\s+(?:const|function|class)\s+([\w]+)/g)) {
    const name = m[1];
    if (name.startsWith(componentName) && name !== componentName) {
      companions.add(name);
    }
  }

  return [...companions];
}

/**
 * Build a minimal Sample* function export using the supplied prop values.
 * Normalizes path-like component names and generates container scaffolds
 * when sibling sub-components are detected in the source.
 */
export function buildSampleScaffold(config: SampleScaffoldConfig): string {
  const { componentName: rawName, exportName, propEntries, sourceCode } = config;

  // Normalize path-like names ("components/Sidebar.tsx" → "Sidebar")
  const componentName = normalizeSampleComponentName(rawName);

  // When sibling sub-components exist, generate a container scaffold
  if (sourceCode) {
    const companions = _extractCompanionComponents(componentName, sourceCode);
    if (companions.length > 0) {
      const childLines = companions.map(
        (companion) => `    <${companion}>${_sampleTextForCompanion(companion, componentName)}</${companion}>`,
      );
      return `export function ${exportName}() {\n  return (\n    <${componentName}>\n${childLines.join('\n')}\n    </${componentName}>\n  );\n}\n`;
    }
  }

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
