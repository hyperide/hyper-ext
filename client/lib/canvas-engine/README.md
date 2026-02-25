# Canvas Engine

A clean, OOP-based canvas builder library for React. Provides data management, undo/redo, and event-driven architecture for building visual editors.

## Features

- **Type-safe OOP API** - Clean class-based architecture
- **Undo/Redo** - Command pattern with full history support
- **Event-driven** - Subscribe to all state changes
- **React Integration** - Zustand store + React hooks
- **Serialization** - Import/export JSON with versioning
- **Tree Operations** - Insert, update, delete, move, duplicate
- **Clipboard** - Copy/paste functionality
- **Validation** - Zod schemas for runtime validation

## Installation

```bash
# Already included in this project
```

## Basic Usage

### 1. Create Engine

```typescript
import { CanvasEngine } from "@/lib/canvas-engine";

const engine = new CanvasEngine({
  onStateChange: (snapshot) => {
    // Sync to external storage
    localStorage.setItem("canvas-state", JSON.stringify(snapshot));
  },
  maxHistoryLength: 100,
  debug: true,
});
```

### 2. Register Components

```typescript
engine.registerComponent({
  type: "Button",
  label: "Button",
  category: "Atoms",
  fields: {
    text: {
      type: "text",
      label: "Button Text",
      defaultValue: "Click me",
    },
    size: {
      type: "select",
      label: "Size",
      options: ["sm", "md", "lg"],
      defaultValue: "md",
    },
    variant: {
      type: "select",
      label: "Variant",
      options: ["primary", "secondary", "outline"],
      defaultValue: "primary",
    },
  },
  defaultProps: {
    text: "Click me",
    size: "md",
    variant: "primary",
  },
  render: ({ props }) => (
    <button className={`btn btn-${props.size} btn-${props.variant}`}>
      {props.text}
    </button>
  ),
  canHaveChildren: false,
});
```

### 3. Tree Operations

```typescript
// Insert instance
const buttonId = engine.insert({
  type: "Button",
  props: { text: "Hello World" },
});

// Update props
engine.update(buttonId, {
  text: "Updated Text",
  size: "lg",
});

// Move instance
engine.move(buttonId, newParentId, newIndex);

// Duplicate instance
const cloneId = engine.duplicate(buttonId);

// Delete instance
engine.delete(buttonId);
```

### 4. Selection

```typescript
// Select single instance
engine.select(buttonId);

// Select multiple
engine.selectMultiple([id1, id2, id3]);

// Add to selection
engine.addToSelection(id4);

// Clear selection
engine.clearSelection();

// Set hovered
engine.setHovered(instanceId);
```

### 5. History (Undo/Redo)

```typescript
// Undo last operation
engine.undo();

// Redo next operation
engine.redo();

// Check availability
if (engine.canUndo()) {
  engine.undo();
}

if (engine.canRedo()) {
  engine.redo();
}

// Get history state
const history = engine.getHistoryState();
console.log(history.canUndo, history.canRedo);
```

### 6. Clipboard

```typescript
// Copy instance
engine.copy(instanceId);

// Paste instance
const pastedId = engine.paste(parentId);

// Check clipboard
if (engine.hasClipboard()) {
  engine.paste();
}
```

### 7. Events

```typescript
// Subscribe to events
engine.events.on("instance:insert", (event) => {
  console.log("Instance inserted:", event.instance);
});

engine.events.on("instance:update", (event) => {
  console.log("Instance updated:", event.id, event.props);
});

engine.events.on("selection:change", (event) => {
  console.log("Selection changed:", event.selectedIds);
});

engine.events.on("history:change", (event) => {
  console.log("History state:", event.state);
});

// Unsubscribe
const unsubscribe = engine.events.on("instance:insert", listener);
unsubscribe(); // Remove listener
```

### 8. Queries

```typescript
// Get instance by ID
const instance = engine.getInstance(instanceId);

// Get root
const root = engine.getRoot();

// Get children
const children = engine.getChildren(parentId);

// Get parent
const parent = engine.getParent(childId);

// Get ancestors (all parents up to root)
const ancestors = engine.getAncestors(instanceId);

// Get descendants (all children recursively)
const descendants = engine.getDescendants(parentId);

// Get all instances
const all = engine.getAllInstances();
```

