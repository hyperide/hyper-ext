/**
 * Generalized sample component ensurer.
 * Checks if a given Sample* export exists in a component file,
 * and generates it via an injectable AI callback if missing.
 *
 * Works in both Node.js (server) and VS Code extension via FileIO abstraction.
 */

import type { FileIO } from '../ast/file-io';
import { escapeRegex, scanSampleExports } from './scanner';

/**
 * AI callback type: receives component source and metadata,
 * returns generated code string (just the export + any new imports)
 * or null if generation failed.
 */
export type SampleGeneratorFn = (
  sourceCode: string,
  componentName: string,
  sampleName: string,
) => Promise<string | null>;

export interface EnsureSampleConfig {
  io: FileIO;
  /** Absolute path to the component file */
  absolutePath: string;
  /** PascalCase component name */
  componentName: string;
  /** Sample export name, e.g. 'SampleDefault', 'SamplePrimary' */
  sampleName: string;
  /** AI generation callback — injected by server or extension */
  generate: SampleGeneratorFn;
}

export interface EnsureSampleResult {
  /** Whether the sample was generated (false if already existed or generation failed) */
  generated: boolean;
  /** Whether the sample exists after the operation */
  exists: boolean;
}

/**
 * Ensure a component file has a specific Sample* export.
 * If missing, generates it via the AI callback and appends to the file.
 */
export async function ensureSample(config: EnsureSampleConfig): Promise<EnsureSampleResult> {
  const { io, absolutePath, componentName, sampleName, generate } = config;

  let sourceCode: string;
  try {
    sourceCode = await io.readFile(absolutePath);
  } catch {
    console.warn(`[ensureSample] Could not read component: ${absolutePath}`);
    return { generated: false, exists: false };
  }

  // Skip empty or very small files (likely corrupted)
  if (sourceCode.trim().length < 50) {
    return { generated: false, exists: false };
  }

  // Check if sample already exists
  const existingSamples = scanSampleExports(sourceCode);
  if (existingSamples.includes(sampleName)) {
    return { generated: false, exists: true };
  }

  // Generate via AI callback
  let generatedCode: string | null;
  try {
    generatedCode = await generate(sourceCode, componentName, sampleName);
  } catch (error) {
    // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    console.error(`[ensureSample] AI generation failed for ${sampleName}:`, error);
    return { generated: false, exists: false };
  }

  if (!generatedCode) {
    return { generated: false, exists: false };
  }

  // Validate generated code
  const validationError = validateGeneratedSample(generatedCode, sampleName, sourceCode);
  if (validationError) {
    console.error(`[ensureSample] Validation failed: ${validationError}`);
    return { generated: false, exists: false };
  }

  // Append to file
  const updatedCode = `${sourceCode}\n\n${generatedCode}\n`;
  try {
    await io.writeFile(absolutePath, updatedCode);
    console.log(`[ensureSample] Generated ${sampleName} for ${componentName}`);
    return { generated: true, exists: true };
  } catch (error) {
    console.error(`[ensureSample] Failed to write: ${error}`);
    return { generated: false, exists: false };
  }
}

/**
 * Validate AI-generated sample code before appending.
 * Returns error message string if invalid, null if valid.
 */
function validateGeneratedSample(code: string, sampleName: string, existingSource: string): string | null {
  // Must start with export or import
  if (!code.startsWith('export') && !code.startsWith('import')) {
    return 'Generated code does not start with export or import';
  }

  // No test utilities
  if (
    code.includes('jest.mock') ||
    code.includes('vitest.mock') ||
    code.includes('as jest.Mock') ||
    code.includes('as Mock')
  ) {
    return 'Generated code contains forbidden test utilities (jest/vitest)';
  }

  // Must contain the expected sample export
  const escaped = escapeRegex(sampleName);
  // nosemgrep: detect-non-literal-regexp -- sampleName is escaped internal identifier, not user input
  const sampleExportRe = new RegExp(`export\\s+(?:const|function)\\s+${escaped}\\b`);
  if (!sampleExportRe.test(code)) {
    return `Generated code does not contain 'export const/function ${sampleName}'`;
  }

  // No duplicate sample exports
  // nosemgrep: detect-non-literal-regexp -- sampleName is escaped internal identifier, not user input
  const sampleMatches = code.match(new RegExp(`export\\s+(?:const|function)\\s+${escaped}\\b`, 'g'));
  if (sampleMatches && sampleMatches.length > 1) {
    return `Generated code contains duplicate ${sampleName} exports`;
  }

  // Check if generated code tries to import the component itself
  const componentNameMatch =
    existingSource.match(/export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)/) ||
    existingSource.match(/export\s+default\s+(\w+)/);
  if (componentNameMatch) {
    const actualComponentName = componentNameMatch[1];
    const generatedImports = code.match(/^import .+ from .+;$/gm) || [];
    for (const genImport of generatedImports) {
      if (genImport.includes(actualComponentName) && !genImport.includes("from 'react")) {
        return `Generated code tries to import the component itself (${actualComponentName})`;
      }
    }
  }

  return null;
}
