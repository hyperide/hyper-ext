/**
 * Unit Test Generator
 *
 * Generates unit tests in BDD style for React components.
 * Supports bun:test, vitest, and jest based on project configuration.
 * Uses testing-library/react for rendering.
 */

import type { ComponentAnalysis, InteractiveElement, TestRunner, TestVariant } from '../types';
import { getTestImportForRunner } from '../utils/detect-test-runner';

/**
 * Check if running in Bun environment
 * @deprecated Use detectTestRunner from utils/detect-test-runner instead
 */
export const isBun = typeof process !== 'undefined' && process.versions?.bun !== undefined;

/**
 * Generate import statements for test file
 */
function generateImports(analysis: ComponentAnalysis, testRunner: TestRunner): string[] {
  const { componentName, filePath } = analysis;
  const componentFileName =
    filePath
      .split('/')
      .pop()
      ?.replace(/\.tsx?$/, '') || 'component';

  const imports: string[] = [
    getTestImportForRunner(testRunner),
    `import { render, screen, fireEvent, cleanup } from '@testing-library/react';`,
    `import '@testing-library/jest-dom';`,
    ``,
    `import { ${componentName} } from './${componentFileName}';`,
  ];

  // Add variants import if exists
  imports.push(`// import { testVariants } from './${componentFileName}.variants';`);

  return imports;
}

/**
 * Generate test for component rendering
 */
function generateRenderTest(componentName: string): string[] {
  return [
    `  describe('rendering', () => {`,
    `    it('should render without crashing', () => {`,
    `      expect(() => render(<${componentName}>Test</${componentName}>)).not.toThrow();`,
    `    });`,
    ``,
    `    it('should render children', () => {`,
    `      render(<${componentName}>Test Content</${componentName}>);`,
    `      expect(screen.getByText('Test Content')).toBeInTheDocument();`,
    `    });`,
    `  });`,
  ];
}

/**
 * Generate test for testId prop
 */
function generateTestIdTest(componentName: string): string[] {
  return [
    `  describe('testId prop', () => {`,
    `    it('should apply data-test-id when testId prop is provided', () => {`,
    `      render(<${componentName} testId="my-test-id">Content</${componentName}>);`,
    `      expect(screen.getByTestId('my-test-id')).toBeInTheDocument();`,
    `    });`,
    ``,
    `    it('should not have data-test-id when testId is not provided', () => {`,
    `      render(<${componentName}>Content</${componentName}>);`,
    `      expect(screen.queryByTestId('my-test-id')).not.toBeInTheDocument();`,
    `    });`,
    `  });`,
  ];
}

/**
 * Generate tests for boolean props (disabled, loading, etc.)
 */
function generateBooleanPropTests(componentName: string, booleanProps: string[]): string[] {
  const tests: string[] = [];

  for (const prop of booleanProps) {
    tests.push(`  describe('${prop} prop', () => {`);

    if (prop === 'disabled') {
      tests.push(`    it('should have disabled attribute when ${prop} is true', () => {`);
      tests.push(`      render(<${componentName} ${prop}>Content</${componentName}>);`);
      tests.push(`      // Check for disabled attribute or aria-disabled`);
      tests.push(`      const element = screen.getByRole('button');`);
      tests.push(`      expect(element).toBeDisabled();`);
      tests.push(`    });`);
      tests.push(``);
      tests.push(`    it('should not be disabled by default', () => {`);
      tests.push(`      render(<${componentName}>Content</${componentName}>);`);
      tests.push(`      const element = screen.getByRole('button');`);
      tests.push(`      expect(element).not.toBeDisabled();`);
      tests.push(`    });`);
    } else if (prop === 'loading') {
      tests.push(`    it('should show loading state when ${prop} is true', () => {`);
      tests.push(`      render(<${componentName} ${prop}>Content</${componentName}>);`);
      tests.push(`      // Check for loading indicator or aria-busy`);
      tests.push(`      const element = screen.getByRole('button');`);
      tests.push(`      expect(element).toHaveAttribute('aria-busy', 'true');`);
      tests.push(`    });`);
    } else {
      tests.push(`    it('should apply ${prop} state when ${prop} is true', () => {`);
      tests.push(`      render(<${componentName} ${prop}>Content</${componentName}>);`);
      tests.push(`      // Add specific assertion for ${prop} state`);
      tests.push(`      expect(true).toBe(true); // TODO: implement specific check`);
      tests.push(`    });`);
    }

    tests.push(`  });`);
    tests.push(``);
  }

  return tests;
}

