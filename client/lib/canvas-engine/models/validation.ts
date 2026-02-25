/**
 * Zod validation schemas for Canvas Engine types
 */

import { z } from 'zod';

/**
 * Field type schema
 */
export const fieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'radio',
  'color',
  'date',
  'custom',
]);

/**
 * Base field definition schema
 */
const baseFieldSchema = z.object({
  type: fieldTypeSchema,
  label: z.string().optional(),
  defaultValue: z.any().optional(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  description: z.string().optional(),
});

/**
 * Text field schema
 */
export const textFieldSchema = baseFieldSchema.extend({
  type: z.enum(['text', 'textarea']),
  placeholder: z.string().optional(),
  maxLength: z.number().positive().optional(),
  minLength: z.number().nonnegative().optional(),
  pattern: z.string().optional(),
});

/**
 * Number field schema
 */
export const numberFieldSchema = baseFieldSchema.extend({
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
});

/**
 * Boolean field schema
 */
export const booleanFieldSchema = baseFieldSchema.extend({
  type: z.literal('boolean'),
});

/**
 * Select field schema
 */
export const selectFieldSchema = baseFieldSchema.extend({
  type: z.enum(['select', 'radio']),
  options: z.union([z.array(z.object({ label: z.string(), value: z.any() })), z.array(z.any())]),
});

/**
 * Color field schema
 */
export const colorFieldSchema = baseFieldSchema.extend({
  type: z.literal('color'),
});

/**
 * Date field schema
 */
export const dateFieldSchema = baseFieldSchema.extend({
  type: z.literal('date'),
  min: z.string().optional(),
  max: z.string().optional(),
});

/**
 * Custom field schema
 */
export const customFieldSchema = baseFieldSchema.extend({
  type: z.literal('custom'),
  render: z.function(),
});

/**
 * Field definition schema (discriminated union)
 */
export const fieldDefinitionSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  selectFieldSchema,
  colorFieldSchema,
  dateFieldSchema,
  customFieldSchema,
]);

/**
 * Fields map schema
 */
export const fieldsMapSchema = z.record(z.string(), fieldDefinitionSchema);

/**
 * Component definition schema
 */
export const componentDefinitionSchema = z.object({
  type: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Type must be valid identifier'),
  label: z.string().min(1),
  category: z.string().optional(),
  fields: fieldsMapSchema,
  defaultProps: z.record(z.string(), z.any()),
  render: z.function(),
  canHaveChildren: z.boolean().optional(),
  allowedParents: z.array(z.string()).optional(),
  allowedChildren: z.array(z.string()).optional(),
  icon: z.any().optional(),
  hidden: z.boolean().optional(),
});

/**
 * Component instance schema
 */
export const componentInstanceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  props: z.record(z.string(), z.any()),
  parentId: z.string().nullable(),
  children: z.array(z.string()),
  metadata: z
    .object({
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
    })
    .catchall(z.any())
    .optional(),
});

/**
 * Document tree schema
 */
export const documentTreeSchema = z.object({
  rootId: z.string().min(1),
  instances: z.record(z.string(), componentInstanceSchema),
  version: z.number().int().nonnegative(),
});

/**
 * Selection state schema
 */
export const selectionStateSchema = z.object({
  selectedIds: z.array(z.string()),
  hoveredId: z.string().nullable(),
});

/**
 * History state schema
 */
export const historyStateSchema = z.object({
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  position: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});

/**
 * Canvas engine config schema
 */
export const canvasEngineConfigSchema = z.object({
  onStateChange: z.function().optional(),
  maxHistoryLength: z.number().int().positive().optional().default(100),
  initialTree: documentTreeSchema.partial().optional(),
  debug: z.boolean().optional().default(false),
});

/**
 * Operation result schema
 */
export const operationResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  changedIds: z.array(z.string()).optional(),
});
