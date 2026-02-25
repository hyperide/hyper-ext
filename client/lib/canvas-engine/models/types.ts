/**
 * Core types for Canvas Engine
 */

import type React from "react";
import { ReactNode } from "react";
import type { ServerSyncConfig } from "../core/ServerSyncManager";

/**
 * Supported field types for component properties
 */
export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "select"
  | "radio"
  | "color"
  | "date"
  | "custom";

/**
 * Base field definition
 */
export interface BaseFieldDefinition<T = any> {
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
  type: "text" | "textarea";
  placeholder?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
}

/**
 * Number field definition
 */
export interface NumberFieldDefinition extends BaseFieldDefinition<number> {
  type: "number";
  min?: number;
  max?: number;
  step?: number;
}

/**
 * Boolean field definition
 */
export interface BooleanFieldDefinition extends BaseFieldDefinition<boolean> {
  type: "boolean";
}

/**
 * Select/Radio field definition
 */
export interface SelectFieldDefinition<T = string>
  extends BaseFieldDefinition<T> {
  type: "select" | "radio";
  options: { label: string; value: T }[] | T[];
}

/**
 * Color field definition
 */
export interface ColorFieldDefinition extends BaseFieldDefinition<string> {
  type: "color";
}

/**
 * Date field definition
 */
export interface DateFieldDefinition extends BaseFieldDefinition<string> {
  type: "date";
  min?: string;
  max?: string;
}

/**
 * Custom field definition with render function
 */
export interface CustomFieldDefinition<T = any> extends BaseFieldDefinition<T> {
  type: "custom";
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
  [K in keyof F]: F[K] extends BaseFieldDefinition<infer T> ? T : any;
};

/**
 * Component render function
 */
export type ComponentRenderFn<Props = any> = (props: {
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
}

/**
 * Component instance - actual component on canvas
 */
export interface ComponentInstance<Props = any> {
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
    [key: string]: any;
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
 * Selection state
 */
export interface SelectionState {
  /** Selected instance IDs */
  selectedIds: string[];

  /** Hovered instance ID */
  hoveredId: string | null;

  /** Hovered item index for map-rendered elements (null = all items) */
  hoveredItemIndex: number | null;

  /**
   * Item indices for map-rendered elements.
   * When an element is rendered multiple times via .map(),
   * this tracks which specific item was clicked.
   * Key: uniqId, Value: itemIndex (null = all items selected)
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