/**
 * Generate tests for CVA variants
 */
function generateVariantTests(componentName: string, variantName: string, values: string[]): string[] {
  const tests: string[] = [`  describe('${variantName} variants', () => {`];

  for (const value of values) {
    tests.push(`    it('should render with ${variantName}="${value}"', () => {`);
    tests.push(`      render(<${componentName} ${variantName}="${value}">Content</${componentName}>);`);
    tests.push(`      expect(screen.getByRole('button')).toBeInTheDocument();`);
    tests.push(`    });`);
    tests.push(``);
  }

  tests.push(`  });`);
  return tests;
}

/**
 * Generate tests for interactive elements
 */
function generateInteractiveTests(componentName: string, elements: InteractiveElement[]): string[] {
  const tests: string[] = [`  describe('interactive elements', () => {`];

  // Group by type
  const byType = new Map<string, InteractiveElement[]>();
  for (const el of elements) {
    const existing = byType.get(el.type) || [];
    existing.push(el);
    byType.set(el.type, existing);
  }

  for (const [type, els] of byType) {
    if (type === 'button') {
      tests.push(`    describe('buttons', () => {`);
      tests.push(`      it('should have ${els.length} interactive button(s)', () => {`);
      tests.push(`        render(<${componentName}>Content</${componentName}>);`);
      tests.push(`        const buttons = screen.getAllByRole('button');`);
      tests.push(`        expect(buttons.length).toBeGreaterThanOrEqual(1);`);
      tests.push(`      });`);

      for (const el of els) {
        if (el.suggestedTestId) {
          tests.push(``);
          tests.push(`      it('should find element with testId "${el.suggestedTestId}"', () => {`);
          tests.push(`        render(<${componentName} testId="${el.suggestedTestId}">Content</${componentName}>);`);
          tests.push(`        expect(screen.getByTestId('${el.suggestedTestId}')).toBeInTheDocument();`);
          tests.push(`      });`);
        }
      }

      tests.push(`    });`);
      tests.push(``);
    }

    if (type === 'input') {
      tests.push(`    describe('inputs', () => {`);
      tests.push(`      it('should have input element(s)', () => {`);
      tests.push(`        render(<${componentName} />);`);
      tests.push(`        const inputs = screen.getAllByRole('textbox');`);
      tests.push(`        expect(inputs.length).toBeGreaterThanOrEqual(1);`);
      tests.push(`      });`);
      tests.push(`    });`);
      tests.push(``);
    }
  }

  tests.push(`  });`);
  return tests;
}

/**
 * Generate accessibility tests
 */
function generateA11yTests(componentName: string): string[] {
  return [
    `  describe('accessibility', () => {`,
    `    it('should have accessible name', () => {`,
    `      render(<${componentName}>Accessible Content</${componentName}>);`,
    `      expect(screen.getByRole('button', { name: /accessible content/i })).toBeInTheDocument();`,
    `    });`,
    ``,
    `    it('should be focusable', () => {`,
    `      render(<${componentName}>Content</${componentName}>);`,
    `      const element = screen.getByRole('button');`,
    `      element.focus();`,
    `      expect(element).toHaveFocus();`,
    `    });`,
    `  });`,
  ];
}

/**
 * Generate tests for canvas variants (from canvas.json)
 */
