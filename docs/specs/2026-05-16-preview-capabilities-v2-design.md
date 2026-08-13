# Preview Capabilities v2 — Design Spec

**Date:** 2026-05-16  
**Status:** Approved  
**Scope:** VS Code extension — preview panel, project detection, readonly screen

## Problem

Five related issues in the preview panel:

1. When auto-start is enabled, the webview shows the "Start Dev Server" button instead of a loading indicator while the server starts.
2. Auto-connect does not visually behave the same as manual button click (no progress state visible).
3. HyperIDE's own project is misdetected as `shadcn` (CSS system) because `class-variance-authority` is used as a trigger — CVA is a utility, not a shadcn signal.
4. HyperIDE is shown in readonly mode despite using fully supported technologies (Tailwind + bun bundler). Bun is already handled in `PreviewModeManager` but excluded from `FULL_EDIT_BUNDLERS`.
5. The readonly screen shows a static list of all possible CSS frameworks instead of the detected stack for this project.

## Solution Overview

- Expand `devserver:statusChanged` to carry a `status` field for 4 states.
- Replace the single `cssSystem` detection axis with 6 independent dimensions.
- Fix detection bugs: CVA is not shadcn, `bun.lockb` is not bundler, bun bundler IS supported.
- Redesign the readonly screen to show the detected stack with per-dimension support levels.
- Rename `uiKit` → `designSystem` in `ProjectCapabilities` and `StateHub`.

---

## 1. Dev Server Status (Issues 1 & 2)

### Current

`devserver:statusChanged` carries `{ running: boolean, url?: string }`. There is no `'starting'` state surfaced to the webview. During auto-start, the webview shows `StartDevServerScreen` (with a button) until the server is fully running.

### New

Extend the message:

```typescript
// extension → webview
type DevServerStatusMessage = {
  type: "devserver:statusChanged";
  status: "stopped" | "starting" | "running" | "error";
  url?: string;
  error?: string;
};
```

Wire `DevServerManager.onStatusChange` to broadcast all 4 states to the webview (currently only `stopped` and `error` are broadcast via `notifyDevServerStopped`). Add `PreviewPanel.notifyDevServerStatus(status, url?, error?)`.

When auto-start fires in `extension.ts`, send `status: 'starting'` immediately before `devServerManager.start()` resolves.

### Webview screens by status

| status     | screen                                                       |
| ---------- | ------------------------------------------------------------ |
| `stopped`  | `StartDevServerScreen` — button + auto-start checkbox        |
| `starting` | `StartingDevServerScreen` — spinner + "Starting dev server…" |
| `running`  | preview + readonly overlay if `isReadonly`                   |
| `error`    | `DevServerErrorScreen` — error message + retry button        |

`StartingDevServerScreen` replaces the button when `autoStart: true` — no button shown while server is starting.

---

## 2. Detected Stack Dimensions

Six orthogonal axes replace the single `cssSystem` field.

### 2a. CSS Framework

The style-writing mechanism. Only CSS systems for which the extension can read and AST-write styles.

```typescript
type CssFramework =
  | "tailwind"
  | "cssmodules"
  | "styled-components"
  | "emotion"
  | "sass"
  | "vanilla-extract"
  | "pandacss"
  | "unocss"
  | "stylex"
  | "unknown";
```

**Support map:**

| CSS Framework                                          | Support    |
| ------------------------------------------------------ | ---------- |
| tailwind, cssmodules, styled-components, emotion, sass | `full`     |
| vanilla-extract, pandacss, unocss, stylex              | `readonly` |
| unknown                                                | `readonly` |

Detection: same logic as current `detectCssSystem()` minus the design-system entries (mui, antd, chakra, mantine, fluent, nextui, shadcn, daisyui all move out).

### 2b. Design System

The component layer on top of CSS. Detected separately from the CSS mechanism.

