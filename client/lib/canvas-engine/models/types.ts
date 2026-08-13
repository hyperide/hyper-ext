/**
 * Core types for Canvas Engine
 */

import type React from 'react';
import type { ReactNode } from 'react';
import type { ServerSyncConfig } from '../core/ServerSyncManager';

/**
 * Supported field types for component properties
 */
export type FieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'radio' | 'color' | 'date' | 'custom';

/**
 * Base field definition
 */
export interface BaseFieldDefinition<T = unknown> {
  type: FieldType;
  label?: string;
  defaultValue?: T;
  required?: boolean;
  readOnly?: boolean;
  description?: string;
}

/**
 * Text field definition
 */
export interface TextFieldDefinition extends BaseFieldDefinition<string> {
  type: 'text' | 'textarea';
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
}

/**
 * Number field definition
 */
export interface NumberFieldDefinition extends BaseFieldDefinition<number> {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Boolean field definition
 */
export interface BooleanFieldDefinition extends BaseFieldDefinition<boolean> {
  type: 'boolean';
}

/**
 * Select/Radio field definition
 */
export interface SelectFieldDefinition<T = string> extends BaseFieldDefinition<T> {
  type: 'select' | 'radio';
  options: { label: string; value: T }[] | T[];
}

/**
 * Color field definition
 */
export interface ColorFieldDefinition extends BaseFieldDefinition<string> {
  type: 'color';
}

/**
 * Date field definition
 */
export interface DateFieldDefinition extends BaseFieldDefinition<string> {
  type: 'date';
  min?: string;
  max?: string;
}

/**
 * Custom field definition with render function
 */
export interface CustomFieldDefinition<T = unknown> extends BaseFieldDefinition<T> {
  type: 'custom';
  render: (props: {
    value: T;
    onChange: (value: T) => void;
    field: CustomFieldDefinition<T>;
    readOnly?: boolean;
  }) => ReactNode;
}

/**
 * Union of all field definitions
 */
export type FieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | BooleanFieldDefinition
  | SelectFieldDefinition
  | ColorFieldDefinition
  | DateFieldDefinition
  | CustomFieldDefinition;

/**
 * Fields map for a component
 */
export type FieldsMap = Record<string, FieldDefinition>;

/**
 * Component props based on fields
 */
export type ComponentProps<F extends FieldsMap = FieldsMap> = {
  [K in keyof F]: F[K] extends BaseFieldDefinition<infer T> ? T : unknown;
};

/**
 * Component render function
 */
export type ComponentRenderFn<Props = Record<string, unknown>> = (props: {
  id: string;
  props: Props;
  children?: ReactNode;
}) => ReactNode;

/**
 * Component category for organization
 */
export type ComponentCategory = string;

/**
 * Component definition - blueprint for creating instances
 */
export interface ComponentDefinition<F extends FieldsMap = FieldsMap> {
  /** Unique component type identifier */
  type: string;

  /** Human-readable label */
  label: string;

  /** Component category for organization */
  category?: ComponentCategory;

  /** Field definitions */
  fields: F;

  /** Default props values */
  defaultProps: Partial<ComponentProps<F>>;

  /**
   * Sample component for canvas preview (used only in HyperIDE)
   * Named SampleDefault to be HMR-compatible (React Fast Refresh requires PascalCase)
   */
  SampleDefault?: React.FC;

  /** Render function */
  render: ComponentRenderFn<ComponentProps<F>>;

  /** Can this component have children? */
  canHaveChildren?: boolean;

  /** Allowed parent types (undefined = any parent) */
  allowedParents?: string[];

  /** Allowed child types (undefined = any children) */
  allowedChildren?: string[];

  /** Custom icon for component picker */
  icon?: ReactNode;

  /** Is this component hidden from component picker? */
  hidden?: boolean;

  /** File path of the component source (set by server for Atom components) */
  filePath?: string;
}

/**
 * Component instance - actual component on canvas
 */
export interface ComponentInstance<Props = Record<string, unknown>> {
  /** Unique instance ID */
  id: string;

