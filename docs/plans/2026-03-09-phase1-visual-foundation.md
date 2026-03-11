# Phase 1: Visual Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-select batch editing, drag reorder/swap, resize handles, and a universal two-phase update (FastPatchService) to HyperIDE's visual editor.

**Architecture:** FastPatchService provides instant CSS injection into the iframe for all visual operations, then commits via AST. Multi-select extends existing CanvasEngine selection to batch style writes. Drag reorder uses custom mouse events (no DnD library) with a new ASTMoveOperation and server endpoint. Resize handles are overlay divs rendered via the existing RAF-based overlay system.

**Tech Stack:** React 18, TypeScript, Zustand, Bun test runner, Babel AST (recast), PostCSS, custom mouse event handling, RAF overlays

**Design doc:** `docs/plans/2026-03-09-hyperide-next-level-design.md`

---

## Key Files Reference

| Area | File |
|------|------|
| CanvasEngine | `client/lib/canvas-engine/core/CanvasEngine.ts` |
| Operations base | `client/lib/canvas-engine/operations/Operation.ts` |
| Batch operation | `client/lib/canvas-engine/operations/BatchOperation.ts` |
| ASTStyle operation | `client/lib/canvas-engine/operations/ASTStyleOperation.ts` |
| AST API service | `client/lib/canvas-engine/services/ASTApiService.ts` (interface) |
| AST API impl | `client/lib/canvas-engine/services/ASTApiServiceImpl.ts` |
| Selection hooks | `client/pages/Editor/components/hooks/useElementInteraction.ts` |
| Element tree selection | `client/components/LeftSidebar/hooks/useElementSelection.ts` |
| Overlay renderer | `shared/canvas-interaction/overlay-renderer.ts` |
| Style injector | `shared/canvas-interaction/style-injector.ts` |
| DOM utils | `client/lib/dom-utils.ts` |
| Style sync hook | `client/components/RightSidebar/hooks/useStyleSync.ts` |
| RightSidebar | `client/components/RightSidebar/RightSidebar.tsx` |
| CanvasEditor | `client/pages/Editor/CanvasEditor.tsx` |
| AST mutator | `lib/ast/mutator.ts` |
| AST traverser | `lib/ast/traverser.ts` |
| AST operations | `lib/ast/operations.ts` |
| AST parser | `lib/ast/parser.ts` |
| Server routes index | `server/index.ts` |
| Insert element route | `server/routes/insertElement.ts` |
| Mock AST API | `client/lib/canvas-engine/__tests__/mocks/MockASTApiService.ts` |
| Test setup | `test/setup.ts` |

---

## Part A: FastPatchService (universal two-phase update)

### Task 1: FastPatchService — core class with tests

**Context:** All visual changes (inspector, drag, resize, scrubbers) need instant feedback.
Currently, changes go through AST mutation → HMR → iframe reload (300ms+). FastPatchService
injects CSS directly into the iframe `<style>` element for instant preview, then the caller
commits via AST.

**Files:**

- Create: `client/lib/fast-patch-service.ts`
- Create: `client/lib/__tests__/fast-patch-service.test.ts`

**Step 1: Write the failing tests**

```typescript
// client/lib/__tests__/fast-patch-service.test.ts
import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock dom-utils before importing
let mockIframeDoc: {
  getElementById: ReturnType<typeof mock>;
  createElement: ReturnType<typeof mock>;
  head: { appendChild: ReturnType<typeof mock> };
} | null = null;

mock.module('@/lib/dom-utils', () => ({
  getPreviewIframe: () =>
    mockIframeDoc
      ? { contentDocument: mockIframeDoc, contentWindow: {} }
      : null,
}));

import { FastPatchService } from '../fast-patch-service';

describe('FastPatchService', () => {
  let service: FastPatchService;
  let mockStyleEl: { textContent: string; id: string };

  beforeEach(() => {
    mockStyleEl = { textContent: '', id: '' };
    mockIframeDoc = {
      getElementById: mock(() => null),
      createElement: mock(() => mockStyleEl),
      head: { appendChild: mock(() => {}) },
    };
    service = new FastPatchService();
  });

  describe('applyPatch', () => {
    it('injects CSS for element by data-uniq-id selector', () => {
      service.applyPatch('elem-1', { backgroundColor: 'red', padding: '16px' });

      expect(mockStyleEl.textContent).toContain('[data-uniq-id="elem-1"]');
      expect(mockStyleEl.textContent).toContain('background-color: red !important');
      expect(mockStyleEl.textContent).toContain('padding: 16px !important');
    });

    it('scopes to instance when instanceId provided', () => {
      service.applyPatch('elem-1', { color: 'blue' }, 'instance-1');

      expect(mockStyleEl.textContent).toContain(
        '[data-canvas-instance-id="instance-1"] [data-uniq-id="elem-1"]',
      );
    });

    it('replaces previous patch for same element', () => {
      service.applyPatch('elem-1', { color: 'red' });
      service.applyPatch('elem-1', { color: 'blue' });

      const occurrences = (mockStyleEl.textContent.match(/elem-1/g) || []).length;
      // Should appear once in selector, not duplicated
      expect(occurrences).toBeLessThanOrEqual(2); // selector + possibly closing
      expect(mockStyleEl.textContent).toContain('color: blue');
      expect(mockStyleEl.textContent).not.toContain('color: red');
    });
  });

  describe('clearPatch', () => {
    it('removes patch for specific element', () => {
      service.applyPatch('elem-1', { color: 'red' });
      service.applyPatch('elem-2', { color: 'blue' });
      service.clearPatch('elem-1');

      expect(mockStyleEl.textContent).not.toContain('elem-1');
      expect(mockStyleEl.textContent).toContain('elem-2');
    });
  });

  describe('clearAll', () => {
    it('removes all patches', () => {
      service.applyPatch('elem-1', { color: 'red' });
      service.applyPatch('elem-2', { color: 'blue' });
      service.clearAll();

      expect(mockStyleEl.textContent).toBe('');
    });
  });

  describe('no iframe', () => {
    it('does not throw when iframe is missing', () => {
      mockIframeDoc = null;
      expect(() => service.applyPatch('elem-1', { color: 'red' })).not.toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test client/lib/__tests__/fast-patch-service.test.ts`
