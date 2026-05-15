import { scanRenderableExportNames } from './scanner';

export interface SampleScaffoldConfig {
  sourceCode?: string;
  componentName: string;
  exportName: string;
  propEntries?: Array<[string, unknown]>;
}

function isValidJsxComponentName(identifier: string): boolean {
  return /^[A-Za-z_$]/.test(identifier);
}

function toPascalIdentifier(name: string): string {
  const withoutExt = name.replace(/\.[^.]+$/, '');
  const basename = withoutExt.split('/').pop() ?? withoutExt;
  return basename
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

export function normalizeSampleComponentName(componentName: string): string {
  if (isValidJsxComponentName(componentName) && /^[A-Z]/.test(componentName)) return componentName;
  const candidate = toPascalIdentifier(componentName);
  return isValidJsxComponentName(candidate) && candidate.length > 0 ? candidate : 'Component';
}

function getSubComponentPlaceholder(subName: string): string {
  if (/title|header|label/i.test(subName)) return 'Preview title';
  if (/description|body|content|text/i.test(subName)) return 'This sample shows the component with visible content.';
  return `Sample ${subName}`;
}

export function buildDeterministicContainerSampleScaffold(config: {
  sourceCode: string;
  componentName: string;
  exportName: string;
}): string | null {
  const { sourceCode, componentName, exportName } = config;

  let exportedNames: string[];
  try {
    exportedNames = scanRenderableExportNames(sourceCode);
  } catch {
    return null;
  }

  const subComponents = exportedNames.filter(
    (name) =>
      name !== componentName && name.startsWith(componentName) && /^[A-Z]/.test(name.charAt(componentName.length)),
  );

  if (subComponents.length === 0) return null;

  const childLines = subComponents.map((sub) => `  <${sub}>${getSubComponentPlaceholder(sub)}</${sub}>`);

  return [
    '',
    `export const ${exportName} = () => (`,
    `  <${componentName}>`,
    ...childLines,
    `  </${componentName}>`,
    ');',
  ].join('\n');
}

export function buildSampleScaffold(config: SampleScaffoldConfig): string {
  const { sourceCode = '', componentName, exportName, propEntries = [] } = config;

  const jsxComponentName = normalizeSampleComponentName(componentName);

  if (sourceCode) {
    const deterministic = buildDeterministicContainerSampleScaffold({
      sourceCode,
      componentName: jsxComponentName,
      exportName,
    });
    if (deterministic) return deterministic;
  }

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
    `// Sample component — add required props below`,
    `export const ${exportName} = () => (`,
    `  <${jsxComponentName}`,
    ...propLines,
    `  />`,
    ');',
  ].join('\n');
}