  /** Component type reference */
  type: string;

  /** Current props values */
  props: Props;

  /** Parent instance ID (null for root-level) */
  parentId: string | null;

  /** Child instance IDs (ordered) */
  children: string[];

  /** Metadata (timestamps, user info, etc.) */
  metadata?: {
    createdAt?: number;
    updatedAt?: number;
    [key: string]: unknown;
  };
}

/**
 * Document tree - complete state of canvas
 */
export interface DocumentTree {
  /** Root instance ID */
  rootId: string;

  /** All instances by ID */
  instances: Record<string, ComponentInstance>;

  /** Tree version for serialization */
  version: number;
}

/**
 * "instance" terminology — three distinct concepts (HYP-290b, spec A7)
 *
 * The word "instance" historically meant several unrelated things in this codebase.
 * To avoid the collision that produced wrong prior-art in the HYP-290 ticket, the
 * map-operation plumbing uses these precise terms:
 *
 * - **document-instance** — a {@link ComponentInstance} in the {@link DocumentTree}
 *   (`tree.getInstance(...)`). One node of the edited component's structure.
 * - **canvas-instance** — a multi-placement drop of the same component at an `x/y`
 *   position on the infinite canvas, keyed by `data-canvas-instance-id`
 *   (`__CANVAS_INSTANCES__`). Unrelated to `.map()`; not touched here.
 * - **map-iteration** — a single rendered item produced by a `.map()` over a data
 *   source. Targeted by `parentMapId` (which `.map()`) + `itemIndex` (which item),
 *   NOT by any DOM attribute. See {@link MapIterationContext}.
 */

/**
 * Context identifying a single `.map()` iteration for the operation layer.
 *
 * Carried from the selection event through to where structural ops are dispatched,
 * so a later DOM-mode op can target one rendered item instead of the whole template.
 * Resolved from the selected AST node's `mapItem` plus the per-id `itemIndex` — no
 * DOM-attribute (`data-canvas-instance-id`) lookup is involved (spec A1/A7).
 */
export interface MapIterationContext {
  /** Identifier of the `.map()` group the selected element belongs to. */
  parentMapId: string;

  /** Sibling index of the selected item within the `.map()` render group. */
  itemIndex: number;

  /**
   * Raw source text of the `.map()` receiver (e.g. `"items"`, `"data.users"`),
   * captured by the parser. The data source the iteration was rendered from.
   */
  mapExpression: string;
}

/**
 * Selection state
 */
export interface SelectionState {
  /** Selected document-instance / AST-node IDs. */
  selectedIds: string[];

  /** Hovered document-instance / AST-node ID. */
  hoveredId: string | null;

  /** Hovered map-iteration index (null = whole `.map()` group / not a map iteration). */
  hoveredItemIndex: number | null;

  /**
   * Per-id map-iteration index. When an element is rendered multiple times via
   * `.map()`, this records which iteration was clicked so the operation layer can
   * resolve its {@link MapIterationContext}.
   * Key: selected id, Value: itemIndex (null = whole group / not a map iteration).
   */
  selectedItemIndices: Map<string, number | null>;
}

/**
 * History state
 */
export interface HistoryState {
  /** Can undo? */
  canUndo: boolean;

  /** Can redo? */
  canRedo: boolean;

  /** Current history position */
  position: number;

  /** Total history length */
  length: number;
}

/**
 * Engine configuration
 */
export interface CanvasEngineConfig {
  /** Callback when state changes */
  onStateChange?: (snapshot: DocumentTree) => void;

  /** Maximum history length */
  maxHistoryLength?: number;

  /** Initial tree state */
  initialTree?: Partial<DocumentTree>;

  /** Enable debug logging */
  debug?: boolean;

  /** Server synchronization configuration */
  serverSync?: ServerSyncConfig;
}

/**
 * Operation result
 */
export interface OperationResult {
  /** Was operation successful? */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Changed instance IDs */
  changedIds?: string[];
}
