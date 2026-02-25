/**
 * Canvas Variant Generator
 *
 * Reads variants from canvas.json instead of generating .variants.tsx files.
 * Canvas instances serve as test variants for unit tests, e2e tests, and docs.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CanvasState,
  CanvasTestInteraction,
  InstanceConfig,
  InstanceTestConfig,
} from '../../../shared/types/canvas';
import { toInstanceConfig } from '../../../shared/types/canvas';
import type { ComponentAnalysis, CvaVariantInfo, PropDefinition, TestInteraction, TestVariant } from '../types';

/**
 * Common boolean props that should generate variants
 */
const VARIANT_BOOLEAN_PROPS = new Set([
  'disabled',
  'loading',
  'error',
  'readonly',
  'readOnly',
  'checked',
  'selected',
  'active',
  'open',
  'expanded',
  'focused',
  'hovered',
  'pressed',
  'required',
  'invalid',
  'indeterminate',
]);

/**
 * Convert CanvasTestInteraction to TestInteraction
 */
function toTestInteraction(interaction: CanvasTestInteraction): TestInteraction {
  return interaction as TestInteraction;
}

/**
 * Convert canvas instance to TestVariant
 */
function instanceToVariant(instanceId: string, instance: InstanceConfig): TestVariant {
  return {
    id: instanceId,
    name: instance.label || instanceId,
    description: instance.description || `${instanceId} variant`,
    props: instance.props,
    tags: instance.testConfig?.tags,
    skip: instance.testConfig?.skip,
    expectedTestIds: instance.testConfig?.expectedTestIds,
    interactions: instance.testConfig?.interactions?.map(toTestInteraction),
    render: () => null as unknown as JSX.Element,
  };
}

/**
 * Get TestVariant array from canvas.json for a component
 */
export function getVariantsFromCanvas(canvasState: CanvasState, componentPath: string): TestVariant[] {
  const composition = canvasState[componentPath];
  if (!composition) return [];

  return Object.entries(composition.instances)
    .map(([instanceId, instance]) => {
      const config = toInstanceConfig(instance);
      return instanceToVariant(instanceId, config);
    })
    .sort((a, b) => {
      // Sort: 'default' first, then alphabetically
      if (a.id === 'default') return -1;
      if (b.id === 'default') return 1;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Check if canvas.json has variants for a component
 */
export function hasCanvasVariants(canvasState: CanvasState, componentPath: string): boolean {
  const composition = canvasState[componentPath];
  return !!composition && Object.keys(composition.instances).length > 0;
}

/**
 * Load canvas.json from project directory
 */
export async function loadCanvasState(projectPath: string): Promise<CanvasState | null> {
  const canvasJsonPath = path.join(projectPath, '.hyperide', 'canvas.json');

  try {
    const content = await fs.readFile(canvasJsonPath, 'utf-8');
    return JSON.parse(content) as CanvasState;
  } catch {
    return null;
  }
}

/**
 * Save canvas.json to project directory
 */
export async function saveCanvasState(projectPath: string, state: CanvasState): Promise<void> {
  const canvasJsonPath = path.join(projectPath, '.hyperide', 'canvas.json');
  const dir = path.dirname(canvasJsonPath);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(canvasJsonPath, JSON.stringify(state, null, 2), 'utf-8');
}

// ============================================================================
// Variant Generation Logic (for canvas_auto_generate_variants tool)
// ============================================================================

/**
 * Generate variant ID from props
 */
function generateVariantId(props: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'boolean') {
      if (value) parts.push(key);
    } else if (typeof value === 'string') {
      parts.push(`${key}-${value}`);
    }
  }

  return parts.length > 0 ? parts.join('-') : 'default';
}

/**
 * Generate human-readable variant name
 */
function generateVariantName(props: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'boolean') {
      if (value) {
        parts.push(key.charAt(0).toUpperCase() + key.slice(1));
      }
    } else if (typeof value === 'string') {
      parts.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : 'Default';
}

/**
 * Generate variant description
 */
function generateVariantDescription(componentName: string, props: Record<string, unknown>): string {
  const conditions: string[] = [];

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'boolean' && value) {
      conditions.push(`${key} state`);
    } else if (typeof value === 'string') {
      conditions.push(`${key}="${value}"`);
    }
  }

  if (conditions.length === 0) {
    return `${componentName} in default state`;
  }

  return `${componentName} with ${conditions.join(' and ')}`;
}

/**
 * Generate all combinations of CVA variants
 */
function generateCvaCombinations(cvaVariants: CvaVariantInfo[]): Array<Record<string, string>> {
  if (cvaVariants.length === 0) return [{}];

  const combinations: Array<Record<string, string>> = [];

  function recurse(index: number, current: Record<string, string>): void {
    if (index >= cvaVariants.length) {
      combinations.push({ ...current });
      return;
    }

    const variant = cvaVariants[index];

    // Use default value for this combination
    if (variant.defaultValue) {
      current[variant.name] = variant.defaultValue;
      recurse(index + 1, current);
      delete current[variant.name];
    }

    // Also generate variants for non-default values
    for (const value of variant.values) {
      if (value !== variant.defaultValue) {
        current[variant.name] = value;
        recurse(index + 1, current);
        delete current[variant.name];
      }
    }
  }

  recurse(0, {});

  return combinations;
}

/**
 * Generate boolean prop combinations
 */
