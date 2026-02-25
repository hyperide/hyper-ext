# Canvas-Engine Architecture

## Layer Diagram

```plain
UI (CanvasEditor, hooks)
  → CanvasEngine (facade, ~68 public methods)
    → Operations (Command pattern, execute/undo/redo)
      → DocumentTree (in-memory tree, Map<id, ComponentInstance>)
      → ASTApiService (HTTP calls to server for file mutations)
    → HistoryManager (undo/redo stack, max 100)
    → EventEmitter (13 typed events → Zustand store → React)
    → StyleAdapters (Tailwind: className, Tamagui: props)
```

## Two Environments

**Design Mode** (single instance):

- Edit elements within component
- Click → select element by data-uniq-id
- AST operations (insert/delete/duplicate/style/props)
- Undo/redo via file snapshots (PostgreSQL) + local tree ops

**Board Mode** (multiple instances):

- Excalidraw-style canvas with zoom/pan
- Click → select instance
- Instance operations (copy/cut/paste/duplicate/delete)
- Annotations (arrows, text stickers)

Both share same CanvasEngine & DocumentTree.

## Key Types

- `ComponentInstance` — { id, type, props, parentId, children: string[], metadata? }
- `OperationResult` — { success, error?, changedIds? }
- `HistoryState` — { canUndo, canRedo, position, length }
- `Operation` interface — { name, execute(tree), undo(tree), redo(tree), canUndo() }
- `BaseOperation` — abstract class, has `api: ASTApiService`, helper methods success()/error()

## Operations (Command Pattern)

### Tree ops (local, sync)

Insert, Delete, Update, Move, Duplicate, Batch — operate on DocumentTree directly.

### AST ops (server, async)

All extend BaseOperation, receive ASTApiService via constructor.

| Operation | execute | undo | redo | Key state |
|-----------|---------|------|------|-----------|
| ASTInsert | api.insertElement → store insertedId | api.deleteElement(insertedId) | execute() | insertedId |
| ASTDelete | storeElementForUndo(tree) → api.deleteElement | api.insertElement(stored structure) | syncDelete() | deletedElement, parentId, elementIndex |
| ASTBatchDelete | storeElementsForUndo → api.deleteElements | insertElement for each (grouped by parent, sorted by index) | syncBatchDelete() | deletedElements: Map |
| ASTDuplicate | storeOriginalElement → api.duplicateElement → store newElementId | api.deleteElement(newElementId) | insertElement(same structure, same ID) | newElementId, parentId, duplicatedElementStructure |
| ASTPaste | api.pasteElement → store newElementIds | storePastedElement → api.deleteElements(newElementIds) | syncPaste() again | newElementId, newElementIds[], pastedElementStructure |
| ASTStyle | api.updateStyles → save undoSnapshotId, then api.saveFileSnapshot → redoSnapshotId | api.restoreFileSnapshot(undoSnapshotId) | api.restoreFileSnapshot(redoSnapshotId) or execute() | undoSnapshotId, redoSnapshotId, _pendingPromise |
| ASTUpdate | getPropFromDOM → applyPropToDOM → api.updateProp (bg) | applyPropToDOM(oldValue) → syncToFile(oldValue) | execute() | oldValue (from DOM) |
| ASTUpdateProps | getPropFromDOM for each → applyPropToDOM → api.updatePropsBatch | applyPropToDOM(oldValues) → syncToFile(oldValues) | execute() | oldValues: Record |
| ASTEditCondition | api.editCondition(new) → reloadComponent | api.editCondition(old) → reloadComponent | execute() | params.oldExpression, params.newExpression, _pendingPromise |

### Annotation ops

Insert, Update, Delete, Move, BatchDelete — operate on annotation layer.

## Fire-and-forget Pattern

Most AST operations return `success` synchronously, launch async API calls in background.
Some operations store `_pendingPromise` (ASTStyle, ASTEditCondition).
Engine's `undo()` awaits `_pendingPromise` before completing.

## CanvasEngine API Property

- `private api: ASTApiService` — created as `new ASTApiServiceImpl()` in constructor
- No DI via config — for tests, override with `(engine as any).api = mockApi`

## ASTApiService Interface (14 methods)

```typescript
interface ASTApiService {
  insertElement(params): Promise<InsertElementResult>
  deleteElement(params): Promise<ApiResult>
  deleteElements(params): Promise<ApiResult>
  duplicateElement(params): Promise<DuplicateElementResult>
  pasteElement(params): Promise<PasteElementResult>
  updateStyles(params): Promise<UpdateStylesResult>
  updateProp(params): Promise<ApiResult>
  updatePropsBatch(params): Promise<ApiResult>
  updateText(params): Promise<ApiResult>
  editCondition(params): Promise<EditConditionResult>
  parseComponent(filePath): Promise<ParseComponentResult>
  saveFileSnapshot(filePath): Promise<SaveSnapshotResult>
  restoreFileSnapshot(snapshotId, filePath): Promise<void>
  reloadComponent(filePath): Promise<void>
}
```

## Undo/Redo: File Snapshots (for ASTStyleOperation only)

1. Server middleware intercepts mutating endpoints
2. Saves file content to fileSnapshots table (PostgreSQL)
3. Returns snapshotId in response header/body
4. ASTStyleOperation stores undoSnapshotId (pre-mutation) and redoSnapshotId (post-mutation)
5. Undo → restoreFileSnapshot(undoSnapshotId)
6. Redo → restoreFileSnapshot(redoSnapshotId) or re-execute

## Style Adapters

StyleAdapter interface: read(), write(), writeBatch(), changeLayout()

- TailwindAdapter (writeMode='className') — className manipulation
- TamaguiAdapter (writeMode='props') — React Native style props

## Batch Mode

- `startBatch()` → defers events, sets `_isBatchMode = true`
- Operations executed normally, events collected in `_batchedEvents`
- `finalizeBatch()` → deduplicates events, emits once
- `executeBatch(operations)` → wraps in BatchOperation → single undo/redo

## Key Files

- Core: `core/CanvasEngine.ts`, `core/DocumentTree.ts`, `core/HistoryManager.ts`
- Operations: `operations/Operation.ts`, `operations/AST*.ts`, `operations/BatchOperation.ts`
- Services: `services/ASTApiService.ts` (interface + types), `services/ASTApiServiceImpl.ts`
- Adapters: `adapters/StyleAdapter.ts`, `adapters/TailwindAdapter.ts`, `adapters/TamaguiAdapter.ts`
- Events: `events/events.ts` (13 event types)
- Store: `store/createCanvasStore.ts` (Zustand bridge)
- Server snapshots: `server/middleware/fileSnapshot.ts`, `server/services/fileSnapshotStore.ts`

## DOM Dependency in Tests

ASTUpdateOperation and ASTUpdatePropsOperation use `getPreviewIframe()` (from `@/lib/dom-utils`).
For testing, mock the module: `mock.module('@/lib/dom-utils', () => ({ getPreviewIframe: () => null }))`
