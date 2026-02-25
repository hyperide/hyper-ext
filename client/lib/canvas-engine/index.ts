/**
 * Canvas Engine - Public API
 *
 * A clean, OOP-based canvas builder library for React.
 * Provides data management, undo/redo, and event-driven architecture
 * for building visual editors.
 *
 * @packageDocumentation
 */

// ============================================
// Core
// ============================================
export { CanvasEngine } from "./core/CanvasEngine";
export { ComponentRegistry } from "./core/ComponentRegistry";
export { DocumentTree } from "./core/DocumentTree";
export { HistoryManager } from "./core/HistoryManager";
export { ClipboardManager } from "./core/ClipboardManager";

// ============================================
// Types
// ============================================
export type {
  // Field types
  FieldType,
  FieldDefinition,
  BaseFieldDefinition,
  TextFieldDefinition,
  NumberFieldDefinition,
  BooleanFieldDefinition,
  SelectFieldDefinition,
  ColorFieldDefinition,
  DateFieldDefinition,
  CustomFieldDefinition,
  FieldsMap,
  ComponentProps,
  // Component types
  ComponentDefinition,
  ComponentInstance,
  ComponentCategory,
  ComponentRenderFn,
  // Tree types
  DocumentTree as IDocumentTree,
  SelectionState,
  HistoryState,
  // Config types
  CanvasEngineConfig,
  OperationResult,
} from "./models/types";

// ============================================
// Events
// ============================================
export { EventEmitter } from "./events/EventEmitter";
export type {
  CanvasEngineEvents,
  CanvasEventName,
  EventListener,
  // Event payloads
  InstanceInsertEvent,
  InstanceUpdateEvent,
  InstanceDeleteEvent,
  InstanceMoveEvent,
  InstanceDuplicateEvent,
  SelectionChangeEvent,
  HoverChangeEvent,
  HistoryChangeEvent,
  UndoEvent,
  RedoEvent,
  TreeChangeEvent,
} from "./events/events";

// ============================================
// Operations
// ============================================
export type { Operation, OperationSource } from "./operations/Operation";
export { BaseOperation } from "./operations/Operation";
export {
  FileSnapshotOperation,
  type FileSnapshotOperationParams,
  type FileChangeSource,
} from "./operations/FileSnapshotOperation";
export { BatchOperation } from "./operations/BatchOperation";

// Annotation operations
export {
  AnnotationInsertOperation,
  AnnotationUpdateOperation,
  AnnotationDeleteOperation,
  AnnotationBatchDeleteOperation,
  AnnotationMoveOperation,
  type AnnotationStore,
  type AnnotationInsertParams,
  type AnnotationUpdateParams,
  type AnnotationDeleteParams,
  type AnnotationBatchDeleteParams,
  type AnnotationMoveParams,
} from "./operations/AnnotationOperations";

// ============================================
// React Integration
// ============================================
export {
  CanvasEngineProvider,
  useCanvasEngineContext,
  useCanvasEngineOptional,
  type CanvasEngineProviderProps,
} from "./react/CanvasEngineProvider";

export {
  useCanvasEngine,
  useCanvasStore,
  useInstance,
  useChildren,
  useParent,
  useRoot,
  useAllInstances,
  useSelection,
  useSelectedIds,
  useSelectedItemIndices,
  useSelectedInstances,
  useSelectedInstance,
  useIsSelected,
  useHoveredId,
  useHoveredItemIndex,
  useIsHovered,
  useHistory,
  useCanUndo,
  useCanRedo,
  useTreeSnapshot,
  useForceUpdate,
} from "./react/hooks";

export { CanvasRenderer } from "./react/CanvasRenderer";

// ============================================
// Store
// ============================================
export {
  createCanvasStore,
  type CanvasStore,
  type CanvasStoreApi,
} from "./store/createCanvasStore";

// ============================================
// Utilities
// ============================================
export { generateId, generateIds } from "./utils/id";
export {
  serialize,
  deserialize,
  exportToFile,
  importFromFile,
  type SerializedData,
} from "./utils/serialization";
export {
  parseTailwindClasses,
  getClassNameFromNode,
  type ParsedTailwindStyles,
} from "./utils/tailwindParser";

// ============================================
// Validation
// ============================================
export {
  fieldTypeSchema,
  textFieldSchema,
  numberFieldSchema,
  booleanFieldSchema,
  selectFieldSchema,
  colorFieldSchema,
  dateFieldSchema,
  customFieldSchema,
  fieldDefinitionSchema,
  fieldsMapSchema,
  componentDefinitionSchema,
  componentInstanceSchema,
  documentTreeSchema,
  selectionStateSchema,
  historyStateSchema,
  canvasEngineConfigSchema,
  operationResultSchema,
} from "./models/validation";
