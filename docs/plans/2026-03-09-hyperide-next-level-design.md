# HyperIDE Next Level — Design Document

**Date:** 2026-03-09
**Author:** Alex Ultra + Claude
**Status:** Approved

## Vision

Transform HyperIDE from a Tailwind-focused visual React editor into a **Figma-competitive
visual development platform** for designers and managers, working with real React components
in real codebases across all popular CSS frameworks.

**Target audience:** Designers (Figma users) and managers. Developers as secondary beneficiaries.

**Positioning (unique, nobody else does this):**
> Real React components + visual direct manipulation + AI + lives in IDE + works with real project

**Key competitors analyzed:**

- **Piny** — closest (VS Code ext, TW, multi-select), but style-only, no canvas/drag/AI
- **Onlook** — Figma-like canvas over real React, but desktop app, no multi-select, no AI
- **Utopia** — code=source, but Shopify-tied, no TW, no AI
- **Plasmic** — best variants system, but cloud vendor lock-in
- **Webflow** — best style inspector, but not real React

## Strategy

**Approach: "Figma Killer" — visual-first**, then AI on top.
Deterministic style adapters for each CSS framework (not AI-based).

---

## Architecture

### Universal Two-Phase Update (FastPatchService)

All visual changes follow the same pattern:

1. **Fast path**: CSS injection into iframe -> instant visual feedback (Figma-like)
2. **Commit path**: AST mutation -> HMR -> code updated

Applies to: inspector, scrubbers, drag/reorder, resize, AI-applied changes.

### Style Adapter Layer

Deterministic adapter per framework, composable for hybrid projects.

| Adapter | Write Mode | Read | Write |
|---|---|---|---|
| `TailwindV3Adapter` | className | Parse className string | Replace/add TW classes |
| `TailwindV4Adapter` | className | Same + v4 arbitrary, `@theme` | Same + v4 syntax |
| `EmotionAdapter` | styled/sx | Parse JS style object | Mutate object properties |
| `StyledComponentsAdapter` | styled | Parse tagged template literal | Mutate CSS in template |
| `CSSModulesAdapter` | className | Read `.module.css` by binding | Mutate properties in CSS file |
| `PlainCSSAdapter` | className | Computed styles + source maps | Mutate CSS file, AI distributes across cascade |
| `InlineStyleAdapter` | style prop | Parse `style={{ }}` | Mutate style object |
| `TamaguiAdapter` | props | Parse style props | Already exists, enhance |

**Auto-detection:** scan `package.json` + import patterns -> select adapter(s).
**Preference:** always prefer TW for writing new styles (fallback and hybrid).
**Hybrid projects:** `CompositeAdapter([CSSModulesAdapter, InlineStyleAdapter, TailwindAdapter])`.

**Inspector UX:** unified panel for all frameworks. For plain CSS cascade, AI distributes
changes under the hood. DevTools-like CSS panel available as separate debug view with
direct editing (no AI needed there — cascade is explicit).

### Overall Architecture Diagram

```
+-----------------------------------------------------+
|                    VS Code Extension                 |
+----------+----------+-----------+----------+--------+
| Left     | Preview  | Right     | AI Chat  | Code   |
| Panel    | Canvas   | Inspector | Panel    | Editor |
|          |          |           |          |+scrub  |
+----------+----------+-----------+----------+--------+
|              Platform Abstraction Layer               |
+-----------------------------------------------------+
|  FastPatchService  |  Canvas Engine  |  AI Service   |
|  (CSS inject,      |  (AST ops,      |  (Claude SDK,  |
|   instant visual)  |   undo/redo,    |   Figma MCP,   |
|                    |   history)      |   suggestions) |
+--------------------+-----------------+---------------+
|              Style Adapter Layer (composable)        |
+----+----+--------+---------+--------+-------+-------+
|TW3 |TW4 |Emotion |styled-  |CSS     |Plain  |Inline |
|    |    |(+MUI   |compnts  |Modules |CSS    |Style  |
|    |    |+Chakra)|         |        |+AI    |       |
+----+----+--------+---------+--------+-------+-------+
|  Auto-detect (package.json + imports) -> prefer TW   |
+-----------------------------------------------------+
|              AST Layer (Babel + PostCSS)              |
+-----------------------------------------------------+
|         Iframe Preview (same-origin proxy)           |
|         + DevTools CSS Panel (embedded)              |
+-----------------------------------------------------+
```

---

## Feature Design

### 1. Multi-select + Batch Edit

- `Shift+Click` / `Cmd+Click` in preview and element tree
- Inspector shows **intersection** of properties (mixed values shown as "mixed")
- Batch write via `executeBatch()` (already in CanvasEngine)

### 2. Drag Reorder + Swap

- Drag children within flex/grid containers — visual drop indicator line
- For `.map()` children — sort in source array (Sample* data or source)
- **Swap any 2+ elements:** select multiple -> pink circles at center of each ->
  drag one onto another -> swap positions in AST
- Works for siblings and elements across containers (within same component)
- Drop = AST move operation

### 3. Resize Handles