function generateBooleanCombinations(booleanProps: PropDefinition[]): Array<Record<string, boolean>> {
  if (booleanProps.length === 0) return [{}];

  const combinations: Array<Record<string, boolean>> = [];

  // Default (all false)
  combinations.push({});

  // Each boolean prop enabled individually
  for (const prop of booleanProps) {
    combinations.push({ [prop.name]: true });
  }

  // Common combinations: disabled + loading
  const hasDisabled = booleanProps.find((p) => p.name === 'disabled');
  const hasLoading = booleanProps.find((p) => p.name === 'loading');
  if (hasDisabled && hasLoading) {
    combinations.push({ disabled: true, loading: true });
  }

  return combinations;
}

export type VariantGenerationStrategy = 'minimal' | 'comprehensive';
export type VariantLayout = 'grid' | 'horizontal' | 'vertical';

export interface GenerateVariantsOptions {
  analysis: ComponentAnalysis;
  strategy?: VariantGenerationStrategy;
  layout?: VariantLayout;
  gridColumns?: number;
  spacing?: number;
  startX?: number;
  startY?: number;
}

export interface GeneratedVariant {
  id: string;
  label: string;
  description: string;
  props: Record<string, unknown>;
  x: number;
  y: number;
  testConfig?: InstanceTestConfig;
}

/**
 * Generate variant instances for canvas.json
 */
export function generateVariantsForCanvas(options: GenerateVariantsOptions): GeneratedVariant[] {
  const {
    analysis,
    strategy = 'minimal',
    layout = 'grid',
    gridColumns = 3,
    spacing = 300,
    startX = 100,
    startY = 100,
  } = options;

  const { componentName, cvaVariants, propsInterface } = analysis;

  // Extract boolean props
  const booleanProps = propsInterface?.props.filter((p) => p.isBoolean && VARIANT_BOOLEAN_PROPS.has(p.name)) || [];

  // Generate combinations based on strategy
  let cvaCombinations: Array<Record<string, string>>;
  let booleanCombinations: Array<Record<string, boolean>>;

  if (strategy === 'minimal') {
    // Only default + key states
    cvaCombinations = cvaVariants?.length
      ? [
          // Default
          Object.fromEntries(cvaVariants.filter((v) => v.defaultValue).map((v) => [v.name, v.defaultValue as string])),
          // One non-default per variant type
          ...cvaVariants.flatMap((v) =>
            v.values
              .filter((val) => val !== v.defaultValue)
              .slice(0, 1)
              .map((val) => ({ [v.name]: val })),
          ),
        ]
      : [{}];

    booleanCombinations = [{}, ...booleanProps.slice(0, 3).map((p) => ({ [p.name]: true }))];
  } else {
    // Comprehensive: all combinations
    cvaCombinations = generateCvaCombinations(cvaVariants || []);
    booleanCombinations = generateBooleanCombinations(booleanProps);
  }

  // Combine and generate variants
  const variants: GeneratedVariant[] = [];
  let index = 0;

  for (const cvaCombo of cvaCombinations) {
    for (const boolCombo of booleanCombinations) {
      const combinedProps = { ...cvaCombo, ...boolCombo };
      const id = generateVariantId(combinedProps);

      // Skip duplicates
      if (variants.some((v) => v.id === id)) continue;

      const label = generateVariantName(combinedProps);
      const description = generateVariantDescription(componentName, combinedProps);

      // Calculate position based on layout
      let x: number;
      let y: number;

      switch (layout) {
        case 'horizontal':
          x = startX + index * spacing;
          y = startY;
          break;
        case 'vertical':
          x = startX;
          y = startY + index * spacing;
          break;
        case 'grid':
          x = startX + (index % gridColumns) * spacing;
          y = startY + Math.floor(index / gridColumns) * spacing;
          break;
        default: {
          const _exhaustive: never = layout;
          throw new Error(`Unknown layout: ${_exhaustive}`);
        }
      }

      variants.push({
        id,
        label,
        description,
        props: combinedProps,
        x,
        y,
        testConfig: {
          tags: generateTags(combinedProps),
        },
      });

      index++;
    }
  }

  // Ensure default variant exists
  if (!variants.some((v) => v.id === 'default')) {
    variants.unshift({
      id: 'default',
      label: 'Default',
      description: `${componentName} in default state`,
      props: {},
      x: startX,
      y: startY,
      testConfig: {
        tags: ['default'],
      },
    });
  }

  return variants;
}

/**
 * Generate tags from props
 */
function generateTags(props: Record<string, unknown>): string[] {
  const tags: string[] = [];

  if (Object.keys(props).length === 0) {
    tags.push('default');
  }

  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'boolean' && value) {
      tags.push(key);
      if (key === 'disabled' || key === 'loading' || key === 'error') {
        tags.push('states');
      }
    } else if (typeof value === 'string') {
      tags.push(`${key}:${value}`);
    }
  }

  return tags;
}

/**
 * Add generated variants to canvas state
 */
export function addVariantsToCanvas(
  canvasState: CanvasState,
  componentPath: string,
  componentName: string,
  variants: GeneratedVariant[],
): CanvasState {
  const existingComposition = canvasState[componentPath];

  const newInstances: Record<string, InstanceConfig> = {};

  for (const variant of variants) {
    newInstances[variant.id] = {
      x: variant.x,
      y: variant.y,
      props: variant.props as Record<string, import('../../../shared/types/canvas').SerializableValue>,
      label: variant.label,
      description: variant.description,
      testConfig: variant.testConfig,
    };
  }

  return {
    ...canvasState,
    [componentPath]: {
      component: componentPath,
      componentName,
      instances: {
        ...existingComposition?.instances,
        ...newInstances,
      },
      viewport: existingComposition?.viewport || {
        zoom: 1,
        panX: 0,
        panY: 0,
      },
      annotations: existingComposition?.annotations || [],
    },
  };
}