Expected: FAIL — module `../fast-patch-service` not found

**Step 3: Write minimal implementation**

```typescript
// client/lib/fast-patch-service.ts
import { getPreviewIframe } from '@/lib/dom-utils';

const STYLE_ID = 'hyper-canvas-fast-patch';

/** Converts camelCase CSS property to kebab-case */
function toKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Injects CSS directly into iframe for instant visual feedback.
 * Each patch is keyed by elementId — applying a new patch for the
 * same element replaces the previous one.
 *
 * Usage:
 *   service.applyPatch('elem-1', { backgroundColor: 'red' });
 *   // ... user sees change instantly ...
 *   // commit via AST operation, then:
 *   service.clearPatch('elem-1');
 */
export class FastPatchService {
  private patches = new Map<string, { styles: Record<string, string>; instanceId?: string }>();

  applyPatch(
    elementId: string,
    styles: Record<string, string>,
    instanceId?: string,
  ): void {
    this.patches.set(elementId, { styles, instanceId });
    this.flush();
  }

  clearPatch(elementId: string): void {
    this.patches.delete(elementId);
    this.flush();
  }

  clearAll(): void {
    this.patches.clear();
    this.flush();
  }

  private flush(): void {
    const styleEl = this.getOrCreateStyleElement();
    if (!styleEl) return;

    const rules: string[] = [];
    for (const [elementId, { styles, instanceId }] of this.patches) {
      const selector = instanceId
        ? `[data-canvas-instance-id="${instanceId}"] [data-uniq-id="${elementId}"]`
        : `[data-uniq-id="${elementId}"]`;

      const declarations = Object.entries(styles)
        .map(([prop, value]) => `${toKebab(prop)}: ${value} !important`)
        .join(';\n  ');

      rules.push(`${selector} {\n  ${declarations};\n}`);
    }

    styleEl.textContent = rules.join('\n');
  }

  private getOrCreateStyleElement(): HTMLStyleElement | null {
    const iframe = getPreviewIframe();
    const doc = iframe?.contentDocument;
    if (!doc) return null;

    let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = doc.createElement('style') as HTMLStyleElement;
      el.id = STYLE_ID;
      doc.head.appendChild(el);
    }
    return el;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test client/lib/__tests__/fast-patch-service.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add client/lib/fast-patch-service.ts client/lib/__tests__/fast-patch-service.test.ts
git commit -m "feat: add FastPatchService for instant CSS injection into iframe"
```

---

### Task 2: Integrate FastPatchService into CanvasEngine

**Context:** Make FastPatchService available as `engine.fastPatch` so all hooks can use it.

**Files:**

- Modify: `client/lib/canvas-engine/core/CanvasEngine.ts`
- Modify: `client/lib/canvas-engine/__tests__/CanvasEngine.test.ts`

**Step 1: Add FastPatchService to CanvasEngine**

In `CanvasEngine.ts`, add:

- Import `FastPatchService`
- Create instance: `readonly fastPatch = new FastPatchService()`
- Clear patches on HMR reload (listen for `tree:change` event to clear stale patches)

```typescript
// Add to imports
import { FastPatchService } from '@/lib/fast-patch-service';

// Add to class body (after api declaration)
readonly fastPatch = new FastPatchService();
```

Add cleanup on component reload — in the existing `reloadComponent` method (or wherever
the iframe reloads), call `this.fastPatch.clearAll()`.

**Step 2: Add test**

In `CanvasEngine.test.ts`, add:

```typescript
it('exposes FastPatchService instance', () => {
  expect(engine.fastPatch).toBeDefined();
  expect(engine.fastPatch).toBeInstanceOf(FastPatchService);
});
```

**Step 3: Run tests**

Run: `bun test client/lib/canvas-engine/__tests__/CanvasEngine.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add client/lib/canvas-engine/core/CanvasEngine.ts client/lib/canvas-engine/__tests__/CanvasEngine.test.ts
git commit -m "feat: integrate FastPatchService into CanvasEngine"
```

---

### Task 3: Wire FastPatchService into useStyleSync for instant preview

