/**
 * Autogen Testing System
 *
 * Public API for automatic test generation with data-test-id
 */

// Types
export type {
  ComponentAnalysis,
  ComponentTestMeta,
  CvaVariantInfo,
  DemoConfig,
  InteractiveElement,
  InteractiveElementType,
  PropDefinition,
  PropsInterfaceInfo,
  TestGenerationOptions,
  TestGenerationResult,
  TestInteraction,
  TestRegistryEntry,
  TestRunner,
  TestVariant,
} from './types';

// Analyzers
export { analyzeComponent, analyzeComponents } from './analyzers/component-analyzer';
export {
  detectInteractiveElement,
  findInteractiveElements,
  isInteractiveElement,
} from './analyzers/interactive-detector';

// Generators
export {
  getVariantsFromCanvas,
  hasCanvasVariants,
  loadCanvasState,
  saveCanvasState,
  generateVariantsForCanvas,
  addVariantsToCanvas,
} from './generators/canvas-variant-generator';

export type {
  VariantGenerationStrategy,
  VariantLayout,
  GenerateVariantsOptions,
  GeneratedVariant,
} from './generators/canvas-variant-generator';

export {
  generateUnitTestContent,
  getUnitTestPath,
  isBun,
} from './generators/unit-test-generator';

export type {
  UnitTestGeneratorOptions,
} from './generators/unit-test-generator';

export {
  generateE2ETestContent,
  getE2ETestPath,
  generatePlaywrightConfigSnippet,
} from './generators/e2e-test-generator';

export type {
  E2ETestGeneratorOptions,
} from './generators/e2e-test-generator';

export {
  generateComponentDocs,
  getDocsPath,
} from './generators/docs-generator';

export type {
  DocsGeneratorOptions,
  DocsFormat,
} from './generators/docs-generator';

export {
  generateDemoConfig,
  generateDemoScriptContent,
  generateDemoStyles,
  generateDemoE2ETest,
  getDemoPath,
  getDemoE2ETestPath,
} from './generators/demo-generator';

// Utils
export {
  toKebabCase,
  cleanTextForId,
  resolveCollision,
  generateSemanticTestId,
  isValidTestId,
  suggestTestIdFix,
  elementTypeToRole,
  getInputRole,
} from './utils/naming';

export {
  detectTestRunner,
  getTestImportForRunner,
} from './utils/detect-test-runner';
