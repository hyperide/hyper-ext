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
export { CanvasEngine } from './core/CanvasEngine';
export { ClipboardManager } from './core/ClipboardManager';
export { ComponentRegistry } from './core/ComponentRegistry';
export { DocumentTree } from './core/DocumentTree';
export { HistoryManager } from './core/HistoryManager';
// ============================================
// Events
// ============================================
export { EventEmitter } from './events/EventEmitter';
export type {
  CanvasEngineEvents,
  CanvasEventName,
  EventListener,
  HistoryChangeEvent,
  HoverChangeEvent,
  InstanceDeleteEvent,
  InstanceDuplicateEvent,
  // Event payloads
  InstanceInsertEvent,
  InstanceMoveEvent,
  InstanceUpdateEvent,
  RedoEvent,
  SelectionChangeEvent,
  TreeChangeEvent,
  UndoEvent,
} from './events/events';
// ============================================
// Types
// ============================================
export type {
  BaseFieldDefinition,
  BooleanFieldDefinition,
  // Config types
  CanvasEngineConfig,
  ColorFieldDefinition,
  ComponentCategory,
  // Component types
  ComponentDefinition,
  ComponentInstance,
  ComponentProps,
  ComponentRenderFn,
  CustomFieldDefinition,
  DateFieldDefinition,
  // Tree types
  DocumentTree as IDocumentTree,
  FieldDefinition,
  FieldsMap,
  // Field types
  FieldType,
  HistoryState,
  NumberFieldDefinition,
  OperationResult,
  SelectFieldDefinition,
  SelectionState,
  TextFieldDefinition,
} from './models/types';
// ============================================
// Validation
// ============================================
export {
  booleanFieldSchema,
  canvasEngineConfigSchema,
  colorFieldSchema,
  componentDefinitionSchema,
  componentInstanceSchema,
  customFieldSchema,
  dateFieldSchema,
  documentTreeSchema,
  fieldDefinitionSchema,
  fieldsMapSchema,
  fieldTypeSchema,
  historyStateSchema,
  numberFieldSchema,
  operationResultSchema,
  selectFieldSchema,
  selectionStateSchema,
  textFieldSchema,
} from './models/validation';
// Annotation operations
export {
  AnnotationBatchDeleteOperation,
  type AnnotationBatchDeleteParams,
  AnnotationDeleteOperation,
  type AnnotationDeleteParams,
  AnnotationInsertOperation,
  type AnnotationInsertParams,
  AnnotationMoveOperation,
  type AnnotationMoveParams,
  type AnnotationStore,
  AnnotationUpdateOperation,
  type AnnotationUpdateParams,
} from './operations/AnnotationOperations';
export { BatchOperation } from './operations/BatchOperation';
export {
  type FileChangeSource,
  FileSnapshotOperation,
  type FileSnapshotOperationParams,
} from './operations/FileSnapshotOperation';
// ============================================
// Operations
// ============================================
export type { Operation, OperationSource } from './operations/Operation';
export { BaseOperation } from './operations/Operation';
// ============================================
// React Integration
// ============================================
export {
  CanvasEngineProvider,
  type CanvasEngineProviderProps,
  useCanvasEngineContext,
  useCanvasEngineContextOptional,
  useCanvasEngineOptional,
} from './react/CanvasEngineProvider';

export { CanvasRenderer } from './react/CanvasRenderer';
export {
  useAllInstances,
  useCanRedo,
  useCanUndo,
  useCanvasEngine,
  useCanvasStore,
  useChildren,
  useForceUpdate,
  useHistory,
  useHoveredId,
  useHoveredItemIndex,
  useInstance,
  useIsHovered,
  useIsSelected,
  useParent,
  useRoot,
  useSelectedIds,
  useSelectedInstance,
  useSelectedInstances,
  useSelectedItemIndices,
  useSelection,
  useTreeSnapshot,
} from './react/hooks';
// ============================================
// Store
// ============================================
export {
  type CanvasStore,
  type CanvasStoreApi,
  createCanvasStore,
} from './store/createCanvasStore';
// ============================================
// Utilities
// ============================================
export { generateId, generateIds } from './utils/id';
export {
  deserialize,
  exportToFile,
  importFromFile,
  type SerializedData,
  serialize,
} from './utils/serialization';
export {
  getClassNameFromNode,
  type ParsedTailwindStyles,
  parseTailwindClasses,
} from './utils/tailwindParser';
