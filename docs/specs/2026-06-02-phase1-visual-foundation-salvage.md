# Phase 1 Visual Foundation — Salvage Analysis

**Date:** 2026-06-02  
**PRs:** #144 (Phase 1 → main), #218 (HYP-301 → Phase 1 branch)  
**Branches:** `HYP-phase1-visual-foundation`, `HYP-301-multiselect-committed-styles`

---

## Контекст

Ветка `HYP-phase1-visual-foundation` разрабатывалась 2026-03-09–12 (4 дня, 59 коммитов).
Merge base с main — коммит `ce02b265` (PR #151, ci-cache, ~март 2026).
На сегодня main опережает merge base на **1352 коммита**, ветка Phase 1 — на **59**.

**57 файлов с конфликтами** (53 "both modified" + 4 "delete in main, modify in phase1").

Ни одна из 8 ключевых фич Phase 1 не присутствует в main.

---

## Что выбросить

### 1. Конфигурационные файлы — ВЫБРОСИТЬ

| Файл                                  | Причина                                                         |
| ------------------------------------- | --------------------------------------------------------------- |
| `biome.jsonc`                         | Удалён в main (заменён oxlint/oxfmt). Конфликт неразрешим.      |
| `.serena/memories/common-pitfalls.md` | Удалён в main.                                                  |
| `.claude/settings.local.json`         | Локальная dev-конфигурация, не мержить никогда.                 |
| `bunfig.toml`                         | Оба изменили — но изменения cosmetic, merge вручную если нужно. |
| `CLAUDE.md` / `AGENTS.md`             | Оба кардинально расошлись (1352 коммита правок).                |

### 2. Bug-фиксы с высокой вероятностью дублирования — ПРОВЕРИТЬ ПЕРЕД МЕРЖЕМ

Следующие баги в Phase 1 помечены как исправленные, но за 1352 коммитов main мог исправить их иначе:

- HMR WebSocket port fix (`server/proxy/project-preview.ts`) — есть ли аналог в main?
- `rem→px on Arrow Up/Down` — в main появился HYP-374 (padding arrow) и вся система `computeNumericArrowValue`. Скорее всего покрыто.
- `Undo fails after resize` — проверить `HistoryManager.ts` в main.
- Missing text input debounce — проверить `RightSidebar/` в main.
- Error swallowing in ASTStyleOperation — уже в main? `git log --all -S "remove .catch"`.

### 3. PR #218 (HYP-301-multiselect-committed-styles) — ЗАКРЫТЬ

Таргетит `HYP-phase1-visual-foundation`, не `main`. CI отменён.  
Содержит: NudgeHUD + часть multi-select revert + tailwind/token fixes.  
**Решение:** Закрыть PR #218. NudgeHUD сальважировать отдельным PR на main (см. ниже).

---

## Что сохранить — по приоритету

### Tier 1: Независимые файлы, нет конфликтов — мержатся чисто

#### A. `validateFilePath` — path traversal security fix

- **Что:** `server/lib/path-security.ts` + `server/lib/__tests__/path-security.test.ts`
- **Зачем:** Защищает 16+ server routes от path traversal (`../etc/passwd`). Нет аналога в main.
- **Конфликты:** Нет (новые файлы + правки в server/routes/).
- **Риск:** Низкий. Тесты покрывают граничные случаи.
- **PR-scope:** `server/lib/path-security.ts` + `validateFilePath` в route handlers.

#### B. `spacing-guides.ts` — visual spacing indicators

- **Что:** `shared/canvas-interaction/spacing-guides.ts` (221 строка) + тесты (181 строка)
- **Зачем:** Розовые линии с расстояниями во время drag/resize. Полностью новый файл.
- **Конфликты:** Нет (новый файл, но `overlay-renderer.ts` нужно адаптировать).
- **Адаптация:** `overlay-renderer.ts` в main изменился. Нужно cherry-pick только spacing logic, вставить в актуальную версию renderer вручную.
- **PR-scope:** `spacing-guides.ts` + интеграция в `overlay-renderer.ts`.

#### C. `FastPatchService` — мгновенный CSS inject

- **Что:** `client/lib/fast-patch-service.ts` (66 строк) + тесты (82 строки)
- **Зачем:** Inject CSS в iframe напрямую (минуя HMR) для мгновенной визуальной обратной связи при drag/resize стилей. Main имеет `style-injector.ts` (design-mode CSS), но не per-property fast-patch.
- **Конфликты:** Новый файл. Но интеграция в `CanvasEngine.ts` и `useStyleSync.ts` — оба сильно изменились в main.
- **Адаптация:** Изолировать `fast-patch-service.ts` как standalone сервис, найти новые точки интеграции в актуальном `useStyleSync.ts`.
- **PR-scope:** `fast-patch-service.ts` + hook в `useStyleSync`.

---

### Tier 2: Требуют адаптации в RightSidebar/CanvasEngine

#### D. `NudgeHUD` — pixel-precise nudge

- **Что:** `client/components/NudgeHUD/` (5 файлов: EditNudgeInput, NudgeHUD, NumericMode, TokenMode, **tests**) + `client/stores/nudgeStore.ts` + `useNudgeSetup.ts` hook
- **Зачем:** Floating HUD для точного позиционирования по px/токенам. Полностью новый компонент.
- **Конфликты:** Нет для самого компонента. Конфликт в `useHotkeysSetup.ts` и `CanvasEditor.tsx` (точки монтирования).
- **Адаптация:** Найти актуальные точки монтирования в main.
- **PR-scope:** Весь `NudgeHUD/` + `nudgeStore.ts` + `useNudgeSetup.ts` + монтирование.

#### E. `useElementResize` — resize handles

- **Что:** `client/pages/Editor/components/hooks/useElementResize.ts` (260 строк) + `client/lib/canvas-engine/utils/hasExplicitSize.ts` + тесты
- **Зачем:** Canvas resize с snap-to-grid (4px), обнаружение явного размера.
- **Конфликты:** Main имеет `useResizeHandle.ts` — нужно разобраться в отличиях. `resize-utils.ts` в main — часть той же экосистемы?
- **Адаптация:** Сравнить `useResizeHandle.ts` (main) и `useElementResize.ts` (phase1). Возможно дублирование — если `useResizeHandle.ts` покрывает то же, нужно только `hasExplicitSize.ts` + snap-grid.
- **PR-scope:** После анализа useResizeHandle diff.

---

### Tier 3: Крупные фичи, много конфликтов — отдельные сессии

#### F. AST Drag reorder & swap (HYP-272/273/274)

- **Что:** `client/pages/Editor/components/hooks/useElementDrag.ts` (668 строк), `shared/canvas-interaction/drag-handler.ts` (140), `ASTMoveOperation.ts`, `ASTSwapOperation.ts`, `server/routes/moveElement.ts`, `server/routes/swapElements.ts`, платформенные сообщения в `AstBridge.ts`
- **Зачем:** Физическое перемещение JSX-нодов drag & drop. Main имеет **CSS-order drag** (`order-drag-detect.ts`) — это **другое**: меняет CSS `order:`, не AST. AST drag — постоянное структурное изменение файла.
- **Конфликты:** `CanvasEngine.ts` (много), `IframeCanvas.tsx`, `PlatformContext.tsx`, server routes (изменились в main).
- **Адаптация:** `useElementDrag.ts` нужно переписать с нуля на основе Phase 1 логики, адаптировав под актуальный API main. Нельзя cherry-pick — слишком много drift.
- **PR-scope:** Минимум 2-3 сессии: (1) ASTMoveOperation + server routes, (2) useElementDrag, (3) интеграция + drag-handler.

#### G. Multi-select batch editing (HYP-271)

- **Что:** `useBatchStyleData.ts`, `ASTBatchStyleOperation.ts`, `server/routes/updateComponentStylesBatch.ts`, глубокий рефактор `RightSidebar.tsx` (+515 строк)
- **Зачем:** Выбрать несколько элементов, редактировать общие стили одновременно с mixed-value placeholder.
- **Конфликты:** `RightSidebar.tsx` в main изменился кардинально (i18n inspector, StyleSourceTabs, новые секции). Прямой merge невозможен.
- **Адаптация:** Изолировать `ASTBatchStyleOperation` + server route (без конфликтов). `useBatchStyleData` — адаптировать под актуальные типы. RightSidebar — нужно написать PR на основе Phase 1 UX-дизайна поверх актуального кода.
- **PR-scope:** Минимум 2 сессии: (1) ASTBatchStyleOperation + server route + hook, (2) RightSidebar UI.

---

## Итоговая карта PR-ов

| PR                      | Tier   | Усилие | Риск    | Содержимое                                       |
| ----------------------- | ------ | ------ | ------- | ------------------------------------------------ |
| security/path-traversal | Tier 1 | XS     | Низкий  | `path-security.ts` + 16 route handlers           |
| feat/spacing-guides     | Tier 1 | S      | Низкий  | `spacing-guides.ts` + overlay-renderer           |
| feat/fast-patch-service | Tier 1 | S      | Средний | `fast-patch-service.ts` + useStyleSync hook      |
| feat/nudge-hud          | Tier 2 | M      | Средний | NudgeHUD + nudgeStore + hotkeys                  |
| feat/resize-canvas      | Tier 2 | M      | Средний | useElementResize + hasExplicitSize               |
| feat/ast-drag-reorder   | Tier 3 | XL     | Высокий | ASTMove/Swap + useElementDrag + server           |
| feat/multi-select-batch | Tier 3 | XL     | Высокий | ASTBatchStyle + useBatchStyleData + RightSidebar |

---

## Рекомендуемый порядок

1. **Закрыть PR #218** — бессмысленный саб-PR на мёртвую ветку.
2. **Tier 1 PRs** — можно делать параллельно, независимые. Начать с `path-security` (security fix).
3. **Tier 2 PRs** — после Tier 1 смёрживается, делать последовательно.
4. **Tier 3 PRs** — отдельное планирование. AST drag особенно требует brainstorming-сессии т.к. нужно интегрироваться с существующим CSS-order drag.

---

## Что точно НЕ делать

- **Rebase Phase 1 branch на main** — 57 конфликтов, 1352 commit drift. Стоимость больше пользы.
- **Merge PR #144 as-is** — взорвёт main.
- **Cherry-pick целых файлов типа `RightSidebar.tsx`** — Phase 1 version устарел на 3 месяца активной разработки.
- **Тащить biome.jsonc / CLAUDE.md изменения** — мусор.
