# Client Architecture

## Entry Points

- `client/main.tsx` — React app entry
- `client/App.tsx` — Router + providers

## State Management

- **Zustand stores** in `client/stores/`:
  - `editorStore.ts` — selected elements, split orientation, files
  - `authStore.ts` — user, tokens, workspace
  - `gitStore.ts` — git push/sync
  - `networkStore.ts` — network status

## Key Pages

- `pages/Editor/CanvasEditor.tsx` — Main editor (1500+ lines, 15+ hooks)
- `pages/Projects.tsx` — Project listing
- `pages/Login.tsx` — Auth flow
- `pages/WorkspaceSettings.tsx` — Workspace config

## Sidebar Architecture (shared SaaS + VS Code)

Both sidebars share code with VS Code extension:

**LeftSidebar/** (directory with sections/hooks):

- `LeftSidebar.tsx` — Main component
- `sections/` — ComponentsSection, ElementsTreeSection, PagesSection, TestsSection
- `hooks/` — useComponentsData, useElementsTree, useElementSelection, etc.

**RightSidebar/** (directory with sections/hooks):

- `RightSidebar.tsx` — Style inspector
- `sections/` — Appearance, Layout, Position, Margin, Fill, etc.
- `hooks/` — useStyleSync, useProjectUIKit

## Platform Detection

- `useCanvasEngineOptional()` → CanvasEngine in SaaS, null in VS Code
- `usePlatformContext()` → 'browser' or 'vscode-webview'
- SaaS-only UI hidden via `{!isVSCode && ...}`

## Canvas Engine (client/lib/canvas-engine/)

See `canvas-engine-architecture` memory for details.
Key: Command pattern, event-driven, two modes (design/board).

## Important Rules

- Always use `authFetch` instead of raw `fetch` for API calls
- Import cn from 'clsx' (not classnames)
- Use `cn()` for className concatenation, never string concat
- Use semantic Tailwind tokens for dark theme support