```typescript
type DesignSystem =
  | "shadcn"
  | "daisyui"
  | "nextui"
  | "tamagui"
  | "mui"
  | "antd"
  | "chakra"
  | "mantine"
  | "fluent"
  | "none";
```

**Support map:**

| Design System                      | Support                     |
| ---------------------------------- | --------------------------- |
| shadcn, daisyui, nextui            | `full` (all Tailwind-based) |
| tamagui                            | `full` (special adapter)    |
| mui, antd, chakra, mantine, fluent | `readonly`                  |
| none                               | `n/a`                       |

**shadcn detection:** presence of any `@radix-ui/*` package in deps. Radix UI is the exclusive foundation of shadcn components and is not commonly used without shadcn in the React ecosystem. `class-variance-authority` alone is NOT a shadcn signal.

```typescript
function detectDesignSystem(deps: Record<string, string>): DesignSystem {
  if (Object.keys(deps).some((k) => k.startsWith("@radix-ui/"))) return "shadcn";
  if ("daisyui" in deps) return "daisyui";
  if ("@nextui-org/react" in deps) return "nextui";
  if ("tamagui" in deps || "@tamagui/core" in deps) return "tamagui";
  if ("@mui/material" in deps) return "mui";
  if ("antd" in deps) return "antd";
  if ("@chakra-ui/react" in deps) return "chakra";
  if ("@mantine/core" in deps) return "mantine";
  if ("@fluentui/react-components" in deps || "@fluentui/react" in deps) return "fluent";
  return "none";
}
```

### 2c. JS Framework

```typescript
type JsFramework =
  | "react-vanilla" // React, no meta-framework
  | "react-nextjs" // Next.js
  | "react-remix" // Remix
  | "react-unknown" // React + unrecognized meta-framework
  | "vue"
  | "svelte"
  | "solidjs"
  | "unknown";
```

**Support map:**

| JS Framework                                            | Support       |
| ------------------------------------------------------- | ------------- |
| react-vanilla, react-nextjs, react-remix, react-unknown | `full`        |
| vue, svelte, solidjs, unknown                           | `unsupported` |

Detection:

```typescript
function detectJsFramework(deps): JsFramework {
  if ("next" in deps) return "react-nextjs";
  if ("@remix-run/react" in deps) return "react-remix";
  if ("react" in deps) return "react-vanilla";
  if ("vue" in deps) return "vue";
  if ("svelte" in deps) return "svelte";
  if ("solid-js" in deps) return "solidjs";
  return "unknown";
}
```

### 2d. Router

Derived from `FrameworkType` (already detected in `framework-routing.ts`). Exposed as a separate display field.

```typescript
type RouterType =
  | "nextjs-app" // Next.js App Router
  | "nextjs-pages" // Next.js Pages Router
  | "remix" // Remix
  | "react-router-jsx" // BrowserRouter / createBrowserRouter in JSX
  | "react-router-file" // file-based React Router v6+
  | "none" // no router
  | "unknown";
```

Mapping from `FrameworkType`:

| FrameworkType              | RouterType          |
| -------------------------- | ------------------- |
| `nextjs-app-router`        | `nextjs-app`        |
| `nextjs-pages-router`      | `nextjs-pages`      |
| `remix`                    | `remix`             |
| `vite-spa-jsx-router`      | `react-router-jsx`  |
| `vite-spa-file-based`      | `react-router-file` |
| `bun`, `webpack`, `parcel` | `none`              |
| `unknown`                  | `unknown`           |

Router does not independently gate editing — it is informational and used by `PreviewModeManager` for routing strategy. Not included in `SupportLevel` gating.

### 2e. Bundler

```typescript
type Bundler = "vite" | "webpack" | "cra" | "bun" | "parcel" | "unknown";
```

**Support map:**

| Bundler            | Support                                                                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| vite, webpack, cra | `full`                                                                                                                                                     |
| bun                | `full` — entry-patch + HMR wait already implemented in `PreviewModeManager` (`case 'bun': return this._patchEntryFile({waitForPreviewRouteUpdate: true})`) |
| parcel             | `readonly`                                                                                                                                                 |
| unknown            | `unsupported`                                                                                                                                              |

