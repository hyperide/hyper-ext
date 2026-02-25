#!/usr/bin/env bun
/**
 * CLI for generating tests
 *
 * Usage:
 *   bun run lib/testing/cli/generate-tests.ts [options] <target>
 *
 * Options:
 *   --type <type>    Test type: unit, e2e, variants, demo, all (default: all)
 *   --force          Overwrite existing files
 *   --dry-run        Show what would be generated without writing
 *   --help           Show help
 *
 * Examples:
 *   bun run lib/testing/cli/generate-tests.ts client/components/ui/button.tsx
 *   bun run lib/testing/cli/generate-tests.ts --type unit client/components/ui/*.tsx
 *   bun run lib/testing/cli/generate-tests.ts --dry-run client/components/ui/
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { glob } from 'glob';

import { analyzeComponent } from '../analyzers/component-analyzer';
import {
  getVariantsFromCanvas,
  hasCanvasVariants,
  loadCanvasState,
} from '../generators/canvas-variant-generator';
import { generateDemoE2ETest, generateDemoScriptContent, getDemoE2ETestPath, getDemoPath } from '../generators/demo-generator';
import { generateE2ETestContent, getE2ETestPath } from '../generators/e2e-test-generator';
import { generateUnitTestContent, getUnitTestPath } from '../generators/unit-test-generator';
import type { TestGenerationResult, TestVariant } from '../types';
import { detectTestRunner } from '../utils/detect-test-runner';

interface CliOptions {
  types: ('unit' | 'e2e' | 'variants' | 'demo')[];
  force: boolean;
  dryRun: boolean;
  help: boolean;
  targets: string[];
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    types: ['unit', 'e2e', 'variants', 'demo'],
    force: false,
    dryRun: false,
    help: false,
    targets: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (arg === '--dry-run' || arg === '-d') {
      options.dryRun = true;
    } else if (arg === '--type' || arg === '-t') {
      i++;
      const type = args[i];
      if (type === 'all') {
        options.types = ['unit', 'e2e', 'variants', 'demo'];
      } else if (['unit', 'e2e', 'variants', 'demo'].includes(type)) {
        options.types = [type as 'unit' | 'e2e' | 'variants' | 'demo'];
      } else {
        console.error(`Unknown type: ${type}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      options.targets.push(arg);
    }

    i++;
  }

  return options;
}

function showHelp(): void {
  // nosemgrep: unsafe-formatstring
  console.log(`
Autogen Testing CLI

Usage:
  bun run lib/testing/cli/generate-tests.ts [options] <target>

Options:
  --type, -t <type>  Test type: unit, e2e, variants, demo, all (default: all)
  --force, -f        Overwrite existing files
  --dry-run, -d      Show what would be generated without writing
  --help, -h         Show this help

Examples:
  bun run lib/testing/cli/generate-tests.ts client/components/ui/button.tsx
  bun run lib/testing/cli/generate-tests.ts --type unit client/components/ui/*.tsx
  bun run lib/testing/cli/generate-tests.ts --dry-run client/components/ui/

Supported targets:
  - Single file:     client/components/ui/button.tsx
  - Glob pattern:    client/components/ui/*.tsx
  - Directory:       client/components/ui/
`);
}

async function resolveTargets(targets: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const target of targets) {
    // Check if it's a directory
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        // Find all .tsx files in directory
        const dirFiles = await glob(`${target}/**/*.tsx`, {
          ignore: ['**/*.test.tsx', '**/*.spec.tsx', '**/*.demo.tsx', '**/*.variants.tsx'],
        });
        files.push(...dirFiles);
        continue;
      }
    } catch {
      // Not a directory, might be a glob pattern
    }

    // Try as glob pattern
    if (target.includes('*')) {
      const globFiles = await glob(target, {
        ignore: ['**/*.test.tsx', '**/*.spec.tsx', '**/*.demo.tsx', '**/*.variants.tsx'],
      });
      files.push(...globFiles);
    } else {
      // Single file
      files.push(target);
    }
  }

  // Remove duplicates and sort
  return [...new Set(files)].sort();
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFile(filePath: string, content: string, options: CliOptions): Promise<void> {
  if (options.dryRun) {
    console.log(`  [DRY-RUN] Would write: ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    return;
  }

  // Create directory if needed
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  await fs.writeFile(filePath, content, 'utf-8');
  console.log(`  ✓ Written: ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
}

async function generateForComponent(
  componentPath: string,
  options: CliOptions,
): Promise<TestGenerationResult> {
  const result: TestGenerationResult = {
    componentPath,
    generatedFiles: [],
    interactiveElementsCount: 0,
    variantsCount: 0,
    warnings: [],
    errors: [],
  };

  console.log(`\nProcessing: ${componentPath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  try {
    // Analyze component
    const analysis = await analyzeComponent(componentPath);
    result.interactiveElementsCount = analysis.interactiveElements.length;

    console.log(`  Found ${analysis.interactiveElements.length} interactive elements`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    if (analysis.cvaVariants?.length) {
      console.log(`  Found CVA variants: ${analysis.cvaVariants.map(v => v.name).join(', ')}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    }

    // Determine project root for canvas.json
    const absolutePath = path.resolve(componentPath);
    const projectRoot = absolutePath.includes('/src/')
      ? absolutePath.split('/src/')[0]
      : absolutePath.includes('/client/')
        ? absolutePath.split('/client/')[0]
        : path.dirname(absolutePath);

    // Load canvas variants
    let canvasVariants: TestVariant[] | undefined;
    const canvasState = await loadCanvasState(projectRoot);
    if (canvasState) {
      const relativeComponentPath = path.relative(projectRoot, absolutePath);
      if (hasCanvasVariants(canvasState, relativeComponentPath)) {
        canvasVariants = getVariantsFromCanvas(canvasState, relativeComponentPath);
        console.log(`  Canvas variants: ${canvasVariants.length}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        result.canvasVariantsCount = canvasVariants.length;
        result.variantsCount = canvasVariants.length;
      } else {
        console.log(`  Canvas: no variants for this component`); // nosemgrep: unsafe-formatstring
      }
    } else {
      console.log(`  Canvas: .hyperide/canvas.json not found`); // nosemgrep: unsafe-formatstring
    }

    // variants.tsx generation is deprecated - use canvas.json instead
    if (options.types.includes('variants')) {
      console.log(`  [DEPRECATED] variants.tsx generation is deprecated. Use canvas.json instances instead.`); // nosemgrep: unsafe-formatstring
      result.warnings.push('variants.tsx generation is deprecated. Use canvas.json instances instead.');
    }

    // Generate unit tests
    if (options.types.includes('unit')) {
      const unitTestPath = getUnitTestPath(componentPath);
      const exists = await fileExists(unitTestPath);

      if (!exists || options.force) {
        const testRunner = await detectTestRunner(absolutePath);
        const content = generateUnitTestContent({
          analysis,
          testRunner,
          variants: canvasVariants,
        });
        await writeFile(unitTestPath, content, options);
        result.generatedFiles.push({ path: unitTestPath, type: 'unit' });
      } else {
        console.log(`  [SKIP] Unit test exists: ${unitTestPath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
    }

    // Generate E2E tests
    if (options.types.includes('e2e')) {
      const e2eTestPath = getE2ETestPath(componentPath);
      const exists = await fileExists(e2eTestPath);

      if (!exists || options.force) {
        const content = generateE2ETestContent({
          analysis,
          variants: canvasVariants,
        });
        await writeFile(e2eTestPath, content, options);
        result.generatedFiles.push({ path: e2eTestPath, type: 'e2e' });
      } else {
        console.log(`  [SKIP] E2E test exists: ${e2eTestPath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
    }

    // Generate demo
    if (options.types.includes('demo')) {
      const demoPath = getDemoPath(componentPath);
      const exists = await fileExists(demoPath);

      if (!exists || options.force) {
        const content = generateDemoScriptContent(analysis);
        await writeFile(demoPath, content, options);
        result.generatedFiles.push({ path: demoPath, type: 'demo' });
      } else {
        console.log(`  [SKIP] Demo file exists: ${demoPath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }

      // Demo E2E test
      const demoE2EPath = getDemoE2ETestPath(componentPath);
      const demoE2EExists = await fileExists(demoE2EPath);

      if (!demoE2EExists || options.force) {
        const content = generateDemoE2ETest(analysis);
        await writeFile(demoE2EPath, content, options);
        result.generatedFiles.push({ path: demoE2EPath, type: 'e2e' });
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    console.error(`  ✗ Error: ${errorMessage}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  }

  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help || options.targets.length === 0) {
    showHelp();
    process.exit(options.help ? 0 : 1);
  }

  console.log('Autogen Testing CLI');
  console.log('==================');
  console.log(`Types: ${options.types.join(', ')}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  console.log(`Force: ${options.force}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  console.log(`Dry run: ${options.dryRun}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  // Resolve targets to actual files
  const files = await resolveTargets(options.targets);

  if (files.length === 0) {
    console.error('\nNo matching files found');
    process.exit(1);
  }

  console.log(`\nFound ${files.length} component(s) to process`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string

  const results: TestGenerationResult[] = [];

  for (const file of files) {
    const result = await generateForComponent(file, options);
    results.push(result);
  }

  // Summary
  console.log('\n==================');
  console.log('Summary');
  console.log('==================');

  const totalGenerated = results.reduce((sum, r) => sum + r.generatedFiles.length, 0);
  const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);
  const totalInteractive = results.reduce((sum, r) => sum + r.interactiveElementsCount, 0);
  const totalCanvasVariants = results.reduce((sum, r) => sum + (r.canvasVariantsCount || 0), 0);
  const componentsWithCanvas = results.filter(r => (r.canvasVariantsCount || 0) > 0).length;

  console.log(`Components processed: ${results.length}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  console.log(`Files generated: ${totalGenerated}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  console.log(`Interactive elements found: ${totalInteractive}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  console.log(`Canvas variants used: ${totalCanvasVariants}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  if (componentsWithCanvas > 0) {
    console.log(`Components with canvas: ${componentsWithCanvas}/${results.length}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  }

  if (totalErrors > 0) {
    console.log(`Errors: ${totalErrors}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    process.exit(1);
  }

  console.log('\nDone!');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
