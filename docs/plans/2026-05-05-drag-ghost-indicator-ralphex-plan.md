# Drag-and-Drop Visual Feedback: Ghost Element + Drop Indicator

## Context

Drag-and-drop reorder in HyperCanvas works (sends `hypercanvas:reorderElement`) but has no
visual feedback. Users see nothing while dragging — no ghost image following the cursor,
no indicator showing the drop position. The experience feels broken.

This plan implements:

1. **Ghost element**: a semi-transparent clone of the dragged element follows the cursor (scale 1.03 + shadow = "floating" effect). Original becomes 35% opacity.
2. **Drop indicator**: a blue horizontal line between elements shows where the element will land.

## Files to Change

| File                                                                              | Change                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `shared/canvas-interaction/style-injector.ts`                                     | Add `.hyper-drag-ghost` and `.hyper-drop-indicator` CSS |
| `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` | Extend drag state machine                               |

SaaS is out of scope. Do not touch `client/` or `server/`.

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD: write a failing e2e test first, then implement.
- Do not kill existing ralphex processes.
- Do not modify `shared/canvas-interaction/` beyond `style-injector.ts`.
- Write progress to `.ralphex/progress/progress-2026-05-05-drag-ghost-indicator.txt`.
- Telegram heartbeat every 15 min.

This ralphex run is isolated. Use this Hyper Canvas worktree:

- `../hyperide-worktrees/20260505-drag-visual/hyperide`

Create it with:

```bash
git -C ../hyperide worktree add \
  ../hyperide-worktrees/20260505-drag-visual/hyperide \
  -b HYP-drag-ghost-indicator ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e
```

## Implementation Details

### CSS (style-injector.ts)

Add to `buildDesignStylesCSS()` return string:

```css
.hyper-drag-ghost {
  position: fixed !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  transform: scale(1.03) !important;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.22),
    0 0 0 2px rgba(59, 130, 246, 0.5) !important;
  opacity: 0.88 !important;
  border-radius: 4px !important;
  transition:
    transform 0.12s ease,
    box-shadow 0.12s ease !important;
  will-change: transform, left, top !important;
}
.hyper-drop-indicator {
  position: fixed !important;
  left: 4px !important;
  right: 4px !important;
  height: 2px !important;
  background: #3b82f6 !important;
  z-index: 2147483646 !important;
  pointer-events: none !important;
  border-radius: 2px !important;
}
.hyper-drop-indicator::before,
.hyper-drop-indicator::after {
  content: '' !important;
  position: absolute !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  width: 6px !important;
  height: 6px !important;
  border-radius: 50% !important;
  background: #3b82f6 !important;
}
.hyper-drop-indicator::before {
  left: -3px !important;
}
.hyper-drop-indicator::after {
  right: -3px !important;
}
```

### Drag State Machine (iframe-interaction.ts)

New state variables (add alongside `_dragState`):

```ts
let _dragGhostEl: HTMLElement | null = null;
let _dragIndicatorEl: HTMLElement | null = null;
let _dragOffsetX = 0;
let _dragOffsetY = 0;
let _dragSourceEl: HTMLElement | null = null;
```

In `_dragPointerDown`: save `_dragSourceEl = e.target as HTMLElement`.

In `_dragPointerMove`, transition `pending → dragging`:

```ts
const rect = _dragSourceEl!.getBoundingClientRect();
_dragOffsetX = _dragStartX - rect.left;
_dragOffsetY = _dragStartY - rect.top;
_dragSourceEl!.style.opacity = '0.35';

const ghost = _dragSourceEl!.cloneNode(true) as HTMLElement;
ghost.className = '';
ghost.classList.add('hyper-drag-ghost');
ghost.removeAttribute('data-uniq-id'); // prevent elementFromPoint confusion
ghost.style.width = `${rect.width}px`;
ghost.style.height = `${rect.height}px`;
ghost.style.left = `${_dragStartX - _dragOffsetX}px`;
ghost.style.top = `${_dragStartY - _dragOffsetY}px`;
document.body.appendChild(ghost);
_dragGhostEl = ghost;

const indicator = document.createElement('div');
indicator.classList.add('hyper-drop-indicator');
indicator.style.display = 'none';
document.body.appendChild(indicator);
_dragIndicatorEl = indicator;
```

