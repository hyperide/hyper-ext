/**
 * Demo Generator
 *
 * Generates auto-run demo configurations and scripts for component showcases.
 * Creates visual demonstrations that cycle through component variants.
 */

import * as path from 'node:path';

import type { ComponentAnalysis, DemoConfig, TestVariant } from '../types';

export interface DemoGeneratorOptions {
  analysis: ComponentAnalysis;
  /** Canvas variants from canvas.json (optional) */
  variants?: TestVariant[];
}

/**
 * Generate demo configuration object
 * @deprecated Demo generation uses deprecated variants.tsx approach. Consider using canvas.json variants instead.
 */
export function generateDemoConfig(options: DemoGeneratorOptions): DemoConfig;
/** @deprecated Use options object instead */
export function generateDemoConfig(analysis: ComponentAnalysis): DemoConfig;
export function generateDemoConfig(optionsOrAnalysis: DemoGeneratorOptions | ComponentAnalysis): DemoConfig {
  // Check if it's ComponentAnalysis (has filePath) or DemoGeneratorOptions (has analysis)
  const isComponentAnalysis = 'filePath' in optionsOrAnalysis;
  const options: DemoGeneratorOptions = isComponentAnalysis
    ? { analysis: optionsOrAnalysis as ComponentAnalysis }
    : (optionsOrAnalysis as DemoGeneratorOptions);

  const { analysis, variants: providedVariants } = options;
  const { componentName, interactiveElements } = analysis;

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

  // Generate interactions for interactive elements
  const interactions: DemoConfig['interactions'] = [];

  // For default variant, add hover and click interactions
  if (interactiveElements.length > 0) {
    const defaultInteractions = interactiveElements
      .filter((el) => el.type === 'button')
      .slice(0, 3) // Limit to first 3 buttons
      .flatMap((el) => [
        {
          type: 'hover' as const,
          target: el.suggestedTestId,
          delay: 500,
        },
        {
          type: 'click' as const,
          target: el.suggestedTestId,
          delay: 300,
        },
      ]);

    if (defaultInteractions.length > 0) {
      interactions.push({
        variant: 'default',
        actions: defaultInteractions,
      });
    }
  }

  return {
    componentName,
    variants: variants.map((v) => v.id),
    interval: 2000,
    interactions,
    autoStart: true,
    loop: true,
  };
}

/**
 * Generate demo runner script content
 */
/**
 * Generate demo runner script content
 * @deprecated Demo generation uses deprecated variants.tsx approach. Consider using canvas.json variants instead.
 */
