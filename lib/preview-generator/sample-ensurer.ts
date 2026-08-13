/**
 * Generalized sample component ensurer.
 * Checks if a given Sample* export exists in a co-located .samples.tsx file
 * (or the component itself for backward compat), and generates it via an
 * injectable AI callback if missing. Samples are written to a separate
 * ComponentName.samples.tsx file — not appended to the component.
 *
 * Works in both Node.js (server) and VS Code extension via FileIO abstraction.
 */

import { basename, dirname, join } from 'node:path';
import type { FileIO } from '../ast/file-io';
import { buildDeterministicContainerSampleScaffold } from './sample-scaffold';
import { detectCompoundExports, escapeRegex, scanSampleExports } from './scanner';

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

function guessChildContent(name: string): string | null {
  if (/Title/i.test(name)) return 'Heads up!';
  if (/Description|Content|Body/i.test(name)) return 'Something important happened.';
  if (/Action|Button|Footer/i.test(name)) return 'Dismiss';
  if (/Icon|Indicator/i.test(name)) return null;
  return name;
}

/** Build a deterministic container sample wrapping compound component children. */
export function buildContainerSample(componentName: string, compoundComponents: string[], sampleName: string): string {
  const children = compoundComponents
    .map((child) => {
      const content = guessChildContent(child);
      return content === null ? `      <${child} />` : `      <${child}>${content}</${child}>`;
    })
    .join('\n');
  return `export function ${sampleName}() {\n  return (\n    <${componentName}>\n${children}\n    </${componentName}>\n  );\n}`;
}

/**
 * Try to build a deterministic sample for a container component using its compound siblings.
 * Returns null if no compound siblings are found (AI generation should be used instead).
 */
export function tryDeterministicContainerSample(
  sourceCode: string,
  componentName: string,
  sampleName: string,
): string | null {
  const compounds = detectCompoundExports(sourceCode, componentName);
  if (compounds.length === 0) return null;
  return buildContainerSample(componentName, compounds, sampleName);
}

/**
 * Returns the path to the co-located .samples.tsx file for a component.
 *   /path/to/Button.tsx → /path/to/Button.samples.tsx
 *   /path/to/index.tsx  → /path/to/index.samples.tsx
 *
 * The .samples.tsx suffix is excluded from the preview registry by the
 * isPreviewIneligibleByName name-guard and is git-excluded via ensureGitExclude.
 */
export function getSampleFilePath(componentPath: string): string {
  const dir = dirname(componentPath);
  const stem = basename(componentPath).replace(/\.(tsx?|jsx?)$/, '');
  return join(dir, `${stem}.samples.tsx`);
}

/**
 * Ensure a component has a specific Sample* export in its co-located
 * .samples.tsx file. Falls back to checking the component itself for
 * backward compat (samples written by the old append-to-component system).
 * New samples are always written to .samples.tsx, never to the component.
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

  const sampleFilePath = getSampleFilePath(absolutePath);

  // Check .samples.tsx first (new system)
  const existingSampleCode = await readFileSafe(io, sampleFilePath);
  if (existingSampleCode !== null) {
    // babel can throw on mid-edit source despite `errorRecovery: true`; treat as absent
    // rather than surfacing a parse error during auto-sample generation.
    try {
      if (scanSampleExports(existingSampleCode).includes(sampleName)) {
        return { generated: false, exists: true };
      }
    } catch {
      // .samples.tsx is temporarily unparseable — proceed to (re)generate below
    }
  }

  // Backward compat: check the component itself (old append-to-component system)
  if (scanSampleExports(sourceCode).includes(sampleName)) {
    return { generated: false, exists: true };
  }

  const deterministicCode = buildDeterministicContainerSampleScaffold({
    sourceCode,
    componentName,
    exportName: sampleName,
  });
  if (deterministicCode) {
    // Compound samples reference the container + all its compound children.
    // Pass all names so writeSampleCode can build the import line on first write.
    const compoundNames = detectCompoundExports(sourceCode, componentName);
    const referencedNames = [componentName, ...compoundNames];
    return writeSampleCode(
      io,
      sampleFilePath,
      existingSampleCode,
      deterministicCode.trimStart(),
      componentName,
      sampleName,
      'deterministic',
      referencedNames,
    );
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

  return writeSampleCode(io, sampleFilePath, existingSampleCode, generatedCode, componentName, sampleName, 'AI');
}

async function readFileSafe(io: FileIO, path: string): Promise<string | null> {
  try {
    return await io.readFile(path);
  } catch {
    return null;
  }
}

/**
 * Build a named import line for the component and its compound children.
 *
 * The module specifier is derived from the .samples.tsx filename (not from
 * componentName) to preserve the original file casing — critical on case-sensitive
 * file systems where `alert.tsx` exports `Alert` but `import from './Alert'` fails.
 *
 * Example: /project/src/alert.samples.tsx → `import { Alert, AlertTitle, AlertDescription } from './alert';`
 */
function buildSamplesFileImportLine(sampleFilePath: string, referencedNames: string[]): string {
  const stem = basename(sampleFilePath).replace(/\.samples\.(tsx?|jsx?)$/, '');
  return `import { ${referencedNames.join(', ')} } from './${stem}';`;
}

async function writeSampleCode(
  io: FileIO,
  sampleFilePath: string,
  existingContent: string | null,
  newCode: string,
  componentName: string,
  sampleName: string,
  source: 'deterministic' | 'AI',
  /** Names the generated code references (container + compound children). Only used on first write. */
  referencedNames?: string[],
): Promise<EnsureSampleResult> {
  let updatedContent: string;
  if (existingContent !== null) {
    updatedContent = `${existingContent.trimEnd()}\n\n${newCode}\n`;
  } else {
    // First write: prepend a component import so the sample can reference the component.
    // Only added when referencedNames is provided (deterministic path) and the generated
    // code has no existing import statement (guard against double-import).
    const hasExistingImport = /^import\s/m.test(newCode);
    const needsImport = referencedNames && referencedNames.length > 0 && !hasExistingImport;
    const importLine = needsImport ? `${buildSamplesFileImportLine(sampleFilePath, referencedNames)}\n\n` : '';
    updatedContent = `${importLine}${newCode}\n`;
  }
  try {
    await io.writeFile(sampleFilePath, updatedContent);
    const label = source === 'deterministic' ? 'deterministic ' : '';
    console.log(`[ensureSample] Generated ${label}${sampleName} for ${componentName} → ${basename(sampleFilePath)}`);
    return { generated: true, exists: true };
  } catch (error) {
    console.error(`[ensureSample] Failed to write: ${error}`);
    return { generated: false, exists: false };
  }
}

/**
 * Validate AI-generated sample code before writing.
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
