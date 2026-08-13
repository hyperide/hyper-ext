# Plan: Drag-and-Drop Visual Feedback

## Context

Drag-and-drop реorder работает, но без визуального фидбека. Пользователь двигает элемент —
ничего не происходит визуально до момента дропа. Нужно:

1. Ghost-элемент — визуальная копия тянется за курсором (чуть крупнее + тень = "парит")
2. Drop-indicator — синяя полоска показывает куда будет вставлен элемент

## Где реализовано сейчас

- **Drag state machine**: `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` lines 1089–1160
  - `_dragState: 'idle' | 'pending' | 'dragging'`
  - `_dragPointerDown/Move/Up` — 5px threshold, sends `hypercanvas:reorderElement`
  - **Нет никакого визуального фидбека**

- **CSS injection в iframe**: `shared/canvas-interaction/style-injector.ts`
  - `buildDesignStylesCSS()` — сюда добавляем стили для ghost и indicator

- SaaS drag/reorder не реализован (не в скопе)

## Что изменяем

### 1. `shared/canvas-interaction/style-injector.ts`

Добавить в `buildDesignStylesCSS()` CSS классы:

```css
/* Ghost — clone следит за курсором */
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

/* Drop indicator line */
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

### 2. `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`

Расширить drag state machine (после строки 1099):

**Новые переменные состояния:**

```ts
let _dragGhostEl: HTMLElement | null = null;
let _dragIndicatorEl: HTMLElement | null = null;
let _dragOffsetX = 0; // cursor-to-element-topleft offset
let _dragOffsetY = 0;
let _dragSourceEl: HTMLElement | null = null;
```

**В `_dragPointerMove`** — при переходе `pending → dragging`:

```ts
// Создать ghost
const sourceEl = /* document.querySelector(`[data-uniq-id="${_dragSourceId}"]`) or elementFromPoint at start */
const rect = sourceEl.getBoundingClientRect();
_dragOffsetX = _dragStartX - rect.left;
_dragOffsetY = _dragStartY - rect.top;
_dragSourceEl = sourceEl;
sourceEl.style.opacity = '0.35';

const ghost = sourceEl.cloneNode(true) as HTMLElement;
ghost.className = ''; // убрать все классы от элемента
ghost.classList.add('hyper-drag-ghost');
ghost.style.width = `${rect.width}px`;
ghost.style.height = `${rect.height}px`;
ghost.style.left = `${_dragStartX - _dragOffsetX}px`;
ghost.style.top = `${_dragStartY - _dragOffsetY}px`;
document.body.appendChild(ghost);
_dragGhostEl = ghost;

// Создать indicator
const indicator = document.createElement('div');
indicator.classList.add('hyper-drop-indicator');
indicator.style.display = 'none';
document.body.appendChild(indicator);
_dragIndicatorEl = indicator;
```

**В `_dragPointerMove`** — когда `_dragState === 'dragging'`:

```ts
// Двигать ghost
if (_dragGhostEl) {
  _dragGhostEl.style.left = `${e.clientX - _dragOffsetX}px`;
  _dragGhostEl.style.top = `${e.clientY - _dragOffsetY}px`;
}

// Обновить indicator
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

**В `_dragPointerUp`** — cleanup:

```ts
// Убрать ghost и indicator
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

**Важный нюанс**: ghost клонирует DOM включая dataset. Нужно убрать `data-uniq-id` у клона чтобы `elementFromPoint` не путал его с оригиналом:

```ts
ghost.removeAttribute('data-uniq-id');
```

**Ещё нюанс**: в `_dragPointerDown` нужно сохранить ссылку на source element для offset-вычислений. Сохранить в `_dragSourceEl` до перехода в 'dragging'.

## Детали реализации

### Получить source element в pointerdown

В `_dragPointerDown` уже есть `e.target`. Нужно сохранить его:

```ts
_dragSourceEl = e.target as HTMLElement;
```

### Убрать глитч при клоне

Клон будет содержать все children. Если элемент содержит input/button — они тоже клонируются. Это нормально: ghost имеет `pointer-events: none` и `opacity 0.88` поэтому выглядит правильно.

### Анимация "pickup"

CSS transition `transform 0.12s ease` на `.hyper-drag-ghost` — ghost появляется уже в scale(1.03). Этот переход виден при создании элемента.

## Файлы

| Файл                                          | Изменение                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `shared/canvas-interaction/style-injector.ts` | Добавить `.hyper-drag-ghost` и `.hyper-drop-indicator` CSS в `buildDesignStylesCSS()` |
| `vscode-extension/.../iframe-interaction.ts`  | Расширить drag state machine: ghost + indicator создание/обновление/cleanup           |

## Решения по дизайну

- **Ghost**: DOM-клон элемента, `scale(1.03)`, `box-shadow`, `opacity 0.88`; оригинал → `opacity 0.35`
- **Indicator**: линия только между siblings (top/bottom edge таргета). Full-viewport ширина внутри iframe. Показывается только когда таргет ≠ источник

## Верификация

1. Собрать extension: `npm run package` в `vscode-extension/hypercanvas-preview/`
2. Установить: `code --install-extension ...vsix --force`
3. Reload Window в VS Code
4. Открыть любой компонент, потянуть элемент → видно ghost + indicator
5. Дропнуть → элемент переместился, ghost и indicator исчезли
6. Запустить тесты: `bun test shared/canvas-interaction/` — все зелёные

## Tasks

### Task 1: Add ghost and indicator CSS to style-injector

- [ ] Read `shared/canvas-interaction/style-injector.ts` — find `buildDesignStylesCSS()`.
- [ ] Add `.hyper-drag-ghost` CSS class (position:fixed, z-index max, pointer-events:none, scale(1.03), box-shadow, opacity 0.88).
- [ ] Add `.hyper-drop-indicator` CSS class (position:fixed, 2px height, blue #3b82f6, ::before/::after circles).
- [ ] Run `bun test shared/canvas-interaction/` — no regressions.

### Task 2: Add ghost state variables to iframe-interaction.ts

- [ ] Read `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts` — find `_dragState`, `_dragPointerDown`, `_dragPointerMove`, `_dragPointerUp`.
- [ ] Add variables: `_dragGhostEl`, `_dragIndicatorEl`, `_dragOffsetX`, `_dragOffsetY`, `_dragSourceEl`.
- [ ] In `_dragPointerDown`: save `_dragSourceEl = e.target as HTMLElement`.
- [ ] Run `bun run typecheck` in `vscode-extension/hypercanvas-preview/` — no errors.

### Task 3: Create ghost on pending→dragging transition

- [ ] In `_dragPointerMove`, when `_dragState` transitions `pending → dragging`:
  - Compute `_dragOffsetX/Y` from source element's `getBoundingClientRect()`.
  - Clone source element, set class to `hyper-drag-ghost`, set width/height/left/top.
  - Remove `data-uniq-id` from clone. Append to `document.body`.
  - Set source element `opacity = '0.35'`.
  - Create indicator div with class `hyper-drop-indicator`, `display:none`, append to body.
- [ ] Run `bun run typecheck` — no errors.

### Task 4: Update ghost position and indicator on each pointermove

- [ ] In `_dragPointerMove` when `_dragState === 'dragging'`:
  - Move ghost: `left = e.clientX - _dragOffsetX`, `top = e.clientY - _dragOffsetY`.
  - Get drop target via `document.elementFromPoint(e.clientX, e.clientY)`.
  - If drop target has source and is not drag source: show indicator at top/bottom of target.
  - Otherwise: hide indicator.
- [ ] Run `bun run typecheck` — no errors.

### Task 5: Cleanup on pointerup

- [ ] In `_dragPointerUp`: remove ghost from DOM, remove indicator from DOM, restore source opacity.
- [ ] Run `bun run typecheck` — no errors.

### Task 6: Build extension and manual verify

- [ ] Run `npm run package` in `vscode-extension/hypercanvas-preview/`.
- [ ] Confirm ghost appears during drag and indicator shows drop position.