In `_dragPointerMove`, when `_dragState === 'dragging'`:

```ts
if (_dragGhostEl) {
  _dragGhostEl.style.left = `${e.clientX - _dragOffsetX}px`;
  _dragGhostEl.style.top = `${e.clientY - _dragOffsetY}px`;
}
if (_dragIndicatorEl) {
  const dropEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  const dropSrc = dropEl ? iframeResolver.getSourceLocation(dropEl) : null;
  if (dropSrc) {
    const targetId = `${dropSrc.fileName}:${dropSrc.line}:${dropSrc.column}`;
    if (targetId !== _dragSourceId) {
      const r = dropEl!.getBoundingClientRect();
      const isBefore = e.clientY < r.top + r.height / 2;
      const lineY = isBefore ? r.top : r.bottom;
      _dragIndicatorEl.style.display = 'block';
      _dragIndicatorEl.style.top = `${lineY - 1}px`;
    } else {
      _dragIndicatorEl.style.display = 'none';
    }
  } else {
    _dragIndicatorEl.style.display = 'none';
  }
}
```

In `_dragPointerUp`:

```ts
if (_dragGhostEl) {
  _dragGhostEl.remove();
  _dragGhostEl = null;
}
if (_dragIndicatorEl) {
  _dragIndicatorEl.remove();
  _dragIndicatorEl = null;
}
if (_dragSourceEl) {
  _dragSourceEl.style.opacity = '';
  _dragSourceEl = null;
}
```

### Task 1: Write RED e2e Test

- [ ] Read `ext-test-projects/e2e/tests/project-independent/drag-reorder.spec.ts` for drag patterns.
- [ ] Add a test to `drag-reorder.spec.ts` that:
  - Starts dragging an element (mousedown + small mousemove)
  - While dragging, asserts a `.hyper-drag-ghost` element exists in the DOM
  - Asserts `.hyper-drop-indicator` exists (may need to hover over a sibling)
  - Drops element, asserts ghost and indicator are removed
- [ ] Run test — confirm RED (no ghost/indicator in current build).

Acceptance: test exists and fails because ghost/indicator are absent.

### Task 2: Add CSS to style-injector.ts

- [ ] Read `shared/canvas-interaction/style-injector.ts`.
- [ ] Add the ghost and indicator CSS classes to `buildDesignStylesCSS()`.
- [ ] Run `bun test shared/canvas-interaction/` — confirm no regressions.

### Task 3: Extend Drag State Machine

- [ ] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — drag section (~lines 1089–1160).
- [ ] Add state variables.
- [ ] Implement ghost creation/movement in `_dragPointerMove`.
- [ ] Implement indicator update in `_dragPointerMove`.
- [ ] Implement cleanup in `_dragPointerUp`.
- [ ] Also clean up in any error path (e.g. pointercancel if it exists).

### Task 4: Build and Verify

- [ ] Build: `cd vscode-extension/hypercanvas-preview && npm run package`.
- [ ] Install: `code --install-extension hypercanvas-preview-*.vsix --force`.
- [ ] Reload VS Code: `vscmd workbench.action.reloadWindow -p ../ext-test-projects/react-vite-tw4-twitter`.
- [ ] Run e2e test — confirm GREEN.
- [ ] Manual visual check: drag an element, see ghost + indicator, release.

Acceptance: test GREEN, ghost follows cursor, indicator shows drop position, both disappear on drop.

### Task 5: Capture Screenshots

- [ ] Capture `/tmp/drag-ghost-before.png` — without dragging (baseline).
- [ ] Capture `/tmp/drag-ghost-during.png` — mid-drag, ghost visible.
- [ ] Capture `/tmp/drag-indicator.png` — indicator line visible between elements.

### Task 6: Lint + Typecheck

- [ ] `bun lint` in hyperide.
- [ ] Fix any errors.

### Task 7: Commit

- [ ] Commit: `feat(drag): ghost element and drop indicator for drag-and-drop reorder`.

### Task 8: Telegram Handoff

- [ ] Send summary: test result, what changed.
- [ ] Send screenshots: ghost during drag + indicator.