**Context:** Currently useStyleSync sends changes to backend and waits for HMR.
Add fast-patch: apply CSS instantly on flush, clear patch after HMR verification completes.

**Files:**

- Modify: `client/components/RightSidebar/hooks/useStyleSync.ts`

**Step 1: Study current flushQueue()**

Read `useStyleSync.ts` — the `flushQueue` function calls `engine.updateASTStyles()`.
Before that call, inject `engine.fastPatch.applyPatch()`. After verification
(in `finishSync` callback), call `engine.fastPatch.clearPatch()`.

**Step 2: Add fast-patch calls**

In `flushQueue()`, before the engine/astOps call:

```typescript
// Instant visual feedback
if (engine?.fastPatch) {
  engine.fastPatch.applyPatch(selectedId, styles, selectedId);
}
```

In `finishSync()` callback:

```typescript
// Clear fast patch — HMR has applied the real change
if (engine?.fastPatch) {
  engine.fastPatch.clearPatch(selectedId);
}
```

**Step 3: Test manually**

Change a style in the inspector, verify the element updates instantly (no 300ms delay).

**Step 4: Commit**

```bash
git add client/components/RightSidebar/hooks/useStyleSync.ts
git commit -m "feat: wire FastPatchService into style sync for instant visual feedback"
```

---

## Part B: Multi-Select + Batch Edit

### Task 4: Batch style reading for multi-selected elements

**Context:** RightSidebar currently reads styles for `selectedIds[0]` only. For multi-select,
we need to read styles for ALL selected elements and compute the intersection (common values
shown, differing values shown as "mixed").

**Files:**

- Create: `client/components/RightSidebar/hooks/useBatchStyleData.ts`
- Create: `client/components/RightSidebar/__tests__/useBatchStyleData.test.ts`

**Step 1: Write the failing tests**

```typescript
// client/components/RightSidebar/__tests__/useBatchStyleData.test.ts
import { describe, it, expect } from 'bun:test';
import { mergeStyleData, MIXED } from '../hooks/useBatchStyleData';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/StyleAdapter';

describe('mergeStyleData', () => {
  it('returns single element styles unchanged', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red', padding: '16px' },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.padding).toBe('16px');
  });

  it('returns common values when all elements match', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red', padding: '16px' },
      { backgroundColor: 'red', padding: '16px' },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.padding).toBe('16px');
  });

  it('returns MIXED for differing values', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red', padding: '16px' },
      { backgroundColor: 'blue', padding: '16px' },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe(MIXED);
    expect(result.padding).toBe('16px');
  });

  it('returns empty object for empty input', () => {
    const result = mergeStyleData([]);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('treats undefined and missing as equal', () => {
    const styles: Partial<ParsedStyles>[] = [
      { backgroundColor: 'red' },
      { backgroundColor: 'red', padding: undefined },
    ];
    const result = mergeStyleData(styles);
    expect(result.backgroundColor).toBe('red');
    expect(result.padding).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test client/components/RightSidebar/__tests__/useBatchStyleData.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// client/components/RightSidebar/hooks/useBatchStyleData.ts
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/StyleAdapter';

export const MIXED = '__mixed__' as const;
export type MixedValue = typeof MIXED;

export type MergedStyles = {
  [K in keyof ParsedStyles]?: ParsedStyles[K] | MixedValue;
};

/**
 * Merges multiple ParsedStyles into one, marking differing values as MIXED.
 * Pure function — no hooks, no side effects.
 */
export function mergeStyleData(allStyles: Partial<ParsedStyles>[]): MergedStyles {
  if (allStyles.length === 0) return {};
  if (allStyles.length === 1) return { ...allStyles[0] };

  const keys = new Set<string>();
  for (const s of allStyles) {
    for (const k of Object.keys(s)) {
      if (s[k as keyof ParsedStyles] !== undefined) keys.add(k);
    }
  }

  const merged: MergedStyles = {};
  for (const key of keys) {
    const k = key as keyof ParsedStyles;
    const first = allStyles[0][k];
    const allSame = allStyles.every((s) => {
      const val = s[k];
      if (typeof first === 'object' && first !== null) {
        return JSON.stringify(val) === JSON.stringify(first);
      }
      return val === first;
    });
    (merged as Record<string, unknown>)[key] = allSame ? first : MIXED;
  }

  return merged;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test client/components/RightSidebar/__tests__/useBatchStyleData.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add client/components/RightSidebar/hooks/useBatchStyleData.ts client/components/RightSidebar/__tests__/useBatchStyleData.test.ts
git commit -m "feat: add mergeStyleData for multi-select style intersection"
```

---

### Task 5: Batch style write via CanvasEngine.executeBatch

**Context:** When multiple elements are selected and user changes a style, apply to all.
Use existing `engine.executeBatch()` which wraps in BatchOperation for single undo.

**Files:**

- Modify: `client/components/RightSidebar/hooks/useStyleSync.ts`

**Step 1: Update flushQueue for multi-select**

Currently `flushQueue()` operates on `selectedIds[0]`. Modify to iterate all `selectedIds`
and create one ASTStyleOperation per element, then batch them.

