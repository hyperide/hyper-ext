/**
 * E2E Test Generator
 *
 * Generates Playwright E2E tests for React components.
 * Supports visual snapshots, interactions, and component variants.
 */

import * as path from 'node:path';

import type { ComponentAnalysis, InteractiveElement, TestInteraction, TestVariant } from '../types';

/**
 * Get component preview URL path
 * Extracts relative path from various project structures
 */
function getPreviewUrl(componentPath: string, variant?: string): string {
  // Extract relative path from known project patterns
  let relativePath = componentPath;

  // Try to extract relative path from common project structures
  const patterns = [
    /^.*\/client\/components\//,  // client/components/Button.tsx → Button
    /^.*\/client\//,               // client/pages/Home.tsx → pages/Home
    /^.*\/src\/components\//,      // src/components/Button.tsx → Button
    /^.*\/src\//,                  // src/pages/Home.tsx → pages/Home
    /^.*\/components\//,           // components/Button.tsx → Button
    /^.*\/app\//,                  // app/page.tsx → page
  ];

  for (const pattern of patterns) {
    if (pattern.test(componentPath)) {
      relativePath = componentPath.replace(pattern, '');
      break;
    }
  }

  // Remove file extension
  relativePath = relativePath.replace(/\.tsx?$/, '');

  const base = `/test-preview?component=${encodeURIComponent(relativePath)}`;
  return variant ? `${base}&variant=${encodeURIComponent(variant)}` : base;
}

/**
 * Generate test file header with imports
 */
function generateHeader(componentName: string): string[] {
  return [
    '/**',
    ` * E2E tests for ${componentName}`,
    ' * Auto-generated Playwright tests',
    ' */',
    '',
    `import { test, expect } from '@playwright/test';`,
    '',
  ];
}

/**
 * Generate visual snapshot tests for each variant
 */
function generateVisualTests(
  componentName: string,
  componentPath: string,
  variants: TestVariant[],
): string[] {
  const tests: string[] = [
    `test.describe('${componentName} Visual Tests', () => {`,
  ];

  for (const variant of variants) {
    const url = getPreviewUrl(componentPath, variant.id);
    const snapshotName = `${componentName.toLowerCase()}-${variant.id}.png`;

    tests.push(`  test('visual: ${variant.name}', async ({ page }) => {`);
    tests.push(`    await page.goto('${url}');`);
    tests.push(`    await page.waitForLoadState('networkidle');`);
    tests.push(``);
    tests.push(`    // Wait for component to render`);
    tests.push(`    await page.waitForSelector('[data-test-id]', { state: 'visible', timeout: 5000 }).catch(() => {});`);
    tests.push(``);
    tests.push(`    await expect(page).toHaveScreenshot('${snapshotName}', {`);
    tests.push(`      animations: 'disabled',`);
    tests.push(`      maxDiffPixels: 100,`);
    tests.push(`    });`);
    tests.push(`  });`);
    tests.push(``);
  }

  tests.push(`});`);
  return tests;
}

/**
 * Generate interaction tests for interactive elements
 */
function generateInteractionTests(
  componentName: string,
  componentPath: string,
  elements: InteractiveElement[],
): string[] {
  const tests: string[] = [
    `test.describe('${componentName} Interaction Tests', () => {`,
    `  test.beforeEach(async ({ page }) => {`,
    `    await page.goto('${getPreviewUrl(componentPath)}');`,
    `    await page.waitForLoadState('networkidle');`,
    `  });`,
    ``,
  ];

  // Group elements by type for organized tests
  const buttons = elements.filter(e => e.type === 'button');
  const inputs = elements.filter(e => e.type === 'input');
  const links = elements.filter(e => e.type === 'a');

  // Button interaction tests
  if (buttons.length > 0) {
    tests.push(`  test.describe('buttons', () => {`);

    for (const button of buttons) {
      const testId = button.suggestedTestId;
      const selector = testId ? `[data-test-id="${testId}"]` : 'button';

      tests.push(`    test('click: ${testId || 'button'}', async ({ page }) => {`);
      tests.push(`      const button = page.locator('${selector}').first();`);
      tests.push(`      await expect(button).toBeVisible();`);
      tests.push(``);
      tests.push(`      // Test hover state`);
      tests.push(`      await button.hover();`);
      tests.push(`      await expect(button).toBeVisible();`);
      tests.push(``);
      tests.push(`      // Test click`);
      tests.push(`      await button.click();`);
      tests.push(`      // Add assertions for expected behavior after click`);
      tests.push(`    });`);
      tests.push(``);
    }

    tests.push(`  });`);
    tests.push(``);
  }

  // Input interaction tests
  if (inputs.length > 0) {
    tests.push(`  test.describe('inputs', () => {`);

    for (const input of inputs) {
      const testId = input.suggestedTestId;
      const selector = testId ? `[data-test-id="${testId}"]` : 'input';
      const inputType = input.context.inputType || 'text';

      tests.push(`    test('type: ${testId || 'input'}', async ({ page }) => {`);
      tests.push(`      const input = page.locator('${selector}').first();`);
      tests.push(`      await expect(input).toBeVisible();`);
      tests.push(``);
      tests.push(`      // Test focus`);
      tests.push(`      await input.focus();`);
      tests.push(`      await expect(input).toBeFocused();`);
      tests.push(``);

      if (inputType === 'text' || inputType === 'email' || inputType === 'password') {
        tests.push(`      // Test typing`);
        tests.push(`      await input.fill('test input value');`);
        tests.push(`      await expect(input).toHaveValue('test input value');`);
        tests.push(``);
        tests.push(`      // Test clear`);
        tests.push(`      await input.clear();`);
        tests.push(`      await expect(input).toHaveValue('');`);
      }

      tests.push(`    });`);
      tests.push(``);
    }

    tests.push(`  });`);
    tests.push(``);
  }

  // Link interaction tests
  if (links.length > 0) {
    tests.push(`  test.describe('links', () => {`);

    for (const link of links) {
      const testId = link.suggestedTestId;
      const selector = testId ? `[data-test-id="${testId}"]` : 'a';

      tests.push(`    test('navigate: ${testId || 'link'}', async ({ page }) => {`);
      tests.push(`      const link = page.locator('${selector}').first();`);
      tests.push(`      await expect(link).toBeVisible();`);
      tests.push(``);
      tests.push(`      // Check href attribute`);
      tests.push(`      const href = await link.getAttribute('href');`);
      tests.push(`      expect(href).toBeTruthy();`);
      tests.push(`    });`);
      tests.push(``);
    }

    tests.push(`  });`);
  }

  tests.push(`});`);
  return tests;
}

