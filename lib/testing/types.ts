/**
 * Autogen Testing System - Type Definitions
 *
 * Core interfaces for automatic test generation with data-test-id
 */

import type { JSX } from 'react';

/**
 * Test runner/framework type detected from project
 */
export type TestRunner = 'bun' | 'vitest' | 'jest';

/**
 * Interactive element types that should receive data-test-id
 */
export type InteractiveElementType =
  | 'button'
  | 'input'
  | 'select'
  | 'textarea'
  | 'a'
  | 'checkbox'
  | 'radio'
  | 'switch'
  | 'slider'
  | 'dialog-trigger'
  | 'dropdown-trigger'
  | 'popover-trigger'
  | 'accordion-trigger'
  | 'tab-trigger'
  | 'menu-trigger'
  | 'combobox-trigger'
  | 'tooltip-trigger';

/**
 * Test interaction step for E2E tests
 */
export interface TestInteraction {
  /** Interaction type */
  type: 'click' | 'type' | 'hover' | 'focus' | 'blur' | 'select' | 'check' | 'uncheck' | 'wait' | 'press';
  /** Target selector (data-test-id or CSS selector) */
  target: string;
  /** Value for type/select actions */
  value?: string;
  /** Key for press action */
  key?: string;
  /** Delay in ms before this action */
  delay?: number;
  /** Expected result after action */
  expect?: {
    visible?: string;
    hidden?: string;
    text?: string;
    attribute?: { name: string; value: string };
    checked?: boolean;
    disabled?: boolean;
  };
}

/**
 * Test variant definition - represents a component state to test
 */
export interface TestVariant<Props = Record<string, unknown>> {
  /** Unique ID for this variant (e.g., 'default', 'disabled', 'loading') */
  id: string;
  /** Human-readable name (e.g., 'Default State') */
  name: string;
  /** Description for demo/documentation */
  description: string;
  /** Props to apply for this variant */
  props: Partial<Props>;
  /** Render function that returns the component */
  render: () => JSX.Element;
  /** Tags for filtering/grouping variants */
  tags?: string[];
  /** Skip this variant for certain test types */
  skip?: {
    unit?: boolean;
    e2e?: boolean;
    demo?: boolean;
    snapshot?: boolean;
  };
  /** Expected test IDs that should be present in this variant */
  expectedTestIds?: string[];
  /** Interaction sequence for E2E testing */
  interactions?: TestInteraction[];
}

/**
 * Discovered interactive element in a component
 */
export interface InteractiveElement {
  /** Type of interactive element */
  type: InteractiveElementType;
  /** Suggested data-test-id based on context */
  suggestedTestId: string;
  /** JSX element tag name */
  tagName: string;
  /** Line number in source file */
  line: number;
  /** Column number in source file */
  column: number;
  /** Context extracted for naming */
  context: {
    /** aria-label attribute value */
    ariaLabel?: string;
    /** placeholder attribute value */
    placeholder?: string;
    /** Text content from children */
    children?: string;
    /** name attribute value */
    name?: string;
    /** type attribute for inputs */
    inputType?: string;
    /** role attribute */
    role?: string;
    /** onClick/onChange handler name */
    handler?: string;
  };
  /** Existing data-test-id if any */
  existingTestId?: string;
  /** Existing data-uniq-id if any */
  existingUniqId?: string;
}

/**
 * Props interface info extracted from component
 */
export interface PropsInterfaceInfo {
  /** Interface/type name */
  name: string;
  /** Individual prop definitions */
  props: PropDefinition[];
  /** Line where interface starts */
  line: number;
}

/**
 * Single prop definition
 */
export interface PropDefinition {
  /** Prop name */
  name: string;
  /** TypeScript type as string */
  type: string;
  /** Is this prop optional? */
  optional: boolean;
  /** Default value if any */
  defaultValue?: string;
  /** JSDoc comment */
  description?: string;
  /** Is this a boolean prop? (useful for variant generation) */
  isBoolean: boolean;
  /** Union type values if applicable (useful for variant generation) */
  unionValues?: string[];
}

/**
 * CVA (class-variance-authority) variant info
 */
export interface CvaVariantInfo {
  /** Variant prop name (e.g., 'variant', 'size') */
  name: string;
  /** Possible values */
  values: string[];
  /** Default value */
  defaultValue?: string;
}

/**
 * Component analysis result
 */
export interface ComponentAnalysis {
  /** Component file path */
  filePath: string;
  /** Component name */
  componentName: string;
  /** Props interface info */
  propsInterface?: PropsInterfaceInfo;
  /** CVA variants if using class-variance-authority */
  cvaVariants?: CvaVariantInfo[];
  /** Interactive elements found */
  interactiveElements: InteractiveElement[];
  /** Existing sampleRender function */
  hasSampleRender: boolean;
  /** Existing sampleRenderers object */
  hasSampleRenderers: boolean;
  /** Existing test file */
  hasTestFile: boolean;
  /** Exports list */
  exports: string[];
}

/**
 * Component test metadata (aggregated result for test generation)
 */
export interface ComponentTestMeta {
  /** Component file path */
  componentPath: string;
  /** Component name */
  componentName: string;
  /** Props interface */
  propsInterface?: PropsInterfaceInfo;
  /** CVA variants */
  cvaVariants?: CvaVariantInfo[];
  /** Interactive elements with final test IDs */
  interactiveElements: InteractiveElement[];
  /** Generated test variants */
  variants: TestVariant[];
  /** Generation timestamp */
  generatedAt: number;
  /** Generator version */
  generatorVersion: string;
}

/**
 * Test generation options
 */
export interface TestGenerationOptions {
  /** Target component path or glob pattern */
  target: string;
  /** Types of tests to generate */
  types: ('unit' | 'e2e' | 'variants' | 'demo' | 'snapshot')[];
  /** Overwrite existing files */
  force?: boolean;
  /** Generate visual snapshots */
  snapshots?: boolean;
  /** Prefix for generated test IDs */
  testIdPrefix?: string;
  /** Output directory for generated tests */
  outputDir?: string;
  /** Skip components that already have tests */
  skipExisting?: boolean;
}

/**
 * Test generation result
 */
export interface TestGenerationResult {
  /** Component path */
  componentPath: string;
  /** Generated files */
  generatedFiles: {
    path: string;
    type: 'unit' | 'e2e' | 'variants' | 'demo';
  }[];
  /** Interactive elements found */
  interactiveElementsCount: number;
  /** Variants generated (total) */
  variantsCount: number;
  /** Variants loaded from canvas.json */
  canvasVariantsCount?: number;
  /** Warnings during generation */
  warnings: string[];
  /** Errors during generation */
  errors: string[];
}

/**
 * Demo configuration for auto-run showcase
 */
export interface DemoConfig {
  /** Component name */
  componentName: string;
  /** Variant IDs to cycle through */
  variants: string[];
  /** Interval between variants in ms */
  interval: number;
  /** Interactions to perform during demo */
  interactions?: {
    variant: string;
    actions: TestInteraction[];
  }[];
  /** Auto-start demo on load */
  autoStart?: boolean;
  /** Loop demo continuously */
  loop?: boolean;
}

/**
 * Registry entry for discovered tests
 */
export interface TestRegistryEntry {
  /** Component path */
  componentPath: string;
  /** Component name */
  componentName: string;
  /** Available test files */
  testFiles: {
    unit?: string;
    e2e?: string;
    demo?: string;
  };
  /** Variant count */
  variantCount: number;
  /** Interactive element count */
  interactiveElementCount: number;
  /** Last generated timestamp */
  lastGenerated?: number;
}