**Detection — bun as bundler** (not package manager):

- `bun-plugin-*` in deps (any bun bundler plugin, e.g. `bun-plugin-tailwind`) — primary signal
- `bun-types` in deps AND no vite/webpack/next/cra — secondary signal
- Scripts contain `bun build` or `bun ./scripts/` — tertiary signal

`bun.lockb` / `bun.lock` → package manager only, NOT bundler.

**Fix in `framework-routing.ts`:** remove `hasBunLock` as a bundler trigger. Keep only `deps['bun-plugin-*']` and similar signals. This resolves a latent bug where a project using bun as PM + vite as bundler would (if vite dep were missing) fall through to `framework: 'bun'` based on the lockfile.

Also: add `'bun'` to `ProjectType` in `types.ts` and to `FULL_EDIT_BUNDLERS` in `ProjectDetector.ts`.

Derived from `detectFramework()` result (already reliable for preview pipeline) via the same mapping:

| FrameworkType                              | Bundler                     |
| ------------------------------------------ | --------------------------- |
| `nextjs-app-router`, `nextjs-pages-router` | `webpack` (Next.js default) |
| `remix`, `vite-spa-*`                      | `vite`                      |
| `webpack`                                  | `webpack`                   |
| `bun`                                      | `bun`                       |
| `parcel`                                   | `parcel`                    |
| `cra` (react-scripts)                      | `cra`                       |
| `unknown`                                  | `unknown`                   |

### 2f. Package Manager

Informational only — does not gate editing.

```typescript
type PackageManager = "bun" | "npm" | "pnpm" | "yarn" | "yarn2";
```

Detection: existing `detectPackageManager()` via lock files (`bun.lockb`/`bun.lock` → `bun`, `yarn.lock` → `yarn` or `yarn2` by content, `pnpm-lock.yaml` → `pnpm`, else `npm`).

---

## 3. Updated ProjectCapabilities

```typescript
type SupportLevel = "full" | "readonly" | "unsupported";

interface ProjectCapabilities {
  // Detected stack
  cssFramework: CssFramework;
  designSystem: DesignSystem; // replaces uiKit
  jsFramework: JsFramework;
  router: RouterType;
  bundler: Bundler;
  packageManager: PackageManager;

  // Per-dimension support
  cssSupport: SupportLevel;
  dsSupport: SupportLevel | "n/a";
  jsSupport: SupportLevel;
  bundlerSupport: SupportLevel;

  // Derived — backward compat
  canRender: boolean; // jsSupport !== 'unsupported'
  canWriteStyles: boolean; // cssSupport === 'full' && bundlerSupport === 'full'
  readonly: boolean; // canRender && !canWriteStyles
}
```

`computeCapabilities()` updated to take all new dimensions and compute support levels from the maps above.

### Rename: uiKit → designSystem

- `ProjectCapabilities.uiKit` → `designSystem` (this file)
- `computeCapabilities(uiKit, ...)` parameter → `designSystem`
- `detectUIKit()` → `detectDesignSystem()` (consolidated with new design system detection)
- `stateHub.state.projectUIKit` → `stateHub.state.projectDesignSystem`
- `stateHub.applyUpdate({ projectUIKit })` → `projectDesignSystem`
- Consumers: `AIBridge.ts`, `styling-tools.ts`, `color-token-provider.ts` — update field name

---

## 4. Readonly Screen Redesign

Show the actual detected stack, not a static compatibility table.

### New layout