Key changes in `flushQueue()`:

- If `selectedIds.length === 1`: existing flow (unchanged)
- If `selectedIds.length > 1`: create batch of style operations for each element,
  apply fast-patch for each, execute via `engine.executeBatch()`

```typescript
// Inside flushQueue, when selectedIds.length > 1:
if (engine && selectedIds.length > 1) {
  // Fast-patch all elements instantly
  for (const id of selectedIds) {
    engine.fastPatch.applyPatch(id, styles, id);
  }

  // Batch AST operations for single undo
  await engine.executeBatchStyles(selectedIds, filePath, styles, {
    domClasses: '', // Each element may differ — let server resolve
    state: currentState,
  });

  for (const id of selectedIds) {
    engine.fastPatch.clearPatch(id);
  }
  finishSync();
  return;
}
```

**Step 2: Add executeBatchStyles to CanvasEngine**

In `CanvasEngine.ts`:

```typescript
async executeBatchStyles(
  elementIds: string[],
  filePath: string,
  styles: Record<string, string>,
  options?: { domClasses?: string; state?: string },
): Promise<void> {
  const operations = elementIds.map(
    (id) =>
      new ASTStyleOperation(this.api, {
        elementId: id,
        filePath,
        styles,
        ...options,
      }),
  );
  await this.executeBatch(operations);
}
```

**Step 3: Test manually**

Select 2+ elements with Cmd+Click, change padding in inspector — both should update.
Undo should revert both.

**Step 4: Commit**

```bash
git add client/lib/canvas-engine/core/CanvasEngine.ts client/components/RightSidebar/hooks/useStyleSync.ts
git commit -m "feat: batch style writes for multi-selected elements with single undo"
```

---

### Task 6: RightSidebar — show merged styles for multi-select

**Context:** RightSidebar reads styles via `useElementStyleData` which takes a single
elementId. For multi-select, read styles for each element, merge, and display. Style
sections should show "mixed" indicator when values differ.

**Files:**

- Modify: `client/components/RightSidebar/RightSidebar.tsx`
- Modify: relevant style section components (LayoutSection, SpacingSection, etc.)

**Step 1: Read styles for all selected elements**

In RightSidebar, replace single `useElementStyleData(selectedIds[0])` with a loop
that reads styles for each selected element, then merges via `mergeStyleData()`.

When only 1 element selected — existing behavior (no change).
When 2+ selected — use merged styles, show MIXED indicator in sections.

**Step 2: Add MIXED visual indicator to style inputs**

For each style input component (color picker, number input, select dropdown):

- When value is `MIXED`, show placeholder "Mixed" with dashed border
- When user types/selects a value, it overrides MIXED and applies to all elements
- Visual: gray italic "Mixed" text in input field

**Step 3: Test manually**

1. Select 2 buttons with different background colors
2. Inspector should show "Mixed" for backgroundColor
3. Change backgroundColor — both buttons update
4. Undo — both revert

**Step 4: Commit**

```bash
git add client/components/RightSidebar/
git commit -m "feat: show merged styles and Mixed indicator for multi-select"
```

---

## Part C: Drag Reorder + Swap

### Task 7: Server endpoint — move element (reorder within parent)

**Context:** No move/reorder endpoint exists. Need `POST /api/move-element` that removes
an element from its current position and inserts at a new index within the same parent
(or different parent).

**Files:**

- Create: `server/routes/moveElement.ts`
- Create: `server/routes/__tests__/moveElement.test.ts`
- Modify: `server/index.ts` (register route)

**Step 1: Write failing tests**

```typescript
// server/routes/__tests__/moveElement.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { moveElementInAST } from '../../routes/moveElement';
import { parseCode, printAST } from '@lib/ast/parser';

describe('moveElementInAST', () => {
  it('moves element from index 0 to index 2 within same parent', () => {
    const code = `
export function App() {
  return (
    <div data-uniq-id="parent">
      <span data-uniq-id="a">A</span>
      <span data-uniq-id="b">B</span>
      <span data-uniq-id="c">C</span>
    </div>
  );
}`;
    const ast = parseCode(code);
    const result = moveElementInAST(ast, {
      elementId: 'a',
      targetParentId: 'parent',
      targetIndex: 2,
    });

    expect(result.success).toBe(true);
    const output = printAST(ast);
    // Order should now be: B, C, A
    const posB = output.indexOf('data-uniq-id="b"');
    const posC = output.indexOf('data-uniq-id="c"');
    const posA = output.indexOf('data-uniq-id="a"');
    expect(posB).toBeLessThan(posC);
    expect(posC).toBeLessThan(posA);
  });

  it('moves element to different parent', () => {
    const code = `