### 9. Serialization

```typescript
// Serialize to JSON
const json = engine.serialize();
localStorage.setItem("canvas", json);

// Deserialize from JSON
const json = localStorage.getItem("canvas");
if (json) {
  engine.deserialize(json);
}

// Get snapshot
const snapshot = engine.getSnapshot();

// Export to file (browser)
import { exportToFile } from "@/lib/canvas-engine";
exportToFile(engine.getSnapshot(), "my-canvas.json");

// Import from file (browser)
import { importFromFile } from "@/lib/canvas-engine";
const tree = await importFromFile(file);
engine.deserialize(JSON.stringify({ version: 1, tree, timestamp: Date.now() }));
```

## React Integration

### Provider Setup

```typescript
import { CanvasEngineProvider } from "@/lib/canvas-engine";

function App() {
  const engine = useMemo(() => new CanvasEngine(), []);

  return (
    <CanvasEngineProvider engine={engine}>
      <YourApp />
    </CanvasEngineProvider>
  );
}
```

### Hooks

```typescript
import {
  useCanvasEngine,
  useInstance,
  useChildren,
  useSelectedInstance,
  useCanUndo,
  useCanRedo,
} from "@/lib/canvas-engine";

function MyComponent() {
  // Get engine
  const engine = useCanvasEngine();

  // Get instance
  const instance = useInstance(instanceId);

  // Get children
  const children = useChildren(parentId);

  // Selection
  const selectedInstance = useSelectedInstance();
  const selectedIds = useSelectedIds();
  const isSelected = useIsSelected(instanceId);

  // History
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  // Operations
  const handleInsert = () => {
    engine.insert({
      type: "Button",
      props: { text: "New Button" },
    });
  };

  const handleUndo = () => {
    if (canUndo) {
      engine.undo();
    }
  };

  return (
    <div>
      <button onClick={handleInsert}>Insert</button>
      <button onClick={handleUndo} disabled={!canUndo}>
        Undo
      </button>
    </div>
  );
}
```

## Architecture

```
canvas-engine/
├── core/
│   ├── CanvasEngine.ts         # Main facade class
│   ├── ComponentRegistry.ts    # Component management
│   ├── DocumentTree.ts         # Tree structure
│   ├── HistoryManager.ts       # Undo/Redo
│   └── ClipboardManager.ts     # Copy/Paste
├── models/
│   ├── types.ts                # Type definitions
│   └── validation.ts           # Zod schemas
├── operations/
│   ├── Operation.ts            # Command pattern base
│   ├── InsertOperation.ts
│   ├── DeleteOperation.ts
│   ├── UpdateOperation.ts
│   ├── MoveOperation.ts
│   ├── DuplicateOperation.ts
│   └── BatchOperation.ts
├── events/
│   ├── EventEmitter.ts         # Type-safe events
│   └── events.ts               # Event types
├── store/
│   └── createCanvasStore.ts    # Zustand store
├── react/
│   ├── CanvasEngineProvider.tsx
│   └── hooks.ts
└── utils/
    ├── id.ts                   # ID generation
    └── serialization.ts        # JSON import/export
```

## Design Patterns

- **Facade Pattern** - `CanvasEngine` provides clean API
- **Command Pattern** - Operations for undo/redo
- **Observer Pattern** - Event-driven architecture
- **Strategy Pattern** - Pluggable field types
- **Singleton** - Registry per engine instance

## Performance

- **O(1) lookups** - Map-based instance storage
- **Memoized selectors** - Zustand optimizations
- **Event batching** - Minimal re-renders
- **Lazy updates** - Store updates only on changes

## Testing

```bash
npm test client/lib/canvas-engine
```

Tests cover:
- ✅ DocumentTree operations
- ✅ ComponentRegistry
- ✅ Operations (Command pattern)
- ✅ HistoryManager
- ✅ CanvasEngine integration
- ✅ Event emitter
- ✅ Serialization

## License

Part of hyper-canvas-draft project.
