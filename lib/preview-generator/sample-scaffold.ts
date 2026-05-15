/**
 * @file Sample scaffold generation for preview component stubs
 *
 * Accessed via: PreviewPanel (VS Code extension) and sample-ensurer
 * Assumptions: sourceCode may be empty when generating simple scaffolds;
 *   normalizeSampleComponentName was previously defined in PreviewPanel.ts
 */

export interface SampleScaffoldConfig {
  sourceCode: string;
  componentName: string;
  exportName: string;
  propEntries?: Array<[string, unknown]>;
}

export interface DeterministicScaffoldConfig {
  sourceCode: string;
  componentName: string;
  exportName: string;
}

function isValidJsxComponentName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(value);
}

function toPascalIdentifier(value: string): string {
  const words = value
    .replace(/\.[jt]sx?$/i, '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter(Boolean);
  const identifier = words
    .map((word) => {
      const first = word.charAt(0);
      return `${first.toUpperCase()}${word.slice(1)}`;
    })
    .join('');
  if (!identifier) return 'Component';
  return /^[A-Za-z_$]/.test(identifier) ? identifier : `Component${identifier}`;
}

export function normalizeSampleComponentName(componentName: string): string {
  if (isValidJsxComponentName(componentName) && /^[A-Z]/.test(componentName)) return componentName;
  const fileName = componentName.split(/[\\/]/).pop() ?? componentName;
  const candidate = toPascalIdentifier(fileName);
  return isValidJsxComponentName(candidate) ? candidate : 'Component';
}

function extractExportNames(sourceCode: string): string[] {
  const names: string[] = [];
  for (const m of sourceCode.matchAll(/export\s*\{([^}]+)\}/g)) {
    const parts = m[1]
      .split(',')
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      )
      .filter(Boolean);
    names.push(...(parts as string[]));
  }
  for (const m of sourceCode.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
  }
  return [...new Set(names)];
}

function getCompanionPlaceholder(companionName: string, baseName: string): string {
  const suffix = companionName.slice(baseName.length);
  if (suffix === 'Title') return 'Preview title';
  if (suffix === 'Description') return 'This sample shows the component with visible content.';
  return `${suffix} content`;
}

/**
 * Build a deterministic scaffold for compound/container components
 * (e.g. Alert with AlertTitle + AlertDescription siblings).
 * Returns null when no companion exports are found.
 */
export function buildDeterministicContainerSampleScaffold(config: DeterministicScaffoldConfig): string | null {
  const { sourceCode, componentName, exportName } = config;

  const exportNames = extractExportNames(sourceCode);
  const companions = exportNames.filter(
    (name) => name !== componentName && name.startsWith(componentName) && name.length > componentName.length,
  );

  if (companions.length === 0) return null;

  const childLines = companions.map(
    (companion) => `    <${companion}>${getCompanionPlaceholder(companion, componentName)}</${companion}>`,
  );

  return [
    `export const ${exportName} = () => (`,
    `  <${componentName}>`,
    ...childLines,
    `  </${componentName}>`,
    ');',
  ].join('\n');
}

/**
 * Build a sample component scaffold.
 * When sourceCode is provided, attempts compound-component detection first.
 * Falls back to a simple self-closing scaffold with prop placeholders.
 */
export function buildSampleScaffold(config: SampleScaffoldConfig): string {
  const { sourceCode, componentName, exportName, propEntries = [] } = config;

  if (sourceCode) {
    const compound = buildDeterministicContainerSampleScaffold({ sourceCode, componentName, exportName });
    if (compound) return compound;
  }

  const jsxComponentName = normalizeSampleComponentName(componentName);
  const propLines =
    propEntries.length > 0
      ? propEntries.map(([key, value]) => {
          if (typeof value === 'boolean') return `    ${key}={${value}}`;
          if (typeof value === 'number') return `    ${key}={${value}}`;
          if (typeof value === 'object') return `    ${key}={${JSON.stringify(value)}}`;
          return `    ${key}={${JSON.stringify(String(value))}}`;
        })
      : [`    // TODO: Add required props here`];

  return [
    '',
    '// Sample component — add required props below',
    `export const ${exportName} = () => (`,
    `  <${jsxComponentName}`,
    ...propLines,
    '  />',
    ');',
  ].join('\n');
}