/**
 * Generate accessibility tests
 */
function generateA11yTests(
  componentName: string,
  componentPath: string,
): string[] {
  return [
    `test.describe('${componentName} Accessibility Tests', () => {`,
    `  test('should be keyboard navigable', async ({ page }) => {`,
    `    await page.goto('${getPreviewUrl(componentPath)}');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    // Tab through interactive elements`,
    `    await page.keyboard.press('Tab');`,
    ``,
    `    // Check that something is focused`,
    `    const focusedElement = await page.evaluate(() => {`,
    `      return document.activeElement?.tagName;`,
    `    });`,
    `    expect(focusedElement).toBeTruthy();`,
    `  });`,
    ``,
    `  test('should respond to Enter key on buttons', async ({ page }) => {`,
    `    await page.goto('${getPreviewUrl(componentPath)}');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    const button = page.locator('button').first();`,
    `    if (await button.isVisible()) {`,
    `      await button.focus();`,
    `      await page.keyboard.press('Enter');`,
    `      // Add assertions for expected behavior`,
    `    }`,
    `  });`,
    ``,
    `  test('should have proper focus indicators', async ({ page }) => {`,
    `    await page.goto('${getPreviewUrl(componentPath)}');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    const button = page.locator('button').first();`,
    `    if (await button.isVisible()) {`,
    `      await button.focus();`,
    ``,
    `      // Take screenshot with focus ring visible`,
    `      await expect(page).toHaveScreenshot('${componentName.toLowerCase()}-focus-state.png', {`,
    `        animations: 'disabled',`,
    `      });`,
    `    }`,
    `  });`,
    `});`,
  ];
}

/**
 * Extract relative component path for display/reference
 */
function getRelativeComponentPath(filePath: string): string {
  // Try to extract a meaningful relative path
  const patterns = [
    { regex: /.*\/(client\/components\/.*)$/, group: 1 },
    { regex: /.*\/(client\/.*)$/, group: 1 },
    { regex: /.*\/(src\/components\/.*)$/, group: 1 },
    { regex: /.*\/(src\/.*)$/, group: 1 },
    { regex: /.*\/(components\/.*)$/, group: 1 },
    { regex: /.*\/(app\/.*)$/, group: 1 },
  ];

  for (const { regex, group } of patterns) {
    const match = filePath.match(regex);
    if (match?.[group]) {
      return match[group];
    }
  }

  // Fallback: just the filename
  return filePath.split('/').pop() || filePath;
}

/**
 * Generate interaction tests from variant.interactions
 */
function generateVariantInteractionTests(
  componentName: string,
  componentPath: string,
  variants: TestVariant[],
): string[] {
  const variantsWithInteractions = variants.filter(
    (v) => v.interactions && v.interactions.length > 0 && !v.skip?.e2e,
  );

  if (variantsWithInteractions.length === 0) return [];

  const tests: string[] = [
    `test.describe('${componentName} Variant Interactions', () => {`,
  ];

  for (const variant of variantsWithInteractions) {
    const url = getPreviewUrl(componentPath, variant.id);

    tests.push(`  test('interaction flow: ${variant.name}', async ({ page }) => {`);
    tests.push(`    await page.goto('${url}');`);
    tests.push(`    await page.waitForLoadState('networkidle');`);
    tests.push(``);

    for (const interaction of variant.interactions!) {
      tests.push(...generateInteractionStep(interaction));
    }

    tests.push(`  });`);
    tests.push(``);
  }

  tests.push(`});`);
  return tests;
}

/**
 * Generate a single interaction step
 */