export function generateDemoScriptContent(options: DemoGeneratorOptions): string;
/** @deprecated Use options object instead */
export function generateDemoScriptContent(analysis: ComponentAnalysis): string;
export function generateDemoScriptContent(optionsOrAnalysis: DemoGeneratorOptions | ComponentAnalysis): string {
  // Check if it's ComponentAnalysis (has filePath) or DemoGeneratorOptions (has analysis)
  const isComponentAnalysis = 'filePath' in optionsOrAnalysis;
  const options: DemoGeneratorOptions = isComponentAnalysis
    ? { analysis: optionsOrAnalysis as ComponentAnalysis }
    : (optionsOrAnalysis as DemoGeneratorOptions);

  const { analysis } = options;
  const { componentName, filePath } = analysis;
  const config = generateDemoConfig(options);

  const componentFileName =
    filePath
      .split('/')
      .pop()
      ?.replace(/\.tsx?$/, '') || 'component';

  const lines: string[] = [
    '/**',
    ` * Demo auto-run script for ${componentName}`,
    ' * Cycles through component variants with interactions',
    ' */',
    '',
    `import { useState, useEffect, useCallback } from 'react';`,
    `import { ${componentName} } from './${componentFileName}';`,
    `import { testVariants } from './${componentFileName}.variants';`,
    '',
    `export interface DemoProps {`,
    `  /** Interval between variants in ms */`,
    `  interval?: number;`,
    `  /** Auto-start the demo */`,
    `  autoStart?: boolean;`,
    `  /** Loop continuously */`,
    `  loop?: boolean;`,
    `  /** Callback when variant changes */`,
    `  onVariantChange?: (variantId: string) => void;`,
    `}`,
    '',
    `export const demoConfig = ${JSON.stringify(config, null, 2)};`,
    '',
    `/**`,
    ` * Demo component that cycles through variants`,
    ` */`,
    `export function ${componentName}Demo({`,
    `  interval = ${config.interval},`,
    `  autoStart = ${config.autoStart},`,
    `  loop = ${config.loop},`,
    `  onVariantChange,`,
    `}: DemoProps) {`,
    `  const [currentIndex, setCurrentIndex] = useState(0);`,
    `  const [isRunning, setIsRunning] = useState(autoStart);`,
    ``,
    `  const nextVariant = useCallback(() => {`,
    `    setCurrentIndex((prev) => {`,
    `      const next = prev + 1;`,
    `      if (next >= testVariants.length) {`,
    `        if (!loop) {`,
    `          setIsRunning(false);`,
    `          return prev;`,
    `        }`,
    `        return 0;`,
    `      }`,
    `      return next;`,
    `    });`,
    `  }, [loop]);`,
    ``,
    `  useEffect(() => {`,
    `    if (!isRunning) return;`,
    ``,
    `    const timer = setInterval(nextVariant, interval);`,
    `    return () => clearInterval(timer);`,
    `  }, [isRunning, interval, nextVariant]);`,
    ``,
    `  useEffect(() => {`,
    `    const variant = testVariants[currentIndex];`,
    `    if (variant && onVariantChange) {`,
    `      onVariantChange(variant.id);`,
    `    }`,
    `  }, [currentIndex, onVariantChange]);`,
    ``,
    `  const currentVariant = testVariants[currentIndex];`,
    ``,
    `  return (`,
    `    <div className="demo-container">`,
    `      <div className="demo-controls">`,
    `        <button`,
    `          onClick={() => setIsRunning(!isRunning)}`,
    `          data-test-id="demo-play-pause"`,
    `        >`,
    `          {isRunning ? 'Pause' : 'Play'}`,
    `        </button>`,
    `        <button`,
    `          onClick={() => setCurrentIndex(0)}`,
    `          data-test-id="demo-reset"`,
    `        >`,
    `          Reset`,
    `        </button>`,
    `        <span className="demo-indicator">`,
    `          {currentIndex + 1} / {testVariants.length}`,
    `        </span>`,
    `      </div>`,
    ``,
    `      <div className="demo-info">`,
    `        <h3>{currentVariant?.name}</h3>`,
    `        <p>{currentVariant?.description}</p>`,
    `      </div>`,
    ``,
    `      <div className="demo-preview">`,
    `        {currentVariant?.render()}`,
    `      </div>`,
    ``,
    `      <div className="demo-variant-list">`,
    `        {testVariants.map((variant, index) => (`,
    `          <button`,
    `            key={variant.id}`,
    `            onClick={() => setCurrentIndex(index)}`,
    `            className={index === currentIndex ? 'active' : ''}`,
    `            data-test-id={\`demo-variant-\${variant.id}\`}`,
    `          >`,
    `            {variant.name}`,
    `          </button>`,
    `        ))}`,
    `      </div>`,
    `    </div>`,
    `  );`,
    `}`,
    '',
    `export default ${componentName}Demo;`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Generate demo styles
 */
export function generateDemoStyles(): string {
  return `
/* Demo container styles */
.demo-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  background: #fafafa;
}

.demo-controls {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.demo-controls button {
  padding: 0.5rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 0.25rem;
  background: white;
  cursor: pointer;
}

.demo-controls button:hover {
  background: #f3f4f6;
}

.demo-indicator {
  margin-left: auto;
  font-size: 0.875rem;
  color: #6b7280;
}

.demo-info {
  padding: 0.5rem;
  background: white;
  border-radius: 0.25rem;
}

.demo-info h3 {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
}

.demo-info p {
  margin: 0;
  font-size: 0.875rem;
  color: #6b7280;
}

.demo-preview {
  padding: 2rem;
  background: white;
  border-radius: 0.25rem;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100px;
}

.demo-variant-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.demo-variant-list button {
  padding: 0.25rem 0.5rem;
  border: 1px solid #e5e7eb;
  border-radius: 0.25rem;
  background: white;
  font-size: 0.75rem;
  cursor: pointer;
}

.demo-variant-list button:hover {
  border-color: #3b82f6;
}

.demo-variant-list button.active {
  background: #3b82f6;
  color: white;
  border-color: #3b82f6;
}
`;
}

/**
 * Generate Playwright test for demo auto-run
 */
export function generateDemoE2ETest(analysis: ComponentAnalysis): string {
  const { componentName, filePath } = analysis;
  const config = generateDemoConfig(analysis);

  const componentFileName = path.basename(filePath, path.extname(filePath));

  const lines: string[] = [
    '/**',
    ` * E2E test for ${componentName} demo auto-run`,
    ' */',
    '',
    `import { test, expect } from '@playwright/test';`,
    '',
    `test.describe('${componentName} Demo', () => {`,
    `  test('should auto-cycle through all variants', async ({ page }) => {`,
    `    await page.goto('/test-preview?component=${componentFileName}&demo=true');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    // Wait for demo to start`,
    `    await page.waitForSelector('[data-test-id="demo-play-pause"]');`,
    ``,
    `    // Check initial state`,
    `    const indicator = page.locator('.demo-indicator');`,
    `    await expect(indicator).toContainText('1 / ${config.variants.length}');`,
    ``,
    `    // Wait for auto-advance (with buffer)`,
    `    await page.waitForTimeout(${config.interval + 500});`,
    ``,
    `    // Should have advanced to next variant`,
    `    await expect(indicator).not.toContainText('1 / ${config.variants.length}');`,
    `  });`,
    ``,
    `  test('should pause and resume', async ({ page }) => {`,
    `    await page.goto('/test-preview?component=${componentFileName}&demo=true');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    const playPauseBtn = page.locator('[data-test-id="demo-play-pause"]');`,
    ``,
    `    // Pause`,
    `    await playPauseBtn.click();`,
    `    await expect(playPauseBtn).toContainText('Play');`,
    ``,
    `    // Note current state`,
    `    const indicator = page.locator('.demo-indicator');`,
    `    const beforeText = await indicator.textContent();`,
    ``,
    `    // Wait and verify no change`,
    `    await page.waitForTimeout(${config.interval + 500});`,
    `    await expect(indicator).toHaveText(beforeText!);`,
    ``,
    `    // Resume`,
    `    await playPauseBtn.click();`,
    `    await expect(playPauseBtn).toContainText('Pause');`,
    `  });`,
    ``,
    `  test('should navigate directly to variant', async ({ page }) => {`,
    `    await page.goto('/test-preview?component=${componentFileName}&demo=true');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    config.variants.length > 1
      ? [
          `    // Click on second variant`,
          `    const variantBtn = page.locator('[data-test-id="demo-variant-${config.variants[1]}"]');`,
          `    await variantBtn.click();`,
          ``,
          `    // Check indicator updated`,
          `    const indicator = page.locator('.demo-indicator');`,
          `    await expect(indicator).toContainText('2 / ${config.variants.length}');`,
        ].join('\n')
      : '    // Only one variant, skip navigation test',
    `  });`,
    ``,
    `  test('should capture screenshots for all variants', async ({ page }) => {`,
    `    await page.goto('/test-preview?component=${componentFileName}&demo=true');`,
    `    await page.waitForLoadState('networkidle');`,
    ``,
    `    // Pause auto-play`,
    `    await page.locator('[data-test-id="demo-play-pause"]').click();`,
    ``,
    ...config.variants.map((variantId) =>
      [
        `    // Variant: ${variantId}`,
        `    await page.locator('[data-test-id="demo-variant-${variantId}"]').click();`,
        `    await page.waitForTimeout(300);`,
        `    await expect(page).toHaveScreenshot('demo-${componentName.toLowerCase()}-${variantId}.png');`,
        ``,
      ].join('\n'),
    ),
    `  });`,
    `});`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Get demo file path
 */
export function getDemoPath(componentPath: string): string {
  return componentPath.replace(/\.(tsx?)$/, '.demo.$1');
}

/**
 * Get demo E2E test path
 */
export function getDemoE2ETestPath(componentPath: string): string {
  const componentName = path.basename(componentPath, path.extname(componentPath));
  return `tests/e2e/ui/${componentName}.demo.test.ts`;
}