function generateCanvasVariantTests(componentName: string, variants: TestVariant[]): string[] {
  if (variants.length === 0) return [];

  const tests: string[] = [`  describe('canvas variants', () => {`];

  for (const variant of variants) {
    // Skip variants marked to skip unit tests
    if (variant.skip?.unit) continue;

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

    tests.push(`    it('should render variant: ${variant.name}', () => {`);
    tests.push(`      const { container } = render(`);
    tests.push(`        <${componentName} ${propsString}>`);
    tests.push(`          Test Content`);
    tests.push(`        </${componentName}>`);
    tests.push(`      );`);
    tests.push(`      expect(container.firstChild).toBeInTheDocument();`);

    // Check expected test IDs if defined
    if (variant.expectedTestIds && variant.expectedTestIds.length > 0) {
      tests.push(`      // Check expected test IDs`);
      for (const testId of variant.expectedTestIds) {
        tests.push(`      expect(screen.getByTestId('${testId}')).toBeInTheDocument();`);
      }
    }

    tests.push(`    });`);
    tests.push(``);
  }

  tests.push(`  });`);
  return tests;
}

export interface UnitTestGeneratorOptions {
  analysis: ComponentAnalysis;
  testRunner?: TestRunner;
  /** Canvas variants from canvas.json (optional) */
  variants?: TestVariant[];
}

/**
 * Generate full unit test file content
 *
 * @param options - Generation options
 * @param options.analysis - Component analysis result
 * @param options.testRunner - Test runner to use (bun, vitest, jest). Defaults to 'bun'
 * @param options.variants - Canvas variants from canvas.json (optional)
 */
export function generateUnitTestContent(options: UnitTestGeneratorOptions): string;
/**
 * @deprecated Use options object instead
 */
export function generateUnitTestContent(analysis: ComponentAnalysis, testRunner?: TestRunner): string;
export function generateUnitTestContent(
  optionsOrAnalysis: UnitTestGeneratorOptions | ComponentAnalysis,
  testRunnerArg?: TestRunner,
): string {
  // Handle both signatures for backwards compatibility
  const options: UnitTestGeneratorOptions =
    'analysis' in optionsOrAnalysis ? optionsOrAnalysis : { analysis: optionsOrAnalysis, testRunner: testRunnerArg };

  const { analysis, testRunner = 'bun', variants } = options;
  const { componentName, propsInterface, cvaVariants, interactiveElements } = analysis;

  const lines: string[] = [
    '/**',
    ` * Unit tests for ${componentName}`,
    ' * Auto-generated - customize as needed',
    ' */',
    '',
  ];

  // Imports
  lines.push(...generateImports(analysis, testRunner));
  lines.push('');

  // Main describe block
  lines.push(`describe('${componentName}', () => {`);
  lines.push(`  afterEach(() => {`);
  lines.push(`    cleanup();`);
  lines.push(`  });`);
  lines.push('');

  // Rendering tests
  lines.push(...generateRenderTest(componentName));
  lines.push('');

  // TestId tests
  lines.push(...generateTestIdTest(componentName));
  lines.push('');

  // Boolean prop tests
  const booleanProps =
    propsInterface?.props
      .filter((p) => p.isBoolean && ['disabled', 'loading', 'checked', 'selected', 'active'].includes(p.name))
      .map((p) => p.name) || [];

  if (booleanProps.length > 0) {
    lines.push(...generateBooleanPropTests(componentName, booleanProps));
  }

  // CVA variant tests
  if (cvaVariants && cvaVariants.length > 0) {
    for (const variant of cvaVariants) {
      lines.push(...generateVariantTests(componentName, variant.name, variant.values));
      lines.push('');
    }
  }

  // Interactive element tests
  if (interactiveElements.length > 0) {
    lines.push(...generateInteractiveTests(componentName, interactiveElements));
    lines.push('');
  }

  // Canvas variant tests (from canvas.json)
  if (variants && variants.length > 0) {
    lines.push(...generateCanvasVariantTests(componentName, variants));
    lines.push('');
  }

  // Accessibility tests
  lines.push(...generateA11yTests(componentName));

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate test file path from component path
 */
export function getUnitTestPath(componentPath: string): string {
  return componentPath.replace(/\.(tsx?)$/, '.unit.test.$1');
}