function generateInteractionStep(interaction: TestInteraction): string[] {
  const lines: string[] = [];
  const selector = interaction.target.startsWith('[')
    ? interaction.target
    : `[data-test-id="${interaction.target}"]`;

  if (interaction.delay) {
    lines.push(`    await page.waitForTimeout(${interaction.delay});`);
  }

  switch (interaction.type) {
    case 'click':
      lines.push(`    await page.locator('${selector}').click();`);
      break;
    case 'type':
      lines.push(`    await page.locator('${selector}').fill('${interaction.value || ''}');`);
      break;
    case 'hover':
      lines.push(`    await page.locator('${selector}').hover();`);
      break;
    case 'focus':
      lines.push(`    await page.locator('${selector}').focus();`);
      break;
    case 'blur':
      lines.push(`    await page.locator('${selector}').blur();`);
      break;
    case 'select':
      lines.push(`    await page.locator('${selector}').selectOption('${interaction.value || ''}');`);
      break;
    case 'check':
      lines.push(`    await page.locator('${selector}').check();`);
      break;
    case 'uncheck':
      lines.push(`    await page.locator('${selector}').uncheck();`);
      break;
    case 'wait':
      lines.push(`    await page.waitForTimeout(${interaction.value || 1000});`);
      break;
    case 'press':
      lines.push(`    await page.keyboard.press('${interaction.key || 'Enter'}');`);
      break;
  }

  // Add expectations if defined
  if (interaction.expect) {
    const exp = interaction.expect;
    if (exp.visible) {
      lines.push(`    await expect(page.locator('${exp.visible}')).toBeVisible();`);
    }
    if (exp.hidden) {
      lines.push(`    await expect(page.locator('${exp.hidden}')).toBeHidden();`);
    }
    if (exp.text) {
      lines.push(`    await expect(page.locator('${selector}')).toContainText('${exp.text}');`);
    }
    if (exp.checked !== undefined) {
      lines.push(`    await expect(page.locator('${selector}')).${exp.checked ? 'toBeChecked' : 'not.toBeChecked'}();`);
    }
    if (exp.disabled !== undefined) {
      lines.push(`    await expect(page.locator('${selector}')).${exp.disabled ? 'toBeDisabled' : 'toBeEnabled'}();`);
    }
  }

  lines.push(``);
  return lines;
}

export interface E2ETestGeneratorOptions {
  analysis: ComponentAnalysis;
  /** Canvas variants from canvas.json (optional) */
  variants?: TestVariant[];
}

/**
 * Generate full E2E test file content
 */
export function generateE2ETestContent(options: E2ETestGeneratorOptions): string;
/**
 * @deprecated Use options object instead
 */
export function generateE2ETestContent(analysis: ComponentAnalysis): string;
export function generateE2ETestContent(
  optionsOrAnalysis: E2ETestGeneratorOptions | ComponentAnalysis,
): string {
  // Handle both signatures for backwards compatibility
  // Check if it's ComponentAnalysis (has filePath) or E2ETestGeneratorOptions (has analysis)
  const isComponentAnalysis = 'filePath' in optionsOrAnalysis;
  const options: E2ETestGeneratorOptions = isComponentAnalysis
    ? { analysis: optionsOrAnalysis as ComponentAnalysis }
    : (optionsOrAnalysis as E2ETestGeneratorOptions);

  const { analysis, variants: providedVariants } = options;
  const { componentName, filePath, interactiveElements } = analysis;

  // Use provided variants or create minimal default
  const variants: TestVariant[] = providedVariants || [
    {
      id: 'default',
      name: 'Default',
      description: `${componentName} default state`,
      props: {},
      render: () => null as unknown as JSX.Element,
    },
  ];

  const lines: string[] = [];

  // Header
  lines.push(...generateHeader(componentName));

  // Preview URL constant (relative path for reference)
  const relativeComponentPath = getRelativeComponentPath(filePath);
  lines.push(`const COMPONENT_PATH = '${relativeComponentPath}';`);
  lines.push('');

  // Visual tests
  lines.push(...generateVisualTests(componentName, filePath, variants));
  lines.push('');

  // Interaction tests (from interactive elements analysis)
  if (interactiveElements.length > 0) {
    lines.push(...generateInteractionTests(componentName, filePath, interactiveElements));
    lines.push('');
  }

  // Variant interaction tests (from canvas.json interactions)
  const variantInteractionTests = generateVariantInteractionTests(componentName, filePath, variants);
  if (variantInteractionTests.length > 0) {
    lines.push(...variantInteractionTests);
    lines.push('');
  }

  // Accessibility tests
  lines.push(...generateA11yTests(componentName, filePath));
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate E2E test file path
 */
export function getE2ETestPath(componentPath: string): string {
  // Extract component name and place in tests/e2e/ui/
  const componentName = path.basename(componentPath, path.extname(componentPath));
  return `tests/e2e/ui/${componentName}.e2e.test.ts`;
}

/**
 * Generate Playwright config snippet for component testing
 */
export function generatePlaywrightConfigSnippet(): string {
  return `
// Add to playwright.config.ts for component testing
{
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
    },
  },
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
}
`;
}