export function App() {
  return (
    <div data-uniq-id="root">
      <div data-uniq-id="parent1">
        <span data-uniq-id="child">Hello</span>
      </div>
      <div data-uniq-id="parent2" />
    </div>
  );
}`;
    const ast = parseCode(code);
    const result = moveElementInAST(ast, {
      elementId: 'child',
      targetParentId: 'parent2',
      targetIndex: 0,
    });

    expect(result.success).toBe(true);
    const output = printAST(ast);
    // child should be inside parent2 now
    expect(output).toContain('data-uniq-id="parent2"');
    // parent1 should be empty
    const parent1Section = output.slice(
      output.indexOf('parent1'),
      output.indexOf('parent2'),
    );
    expect(parent1Section).not.toContain('child');
  });

  it('returns error for non-existent element', () => {
    const ast = parseCode('<div data-uniq-id="x" />');
    const result = moveElementInAST(ast, {
      elementId: 'nonexistent',
      targetParentId: 'x',
      targetIndex: 0,
    });
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test server/routes/__tests__/moveElement.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// server/routes/moveElement.ts
import type { Context } from 'hono';
import { parseCode, printAST, readAndParseFile, writeAST } from '@lib/ast/parser';
import { findElementByUuid } from '@lib/ast/traverser';
import { calculateRealIndex } from '@lib/ast/element-builder';
import type * as t from '@babel/types';

interface MoveElementParams {
  elementId: string;
  targetParentId: string;
  targetIndex: number;
}

interface MoveResult {
  success: boolean;
  error?: string;
}

export function moveElementInAST(
  ast: t.File,
  params: MoveElementParams,
): MoveResult {
  const { elementId, targetParentId, targetIndex } = params;

  // Find the element to move
  const elementResult = findElementByUuid(ast, elementId);
  if (!elementResult) {
    return { success: false, error: `Element ${elementId} not found` };
  }

  // Find target parent
  const targetResult = findElementByUuid(ast, targetParentId);
  if (!targetResult) {
    return { success: false, error: `Target parent ${targetParentId} not found` };
  }

  const element = elementResult.element;
  const targetParent = targetResult.element;

  // Remove from current parent via path
  const parentPath = elementResult.path.parentPath;
  if (!parentPath) {
    return { success: false, error: 'Element has no parent path' };
  }

  // Store the node before removing
  const nodeToMove = elementResult.path.node;

  // Remove from current location
  elementResult.path.remove();

  // Make target parent non-self-closing if needed
  if (
    targetParent.openingElement.selfClosing ||
    !targetParent.closingElement
  ) {
    targetParent.openingElement.selfClosing = false;
    targetParent.closingElement = {
      type: 'JSXClosingElement',
      name: { ...targetParent.openingElement.name },
    } as t.JSXClosingElement;
    if (!targetParent.children) {
      targetParent.children = [];
    }
  }

  // Calculate real index (accounting for JSXText whitespace nodes)
  const realIndex = calculateRealIndex(targetParent.children, targetIndex);

  // Insert at target position
  targetParent.children.splice(realIndex, 0, nodeToMove);

  return { success: true };
}

/**
 * POST /api/move-element
 * Body: { elementId, targetParentId, targetIndex, filePath }
 */
export async function moveElement(c: Context): Promise<Response> {
  const body = await c.req.json();
  const { elementId, targetParentId, targetIndex, filePath } = body;

  if (!elementId || !targetParentId || targetIndex === undefined || !filePath) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  const projectPath = c.get('checkedProject').path;
  const { ast, absolutePath } = await readAndParseFile(
    `${projectPath}/${filePath}`,
  );

  const result = moveElementInAST(ast, {
    elementId,
    targetParentId,
    targetIndex,
  });

  if (!result.success) {
    return c.json(result, 400);
  }

  await writeAST(ast, absolutePath);

  return c.json({ success: true });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test server/routes/__tests__/moveElement.test.ts`
Expected: PASS

**Step 5: Register route in server/index.ts**

Add to route registration:

```typescript
import { moveElement } from './routes/moveElement';
// In route setup:
app.post('/api/move-element', authMiddleware, requireEditor, requireProjectAccess, moveElement);
```

**Step 6: Commit**

```bash
git add server/routes/moveElement.ts server/routes/__tests__/moveElement.test.ts server/index.ts
git commit -m "feat: add POST /api/move-element endpoint for reordering children"
```

---

### Task 8: Server endpoint — swap elements

**Context:** Swap positions of two elements. Used when user drags one selected element
onto another. Different from move — both elements exchange positions.

**Files:**

- Create: `server/routes/swapElements.ts`
- Create: `server/routes/__tests__/swapElements.test.ts`
- Modify: `server/index.ts`

**Step 1: Write failing tests**

```typescript
// server/routes/__tests__/swapElements.test.ts
import { describe, it, expect } from 'bun:test';
import { swapElementsInAST } from '../../routes/swapElements';
import { parseCode, printAST } from '@lib/ast/parser';

describe('swapElementsInAST', () => {
  it('swaps two sibling elements', () => {
    const code = `
export function App() {
  return (
    <div data-uniq-id="parent">
      <span data-uniq-id="a">First</span>
      <span data-uniq-id="b">Second</span>
      <span data-uniq-id="c">Third</span>
    </div>
  );
}`;
    const ast = parseCode(code);
    const result = swapElementsInAST(ast, 'a', 'c');

    expect(result.success).toBe(true);
    const output = printAST(ast);
    // Order should be: C, B, A
    const posA = output.indexOf('"a"');
    const posC = output.indexOf('"c"');
    expect(posC).toBeLessThan(posA);
  });

  it('swaps elements in different parents', () => {
    const code = `
