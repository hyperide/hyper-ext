/**
 * Documentation Generator
 *
 * Generates component documentation from canvas.json variants.
 * Creates markdown or MDX files with props tables and usage examples.
 */

import type { ComponentAnalysis, TestVariant } from '../types';

export type DocsFormat = 'markdown' | 'mdx';

export interface DocsGeneratorOptions {
  analysis: ComponentAnalysis;
  variants: TestVariant[];
  format?: DocsFormat;
}

/**
 * Generate props table markdown
 */
function generatePropsTable(analysis: ComponentAnalysis): string[] {
  const lines: string[] = ['## Props', ''];

  if (!analysis.propsInterface || analysis.propsInterface.props.length === 0) {
    lines.push('No props interface found.', '');
    return lines;
  }

  lines.push('| Prop | Type | Required | Default | Description |');
  lines.push('|------|------|----------|---------|-------------|');

  for (const prop of analysis.propsInterface.props) {
    const required = prop.optional ? 'No' : 'Yes';
    const defaultVal = prop.defaultValue || '-';
    const desc = prop.description || '-';
    lines.push(`| \`${prop.name}\` | \`${prop.type}\` | ${required} | ${defaultVal} | ${desc} |`);
  }

  lines.push('');
  return lines;
}

/**
 * Generate CVA variants documentation
 */
function generateCvaVariantsSection(analysis: ComponentAnalysis): string[] {
  if (!analysis.cvaVariants || analysis.cvaVariants.length === 0) {
    return [];
  }

  const lines: string[] = ['## Variants', ''];

  for (const variant of analysis.cvaVariants) {
    lines.push(`### ${variant.name}`);
    lines.push('');
    lines.push(`Available values: ${variant.values.map((v) => `\`${v}\``).join(', ')}`);
    if (variant.defaultValue) {
      lines.push(`Default: \`${variant.defaultValue}\``);
    }
    lines.push('');
  }

  return lines;
}

/**
 * Generate code example for a variant
 */
function generateVariantExample(componentName: string, variant: TestVariant, format: DocsFormat): string[] {
  const lines: string[] = [];
  const propsString = Object.entries(variant.props)
    .map(([key, value]) => {
      if (typeof value === 'boolean') {
        return value ? key : `${key}={false}`;
      }
      if (typeof value === 'string') {
        return `${key}="${value}"`;
      }
      return `${key}={${JSON.stringify(value)}}`;
    })
    .join(' ');

  lines.push(`### ${variant.name}`);
  lines.push('');
  if (variant.description) {
    lines.push(variant.description);
    lines.push('');
  }

  if (format === 'mdx') {
    lines.push('```tsx live');
  } else {
    lines.push('```tsx');
  }

  lines.push(`<${componentName} ${propsString}>`);
  lines.push('  Content');
  lines.push(`</${componentName}>`);
  lines.push('```');
  lines.push('');

  return lines;
}

/**
 * Generate examples section from variants
 */
function generateExamplesSection(componentName: string, variants: TestVariant[], format: DocsFormat): string[] {
  if (variants.length === 0) return [];

  const lines: string[] = ['## Examples', ''];

  for (const variant of variants) {
    // Skip variants with skip.demo
    if (variant.skip?.demo) continue;

    lines.push(...generateVariantExample(componentName, variant, format));
  }

  return lines;
}

/**
 * Generate interactive elements documentation
 */
function generateInteractiveElementsSection(analysis: ComponentAnalysis): string[] {
  if (analysis.interactiveElements.length === 0) return [];

  const lines: string[] = ['## Interactive Elements', ''];

  lines.push('| Element | Type | Test ID | Description |');
  lines.push('|---------|------|---------|-------------|');

  for (const el of analysis.interactiveElements) {
    const desc = el.context.ariaLabel || el.context.placeholder || el.context.children || '-';
    lines.push(`| ${el.tagName} | ${el.type} | \`${el.suggestedTestId}\` | ${desc} |`);
  }

  lines.push('');
  return lines;
}

/**
 * Generate accessibility section
 */
function generateA11ySection(): string[] {
  return [
    '## Accessibility',
    '',
    '- Component is keyboard navigable',
    '- Uses proper ARIA attributes',
    '- Supports screen readers',
    '',
  ];
}

/**
 * Generate MDX-specific frontmatter
 */
function generateMdxFrontmatter(componentName: string): string[] {
  return ['---', `title: ${componentName}`, `description: Documentation for ${componentName} component`, '---', ''];
}

/**
 * Generate component documentation
 */
export function generateComponentDocs(options: DocsGeneratorOptions): string {
  const { analysis, variants, format = 'markdown' } = options;
  const { componentName } = analysis;

  const lines: string[] = [];

  // MDX frontmatter
  if (format === 'mdx') {
    lines.push(...generateMdxFrontmatter(componentName));
  }

  // Title
  lines.push(`# ${componentName}`);
  lines.push('');

  // Description
  lines.push(`Component documentation for \`${componentName}\`.`);
  lines.push('');

  // Import example
  lines.push('## Import');
  lines.push('');
  lines.push('```tsx');
  lines.push(`import { ${componentName} } from './path/to/${componentName}';`);
  lines.push('```');
  lines.push('');

  // Props table
  lines.push(...generatePropsTable(analysis));

  // CVA variants
  lines.push(...generateCvaVariantsSection(analysis));

  // Examples from canvas variants
  lines.push(...generateExamplesSection(componentName, variants, format));

  // Interactive elements
  lines.push(...generateInteractiveElementsSection(analysis));

  // Accessibility
  lines.push(...generateA11ySection());

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*Auto-generated documentation from canvas.json*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Get documentation file path
 */
export function getDocsPath(componentPath: string, format: DocsFormat = 'markdown'): string {
  const ext = format === 'mdx' ? '.mdx' : '.md';
  return componentPath.replace(/\.tsx?$/, `.docs${ext}`);
}