- Appear only when `width`/`height` already set on element
- Drag -> update value in current framework (TW: `w-64`->`w-80`, CSS: `256px`->`320px`)
- Snap to framework standard values (TW spacing scale, 8px grid)

### 4. Alignment / Spacing Guides

- During drag: show distances to neighbors (pink lines with pixel values, like Figma)
- Guides between elements of same container
- Snap to equal distances

### 5. DevTools-like CSS Debug Panel

- Separate tab/panel — cascade of rules for selected element
- Import/reuse Chrome DevTools CSS panel (open source, BSD license) if feasible
- Both viewing AND editing (direct edit in cascade, no AI needed)

### 6. Board Mode + Component States

**Auto-detect props -> variant grid:**
- Scan component props via TypeScript AST
- For enum/union props (`size: 'sm' | 'md' | 'lg'`) generate combinations
- Each combination = separate card on board
- Boolean props (`disabled`, `loading`) = toggle on card

**Interactive pseudo-states:**
- Toolbar above selected element: `hover` / `focus` / `active` / `disabled` buttons
- Click -> force pseudo-state via CSS injection or CDP force state
- Instant result, no board switch needed

**AI smart states:**
- AI analyzes component, suggests edge cases:
  - Long text (overflow)
  - Empty list / no data
  - Network error / error state
  - RTL layout
  - Single item vs 100 items
- Generates `Sample*` for each edge case
- Appear on board as suggestions (gray cards -> click "add")

**Board layout:**
- Free canvas (Excalidraw-style, zoom/pan) — already exists
- AI arranges cards nicely on generation (Masonry/Grid-like)
- User can reposition freely after

### 7. AI Integration

**Chat -> Component (prompt-to-component):**
- In AI Chat panel: describe component in natural language
- AI generates using project's design system (shadcn, MUI, whatever is detected)
- Component appears in preview, immediately editable
- Figma MCP import: select Figma frame -> AI converts to React with project tokens
- Screenshot-to-component: paste screenshot -> Claude Vision API -> React component

**Selection-based AI:**
- Select element -> context menu or chat: "make wider", "add hover effect"
- AI sees: selected element, styles, context (parent, siblings), full component
- Result applied via same AST operations (undo works)
- Mostly already implemented, enhance

**Suggest mode:**
- AI background analysis, proposes improvements:
  - "Text contrast `#777` on `#fff` = 4.48:1, fails WCAG AA" -> fix proposal
  - "Inconsistent spacing: `gap-3` next to `gap-4`" -> unify proposal
  - "No hover state on clickable element"
  - "Text will truncate at > 20 characters"
- Non-intrusive badges on elements or in separate panel
- Click -> apply fix

### 8. Inline Scrubbers (Bret Victor)

- Click on TW class in `.tsx`/`.jsx` -> popup with horizontal scrubber
- Scrubber bound to framework scale:
  - Spacing: `p-0, p-0.5, p-1, ..., p-96`
  - Colors: visual palette grid (existing color picker)
  - Font size: `text-xs ... text-9xl`
  - Border radius: `rounded-none ... rounded-full`
- For non-TW: scrubber over standard CSS values (`4px, 8px, 12px, ...`)
- Implementation: Custom Editor Overlay (webview over editor, positioned at cursor)
- Uses universal two-phase update (fast path + commit)

---

## Phases

### Phase 1 — Visual Foundation
- Multi-select + batch edit
- Drag reorder (flex/grid children + swap any 2+)
- Resize handles (only if w/h set)
- FastPatchService (universal two-phase update)

### Phase 2 — All CSS Frameworks
- TW4 adapter
- Emotion adapter (covers MUI, Chakra)
- styled-components adapter
- CSS Modules adapter
- Plain CSS adapter (+ AI for cascade)
- Inline Style adapter
- Auto-detection + CompositeAdapter
- Tamagui adapter — already exists, enhance

### Phase 3 — Board Mode + States
- Auto-detect props -> variant grid
- Interactive pseudo-states (hover/focus/active)
- AI smart states (edge cases)
- AI card layout on canvas

### Phase 4 — AI Integration
- Prompt-to-component in AI Chat
- Screenshot-to-component (Claude Vision)
- Figma MCP import
- Selection-based AI (enhance existing)
- Suggest mode (accessibility, consistency)

### Phase 5 — Bret Victor
- Inline scrubbers in code
- Color picker inline
- Size/spacing scrubbers
- Custom overlay webview

### Phase 6 — Beyond React
- Svelte support
- Vue support
- Solid support

---

## Competitive Research

Full research reports available at:
- `/tmp/hyperide.github.io/reports/ai-design-tools-research-2026.md`
- Agent research output on visual editors (Utopia, Onlook, Piny, Plasmic, etc.)

### Key Market Stats
- Tailwind CSS: 31M+ weekly downloads, dominates
- MUI: 97K+ GitHub stars, 4.5M+ weekly downloads
- Designer AI adoption: only 31% (vs 59% developers)
- Trust in AI output: only 32%
- Lovable: $6.6B valuation, $200M ARR