```
🔒 Readonly mode

Visual editing is limited for this project.
[reason sentence]

┌─────────────────┬──────────────────────────┬───────────────┐
│ Dimension       │ Detected                 │ Support       │
├─────────────────┼──────────────────────────┼───────────────┤
│ JS Framework    │ React (vanilla)          │ ✅ Full       │
│ Router          │ React Router (JSX)       │ —             │
│ CSS Framework   │ Tailwind CSS             │ ✅ Full       │
│ Design System   │ shadcn/ui                │ ✅ Full       │
│ Bundler         │ Vite                     │ ✅ Full       │
│ Package Manager │ npm                      │ ℹ️            │
└─────────────────┴──────────────────────────┴───────────────┘

[Continue in Readonly]   (only if preview rendered successfully)
```

Rows for dimensions with `'none'` or `'n/a'` are omitted. Package manager row always shown (info only, no support column value).

**Reason sentence** derived from first `readonly` or `unsupported` dimension:

- bundlerSupport `unsupported` → "Bundler not detected — dev server cannot be managed automatically."
- bundlerSupport `readonly` → "Bundler ({name}) has partial support — preview renders but style writes are not guaranteed."
- cssSupport `readonly` → "CSS system ({name}) does not support AST-based style writes."

### ReadonlyStubScreen props

```typescript
interface ReadonlyStubScreenProps {
  capabilities: ProjectCapabilities;
  renderSucceeded: boolean;
  onContinueReadonly: () => void;
}
```

Static `SUPPORTED_CSS_TABLE` array removed.

---

## 5. HyperIDE Example (After Fixes)

| Dimension       | Detected      | Support |
| --------------- | ------------- | ------- |
| JS Framework    | react-vanilla | ✅ full |
| Router          | none          | —       |
| CSS Framework   | tailwind      | ✅ full |
| Design System   | none          | —       |
| Bundler         | bun           | ✅ full |
| Package Manager | bun           | ℹ️      |

**Overall: full editing** — readonly mode not shown.

Detection path:

- `@radix-ui/*` absent → `designSystem: none`
- `tailwindcss` present, `@radix-ui/*` absent → `cssFramework: tailwind`
- `react` present, no next/remix → `jsFramework: react-vanilla`
- `bun-plugin-tailwind` present → `bundler: bun` → `bundlerSupport: full`
- `bun.lockb` present → `packageManager: bun`
- `detectFramework()` → `{ framework: 'bun' }` → `router: none`

---

## 6. Files Changed

| File                                                         | Change                                                                                                                                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types.ts`                                                   | Add `CssFramework`, `DesignSystem`, `JsFramework`, `RouterType`, `Bundler`, `PackageManager`, `SupportLevel`; update `ProjectCapabilities`; add `'bun'` to `ProjectType`     |
| `ProjectDetector.ts`                                         | `detectCssSystem()` → remove DS entries; add `detectDesignSystem()`, `detectJsFramework()`, `detectBundler()`; update `computeCapabilities()`; fix `FULL_EDIT_BUNDLERS`      |
| `framework-routing.ts`                                       | Remove `hasBunLock` as bundler trigger; add bun-plugin-based detection                                                                                                       |
| `extension.ts`                                               | Update `runProjectDetection` calls; rename `projectUIKit` → `projectDesignSystem` in StateHub; send `status: 'starting'` on auto-start; wire `onStatusChange` for all states |
| `PreviewPanel.ts`                                            | Add `notifyDevServerStatus(status, url?, error?)`; update `_pushFullStateToWebview`                                                                                          |
| `usePreviewBridge.ts`                                        | Handle new `devserver:statusChanged` shape with `status` field                                                                                                               |
| `PreviewPanelApp.tsx`                                        | Add `StartingDevServerScreen`, `DevServerErrorScreen`; replace `SUPPORTED_CSS_TABLE` with per-capabilities table in `ReadonlyStubScreen`                                     |
| `AIBridge.ts`, `styling-tools.ts`, `color-token-provider.ts` | Rename `projectUIKit` → `projectDesignSystem`                                                                                                                                |
| `StateHub` (shared)                                          | Rename `projectUIKit` → `projectDesignSystem` — lives in `shared/`, verify SaaS consumers before merging                                                                     |