export function App() {
  return (
    <div data-uniq-id="root">
      <div data-uniq-id="p1"><span data-uniq-id="a">A</span></div>
      <div data-uniq-id="p2"><span data-uniq-id="b">B</span></div>
    </div>
  );
}`;
    const ast = parseCode(code);
    const result = swapElementsInAST(ast, 'a', 'b');

    expect(result.success).toBe(true);
    const output = printAST(ast);
    // A should now be inside p2, B inside p1
    const p1Section = output.slice(output.indexOf('p1'), output.indexOf('p2'));
    expect(p1Section).toContain('"b"');
  });
});
```

**Step 2: Implement swapElementsInAST**

Find both elements, swap their AST nodes in their respective parent's children arrays.
Handle both same-parent and cross-parent cases.

**Step 3: Register route, run tests, commit**

```bash
git add server/routes/swapElements.ts server/routes/__tests__/swapElements.test.ts server/index.ts
git commit -m "feat: add POST /api/swap-elements endpoint"
```

---

### Task 9: ASTMoveOperation + ASTSwapOperation (client)

**Context:** Client-side Operation classes for move and swap, with undo/redo support.

**Files:**

- Create: `client/lib/canvas-engine/operations/ASTMoveOperation.ts`
- Create: `client/lib/canvas-engine/operations/ASTSwapOperation.ts`
- Modify: `client/lib/canvas-engine/services/ASTApiService.ts` (add methods)
- Modify: `client/lib/canvas-engine/services/ASTApiServiceImpl.ts` (implement)
- Modify: `client/lib/canvas-engine/core/CanvasEngine.ts` (add public methods)
- Create: tests for both operations

**Step 1: Add moveElement and swapElements to ASTApiService interface**

```typescript
// In ASTApiService.ts interface:
moveElement(params: {
  elementId: string;
  filePath: string;
  targetParentId: string;
  targetIndex: number;
}): Promise<ApiResult>;

swapElements(params: {
  elementIdA: string;
  elementIdB: string;
  filePath: string;
}): Promise<ApiResult>;
```

**Step 2: Implement ASTMoveOperation**

Follow ASTInsertOperation pattern:

- `execute()`: call `api.moveElement()`, store original parentId + index for undo
- `undo()`: call `api.moveElement()` with original position
- `redo()`: re-execute

**Step 3: Implement ASTSwapOperation**

- `execute()`: call `api.swapElements(idA, idB)`
- `undo()`: call `api.swapElements(idB, idA)` (swap back)
- `redo()`: same as execute

**Step 4: Add to CanvasEngine**

```typescript
moveElement(elementId: string, filePath: string, targetParentId: string, targetIndex: number): void
swapElements(elementIdA: string, elementIdB: string, filePath: string): void
```

**Step 5: Add to MockASTApiService, write tests, commit**

```bash
git commit -m "feat: add ASTMoveOperation and ASTSwapOperation with undo/redo"
```

---

### Task 10: Drag reorder — useElementDrag hook

**Context:** Custom mouse event hook for dragging elements within flex/grid containers.
Follow existing drag pattern (useInstanceOverlays.ts): mousedown → 5px threshold →
mousemove → mouseup.

**Files:**

- Create: `client/pages/Editor/components/hooks/useElementDrag.ts`

**Step 1: Define the hook interface**

```typescript
interface UseElementDragOptions {
  enabled: boolean;
  engine: CanvasEngine;
  overlayContainerRef: React.RefObject<HTMLDivElement>;
  viewport: ViewportState;
  filePath: string;
}

interface DropIndicator {
  parentId: string;
  index: number;
  rect: { left: number; top: number; width: number; height: number };
}
```

**Step 2: Implement drag detection**

- Listen for `mousedown` on selection overlay elements
- Track mouse position, start drag after 5px threshold
- During drag: calculate drop position based on mouse proximity to sibling edges
- Show drop indicator line (thin blue bar between elements)
- On drop: call `engine.moveElement()` or `engine.swapElements()`

**Step 3: Implement swap indicator**

- When 2+ elements selected and user drags one over another selected element:
  - Show pink circles at center of each selected element
  - On drop over another selected element: swap positions

**Step 4: Implement drop indicator rendering**

Using same pattern as overlay-renderer.ts — absolutely positioned divs:

```typescript
// Drop indicator: thin blue line between elements
const indicator = document.createElement('div');
indicator.style.position = 'absolute';
indicator.style.height = '2px';
indicator.style.backgroundColor = 'rgb(59, 130, 246)';
indicator.style.borderRadius = '1px';
indicator.style.pointerEvents = 'none';
indicator.style.zIndex = '100';
```

**Step 5: Wire into CanvasEditor**

Add `useElementDrag()` call in CanvasEditor.tsx, pass required refs and engine.

**Step 6: Commit**

```bash
git commit -m "feat: add useElementDrag hook for drag reorder and element swap"
```

---

### Task 11: Drag reorder — handle .map() array reordering

**Context:** When children are rendered via `.map()`, they share the same `data-uniq-id`.
Reordering means sorting the source array. This requires detecting map context and
modifying the array in source code or in Sample* data.

