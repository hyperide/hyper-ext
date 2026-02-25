/**
 * Autogen Testing System
 *
 * Public API for automatic test generation with data-test-id
 */

// Analyzers
export { analyzeComponent, analyzeComponents } from './analyzers/component-analyzer';
export {
  detectInteractiveElement,
  findInteractiveElements,
  isInteractiveElement,
} from './analyzers/interactive-detector';
export type {
  GeneratedVariant,
  GenerateVariantsOptions,
  VariantGenerationStrategy,
  VariantLayout,
} from './generators/canvas-variant-generator';

// Generators
export {
  addVariantsToCanvas,
  generateVariantsForCanvas,
  getVariantsFromCanvas,
  hasCanvasVariants,
  loadCanvasState,
  saveCanvasState,
} from './generators/canvas-variant-generator';
export {
  generateDemoConfig,
  generateDemoE2ETest,
  generateDemoScriptContent,
  generateDemoStyles,
  getDemoE2ETestPath,
  getDemoPath,
} from './generators/demo-generator';
export type {
  DocsFormat,
  DocsGeneratorOptions,
} from './generators/docs-generator';
export {
  generateComponentDocs,
  getDocsPath,
} from './generators/docs-generator';
export type { E2ETestGeneratorOptions } from './generators/e2e-test-generator';
export {
  generateE2ETestContent,
  generatePlaywrightConfigSnippet,
  getE2ETestPath,
} from './generators/e2e-test-generator';
export type { UnitTestGeneratorOptions } from './generators/unit-test-generator';
export {
  generateUnitTestContent,
  getUnitTestPath,
  isBun,
} from './generators/unit-test-generator';
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
export {
  detectTestRunner,
  getTestImportForRunner,
} from './utils/detect-test-runner';
// Utils
export {
  cleanTextForId,
  elementTypeToRole,
  generateSemanticTestId,
  getInputRole,
  isValidTestId,
  resolveCollision,
  suggestTestIdFix,
  toKebabCase,
} from './utils/naming';
