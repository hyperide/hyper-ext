/**
 * @file Builds deterministic Sample* scaffolds for component preview files.
 *
 * Accessed via: VS Code preview error overlay > Create Sample
 * Assumptions: generated samples are appended to the same source file as the component.
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { scanRenderableExportNames } from './scanner';

export interface SampleScaffoldConfig {
  sourceCode: string;
  componentName: string;
  exportName: string;
  propEntries: Array<[string, unknown]>;
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

export function buildSampleScaffold({
  sourceCode,
  componentName,
  exportName,
  propEntries,
}: SampleScaffoldConfig): string {
  const jsxComponentName = normalizeSampleComponentName(componentName);
  const propLines = propEntries.map(([key, value]) => serializePropLine(key, value));
  const childLines = propLines.length === 0 ? buildVisibleChildLines(sourceCode, jsxComponentName) : [];

  return buildScaffold(jsxComponentName, exportName, propLines, childLines);
}

export function buildDeterministicContainerSampleScaffold({
  sourceCode,
  componentName,
  exportName,
}: Omit<SampleScaffoldConfig, 'propEntries'>): string | null {
  const jsxComponentName = normalizeSampleComponentName(componentName);
  const childLines = buildCompoundChildLines(sourceCode, jsxComponentName);
  if (childLines.length === 0) return null;
  return buildScaffold(jsxComponentName, exportName, [], childLines);
}

function buildScaffold(
  jsxComponentName: string,
  exportName: string,
  propLines: string[],
  childLines: string[],
): string {
  if (childLines.length > 0) {
    return [
      '',
      '// Sample component for preview',
      `export const ${exportName} = () => (`,
      `  <${jsxComponentName}${propLines.length > 0 ? '' : '>'}`,
      ...propLines,
      ...childLines,
      `  </${jsxComponentName}>`,
      ');',
    ].join('\n');
  }

  return [
    '',
    '// Sample component for preview',
    `export const ${exportName} = () => (`,
    `  <${jsxComponentName}`,
    ...propLines,
    '  />',
    ');',
  ].join('\n');
}

function serializePropLine(key: string, value: unknown): string {
  const serializedValue = serializePropValue(value);
  if (!isValidJsxAttributeName(key)) return `    {...{${JSON.stringify(key)}:${serializedValue}}}`;
  return `    ${key}={${serializedValue}}`;
}

function serializePropValue(value: unknown): string {
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(String(value));
}

function isValidJsxAttributeName(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function buildVisibleChildLines(sourceCode: string, componentName: string): string[] {
  const compoundChildren = buildCompoundChildLines(sourceCode, componentName);
  if (compoundChildren.length > 0) return compoundChildren;
  if (componentAcceptsChildren(sourceCode, componentName)) return ['    Sample content'];
  return [];
}

function buildCompoundChildLines(sourceCode: string, componentName: string): string[] {
  const exportedNames = scanRenderableExportNames(sourceCode);
  const suffixPriority = ['Header', 'Title', 'Description', 'Content', 'Body', 'Text', 'Footer', 'Label'];
  const candidates = exportedNames
    .filter((name) => name !== componentName && name.startsWith(componentName))
    .map((name) => ({ name, suffix: name.slice(componentName.length) }))
    .filter(({ suffix }) => suffixPriority.includes(suffix))
    .sort((a, b) => suffixPriority.indexOf(a.suffix) - suffixPriority.indexOf(b.suffix));

  return candidates.map(({ name, suffix }) => `    <${name}>${sampleTextForSuffix(suffix)}</${name}>`);
}

function sampleTextForSuffix(suffix: string): string {
  if (suffix === 'Title' || suffix === 'Header') return 'Preview title';
  if (suffix === 'Description') return 'This sample shows the component with visible content.';
  if (suffix === 'Footer') return 'Preview footer';
  if (suffix === 'Label') return 'Preview label';
  return 'Sample content';
}

function componentAcceptsChildren(sourceCode: string, componentName: string): boolean {
  if (/\b(?:HTMLAttributes|ButtonHTMLAttributes|AnchorHTMLAttributes)\b/.test(sourceCode)) return true;
  const escaped = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propsBlock = new RegExp(`(?:type|interface)\\s+${escaped}Props\\b[\\s\\S]{0,800}\\bchildren\\b`);
  return propsBlock.test(sourceCode);
}