**Files:**

- Modify: `client/pages/Editor/components/hooks/useElementDrag.ts`
- Modify: `server/routes/moveElement.ts`

**Step 1: Detect map context**

Use `ASTNode.mapItem` to check if dragged element is inside a `.map()`.
If yes, reordering changes the array, not JSX children.

**Step 2: Add server support for map array reorder**

New optional field in move-element request:

```typescript
{
  elementId: string;
  filePath: string;
  mapExpression: string; // e.g., "items"
  fromIndex: number;
  toIndex: number;
  isMapReorder: true;
}
```

Server finds the array variable and swaps elements at fromIndex/toIndex.

**Step 3: Commit**

```bash
git commit -m "feat: handle .map() array reordering in drag operations"
```

---

## Part D: Resize Handles

### Task 12: Detect elements with explicit width/height

**Context:** Resize handles should only appear on elements that already have explicit
`width` or `height` set (TW classes like `w-64`, `h-32`, or inline styles).

**Files:**

- Create: `client/lib/canvas-engine/utils/hasExplicitSize.ts`
- Create: `client/lib/canvas-engine/__tests__/hasExplicitSize.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'bun:test';
import { hasExplicitSize } from '../utils/hasExplicitSize';

describe('hasExplicitSize', () => {
  it('returns { width: true, height: false } for "w-64 p-4"', () => {
    expect(hasExplicitSize('w-64 p-4')).toEqual({ width: true, height: false });
  });

  it('returns { width: true, height: true } for "w-full h-screen"', () => {
    expect(hasExplicitSize('w-full h-screen')).toEqual({ width: true, height: true });
  });

  it('returns { width: false, height: false } for "p-4 m-2"', () => {
    expect(hasExplicitSize('p-4 m-2')).toEqual({ width: false, height: false });
  });

  it('handles min/max width/height', () => {
    expect(hasExplicitSize('min-w-0 max-h-96')).toEqual({ width: true, height: true });
  });
});
```

**Step 2: Implement**

```typescript
const WIDTH_PATTERNS = /\b(w-|min-w-|max-w-|basis-)/;
const HEIGHT_PATTERNS = /\b(h-|min-h-|max-h-)/;

export function hasExplicitSize(className: string): { width: boolean; height: boolean } {
  return {
    width: WIDTH_PATTERNS.test(className),
    height: HEIGHT_PATTERNS.test(className),
  };
}
```

**Step 3: Commit**

```bash
git commit -m "feat: add hasExplicitSize utility for resize handle visibility"
```

---

### Task 13: Render resize handles on selected element overlay

**Context:** Extend `overlay-renderer.ts` to render small square handles on edges/corners
of selected elements when they have explicit width/height.

**Files:**

- Modify: `shared/canvas-interaction/overlay-renderer.ts`

**Step 1: Add resize handles to selection rects**

After rendering selection rectangles, if the element has explicit w/h, add handles:

- 4 corner handles (8×8px squares) at corners of selection rect
- 4 edge handles (6×6px squares) at midpoints of edges
- Only show width handles (left/right edges) if element has explicit width
- Only show height handles (top/bottom edges) if element has explicit height
- Corners shown if both width and height are explicit

```typescript
// Handle element: small square
const handle = document.createElement('div');
handle.style.position = 'absolute';
handle.style.width = '8px';
handle.style.height = '8px';
handle.style.backgroundColor = 'rgb(59, 130, 246)';
handle.style.border = '1px solid white';
handle.style.borderRadius = '1px';
handle.style.cursor = 'nwse-resize'; // or appropriate cursor
handle.style.pointerEvents = 'auto'; // handles are clickable!
handle.style.zIndex = '20';
```

**Step 2: Add cursor styles per handle position**

| Handle | Cursor |
|--------|--------|
| top-left, bottom-right | `nwse-resize` |
| top-right, bottom-left | `nesw-resize` |
| left, right | `ew-resize` |
| top, bottom | `ns-resize` |

**Step 3: Emit handle mousedown events**

Handles need `pointerEvents: 'auto'` and `mousedown` listeners that initiate resize.
Pass callback via `OverlayRendererOptions`:

```typescript
interface OverlayRendererOptions {
  // ... existing
  onResizeHandleMouseDown?: (
    elementId: string,
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
    event: MouseEvent,
  ) => void;
  getElementSizeInfo?: (elementId: string) => { width: boolean; height: boolean } | null;
}
```

**Step 4: Commit**

```bash
git commit -m "feat: render resize handles on selected elements with explicit size"
```

---

### Task 14: useElementResize hook — drag to resize

**Context:** Hook that handles mousedown on resize handle → mousemove → mouseup,
updating element width/height via FastPatchService (instant) + AST commit (on mouseup).

**Files:**

- Create: `client/pages/Editor/components/hooks/useElementResize.ts`

**Step 1: Implement resize logic**

```typescript
interface UseElementResizeOptions {
  engine: CanvasEngine;
  viewport: ViewportState;
  filePath: string;
}
```

On mousedown from resize handle:

1. Record start mouse position + element's current w/h
2. On mousemove: calculate new w/h from delta
3. Snap to TW spacing scale (or 8px grid)
4. Apply via `engine.fastPatch.applyPatch(elementId, { width: newW, height: newH })`
5. On mouseup: clear fast patch, commit via `engine.updateASTStyles()` with new w/h

**Step 2: Wire into CanvasEditor**

Pass `onResizeHandleMouseDown` callback from this hook to `useSelectionOverlays`.

**Step 3: Commit**

```bash
git commit -m "feat: add useElementResize hook for drag-to-resize with snap"
```

---

## Part E: Alignment / Spacing Guides

### Task 15: Calculate spacing guides between elements

**Context:** When dragging or resizing, show pink lines with pixel values between
the active element and its siblings (like Figma).

**Files:**

- Create: `shared/canvas-interaction/spacing-guides.ts`
- Create: `shared/canvas-interaction/__tests__/spacing-guides.test.ts`

**Step 1: Write tests**

```typescript
import { describe, it, expect } from 'bun:test';
import { calculateSpacingGuides } from '../spacing-guides';

describe('calculateSpacingGuides', () => {
  it('calculates horizontal gap between siblings', () => {
    const active = { left: 100, top: 0, width: 50, height: 50 };
    const siblings = [{ left: 0, top: 0, width: 50, height: 50 }];

    const guides = calculateSpacingGuides(active, siblings);

    expect(guides).toContainEqual(
      expect.objectContaining({
        direction: 'horizontal',
        distance: 50, // gap between right edge of sibling and left edge of active
      }),
    );
  });
});
```

**Step 2: Implement pure calculation function**

Input: active element rect + sibling rects.
Output: array of guide lines with position + distance label.

**Step 3: Render guides via RAF overlay**

Add guide rendering to `useSelectionOverlays` or separate hook.
Pink lines (#FF69B4) with distance label in small white-on-pink badge.

**Step 4: Commit**

```bash
git commit -m "feat: add spacing guide calculations and overlay rendering"
```

---

## Part F: Platform Messages for VS Code Extension

### Task 16: Add move/swap to PlatformMessage union and PanelRouter

**Context:** VS Code extension uses RPC via platform messages. New operations need
message types and routing.

**Files:**

- Modify: `client/lib/platform/types.ts` — add `ast:moveElement`, `ast:swapElements`
- Modify: `vscode-extension/hypercanvas-preview/src/PanelRouter.ts` — route new messages
- Modify: `vscode-extension/hypercanvas-preview/src/AstBridge.ts` — handle new AST ops

**Step 1: Add message types**

```typescript
// In PlatformMessage union:
| { type: 'ast:moveElement'; requestId: string; elementId: string; filePath: string; targetParentId: string; targetIndex: number }
| { type: 'ast:swapElements'; requestId: string; elementIdA: string; elementIdB: string; filePath: string }
```

**Step 2: Add handling in AstBridge**

Follow existing pattern for `ast:insertElement` / `ast:deleteElements`.

**Step 3: Commit**

```bash
git commit -m "feat: add move/swap platform messages for VS Code extension support"
```

---

## Integration & Testing

### Task 17: End-to-end manual testing checklist

Run through each feature in both SaaS and VS Code extension:

- [ ] Multi-select 3 buttons, change background color → all update
- [ ] Multi-select shows "Mixed" for differing values
- [ ] Undo batch change → all 3 revert
- [ ] Drag element B before element A in flex container → order changes in code
- [ ] Drag inside .map() → array reorders in source
- [ ] Select 2 elements, drag one onto another → swap positions
- [ ] Pink swap circles appear on selected elements
- [ ] Resize handle appears on element with `w-64 h-32`
- [ ] Resize handle does NOT appear on element with only `p-4`
- [ ] Drag resize → element resizes with TW snap
- [ ] Spacing guides appear during drag with pixel labels
- [ ] All operations work with undo/redo
- [ ] FastPatchService: style change is visually instant
- [ ] VS Code extension: move/swap work via RPC

---

## Task Dependency Graph

```
Task 1 (FastPatchService core)
  → Task 2 (integrate into CanvasEngine)
    → Task 3 (wire into useStyleSync)
    → Task 14 (useElementResize uses it)
    → Task 10 (useElementDrag uses it)

Task 4 (mergeStyleData)
  → Task 6 (RightSidebar multi-select UI)

Task 5 (batch style write)
  → Task 6 (RightSidebar multi-select UI)

Task 7 (server move endpoint)
  → Task 9 (ASTMoveOperation)
    → Task 10 (useElementDrag)
      → Task 11 (.map() reorder)

Task 8 (server swap endpoint)
  → Task 9 (ASTSwapOperation)
    → Task 10 (useElementDrag)

Task 12 (hasExplicitSize)
  → Task 13 (resize handle overlays)
    → Task 14 (useElementResize)

Task 15 (spacing guides) — independent

Task 16 (VS Code messages) — after Tasks 7-9

Task 17 (e2e testing) — after all
```

**Parallelizable work:**

- Tasks 1-3 (FastPatch) || Tasks 4-6 (multi-select) || Tasks 7-8 (server endpoints)
- Tasks 12-14 (resize) can start after Task 2
- Task 15 (guides) is fully independent
