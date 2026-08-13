# Preview Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken preview by implementing App Shell mode (default) and Isolated mode (opt-in via `.hyperide/preview.tsx`), replacing the broken `/test-preview → /` proxy rewrite with proper framework-aware route file generation.

**Architecture:** Extension generates `src/__canvas_preview__.tsx` (component only, no `createRoot`) plus a framework-specific route file at the appropriate path. The route file renders `<CanvasPreview />` inside the app's CSS/provider context. Isolated mode (Tier 1 for Vite/Parcel, Tier 2 for Webpack) activates when `.hyperide/preview.tsx` is created and renders a standalone entry with `createRoot` + user-defined providers.

**Tech Stack:** TypeScript, `recast` (AST editing, already in deps), `@babel/parser` (AST analysis, already in deps), Node.js `fs.watch` for FSWatch, Bun test, `InMemoryFileIO` pattern for unit tests.

**Spec:** `docs/specs/2026-03-19-preview-routing-design.md`

---

## File Map

**Create:**

- `lib/preview-generator/framework-routing.ts` — framework detection, route file path resolution, route file content generation
- `lib/preview-generator/__tests__/framework-routing.test.ts` — unit tests
- `lib/proxy/response-processor.ts` — shared proxy response helpers: `injectScripts(html, scripts)`, `swapEntryScript(html, newSrc)`; imported by both extension proxy and SaaS proxy

**Modify:**

- `lib/preview-generator/generator.ts` — add `generateStandaloneEntry()`
- `lib/preview-generator/__tests__/generator.test.ts` — add `generateStandaloneEntry` tests
- `lib/preview-generator/preview-file-manager.ts` — add `ensurePreviewFiles()`, `ensureGitExclude()`, `generateRouteFile()`, `generateBlankLayout()`, `patchRouterConfig()`, `revertRouterPatch()`; modify `ensureComponent()` for init-time full scan + fast AST check
- `lib/preview-generator/__tests__/preview-file-manager.test.ts` — tests for new methods
- `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts` — remove `/test-preview→/` rewrite; add Tier 1 HTML script swap; add FSWatch on `.hyperide/preview.tsx`
- `vscode-extension/hypercanvas-preview/src/extension.ts` — remove `refresh()`, call `ensurePreviewFiles()`

**Step 6 SaaS cleanup (coordinate with server deploy):**

- `client/main.tsx` — remove `isPreviewPath` check and `CanvasPreview` import
- `client/components/IframeCanvas.tsx` — remove `POST /api/generate-preview` calls
- `server/proxy/project-preview.ts` — add Tier 1 HTML rewrite for containers without `.hyperide/preview.tsx`

**Delete (Step 6):**

- `client/CanvasPreviewEntry.tsx`
- `server/routes/generatePreview.ts`

---

## Task 1: Framework detection

**Files:**

- Create: `lib/preview-generator/framework-routing.ts`
- Create: `lib/preview-generator/__tests__/framework-routing.test.ts`

### Background

Framework detection is deterministic (no AI). Primary signal is `package.json` deps — one read, unambiguous. Filesystem checks are secondary and only used to sub-classify within a framework.

```
package.json deps (primary, checked first):
  "next"                → nextjs-* (sub-classify via filesystem)
  "@remix-run/react"    → remix
  "vite"                → vite-spa-* (sub-classify via filesystem)
  "react-scripts"       → webpack  (CRA — uses webpack under the hood)
  "webpack"             → webpack
  "parcel"              → parcel
  otherwise             → unknown

### Project type support matrix

| Type | Status | Notes |
|------|--------|-------|
| Next.js (App Router) | ✅ Supported | |
| Next.js (Pages Router) | ✅ Supported | |
| Vite SPA (file-based routing) | ✅ Supported | |
| Vite SPA (JSX router) | ✅ Supported | |
| CRA / Webpack | ✅ Supported | |
| Parcel | ✅ Supported | |
| Remix | ✅ Supported | |
| Vue | 🔜 Planned | |
| Svelte / SvelteKit | 🔜 Planned | |
| Solid.js | 🔜 Planned | |
| HTML/CSS (no bundler) | 🔜 Planned | |
| jQuery | ❌ Not planned | Invest to prioritize |
| Vanilla JS | ❌ Not planned | Invest to prioritize |
| Angular | ❌ Not planned | Invest to prioritize |

When `detectFramework` returns `unknown`, both SaaS and VS Code extension show a dedicated
"unsupported project type" UI instead of a broken/empty preview. The UI should:

- SaaS: toast + inline message in the preview panel explaining which frameworks are supported
  and which are on the roadmap (link to roadmap page).
- Extension: webview error panel with the same messaging.

Do **not** silently fail or show a blank iframe — users need a clear explanation.

Filesystem sub-classification (only runs after primary dep match):
  next + app/layout.tsx OR src/app/layout.tsx  → nextjs-app-router
  next + pages/_app.tsx OR src/pages/_app.tsx  → nextjs-pages-router
  next + neither                               → nextjs-app-router (modern Next.js default)
  vite + app/routes/ OR src/routes/            → vite-spa-file-based
  vite + no routes dir                         → vite-spa-jsx-router
```

- [ ] **Step 1.1: Write the failing tests**

```ts
// lib/preview-generator/__tests__/framework-routing.test.ts
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import { detectFramework } from '../framework-routing';

function makeIO(pkg: Record<string, unknown>, files: string[] = []): FileIO {
  const fileSet = new Set(files);
  return {
    async readFile(p: string) {
      if (p.endsWith('package.json')) return JSON.stringify(pkg);
      if (!fileSet.has(p)) throw new Error(`ENOENT: ${p}`);
      return '';
    },
    async writeFile() {},
    async access(p: string) {
      const exists = fileSet.has(p) || files.some((f) => f.startsWith(p + '/'));
      if (!exists) throw new Error(`ENOENT: ${p}`);
    },
  };
}

const root = '/project';

describe('detectFramework — primary via package.json', () => {
  it('detects Next.js App Router via app/layout.tsx, returns appDir: "app"', async () => {
    const io = makeIO({ dependencies: { next: '^14.0.0' } }, [`${root}/app/layout.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('nextjs-app-router');
    expect(result.appDir).toBe('app');
  });

  it('detects Next.js App Router via src/app/layout.tsx, returns appDir: "src/app"', async () => {
    const io = makeIO({ dependencies: { next: '^14.0.0' } }, [`${root}/src/app/layout.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('nextjs-app-router');
    expect(result.appDir).toBe('src/app');
  });

  it('detects Next.js Pages Router via pages/_app.tsx, returns pagesDir: "pages"', async () => {
    const io = makeIO({ dependencies: { next: '^14.0.0' } }, [`${root}/pages/_app.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('nextjs-pages-router');
    expect(result.pagesDir).toBe('pages');
  });

  it('detects Next.js Pages Router via src/pages/_app.tsx, returns pagesDir: "src/pages"', async () => {
    const io = makeIO({ dependencies: { next: '^14.0.0' } }, [`${root}/src/pages/_app.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('nextjs-pages-router');
    expect(result.pagesDir).toBe('src/pages');
  });

  it('detects Next.js App Router by default when no filesystem signal', async () => {
    const io = makeIO({ dependencies: { next: '^14.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('nextjs-app-router');
  });

  it('detects Remix via "@remix-run/react" dep, returns routesDir: "app/routes"', async () => {
    const io = makeIO({ dependencies: { '@remix-run/react': '^2.0.0' } });
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('remix');
    expect(result.routesDir).toBe('app/routes');
  });

  it('detects Vite SPA (file-based) via app/routes/, returns routesDir: "app/routes"', async () => {
    const io = makeIO({ dependencies: { vite: '^5.0.0' } }, [`${root}/app/routes/home.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('vite-spa-file-based');
    expect(result.routesDir).toBe('app/routes');
  });

  it('detects Vite SPA (file-based) via src/routes/, returns routesDir: "src/routes"', async () => {
    const io = makeIO({ dependencies: { vite: '^5.0.0' } }, [`${root}/src/routes/home.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('vite-spa-file-based');
    expect(result.routesDir).toBe('src/routes');
  });

  it('detects Vite SPA (JSX router) via "vite" dep, no routes dir', async () => {
    const io = makeIO({ dependencies: { vite: '^5.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('vite-spa-jsx-router');
  });

  it('detects CRA via "react-scripts" dep → webpack', async () => {
    const io = makeIO({ dependencies: { 'react-scripts': '^5.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('webpack');
  });

  it('detects plain webpack via "webpack" dep', async () => {
    const io = makeIO({ devDependencies: { webpack: '^5.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('webpack');
  });

  it('detects Parcel via "parcel" dep', async () => {
    const io = makeIO({ devDependencies: { parcel: '^2.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('parcel');
  });

  it('returns unknown when no known deps and no config files', async () => {
    const io = makeIO({ dependencies: { react: '^18.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('unknown');
  });

  it('returns unknown when package.json is missing', async () => {
    const io: FileIO = {
      async readFile() {
        throw new Error('ENOENT');
      },
      async writeFile() {},
      async access() {
        throw new Error('ENOENT');
      },
    };
    expect((await detectFramework(root, io)).framework).toBe('unknown');
  });
});
```

- [ ] **Step 1.2: Run test — expect FAIL (module not found)**

```bash
bun run test lib/preview-generator/__tests__/framework-routing.test.ts
```

Expected: `Cannot find module '../framework-routing'`

- [ ] **Step 1.3: Implement `framework-routing.ts`**

```ts
// lib/preview-generator/framework-routing.ts
/**
 * @file Deterministic framework detection from project filesystem.
 * Accessed via: PreviewFileManager.ensurePreviewFiles() on component select
 * Assumptions: detection rules are checked in order; first match wins
 */

import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';

export type FrameworkType =
  | 'nextjs-app-router'
  | 'nextjs-pages-router'
  | 'remix'
  | 'vite-spa-file-based'
  | 'vite-spa-jsx-router'
  | 'parcel'
  | 'webpack'
  | 'unknown';

/** Rich detection result that includes the actual dirs found on disk. */
export interface DetectionResult {
  framework: FrameworkType;
  /** Actual app dir found (e.g. 'app' or 'src/app'). Set for nextjs-app-router and remix. */
  appDir?: string;
  /** Actual pages dir found (e.g. 'pages' or 'src/pages'). Set for nextjs-pages-router. */
  pagesDir?: string;
  /** Actual routes dir found (e.g. 'app/routes' or 'src/routes'). Set for vite-spa-file-based and remix. */
  routesDir?: string;
}

async function exists(io: FileIO, p: string): Promise<boolean> {
  try {
    await io.access(p);
    return true;
  } catch {
    return false;
  }
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectFramework(projectRoot: string, io: FileIO): Promise<DetectionResult> {
  // 1. Read package.json once — primary signal for all frameworks
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(await io.readFile(join(projectRoot, 'package.json'))) as PackageJson;
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    /* package.json missing — fall through to unknown */
  }

  // 2. Next.js — sub-classify via filesystem, preserve actual dir for path generation
  if (deps['next']) {
    if (await exists(io, join(projectRoot, 'app/layout.tsx'))) return { framework: 'nextjs-app-router', appDir: 'app' };
    if (await exists(io, join(projectRoot, 'src/app/layout.tsx')))
      return { framework: 'nextjs-app-router', appDir: 'src/app' };
    if (await exists(io, join(projectRoot, 'pages/_app.tsx')))
      return { framework: 'nextjs-pages-router', pagesDir: 'pages' };
    if (await exists(io, join(projectRoot, 'src/pages/_app.tsx')))
      return { framework: 'nextjs-pages-router', pagesDir: 'src/pages' };
    return { framework: 'nextjs-app-router', appDir: 'app' }; // modern Next.js default
  }

  // 3. Remix — prefer app/routes/, fallback to src/routes/
  if (deps['@remix-run/react'] || deps['@remix-run/node']) {
    const routesDir = (await exists(io, join(projectRoot, 'src/routes'))) ? 'src/routes' : 'app/routes';
    return { framework: 'remix', routesDir };
  }

  // 4. Vite — sub-classify via filesystem, preserve actual routes dir
  if (deps['vite']) {
    if (await exists(io, join(projectRoot, 'app/routes')))
      return { framework: 'vite-spa-file-based', routesDir: 'app/routes' };
    if (await exists(io, join(projectRoot, 'src/routes')))
      return { framework: 'vite-spa-file-based', routesDir: 'src/routes' };
    return { framework: 'vite-spa-jsx-router' };
  }

  // 5. CRA (react-scripts) and plain Webpack — both get webpack treatment
  if (deps['react-scripts'] || deps['webpack']) return { framework: 'webpack' };

  // 6. Parcel
  if (deps['parcel']) return { framework: 'parcel' };

  return { framework: 'unknown' };
}
```

- [ ] **Step 1.4: Run test — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/framework-routing.test.ts
```

- [ ] **Step 1.5: Commit**

```bash
git add lib/preview-generator/framework-routing.ts \
        lib/preview-generator/__tests__/framework-routing.test.ts
git commit -m "feat(preview): add deterministic framework detector"
```

---

## Task 2: Route file content generators

**Files:**

- Modify: `lib/preview-generator/framework-routing.ts` — add route content generators
- Modify: `lib/preview-generator/__tests__/framework-routing.test.ts` — add content tests

Route files import `CanvasPreview` (default import) from `__canvas_preview__`. The import path is computed relative to where the route file lives. Preview file is always at `src/__canvas_preview__` (or `apps/next/__canvas_preview__` for monorepo, but that's handled by `getPreviewFilePath()` — route generators receive the absolute preview path and compute relative import).

- [ ] **Step 2.1: Write failing tests for route content generators**

Add to `__tests__/framework-routing.test.ts`:

```ts
import { getRouteFilePaths, generateRouteFileContent, generateBlankLayoutContent } from '../framework-routing';

describe('getRouteFilePaths', () => {
  it('returns app/test-preview/* for nextjs-app-router with appDir: "app"', () => {
    const paths = getRouteFilePaths({ framework: 'nextjs-app-router', appDir: 'app' }, '/project');
    expect(paths.routeFile).toBe('/project/app/test-preview/page.tsx');
    expect(paths.layoutFile).toBe('/project/app/test-preview/layout.tsx');
  });

  it('returns src/app/test-preview/* for nextjs-app-router with appDir: "src/app"', () => {
    const paths = getRouteFilePaths({ framework: 'nextjs-app-router', appDir: 'src/app' }, '/project');
    expect(paths.routeFile).toBe('/project/src/app/test-preview/page.tsx');
    expect(paths.layoutFile).toBe('/project/src/app/test-preview/layout.tsx');
  });

  it('returns pages/test-preview.tsx for nextjs-pages-router with pagesDir: "pages"', () => {
    const paths = getRouteFilePaths({ framework: 'nextjs-pages-router', pagesDir: 'pages' }, '/project');
    expect(paths.routeFile).toBe('/project/pages/test-preview.tsx');
    expect(paths.layoutFile).toBeUndefined();
  });

  it('returns src/pages/test-preview.tsx for nextjs-pages-router with pagesDir: "src/pages"', () => {
    const paths = getRouteFilePaths({ framework: 'nextjs-pages-router', pagesDir: 'src/pages' }, '/project');
    expect(paths.routeFile).toBe('/project/src/pages/test-preview.tsx');
    expect(paths.layoutFile).toBeUndefined();
  });

  it('returns app/routes/test-preview.tsx for remix with routesDir: "app/routes"', () => {
    const paths = getRouteFilePaths({ framework: 'remix', routesDir: 'app/routes' }, '/project');
    expect(paths.routeFile).toBe('/project/app/routes/test-preview.tsx');
    expect(paths.layoutFile).toBeUndefined();
  });

  it('returns src/routes/test-preview.tsx for remix with routesDir: "src/routes"', () => {
    const paths = getRouteFilePaths({ framework: 'remix', routesDir: 'src/routes' }, '/project');
    expect(paths.routeFile).toBe('/project/src/routes/test-preview.tsx');
  });
});

describe('generateRouteFileContent', () => {
  it('nextjs-app-router route uses useSearchParams + Suspense', () => {
    const content = generateRouteFileContent('nextjs-app-router', '../../src/__canvas_preview__');
    expect(content).toContain("'use client'");
    expect(content).toContain('useSearchParams');
    expect(content).toContain('Suspense');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('CanvasPreview');
  });

  it('nextjs-pages-router route renders CanvasPreview directly', () => {
    const content = generateRouteFileContent('nextjs-pages-router', '../src/__canvas_preview__');
    expect(content).toContain('CanvasPreview');
    expect(content).toContain('@hyperide-managed');
    expect(content).not.toContain('useSearchParams');
  });

  it('remix route renders CanvasPreview', () => {
    const content = generateRouteFileContent('remix', '../../src/__canvas_preview__');
    expect(content).toContain('CanvasPreview');
    expect(content).toContain('@hyperide-managed');
  });
});

describe('generateBlankLayoutContent', () => {
  it('returns a passthrough layout', () => {
    const content = generateBlankLayoutContent();
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('children');
    expect(content).toContain('{children}');
  });
});
```

- [ ] **Step 2.2: Run test — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/framework-routing.test.ts
```

Expected: `getRouteFilePaths is not a function` (or similar)

- [ ] **Step 2.3: Implement route generators in `framework-routing.ts`**

Add after `detectFramework`:

```ts
export interface RouteFilePaths {
  routeFile: string;
  layoutFile?: string;
}

/**
 * Compute paths for framework-specific route files using actual dirs from DetectionResult.
 * Callers must pass the full DetectionResult so paths match the dirs that actually exist on disk.
 */
export function getRouteFilePaths(result: DetectionResult, projectRoot: string): RouteFilePaths {
  const { framework, appDir = 'app', pagesDir = 'pages', routesDir } = result;
  switch (framework) {
    case 'nextjs-app-router':
      return {
        routeFile: join(projectRoot, appDir, 'test-preview/page.tsx'),
        layoutFile: join(projectRoot, appDir, 'test-preview/layout.tsx'),
      };
    case 'nextjs-pages-router':
      return { routeFile: join(projectRoot, pagesDir, 'test-preview.tsx') };
    case 'remix':
    case 'vite-spa-file-based':
      return { routeFile: join(projectRoot, routesDir ?? 'app/routes', 'test-preview.tsx') };
    default:
      // webpack, parcel, vite-spa-jsx-router, unknown — no file-based route
      return { routeFile: '' };
  }
}

export function generateRouteFileContent(framework: FrameworkType, previewImportPath: string): string {
  const managed = '// @hyperide-managed';

  if (framework === 'nextjs-app-router') {
    return `${managed}
'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import CanvasPreview from '${previewImportPath}';

function PreviewContent() {
  return <CanvasPreview />;
}

export default function TestPreviewPage() {
  return <Suspense><PreviewContent /></Suspense>;
}
`;
  }

  if (framework === 'nextjs-pages-router') {
    return `${managed}
import CanvasPreview from '${previewImportPath}';

export default function TestPreviewPage() {
  return <CanvasPreview />;
}
`;
  }

  // Remix, Vite file-based
  return `${managed}
import CanvasPreview from '${previewImportPath}';

export default function TestPreviewRoute() {
  return <CanvasPreview />;
}
`;
}

export function generateBlankLayoutContent(): string {
  return `// @hyperide-managed
import type { ReactNode } from 'react';

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
`;
}
```

- [ ] **Step 2.4: Run test — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/framework-routing.test.ts
```

- [ ] **Step 2.5: Commit**

```bash
git add lib/preview-generator/framework-routing.ts \
        lib/preview-generator/__tests__/framework-routing.test.ts
git commit -m "feat(preview): route file content generators for all frameworks"
```

---

## Task 3: `ensurePreviewFiles()`

**Files:**

- Modify: `lib/preview-generator/preview-file-manager.ts`
- Modify: `lib/preview-generator/__tests__/preview-file-manager.test.ts`

### 3b — `ensurePreviewFiles()` in `PreviewFileManager`

This method is idempotent: it generates the route file(s) only if they don't already contain `@hyperide-managed`. Must not overwrite user-created files (P3-3 check).

- [ ] **Step 3b.1: Write failing tests**

Add to `preview-file-manager.test.ts`:

```ts
import {
  detectFramework,
  getRouteFilePaths,
  generateRouteFileContent,
  generateBlankLayoutContent,
} from '../framework-routing';

describe('PreviewFileManager.ensurePreviewFiles', () => {
  it('generates route file for Next.js App Router', async () => {
    const io = new InMemoryFileIO();
    // Simulate Next.js App Router project
    io.files.set('/project/app/layout.tsx', 'export default function RootLayout...');
    // Pre-populate source component
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    // Pre-populate __canvas_preview__.tsx (as if ensureComponent ran first)
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    const routeFile = io.files.get('/project/app/test-preview/page.tsx');
    expect(routeFile).toBeDefined();
    expect(routeFile).toContain('@hyperide-managed');
    expect(routeFile).toContain('CanvasPreview');
    expect(routeFile).toContain('useSearchParams');

    const layoutFile = io.files.get('/project/app/test-preview/layout.tsx');
    expect(layoutFile).toBeDefined();
    expect(layoutFile).toContain('@hyperide-managed');
  });

  it('skips route file if it already exists with @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    const existingContent = '// @hyperide-managed\nexport default function TestPreviewPage() {}';
    io.files.set('/project/app/test-preview/page.tsx', existingContent);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    // File should remain unchanged
    expect(io.files.get('/project/app/test-preview/page.tsx')).toBe(existingContent);
  });

  it('does not overwrite user file without @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    const userContent = 'export default function UserPage() { return <div>My page</div>; }';
    io.files.set('/project/app/test-preview/page.tsx', userContent);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensurePreviewFiles();

    // User file must not be overwritten
    expect(io.files.get('/project/app/test-preview/page.tsx')).toBe(userContent);
  });

  it('does nothing for unknown framework', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    // Should not throw
    await expect(manager.ensurePreviewFiles()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3b.2: Run test — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

Expected: `manager.ensurePreviewFiles is not a function`

- [ ] **Step 3b.3: Implement `ensurePreviewFiles()` in `PreviewFileManager`**

Add these imports at the top of `preview-file-manager.ts`:

```ts
import { relative, dirname as pathDirname } from 'node:path';
import {
  detectFramework,
  generateBlankLayoutContent,
  generateRouteFileContent,
  getRouteFilePaths,
  type FrameworkType,
} from './framework-routing';
```

Add method to the `PreviewFileManager` class:

```ts
/**
 * Ensure framework-specific route file(s) exist for App Shell mode.
 * Idempotent — skips files that already contain @hyperide-managed.
 * Does not overwrite user files (P3-3).
 */
async ensurePreviewFiles(): Promise<void> {
  const framework = await detectFramework(this.projectRoot, this.io);
  if (framework === 'unknown' || framework === 'webpack' || framework === 'vite-spa-jsx-router' || framework === 'parcel') {
    // These frameworks require AST patching (separate methods) or are unsupported
    return;
  }

  const previewPath = await this.getPreviewFilePath();
  const paths = getRouteFilePaths(framework, this.projectRoot);

  if (!paths.routeFile) return;

  // Compute import path from route file to preview file
  const routeDir = pathDirname(paths.routeFile);
  let importPath = relative(routeDir, previewPath).replace(/\.\w+$/, '');
  if (!importPath.startsWith('.')) importPath = `./${importPath}`;

  await this._writeIfSafe(paths.routeFile, generateRouteFileContent(framework, importPath));

  if (paths.layoutFile) {
    await this._writeIfSafe(paths.layoutFile, generateBlankLayoutContent());
  }
}

/**
 * Write file only if it doesn't exist or already contains @hyperide-managed.
 * Prevents overwriting user files.
 */
private async _writeIfSafe(filePath: string, content: string): Promise<void> {
  try {
    const existing = await this.io.readFile(filePath);
    if (!existing.includes('@hyperide-managed')) {
      console.warn(`[PreviewFileManager] Skipping ${filePath} — exists without @hyperide-managed marker`);
      return;
    }
    // Already managed — skip (idempotent)
    return;
  } catch {
    // File doesn't exist — safe to write
  }
  await this.io.writeFile(filePath, content);
}
```

Note: `_writeIfSafe` currently always skips if the managed file exists (idempotent). If you need to regenerate (e.g. after mode switch), call `_cleanupPreviewFiles()` first (Task 3c adds this).

- [ ] **Step 3b.4: Run test — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 3b.5: Commit**

```bash
git add lib/preview-generator/preview-file-manager.ts \
        lib/preview-generator/__tests__/preview-file-manager.test.ts
git commit -m "feat(preview): PreviewFileManager.ensurePreviewFiles() for App Shell route generation"
```

---

## Task 3c: `_cleanupPreviewFiles()` for mode switching (P1-3)

**Files:**

- Modify: `lib/preview-generator/preview-file-manager.ts`
- Modify: `lib/preview-generator/__tests__/preview-file-manager.test.ts`

Per spec P1-3: when `.hyperide/preview.tsx` is created after App Shell mode is active, route files must be deleted and Isolated mode must activate. When wrapper is deleted, route files must be recreated. `_cleanupPreviewFiles()` removes all `@hyperide-managed` route files so `ensurePreviewFiles()` can regenerate them (or skip if now in Isolated mode).

- [ ] **Step 3c.1: Write failing test**

```ts
describe('PreviewFileManager._cleanupPreviewFiles (public for testing)', () => {
  it('removes @hyperide-managed route files', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set(
      '/project/app/test-preview/page.tsx',
      '// @hyperide-managed\nexport default function TestPreviewPage() {}',
    );
    io.files.set(
      '/project/app/test-preview/layout.tsx',
      '// @hyperide-managed\nexport default function PreviewLayout...',
    );
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      '// @hyperide-managed\nexport default function CanvasPreview() {}',
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.cleanupPreviewFiles();

    expect(io.files.has('/project/app/test-preview/page.tsx')).toBe(false);
    expect(io.files.has('/project/app/test-preview/layout.tsx')).toBe(false);
    // __canvas_preview__.tsx should NOT be removed — only route files
    expect(io.files.has('/project/src/__canvas_preview__.tsx')).toBe(true);
  });

  it('does not remove user files without @hyperide-managed', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/app/layout.tsx', '...');
    io.files.set('/project/app/test-preview/page.tsx', 'export default function MyPage() {}');

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.cleanupPreviewFiles();

    expect(io.files.has('/project/app/test-preview/page.tsx')).toBe(true);
  });
});
```

- [ ] **Step 3c.2: Run test — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 3c.3: Implement `cleanupPreviewFiles()`**

Add to `PreviewFileManager` class. Note: `FileIO` doesn't have a `delete` method. Add `deleteFile?: (path: string) => Promise<void>` as optional to `FileIO` interface, with a default no-op for backward compat. `InMemoryFileIO` and `VSCodeFileIO` implement it.

```ts
// In lib/ast/file-io.ts — add optional method:
deleteFile?(absolutePath: string): Promise<void>;
```

```ts
// In PreviewFileManager:
async cleanupPreviewFiles(): Promise<void> {
  const framework = await detectFramework(this.projectRoot, this.io);
  const paths = getRouteFilePaths(framework, this.projectRoot);

  for (const filePath of [paths.routeFile, paths.layoutFile].filter(Boolean) as string[]) {
    try {
      const content = await this.io.readFile(filePath);
      if (content.includes('@hyperide-managed')) {
        await this.io.deleteFile?.(filePath);
      }
    } catch {
      // File doesn't exist — nothing to clean up
    }
  }
}
```

Also update `_writeIfSafe` to force-write when called after cleanup (add `forceWrite?: boolean` parameter or simply check `forceWrite` flag):

Actually, simpler: change `_writeIfSafe` to only skip if file exists AND contains `@hyperide-managed` AND the content hasn't changed. Since the framework/route file content is deterministic, skipping unchanged files is correct idempotent behavior. After `cleanupPreviewFiles()` removes the files, `_writeIfSafe` will write them fresh (file-not-found path).

- [ ] **Step 3c.4: Run tests — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 3c.5: Commit**

```bash
git add lib/preview-generator/preview-file-manager.ts \
        lib/preview-generator/__tests__/preview-file-manager.test.ts \
        lib/ast/file-io.ts
git commit -m "feat(preview): cleanupPreviewFiles for App Shell ↔ Isolated mode switching"
```

### 3d — Init-time full scan + fast AST check in `ensureComponent`

**Files:**

- Modify: `lib/preview-generator/preview-file-manager.ts`
- Modify: `lib/preview-generator/__tests__/preview-file-manager.test.ts`

#### Background

Current `ensureComponent` behavior: parses existing `__canvas_preview__.tsx`, merges new entries, fully regenerates and writes. Every component switch triggers a full file write.

New behavior:

- **Init (file missing)**: scan all project components via component scanner → `generatePreviewContent(allEntries)` → write once. All imports are present from the start — no delay on first switch.
- **Subsequent calls**: `_hasImport()` AST check. Import already present → return immediately, no write. Import missing (new file added after init, race with file-watch) → `_astInsertImport()` → minimal write.

No extra in-memory caches needed. The file IS the cache.

#### `_hasImport(previewFilePath, importPath)` — path normalization

String search is fragile (user may edit the file, change quotes, reformatting). Parse with `@babel/parser`, walk `ImportDeclaration` nodes:

```ts
private async _hasImport(previewFilePath: string, importPath: string): Promise<boolean> {
  const source = await this.io.readFile(previewFilePath);
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const previewDir = dirname(previewFilePath);
  const normalizedTarget = this._normalizeImportPath(previewDir, importPath);

  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const normalized = this._normalizeImportPath(previewDir, node.source.value);
    if (normalized === normalizedTarget) return true;
  }
  return false;
}

private _normalizeImportPath(fromDir: string, importPath: string): string {
  // Relative path → resolve to absolute, strip extension
  if (importPath.startsWith('.')) {
    return resolve(fromDir, importPath).replace(/\.(tsx?|jsx?)$/, '');
  }
  // Package import — compare as-is (no resolution needed)
  return importPath;
}
```

#### `_astInsertImport(previewFilePath, entry)` — minimal AST insert

Parses the file with `recast` (preserves formatting), finds the last `ImportDeclaration`, inserts the new import line after it, writes. Does NOT regenerate the whole file — preserves any user edits.

- [ ] **Step 3d.1: Write failing tests**

```ts
describe('PreviewFileManager._hasImport', () => {
  it('returns true for exact relative import', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });

  it('returns true when import has extension but search does not', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button.tsx';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });

  it('returns false for missing import', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from './components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Card')).toBe(false);
  });

  it('handles absolute vs relative normalization (same resolved path)', async () => {
    const io = new InMemoryFileIO();
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "import Button from '../src/components/Button';\nexport default function CanvasPreview() {}",
    );
    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    // Different relative path, same resolved file
    expect(await manager._hasImport('/project/src/__canvas_preview__.tsx', './components/Button')).toBe(true);
  });
});

describe('ensureComponent — fast path', () => {
  it('does not write file when import already present', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-managed\nimport Button from './components/Button';\nexport default function CanvasPreview() {}",
    );
    let writeCount = 0;
    const origWrite = io.writeFile.bind(io);
    io.writeFile = async (p, c) => {
      writeCount++;
      return origWrite(p, c);
    };

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Button.tsx']);

    expect(writeCount).toBe(0); // fast path — no write
  });

  it('AST-inserts missing import without full regeneration', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    // File has Button but not Card
    io.files.set(
      '/project/src/__canvas_preview__.tsx',
      "// @hyperide-managed\nimport Button from './components/Button';\nexport default function CanvasPreview() {}",
    );

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Card.tsx']);

    const content = io.files.get('/project/src/__canvas_preview__.tsx')!;
    expect(content).toContain('Button'); // existing import preserved
    expect(content).toContain('Card'); // new import added
  });

  it('init: generates with ALL project components when file is missing', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/components/Button.tsx', BUTTON_SOURCE);
    io.files.set('/project/src/components/Card.tsx', CARD_SOURCE);
    io.files.set('/project/package.json', JSON.stringify({ name: 'test' }));

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.ensureComponent(['src/components/Button.tsx']); // only Button requested

    const content = io.files.get('/project/src/__canvas_preview__.tsx')!;
    expect(content).toContain('Button');
    expect(content).toContain('Card'); // all components included on init
  });
});
```

- [ ] **Step 3d.2: Run tests — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 3d.3: Implement**

In `ensureComponent`:

1. Check if `__canvas_preview__.tsx` exists.
2. **File missing (init)**: call component scanner for the whole project → `generatePreviewContent(allEntries)` → write.
3. **File exists**: for each requested path, call `_hasImport()`. If all present → return. If any missing → `_astInsertImport()` for each missing one.

Add `_hasImport()` and `_astInsertImport()` as private methods per the specs above.

- [ ] **Step 3d.4: Run ALL tests — expect PASS**

```bash
bun run test lib/preview-generator
```

- [ ] **Step 3d.5: Commit**

```bash
git add lib/preview-generator/preview-file-manager.ts \
        lib/preview-generator/__tests__/preview-file-manager.test.ts
git commit -m "feat(preview): init-time full scan + fast AST import check in ensureComponent"
```

---

## Task 4: Extension — App Shell mode wiring

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/extension.ts`

This is extension code — no unit tests applicable. Verify manually.

### 4a — `PreviewProxy`: stop rewriting `/test-preview`

The current `_handleHttp()` method rewrites `/test-preview` to `/`. This is the root cause of the broken preview. Remove it.

- [ ] **Step 4a.1: In `PreviewProxy.ts`, remove the `/test-preview` path rewrite**

Delete lines 88–94 in `_handleHttp()`:

```ts
// DELETE these lines:
let proxyPath = clientReq.url || '/';
if (proxyPath.startsWith('/test-preview')) {
  proxyPath = `/${proxyPath.slice('/test-preview'.length)}`;
  if (proxyPath.startsWith('//')) proxyPath = proxyPath.slice(1);
  if (proxyPath === '') proxyPath = '/';
}
```

Replace with:

```ts
const proxyPath = clientReq.url || '/';
```

Also update the JSDoc comment on `_handleHttp()` — remove the "Rewrites /test-preview" sentence, since we no longer do that.

- [ ] **Step 4a.2: Add 404 retry logic for `/test-preview` (P2-5)**

In `_handleHttp()`, after getting the proxy response, if status is 404 and path starts with `/test-preview`, retry up to 5 times with 200ms delay. This handles the gap between route file creation and dev server FSWatch pickup.

```ts
// In the proxyReq callback, before processing response:
if (
  (proxyRes.statusCode === 404 || proxyRes.statusCode === 503) &&
  proxyPath.startsWith('/test-preview') &&
  retryCount < 5
) {
  proxyRes.resume(); // drain response
  setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), 200);
  return;
}
```

Add `retryCount = 0` parameter to `_handleHttp()` signature.

- [ ] **Step 4a.3: Commit**

```bash
git add vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts
git commit -m "fix(preview): stop rewriting /test-preview → /, add 404 retry"
```

### 4b — `extension.ts`: call `ensurePreviewFiles()`, remove `refresh()`

Current flow (in `stateHub.onChange`):

1. `ensureSample()`
2. `previewManager.ensureComponent([relativePath])`
3. `previewPanel?.refresh()`

New flow:

1. `ensureSample()`
2. `previewManager.ensureComponent([relativePath])`
3. `previewManager.ensurePreviewFiles()`
4. Update iframe URL via `?component=` param — no full `refresh()`

- [ ] **Step 4b.1: Modify `extension.ts`**

Find the chain starting at `ensureSample(...)`:

```ts
.then(() => {
  if (ac.signal.aborted) return;
  const relativePath = relative(workspaceRoot, absComponentPath);
  return previewManager.ensureComponent([relativePath]);
})
.then(() => {
  if (ac.signal.aborted) return;
  // 3. Refresh iframe to pick up regenerated __canvas_preview__.tsx
  previewPanel?.refresh();
})
```

Change to:

```ts
.then(() => {
  if (ac.signal.aborted) return;
  const relativePath = relative(workspaceRoot, absComponentPath);
  return previewManager.ensureComponent([relativePath]);
})
.then(() => {
  if (ac.signal.aborted) return;
  return previewManager.ensurePreviewFiles();
})
.then(() => {
  if (ac.signal.aborted) return;
  const relativePath = relative(workspaceRoot, absComponentPath);
  // Update component URL param — no hard reload needed
  previewPanel?.setComponentParam(relativePath);
})
```

Then add `setComponentParam(path: string)` to `PreviewPanel.ts`:

```ts
// In PreviewPanel.ts, add method:
setComponentParam(componentPath: string): void {
  if (!this._panel) return;
  this._currentComponent = componentPath;
  // Send postMessage to webview to update iframe src param without full reload
  this._panel.webview.postMessage({
    type: 'setComponent',
    component: componentPath,
  });
}
```

In `PreviewPanelApp.tsx`, find the existing window message handler (there's already one for `webview:ready`, etc.) and add:

```tsx
// In the useEffect that handles window.addEventListener('message', ...):
case 'setComponent': {
  const { component } = message as { type: 'setComponent'; component: string };
  if (iframeRef.current) {
    const url = new URL(iframeRef.current.src);
    url.searchParams.set('component', component);
    iframeRef.current.src = url.toString();
  }
  break;
}
```

**Verify this works**: the iframe `src` change triggers a navigation to `/test-preview?component=<path>`. The route file at `/test-preview` renders `<CanvasPreview />` which reads `window.location.search`. This is a full page load inside the iframe — expected behavior. The "instant switch without reload" (P2-6) is a future optimization.

**Important**: `previewPanel.refresh()` call in `HyperMcpServer.onRefresh` callback should stay as-is — that's an explicit user/AI refresh action, not a component switch.

- [ ] **Step 4b.1b: Handle `unknown` framework — show notification instead of blank iframe**

`ensurePreviewFiles()` silently returns `undefined` for `unknown` (and for frameworks that require
AST patching — those are handled in later tasks). Without this step, `setComponentParam` is called
regardless and the iframe loads `/test-preview` which returns 404.

Change `ensurePreviewFiles()` return type to `'ok' | 'unsupported' | 'needs-patch'`:

```ts
async ensurePreviewFiles(): Promise<'ok' | 'unsupported' | 'needs-patch'> {
  const detection = await detectFramework(this.projectRoot, this.io);
  const { framework } = detection;

  if (framework === 'unknown') return 'unsupported';

  if (framework === 'webpack' || framework === 'vite-spa-jsx-router' || framework === 'parcel') {
    // Handled by patchRouterConfig / patchEntryFile in later tasks (Tasks 5, 8, 9).
    return 'needs-patch';
  }

  // ... existing file generation logic ...
  return 'ok';
}
```

In `extension.ts`, use the return value to gate `setComponentParam`:

```ts
.then((result: 'ok' | 'unsupported' | 'needs-patch' | undefined) => {
  if (ac.signal.aborted) return;
  if (result === 'unsupported') {
    void vscode.window.showWarningMessage(
      'HyperIDE: unsupported project type. ' +
      'Supported: Next.js, Remix, Vite (file-based and JSX router), Webpack/CRA, Parcel.',
    );
    return; // do not call setComponentParam — no route exists
  }
  // 'ok' and 'needs-patch' both proceed: 'needs-patch' frameworks
  // have their route set up via patchRouterConfig / patchEntryFile in Tasks 5/8/9,
  // which are called separately and complete before this point via ModeManager (Task 10).
  const relativePath = relative(workspaceRoot, absComponentPath);
  previewPanel?.setComponentParam(relativePath);
})
```

Update `ensurePreviewFiles` tests to assert the correct return value for each case.

- [ ] **Step 4b.2: Exclude generated files via `.git/info/exclude`**

Use `.git/info/exclude` instead of modifying the user's `.gitignore` — we don't touch project files. Fallback to `.gitignore` if `.git/info/` doesn't exist (Stackblitz, no `.git`, shallow clone).

Add `ensureGitExclude()` to `PreviewFileManager` and call it from `ensurePreviewFiles()` after writing route files:

```ts
async ensureGitExclude(): Promise<void> {
  const previewPath = await this.getPreviewFilePath();
  const framework = await detectFramework(this.projectRoot, this.io);

  // Collect paths to exclude: always __canvas_preview__.tsx,
  // plus route files we created from scratch (tagged @hyperide-managed).
  // Patched files (Vite JSX router, Webpack) are user-owned — never exclude.
  const pathsToExclude: string[] = [previewPath];

  if (framework !== 'vite-spa-jsx-router' && framework !== 'webpack') {
    const paths = getRouteFilePaths(framework, this.projectRoot);
    for (const p of [paths.routeFile, paths.layoutFile].filter(Boolean) as string[]) {
      try {
        const content = await this.io.readFile(p);
        if (content.includes('@hyperide-managed')) pathsToExclude.push(p);
      } catch { /* file doesn't exist yet */ }
    }
  }

  const entries = pathsToExclude
    .map(p => `${relative(this.projectRoot, p)} # @hyperide-managed`)
    .join('\n');

  // Try .git/info/exclude first (doesn't touch project files)
  const excludePath = join(this.projectRoot, '.git', 'info', 'exclude');
  try {
    const existing = await this.io.readFile(excludePath);
    const missing = entries.split('\n').filter(e => !existing.includes(e.split(' #')[0]));
    if (missing.length > 0) {
      await this.io.writeFile(excludePath, `${existing.trimEnd()}\n${missing.join('\n')}\n`);
    }
    return;
  } catch {
    // .git/info/ not accessible — fall through to .gitignore
  }

  // Fallback: append to .gitignore
  const gitignorePath = join(this.projectRoot, '.gitignore');
  try {
    const existing = await this.io.readFile(gitignorePath);
    const missing = entries.split('\n').filter(e => !existing.includes(e.split(' #')[0]));
    if (missing.length > 0) {
      await this.io.writeFile(gitignorePath, `${existing.trimEnd()}\n${missing.join('\n')}\n`);
    }
  } catch {
    await this.io.writeFile(gitignorePath, `${entries}\n`);
  }
}
```

Notes:

- Called from `ensurePreviewFiles()` after writing route files — so route files exist and can be checked for `@hyperide-managed` before excluding.
- Excluded: `__canvas_preview__.tsx` always + route files we created (`@hyperide-managed`). Not excluded: files patched by `patchRouterConfig` (Vite JSX router, Webpack) — those are user-owned.
- Idempotent — checks path presence before appending.
- On container restart `.git/info/exclude` resets. `ensurePreviewFiles()` runs on startup, so `ensureGitExclude()` re-adds automatically.

- [ ] **Step 4b.3: Manual verification**

1. Open `ext-test-projects/nextjs-sample` in VS Code with the extension active
2. Select a component in the Explorer panel
3. Confirm `app/test-preview/page.tsx` and `app/test-preview/layout.tsx` are created in the project
4. Confirm iframe loads the component (not the user's app homepage)
5. Confirm no 404 in extension logs

- [ ] **Step 4b.4: Commit**

```bash
git add vscode-extension/hypercanvas-preview/src/extension.ts \
        vscode-extension/hypercanvas-preview/src/PreviewPanel.ts \
        vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx
git commit -m "feat(preview): App Shell mode — generate route files, remove hard refresh"
```

---

## Task 4c: PreviewModeManager — skeleton + FSWatch (architecture-first)

**Files:**

- Create: `lib/preview-generator/preview-mode-manager.ts`
- Create: `lib/preview-generator/__tests__/preview-mode-manager.test.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts` — add `setIsolatedMode()`
- Modify: `vscode-extension/hypercanvas-preview/src/extension.ts` — wire ModeManager

**Why here:** ModeManager owns FSWatch and mode transitions from day one.
`PreviewProxy` stays a pure HTTP proxy — it only receives `setIsolatedMode(isolated: boolean)` as a callback.
Vite JSX / Webpack branches are wired now but will throw until Tasks 5 and 8 implement the FileManager methods.
User said: "не страшно что какое-то время проект не будет работать" — so partial support is acceptable.

### 4c.1: Implement `preview-mode-manager.ts`

```ts
// lib/preview-generator/preview-mode-manager.ts
/**
 * @file Orchestrates App Shell ↔ Isolated mode transitions.
 * Accessed via: extension.ts → stateHub.onChange (component selected) +
 *               WatcherFactory on .hyperide/preview.tsx (mode switch)
 * Assumptions: coalescing guard on _updateMode prevents concurrent transitions
 */

import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';
import { detectFramework } from './framework-routing';
import { PreviewFileManager } from './preview-file-manager';

export type PreviewMode = 'app-shell' | 'isolated';

/**
 * Watches projectRoot for .hyperide/preview.tsx create/delete.
 * Calls onChange when the file appears or disappears.
 * Returns a dispose function to stop watching.
 *
 * Extension: use fsWatchFactory (node:fs, debounce 200ms)
 * SaaS:      use chokidarWatchFactory (awaitWriteFinish, handles NFS/Docker volumes)
 */
export type WatcherFactory = (projectRoot: string, onChange: () => void) => () => void;

export interface PreviewModeManagerOptions {
  projectRoot: string;
  io: FileIO;
  /** Called when mode changes — PreviewProxy uses this to toggle HTML script swap. */
  onModeChange?: (isolated: boolean) => void;
  /**
   * Injectable watcher factory. Defaults to fsWatchFactory.
   * Pass chokidarWatchFactory on SaaS (handles Docker volumes reliably).
   */
  watcherFactory?: WatcherFactory;
}

/** Default: node:fs.watch with debounce. Suitable for local extension use. */
export function fsWatchFactory(projectRoot: string, onChange: () => void): () => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  const hyperideDir = join(projectRoot, '.hyperide');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, 200);
  };

  const rootWatcher = fs.watch(projectRoot, (_event: string, filename: string | null) => {
    if (filename === '.hyperide') debounced();
  });
  rootWatcher.on('error', (err: Error) => {
    console.error('[ModeManager] Root watcher error:', err.message);
  });

  let hyperideWatcher: ReturnType<typeof fs.watch> | null = null;
  try {
    hyperideWatcher = fs.watch(hyperideDir, (_event: string, filename: string | null) => {
      if (filename === 'preview.tsx' || filename === 'preview.ts') debounced();
    });
    hyperideWatcher.on('error', (err: Error) => {
      console.error('[ModeManager] .hyperide watcher error:', err.message);
    });
  } catch {
    // .hyperide doesn't exist yet — root watcher covers its creation
  }

  return () => {
    rootWatcher.close();
    hyperideWatcher?.close();
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

export class PreviewModeManager {
  private _mode: PreviewMode = 'app-shell';
  private _fileManager: PreviewFileManager;
  private readonly _projectRoot: string;
  private readonly _io: FileIO;
  private readonly _onModeChange?: (isolated: boolean) => void;
  private readonly _watcherFactory: WatcherFactory;

  private _watcherDispose: (() => void) | null = null;
  private _modeUpdateInProgress = false;
  private _modeUpdatePending = false;

  constructor({ projectRoot, io, onModeChange, watcherFactory }: PreviewModeManagerOptions) {
    this._projectRoot = projectRoot;
    this._io = io;
    this._onModeChange = onModeChange;
    this._watcherFactory = watcherFactory ?? fsWatchFactory;
    this._fileManager = new PreviewFileManager({ projectRoot, io });
  }

  get mode(): PreviewMode {
    return this._mode;
  }

  startWatching(): void {
    this._watcherDispose = this._watcherFactory(this._projectRoot, () => {
      void this._updateMode();
    });
    void this._updateMode();
  }

  stopWatching(): void {
    this._watcherDispose?.();
    this._watcherDispose = null;
  }

  /** Called when a component is selected in the explorer. */
  async onComponentSelected(absComponentPath: string): Promise<'ok' | 'unsupported' | 'needs-patch'> {
    if (this._mode === 'isolated') {
      // Isolated mode: __canvas_preview__.tsx updated, no routing changes
      return 'ok';
    }

    const detection = await detectFramework(this._projectRoot, this._io);
    const { framework } = detection;

    switch (framework) {
      case 'nextjs-app-router':
      case 'nextjs-pages-router':
      case 'remix':
      case 'vite-spa-file-based':
        return this._fileManager.ensurePreviewFiles();
      case 'vite-spa-jsx-router': {
        const routerFile = await this.detectRouterFile();
        if (routerFile) await this._fileManager.patchRouterConfig(routerFile);
        return 'ok';
      }
      case 'webpack': {
        const entryFile = await this._detectEntryFile();
        if (entryFile) await this._fileManager.patchEntryFile(entryFile);
        return 'ok';
      }
      case 'unknown':
        return 'unsupported';
      default:
        return 'ok'; // parcel — file-based, handled by ensurePreviewFiles
    }
  }

  /** Called by FSWatch when .hyperide/preview.tsx appears. */
  async onWrapperCreated(): Promise<void> {
    await this._fileManager.cleanupPreviewFiles();
    await this._revertJsxPatchIfPresent();
    await this._revertEntryPatchIfPresent();
    this._mode = 'isolated';
    this._onModeChange?.(true);
  }

  /** Called by FSWatch when .hyperide/preview.tsx is deleted. */
  async onWrapperDeleted(): Promise<void> {
    await this._fileManager.ensurePreviewFiles();
    await this._applyPatchIfNeeded();
    this._mode = 'app-shell';
    this._onModeChange?.(false);
  }

  /** Override in tests to inject a known router file path. */
  async detectRouterFile(): Promise<string | null> {
    const candidates = ['src/App.tsx', 'src/app.tsx', 'App.tsx'];
    for (const rel of candidates) {
      const abs = join(this._projectRoot, rel);
      try {
        const content = await this._io.readFile(abs);
        if (content.includes('<Routes>') || content.includes('<BrowserRouter>')) return abs;
      } catch {
        /* not found */
      }
    }
    return null;
  }

  private async _detectEntryFile(): Promise<string | null> {
    const candidates = ['src/index.tsx', 'src/index.ts', 'src/main.tsx', 'src/main.ts'];
    for (const rel of candidates) {
      const abs = join(this._projectRoot, rel);
      try {
        await this._io.readFile(abs);
        return abs;
      } catch {
        /* not found */
      }
    }
    return null;
  }

  /** Coalescing guard: re-runs after current execution if state changed mid-flight. */
  private async _updateMode(): Promise<void> {
    if (this._modeUpdateInProgress) {
      this._modeUpdatePending = true;
      return;
    }
    this._modeUpdateInProgress = true;
    try {
      const wrapperPath = join(this._projectRoot, '.hyperide/preview.tsx');
      try {
        await this._io.access(wrapperPath);
        const wasIsolated = this._mode === 'isolated';
        if (!wasIsolated) await this.onWrapperCreated();
      } catch {
        const wasAppShell = this._mode === 'app-shell';
        if (!wasAppShell) await this.onWrapperDeleted();
      }
    } finally {
      this._modeUpdateInProgress = false;
      if (this._modeUpdatePending) {
        this._modeUpdatePending = false;
        void this._updateMode();
      }
    }
  }

  private async _revertJsxPatchIfPresent(): Promise<void> {
    const routerFile = await this.detectRouterFile();
    if (!routerFile) return;
    try {
      const content = await this._io.readFile(routerFile);
      if (content.includes('@hyperide-managed')) await this._fileManager.revertRouterPatch(routerFile);
    } catch {
      /* not accessible */
    }
  }

  private async _revertEntryPatchIfPresent(): Promise<void> {
    const entryFile = await this._detectEntryFile();
    if (!entryFile) return;
    try {
      const content = await this._io.readFile(entryFile);
      if (content.includes('@hyperide-managed')) await this._fileManager.revertEntryFile(entryFile);
    } catch {
      /* not accessible */
    }
  }

  private async _applyPatchIfNeeded(): Promise<void> {
    const detection = await detectFramework(this._projectRoot, this._io);
    if (detection.framework === 'vite-spa-jsx-router') {
      const routerFile = await this.detectRouterFile();
      if (routerFile) await this._fileManager.patchRouterConfig(routerFile);
    } else if (detection.framework === 'webpack') {
      const entryFile = await this._detectEntryFile();
      if (entryFile) await this._fileManager.patchEntryFile(entryFile);
    }
  }
}
```

**Note on stubs:** `patchRouterConfig`, `revertRouterPatch`, `patchEntryFile`, `revertEntryFile` don't exist yet in `PreviewFileManager` — they're implemented in Tasks 5 and 8. Until then, those branches throw at runtime. That's acceptable.

### 4c.2: Write tests for ModeManager

Copy the test code from Task 10.1 (tests are identical — Task 10 is removed).

```bash
bun run test lib/preview-generator/__tests__/preview-mode-manager.test.ts
```

Expected: FAIL on `patchRouterConfig is not a function` for vite-jsx test — correct, Tasks 5/8 implement those.
Next.js tests should pass.

### 4c.3: Add `setIsolatedMode()` to `PreviewProxy`

Replace the `_isIsolatedMode` + `_updateMode()` + FSWatch block in `PreviewProxy` with a single setter:

```ts
// In PreviewProxy.ts — add field + setter, remove all FSWatch code
private _isIsolatedMode = false;

setIsolatedMode(isolated: boolean): void {
  this._isIsolatedMode = isolated;
}
```

`PreviewProxy` stays a pure HTTP proxy — no watching, no timers.

### 4c.4: Wire in `extension.ts`

```ts
// In extension.ts activation:
const modeManager = new PreviewModeManager({
  projectRoot: workspaceRoot,
  io: new VSCodeFileIO(),
  onModeChange: (isolated) => previewProxy.setIsolatedMode(isolated),
});
modeManager.startWatching();

// In stateHub.onChange chain, replace previewManager.ensurePreviewFiles() with:
.then(async () => {
  if (ac.signal.aborted) return;
  const result = await modeManager.onComponentSelected(absComponentPath);
  if (result === 'unsupported') {
    void vscode.window.showWarningMessage(
      'HyperIDE: unsupported project type. Supported: Next.js, Remix, Vite, Webpack/CRA, Parcel.',
    );
    return 'unsupported';
  }
  return result;
})
.then((result) => {
  if (ac.signal.aborted || result === 'unsupported') return;
  const relativePath = relative(workspaceRoot, absComponentPath);
  previewPanel?.setComponentParam(relativePath);
})
```

Also call `modeManager.stopWatching()` in the deactivation cleanup.

### 4c.5: Commit

```bash
git add lib/preview-generator/preview-mode-manager.ts \
        lib/preview-generator/__tests__/preview-mode-manager.test.ts \
        vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts \
        vscode-extension/hypercanvas-preview/src/extension.ts
git commit -m "feat(preview): PreviewModeManager — centralized mode orchestration + FSWatch"
```

---

## Task 5: App Shell mode for Vite SPA (JSX router patch)

**Files:**

- Modify: `lib/preview-generator/preview-file-manager.ts` — add `patchRouterConfig()`, `revertRouterPatch()`
- Modify: `lib/preview-generator/__tests__/preview-file-manager.test.ts`

This handles `vite-spa-jsx-router` case where `<Routes>` is defined in JSX and no file-based routing exists. Uses `recast` for AST patch — tagged `@hyperide-managed`, auto-reverted on cleanup.

**Lifecycle of the patch:** the route lives in `App.tsx` permanently while the user uses HyperIDE in App Shell mode.
`revertRouterPatch()` is called only during an explicit mode switch (App Shell → Isolated, i.e. user creates `.hyperide/preview.tsx`).
It is NOT a crash-recovery mechanism. The patch is identified by `@hyperide-managed` AST comment nodes,
so intermediate Prettier/Biome reformatting between patch and revert has no effect — each call reads the
current file, parses fresh AST, filters managed nodes, and writes back.

**Skip if wrapper exists**: per spec, Tier 1 makes JSX router irrelevant. `patchRouterConfig()` should only be called when no `.hyperide/preview.tsx` exists.

- [ ] **Step 5.1: Write failing tests**

```ts
describe('PreviewFileManager.patchRouterConfig', () => {
  const ROUTER_SOURCE = `
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Home } from './pages/Home';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
`;

  it('injects /test-preview route into <Routes>', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx')!;
    expect(patched).toContain('test-preview');
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('CanvasPreview');
  });

  it('revertRouterPatch removes @hyperide-managed lines and preserves original routes', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');
    await manager.revertRouterPatch('/project/src/App.tsx');

    const reverted = io.files.get('/project/src/App.tsx')!;
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).not.toContain('test-preview');
    // Original home route must survive the revert
    expect(reverted).toContain('path="/"');
    expect(reverted).toContain('Home');
  });

  it('is idempotent — does not double-inject', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/App.tsx', ROUTER_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchRouterConfig('/project/src/App.tsx');
    await manager.patchRouterConfig('/project/src/App.tsx');

    const patched = io.files.get('/project/src/App.tsx')!;
    // Should only have one test-preview route
    const count = (patched.match(/test-preview/g) || []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 5.2: Run test — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 5.3: Implement `patchRouterConfig()` and `revertRouterPatch()` in `PreviewFileManager`**

Add imports:

```ts
import * as recast from 'recast';
import { builders as b } from 'ast-types';
// Use @babel/parser directly — recast/parsers/babel-ts uses require() which fails in ESM
import { parse as babelParse } from '@babel/parser';
```

Add methods to `PreviewFileManager`:

```ts
const RECAST_PARSER = {
  parse: (source: string) =>
    babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      tokens: true,
    }),
};

/**
 * Inject <Route path="/test-preview" element={<CanvasPreview />} /> into <Routes> JSX.
 * Uses recast for AST editing (preserves formatting). Tags with @hyperide-managed.
 * Only for Vite SPA JSX router (App Shell mode, no wrapper).
 */
async patchRouterConfig(routerFilePath: string): Promise<void> {
  const source = await this.io.readFile(routerFilePath);

  // Idempotency check
  if (source.includes('@hyperide-managed')) return;

  const ast = recast.parse(source, { parser: RECAST_PARSER });

  let patched = false;
  recast.visit(ast, {
    visitJSXElement(path) {
      const el = path.node;
      if (
        el.openingElement.name.type === 'JSXIdentifier' &&
        el.openingElement.name.name === 'Routes'
      ) {
        // Build: <Route path="/test-preview" element={<CanvasPreview />} /> {/* @hyperide-managed */}
        const newRoute = b.jsxElement(
          b.jsxOpeningElement(
            b.jsxIdentifier('Route'),
            [
              b.jsxAttribute(b.jsxIdentifier('path'), b.stringLiteral('/test-preview')),
              b.jsxAttribute(
                b.jsxIdentifier('element'),
                b.jsxExpressionContainer(
                  b.jsxElement(b.jsxOpeningElement(b.jsxIdentifier('CanvasPreview'), [], true), null, [])
                )
              ),
            ],
            true
          ),
          null,
          []
        );
        // Add comment to the JSX element for identification
        (newRoute as { comments?: unknown[] }).comments = [
          { type: 'CommentLine', value: ' @hyperide-managed', leading: false, trailing: true },
        ];
        el.children.push(b.jsxText('\n        '), newRoute, b.jsxText('\n      '));
        patched = true;
        return false;
      }
      this.traverse(path);
    },
  });

  if (!patched) {
    console.warn('[PreviewFileManager] Could not find <Routes> in', routerFilePath);
    return;
  }

  // Add CanvasPreview import at top — path relative to the router file's directory
  const previewPath = await this.getPreviewFilePath();
  const routerDir = dirname(routerFilePath); // use actual directory, not hardcoded src/
  let importPath = relative(routerDir, previewPath).replace(/\.\w+$/, '');
  if (!importPath.startsWith('.')) importPath = `./${importPath}`;

  const previewImport = `import CanvasPreview from '${importPath}'; // @hyperide-managed\n`;

  const output = recast.print(ast).code;
  await this.io.writeFile(routerFilePath, previewImport + output);
}

/**
 * Remove the injected <Route> and CanvasPreview import using AST.
 * Safer than line-filter: recast comment attachment is not stable enough for string scanning.
 */
async revertRouterPatch(filePath: string): Promise<void> {
  const source = await this.io.readFile(filePath);
  if (!source.includes('@hyperide-managed')) return;

  const ast = recast.parse(source, { parser: RECAST_PARSER });

  // Remove @hyperide-managed Route element from all <Routes> children
  recast.visit(ast, {
    visitJSXElement(path) {
      const el = path.node;
      if (
        el.openingElement.name.type === 'JSXIdentifier' &&
        el.openingElement.name.name === 'Routes'
      ) {
        el.children = el.children.filter(child => {
          if (child.type !== 'JSXElement') return true;
          return !child.comments?.some((c: { value?: string }) => c.value?.includes('@hyperide-managed'));
        });
        return false;
      }
      this.traverse(path);
    },
  });

  // Remove @hyperide-managed import declaration
  ast.program.body = ast.program.body.filter((node: { type: string; comments?: { value?: string }[] }) => {
    if (node.type !== 'ImportDeclaration') return true;
    return !node.comments?.some(c => c.value?.includes('@hyperide-managed'));
  });

  await this.io.writeFile(filePath, recast.print(ast).code);
}
```

Note: The `recast` AST JSX manipulation above is a starting point — actual implementation may need adjustment depending on `ast-types` API. Run the tests and fix until green.

- [ ] **Step 5.4: Run test — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 5.5: Commit**

```bash
git add lib/preview-generator/preview-file-manager.ts \
        lib/preview-generator/__tests__/preview-file-manager.test.ts
git commit -m "feat(preview): patchRouterConfig/revertRouterPatch for Vite SPA JSX router"
```

---

## Task 6: Chrome detection notification

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts`

After iframe loads in App Shell mode, check DOM for `<nav>`, `<header>`, `<aside>`. If found, notify user once per workspace session.

- [ ] **Step 6.1: Inject chrome-detection script in `PreviewProxy.ts`**

In `_handleHttp()`, alongside the existing `INJECTED_SCRIPTS`, add an inline detection script injected only for `/test-preview` requests:

```ts
// After existing INJECTED_SCRIPTS injection for /test-preview requests:
if (proxyPath.startsWith('/test-preview')) {
  const chromeDetectScript = `<script>
    (function() {
      window.addEventListener('load', function() {
        var hasChrome = document.querySelector('nav, header, aside') !== null;
        if (hasChrome) {
          window.parent.postMessage({ type: 'chrome-detected' }, '*');
        }
      }, { once: true });
    })();
  </script>`;
  html = html.replace('</head>', chromeDetectScript + '</head>');
}
```

- [ ] **Step 6.2: Route `chrome-detected` through `usePreviewBridge.ts` (with source validation)**

The iframe sends `window.parent.postMessage({ type: 'chrome-detected' }, '*')` to the webview.
The webview handler in `usePreviewBridge.ts` already guards all iframe messages with
`if (event.source !== iframeEl?.contentWindow) return;` — add `chrome-detected` there.

In `usePreviewBridge.ts`, inside the iframe→extension handler (the first `useEffect`, after
the existing `hypercanvas:*` checks):

```ts
if (msg.type === 'chrome-detected') {
  canvas.sendEvent({ type: 'chrome-detected' } as unknown as PlatformMessage);
  return;
}
```

This message now flows: iframe → webview (source-validated) → extension.

Then handle it in `PreviewPanel.ts` `_handleMessage()`:

```ts
case 'chrome-detected': {
  const shown = this._context.workspaceState.get<boolean>('chromeDetectedShown', false);
  if (!shown) {
    void this._context.workspaceState.update('chromeDetectedShown', true);
    void vscode.window.showInformationMessage(
      'HyperCanvas: Preview includes app layout (nav/header/sidebar). Create .hyperide/preview.tsx to isolate components.',
      'Generate wrapper',
      'Dismiss',
    ).then(choice => {
      if (choice === 'Generate wrapper') {
        // TODO: trigger AI wrapper generation (Task 7 wires this)
        void vscode.window.showInformationMessage('Create .hyperide/preview.tsx with your providers and CSS imports.');
      }
    });
  }
  break;
}
```

Note: `PreviewPanel` needs `vscode.ExtensionContext` for `workspaceState`. Pass it in constructor. Check if already present — if not, add it.

- [ ] **Step 6.3: Manual verification**

1. Open a Next.js project with a navbar in root `layout.tsx`
2. Select a component — preview renders
3. Confirm VS Code notification appears about app chrome
4. Dismiss — reselecting another component should NOT show the notification again
5. Confirm notification does not appear for a project with a blank layout (e.g. Vite SPA)

- [ ] **Step 6.4: Commit**

```bash
git add vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts \
        vscode-extension/hypercanvas-preview/src/PreviewPanel.ts
git commit -m "feat(preview): chrome-detection notification for App Shell mode"
```

---

## Task 7: Isolated mode Tier 1 (Vite/Parcel)

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts`
- Modify: `lib/preview-generator/generator.ts` — add `generateStandaloneEntry()`
- Modify: `lib/preview-generator/__tests__/generator.test.ts`

Isolated mode activates when `.hyperide/preview.tsx` exists. PreviewProxy swaps the `<script>` tag to point to `src/__canvas_preview__.tsx` instead of the user's `main.tsx`.

### 7a — `generateStandaloneEntry()` in generator

- [ ] **Step 7a.1: Write failing test**

```ts
describe('generateStandaloneEntry', () => {
  it('generates standalone entry with createRoot and PreviewWrapper', () => {
    const content = generateStandaloneEntry([makeEntry('src/Button.tsx', 'Button')], '../.hyperide/preview');
    expect(content).toContain('createRoot');
    expect(content).toContain('PreviewWrapper');
    expect(content).toContain('@hyperide-managed');
    // Component registry must be present (from base generatePreviewContent)
    expect(content).toContain('componentRegistry');
    expect(content).toContain("document.getElementById('root')");
    expect(content).toContain('<CanvasPreview />');
  });
});
```

- [ ] **Step 7a.2: Run test — expect FAIL**

- [ ] **Step 7a.3: Implement `generateStandaloneEntry()` in `generator.ts`**

```ts
/**
 * Generate __canvas_preview__.tsx as a standalone entry (Isolated mode).
 * Includes createRoot and imports PreviewWrapper from .hyperide/preview.tsx.
 */
export function generateStandaloneEntry(
  entries: PreviewComponentEntry[],
  wrapperImportPath: string,
  options?: GeneratePreviewOptions,
): string {
  const baseContent = generatePreviewContent(entries, options);

  const bootstrap = `
import { createRoot } from 'react-dom/client';
import { PreviewWrapper } from '${wrapperImportPath}';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <PreviewWrapper>
      <CanvasPreview />
    </PreviewWrapper>
  );
}
`;
  return baseContent + bootstrap;
}
```

- [ ] **Step 7a.4: Run test — expect PASS**

- [ ] **Step 7a.5: Commit**

```bash
git add lib/preview-generator/generator.ts \
        lib/preview-generator/__tests__/generator.test.ts
git commit -m "feat(preview): generateStandaloneEntry for Isolated mode"
```

### 7b — `PreviewProxy` Isolated mode

- [ ] **Step 7b.1: Add `projectRoot` to `PreviewProxy` constructor**

Current: `constructor(targetPort: number)`.
New: `constructor(targetPort: number, projectRoot?: string)`.

The `projectRoot` parameter is optional to avoid breaking `DevServerManager` callers.

Find where `PreviewProxy` is instantiated in `DevServerManager.ts` and pass `this._projectRoot` (or `workspaceRoot`).

- [x] **Step 7b.2: FSWatch — moved to Task 4c**

FSWatch on `.hyperide/preview.tsx` lives in `PreviewModeManager.startWatching()` (Task 4c).
`PreviewProxy` only has `setIsolatedMode(isolated: boolean)` — no watcher, no `_updateMode()`.
Update `stop()` to call `modeManager.stopWatching()` (already wired in Task 4c.4).

- [ ] **Step 7b.3: Add Tier 1 HTML script swap in `_handleHttp()`**

**Shared proxy response processing:** Extract to `lib/proxy/response-processor.ts`.
Both extension and SaaS use identical pipeline, parametrised by `prefix`:

| Content-Type      | Operation                                                                    |
| ----------------- | ---------------------------------------------------------------------------- |
| `text/html`       | `injectScripts(html, scripts)` + `swapEntryScript(html, newSrc)` if isolated |
| `text/javascript` | `rewriteJs(js, prefix)`                                                      |
| `text/css`        | `rewriteCss(css, prefix)`                                                    |
| everything else   | pipe directly                                                                |

- **SaaS**: `prefix = '/project-preview/123'`, isolated = project config flag (`project.previewMode`)
- **Extension**: `prefix = ''`, isolated = `ModeManager._isIsolatedMode`

Extension proxy serves from port root (`http://localhost:N/`) — browser resolves `/src/main.tsx` correctly without rewriting.
SaaS proxy sits behind a path prefix — browser would resolve `/src/main.tsx` to the app root (404), so rewriting is needed.

In the HTML buffering section, after injecting `INJECTED_SCRIPTS`, add Tier 1 script swap when in isolated mode:

```ts
if (this._isIsolatedMode && proxyPath.startsWith('/test-preview')) {
  // Read vite base from config (cached)
  const base = this._viteBase ?? '';
  // Find user entry script (filter out Vite internals and CDN scripts)
  const scriptRegex = /<script\s+type="module"\s+src="([^"]+)"\s*>/g;
  let match: RegExpExecArray | null;
  let userScript: string | null = null;
  while ((match = scriptRegex.exec(html)) !== null) {
    const src = match[1];
    if (!src.startsWith('/@') && !src.startsWith('https://') && !src.startsWith(base + '@')) {
      userScript = src;
      break;
    }
  }

  if (userScript) {
    // Swap to standalone preview entry
    html = html.replace(`src="${userScript}"`, `src="/src/__canvas_preview__.tsx"`);
    console.log(`[PreviewProxy] Tier 1 script swap: ${userScript} → /src/__canvas_preview__.tsx`);
  } else {
    console.warn('[PreviewProxy] Tier 1: could not find user entry script, falling back to App Shell');
  }
}
```

- [ ] **Step 7b.4: Read `vite.config.ts` base on startup (P2-1)**

In `_updateMode()` or `start()`, parse `vite.config.ts` for `base`:

```ts
private async _readViteBase(): Promise<string> {
  if (!this._projectRoot) return '';
  try {
    const configPath = path.join(this._projectRoot, 'vite.config.ts');
    const content = await fs.promises.readFile(configPath, 'utf-8');
    const match = content.match(/base\s*:\s*['"]([^'"]+)['"]/);
    return match?.[1] ?? '';
  } catch {
    return '';
  }
}
```

Store result in `this._viteBase` (cached on startup).

- [ ] **Step 7b.5: Manual verification**

1. Open `ext-test-projects/react-vite-tw4-twitter`
2. Verify App Shell mode works (no `.hyperide/preview.tsx`)
3. Create `.hyperide/preview.tsx` with basic providers + CSS import
4. Select a component — confirm proxy logs show "Tier 1 script swap"
5. Check Network tab in devtools — script src should point to `__canvas_preview__.tsx`
6. Confirm preview renders without app chrome
7. Delete `.hyperide/preview.tsx` — confirm switches back to App Shell mode

- [ ] **Step 7b.6: Commit**

```bash
git add vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts \
        vscode-extension/hypercanvas-preview/src/services/DevServerManager.ts
git commit -m "feat(preview): Isolated mode Tier 1 — script swap for Vite/Parcel"
```

---

## Task 8: Isolated mode Tier 2 (Webpack/CRA)

**Files:**

- Modify: `lib/preview-generator/preview-file-manager.ts`
- Modify: `lib/preview-generator/__tests__/preview-file-manager.test.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts`

Tier 2 patches `src/index.tsx` (webpack entry) to conditionally import `__canvas_preview__` when `?__preview` is in the URL.

**Lifecycle:** same as Task 5 — patch lives permanently while Isolated mode is active (`.hyperide/preview.tsx` exists).
`revertEntryFile()` is called only on explicit mode switch (user deletes `.hyperide/preview.tsx`).
AST-based via recast — formatting-safe, no text diff involved.

- [ ] **Step 8.1: Write failing tests**

```ts
describe('PreviewFileManager.patchEntryFile', () => {
  const ENTRY_SOURCE = `
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;

  it('wraps createRoot call in if/else block', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');

    const patched = io.files.get('/project/src/index.tsx')!;
    expect(patched).toContain('__preview');
    expect(patched).toContain('@hyperide-managed');
    expect(patched).toContain('__canvas_preview__');
  });

  it('revertEntryFile restores original bootstrap code', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    await manager.revertEntryFile('/project/src/index.tsx');

    const reverted = io.files.get('/project/src/index.tsx')!;
    expect(reverted).not.toContain('@hyperide-managed');
    expect(reverted).not.toContain('__preview');
    // Original bootstrap code must be present after revert
    expect(reverted).toContain('ReactDOM.createRoot');
    expect(reverted).toContain("document.getElementById('root')");
  });

  it('is idempotent', async () => {
    const io = new InMemoryFileIO();
    io.files.set('/project/src/index.tsx', ENTRY_SOURCE);

    const manager = new PreviewFileManager({ projectRoot: '/project', io });
    await manager.patchEntryFile('/project/src/index.tsx');
    await manager.patchEntryFile('/project/src/index.tsx');

    const patched = io.files.get('/project/src/index.tsx')!;
    const count = (patched.match(/__preview/g) || []).length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 8.2: Run test — expect FAIL**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 8.3: Implement `patchEntryFile()` and `revertEntryFile()` — AST approach**

Use recast to find the `createRoot` call expression and wrap it in an `if` statement.
No string slicing, no line counting — AST is the only reliable approach here.

Same `RECAST_PARSER` constant from Task 5 (already imported in the file).

```ts
/**
 * Patch webpack/CRA entry file to conditionally load __canvas_preview__ via AST.
 * Finds the createRoot(...).render(...) ExpressionStatement and wraps it in:
 *   if (__preview param) { import('./__canvas_preview__') }
 *   else { <original createRoot call> }
 * Tagged with a leading comment for AST-safe revert.
 */
async patchEntryFile(entryFilePath: string): Promise<void> {
  const source = await this.io.readFile(entryFilePath);
  if (source.includes('@hyperide-managed')) return; // idempotent

  const ast = recast.parse(source, { parser: RECAST_PARSER });
  let patched = false;

  recast.visit(ast, {
    visitExpressionStatement(path) {
      const expr = path.node.expression;
      // Detect ReactDOM.createRoot(...).render(...) or createRoot(...).render(...)
      const isCreateRoot =
        expr.type === 'CallExpression' &&
        expr.callee.type === 'MemberExpression' &&
        expr.callee.property.type === 'Identifier' &&
        expr.callee.property.name === 'render';

      if (!isCreateRoot || patched) {
        this.traverse(path);
        return;
      }

      // Build: if (new URLSearchParams(location.search).get('__preview')) { import(...) } else { original }
      const ifStmt = b.ifStatement(
        b.callExpression(
          b.memberExpression(
            b.newExpression(b.identifier('URLSearchParams'), [
              b.memberExpression(b.identifier('location'), b.identifier('search')),
            ]),
            b.identifier('get')
          ),
          [b.stringLiteral('__preview')]
        ),
        b.blockStatement([
          b.expressionStatement(
            b.callExpression(b.import(), [b.stringLiteral('./__canvas_preview__')])
          ),
        ]),
        b.blockStatement([path.node])
      );

      // Mark with leading comment for revert identification
      (ifStmt as { comments?: unknown[] }).comments = [
        { type: 'CommentLine', value: ' @hyperide-managed', leading: true, trailing: false },
      ];

      path.replace(ifStmt);
      patched = true;
      return false;
    },
  });

  if (!patched) {
    console.warn('[PreviewFileManager] Could not find createRoot().render() in entry file', entryFilePath);
    return;
  }

  await this.io.writeFile(entryFilePath, recast.print(ast).code);
}

/**
 * Revert entry file patch: find the @hyperide-managed IfStatement and replace it
 * with the original else-branch content. AST-based — safe for any formatting.
 */
async revertEntryFile(filePath: string): Promise<void> {
  const source = await this.io.readFile(filePath);
  if (!source.includes('@hyperide-managed')) return;

  const ast = recast.parse(source, { parser: RECAST_PARSER });

  recast.visit(ast, {
    visitIfStatement(path) {
      const node = path.node;
      const isManaged = node.comments?.some((c: { value?: string }) => c.value?.includes('@hyperide-managed'));
      if (!isManaged) {
        this.traverse(path);
        return;
      }
      // Replace the entire if/else with just the else-branch statements
      const elseBody = node.alternate?.type === 'BlockStatement' ? node.alternate.body : [];
      path.replace(...elseBody);
      return false;
    },
  });

  await this.io.writeFile(filePath, recast.print(ast).code);
}
```

- [x] **Step 8.4: Webpack wiring — moved to Task 4c**

`patchEntryFile` / `revertEntryFile` are called from `PreviewModeManager.onComponentSelected()`
and `onWrapperCreated()` / `onWrapperDeleted()` (Task 4c). No wiring needed here —
`PreviewProxy` only calls `setIsolatedMode()` which is already set up.

- [ ] **Step 8.5: Run tests — expect PASS**

```bash
bun run test lib/preview-generator/__tests__/preview-file-manager.test.ts
```

- [ ] **Step 8.6: Manual verification with a CRA project**

1. Open `ext-test-projects/webpack-react-tw3-kanban` (if available, otherwise any CRA project)
2. Create `.hyperide/preview.tsx`
3. Select a component — confirm `src/index.tsx` is patched
4. Confirm preview renders without app chrome
5. Delete `.hyperide/preview.tsx` — confirm `src/index.tsx` is reverted

- [ ] **Step 8.7: Commit**

```bash
git add lib/preview-generator/preview-file-manager.ts \
        lib/preview-generator/__tests__/preview-file-manager.test.ts \
        vscode-extension/hypercanvas-preview/src/services/PreviewProxy.ts \
        vscode-extension/hypercanvas-preview/src/services/DevServerManager.ts
git commit -m "feat(preview): Isolated mode Tier 2 — entry file patch for Webpack/CRA"
```

---

## Task 9: SaaS cleanup

**Files:**

- Modify: `client/main.tsx`
- Modify: `client/components/IframeCanvas.tsx`
- Modify: `server/proxy/project-preview.ts`
- Delete: `client/CanvasPreviewEntry.tsx`
- Delete: `server/routes/generatePreview.ts`

**Coordinate with server deploy**: `client/main.tsx` and `server/routes/generatePreview.ts` changes must be deployed together.

- [ ] **Step 9.1: Remove `isPreviewPath` from `client/main.tsx`**

Current:

```tsx
import CanvasPreview from './__canvas_preview__';
...
const isPreviewPath = window.location.pathname.match(/^\/project-preview\/[^/]+\/test-preview$/);
const element = document.getElementById('root');
if (element) {
  createRoot(element).render(<StrictMode>{isPreviewPath ? <PreviewGuard /> : <App /></StrictMode>);
}
```

New:

```tsx
const element = document.getElementById('root');
if (element) {
  createRoot(element).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
```

Remove `import CanvasPreview from './__canvas_preview__'` and the `PreviewGuard` component entirely.

- [ ] **Step 9.2: Delete dead files**

```bash
rm client/CanvasPreviewEntry.tsx
rm server/routes/generatePreview.ts
```

Remove the route registration for `generatePreview` from `server/index.ts` (or wherever it's registered). Find it with:

```bash
grep -r "generatePreview" server/
```

- [ ] **Step 9.3: Remove `POST /api/generate-preview` from `IframeCanvas.tsx`**

Find and remove the `authFetch('/api/generate-preview', ...)` call from `client/components/IframeCanvas.tsx`. Component switching should trigger a WebSocket message to `ensureComponent()` on the server directly (check existing WS message flow or add `ensureComponent` WS message type).

- [ ] **Step 9.4: Wire `PreviewModeManager` on SaaS + add Tier 1 HTML rewrite**

SaaS uses the same `PreviewModeManager` from `lib/` with chokidar `WatcherFactory`.
Mode state lives in an in-memory `Map` — no DB column needed (derived from filesystem state).

**9.4.1: Add `chokidarWatchFactory` in `server/proxy/`**

```ts
// server/proxy/chokidar-watch-factory.ts
import { join } from 'node:path';
import { watch } from 'chokidar';
import type { WatcherFactory } from '../../lib/preview-generator/preview-mode-manager';

export const chokidarWatchFactory: WatcherFactory = (projectRoot, onChange) => {
  const watcher = watch(join(projectRoot, '.hyperide/preview.tsx'), {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  watcher.on('add', onChange).on('unlink', onChange);
  return () => {
    watcher.close();
  };
};
```

**9.4.2: Wire `PreviewModeManager` per project in `server/services/container-manager.ts`**

When a container starts, create a `PreviewModeManager` for its project:

```ts
// In-memory map: projectId → { manager, isolated }
const projectModeManagers = new Map<string, PreviewModeManager>();
const projectIsolatedState = new Map<string, boolean>();

function startModeManager(project: Project): void {
  const manager = new PreviewModeManager({
    projectRoot: project.path,
    io: new NodeFileIO(),
    watcherFactory: chokidarWatchFactory,
    onModeChange: (isolated) => projectIsolatedState.set(project.id, isolated),
  });
  manager.startWatching();
  projectModeManagers.set(project.id, manager);
}

function stopModeManager(projectId: string): void {
  projectModeManagers.get(projectId)?.stopWatching();
  projectModeManagers.delete(projectId);
  projectIsolatedState.delete(projectId);
}

export function isProjectIsolated(projectId: string): boolean {
  return projectIsolatedState.get(projectId) ?? false;
}
```

Call `startModeManager` when container starts, `stopModeManager` when it stops.

**9.4.3: Add script swap in `handleHtmlResponse`**

```ts
if (contentType.includes('text/html') && proxyPath.startsWith('/test-preview')) {
  if (isProjectIsolated(projectId)) {
    html = swapEntryScript(html, '/src/__canvas_preview_standalone__.tsx');
  }
}
```

Import `swapEntryScript` from `lib/proxy/response-processor.ts` and `isProjectIsolated` from container-manager.

- [ ] **Step 9.5: Run full test suite**

```bash
bun run test
```

Fix any test failures caused by removed files/imports.

- [ ] **Step 9.6: Manual verification**

1. Open SaaS, select a component, confirm preview works without `POST /api/generate-preview` in Network tab
2. Check the container's `/test-preview` path renders the component

- [ ] **Step 9.7: Commit**

```bash
git add client/main.tsx client/components/IframeCanvas.tsx \
        server/proxy/project-preview.ts
git commit -m "feat(preview): SaaS cleanup — remove isPreviewPath check and generatePreview endpoint"
```

---

## Task 10: Integration smoke test — all ModeManager branches live

**Files:** none (no new code)

`PreviewModeManager` was created in Task 4c. By now Tasks 5 and 8 have implemented
`patchRouterConfig`, `revertRouterPatch`, `patchEntryFile`, `revertEntryFile` in `PreviewFileManager`.
Task 10 verifies all branches in ModeManager are functional end-to-end.

### 10.1: Run full test suite

```bash
bun run test
```

All branches should pass — `patchRouterConfig` (Task 5), `patchEntryFile` (Task 8),
`ensurePreviewFiles` (Task 3) are all implemented by this point.

### 10.2: Commit

```bash
git commit -m "chore(preview): all ModeManager branches verified"
```

---

## Task 12: E2E tests (`ext-test-projects`)

**Repo:** `/Users/ultra/work/ext-test-projects`
**New file:** `e2e/tests/project-dependent/preview-routing.spec.ts`

Covers all verification scenarios automatically. Uses existing test projects and page objects.

### Scenarios → test projects

| Scenario                                              | Test project                             |
| ----------------------------------------------------- | ---------------------------------------- |
| Next.js App Router — App Shell                        | `nextjs-sample`                          |
| Next.js Pages Router — App Shell                      | `nextjs-tw-sample`                       |
| Vite JSX router — App Shell + `patchRouterConfig`     | `react-vite-tw4-twitter`                 |
| Webpack — App Shell + `patchEntryFile`                | `webpack-react-tw3-kanban`               |
| Remix — App Shell file-based route                    | `remix-tw4-twitter`                      |
| Isolated mode Tier 1 (create `.hyperide/preview.tsx`) | `react-vite-tw4-twitter`                 |
| Revert to App Shell (delete `.hyperide/preview.tsx`)  | `react-vite-tw4-twitter`                 |
| Webpack Tier 2 + `.hyperide/preview.tsx`              | `webpack-react-tw3-kanban`               |
| Git check — error screen when no `.git`               | `react-vite-tw4-twitter` (remove `.git`) |

### Test structure

```ts
// e2e/tests/project-dependent/preview-routing.spec.ts
import { test, expect } from '../../fixtures/project.fixture';
import { setupPreviewWithDevServer } from '../../helpers/setup-preview';

test.describe('Preview Routing — App Shell mode', { tag: ['@preview', '@routing'] }, () => {
  test('Vite JSX router: select component → preview loads at /test-preview (no 404)', async ({ window }) => {
    // project: react-vite-tw4-twitter
    const { canvas } = await setupPreviewWithDevServer(window, 'react-vite-tw4-twitter');
    await expect.poll(() => canvas.isPreviewLoaded(), { timeout: 30_000 }).toBe(true);
    // Assert no 404 error overlay
    const appFrame = await canvas.getAppFrame();
    await expect(appFrame.locator('text=404')).not.toBeVisible();
  });

  test('Next.js App Router: component renders with app wrap (CSS applied)', async ({ window }) => {
    const { canvas } = await setupPreviewWithDevServer(window, 'nextjs-sample');
    await expect.poll(() => canvas.isPreviewLoaded(), { timeout: 60_000 }).toBe(true);
    const appFrame = await canvas.getAppFrame();
    const el = appFrame.locator('[data-uniq-id]').first();
    const box = await el.boundingBox();
    expect(box!.width).toBeGreaterThan(0);
  });

  test('Webpack: App Shell + entry file patched — preview renders', async ({ window }) => {
    const { canvas } = await setupPreviewWithDevServer(window, 'webpack-react-tw3-kanban');
    await expect.poll(() => canvas.isPreviewLoaded(), { timeout: 60_000 }).toBe(true);
    expect(await canvas.getElementCount()).toBeGreaterThan(0);
  });
});

test.describe('Preview Routing — Isolated mode', { tag: ['@preview', '@routing'] }, () => {
  test('create .hyperide/preview.tsx → switches to Isolated mode (Tier 1 script swap)', async ({ window, fs }) => {
    const { canvas } = await setupPreviewWithDevServer(window, 'react-vite-tw4-twitter');
    await expect.poll(() => canvas.isPreviewLoaded(), { timeout: 30_000 }).toBe(true);

    // Create .hyperide/preview.tsx
    await fs.writeFile('.hyperide/preview.tsx', MINIMAL_WRAPPER);
    // Wait for ModeManager FSWatch to pick up change
    await window.waitForTimeout(500);

    // Assert: proxy now serves standalone entry (no app chrome in iframe URL path)
    await expect.poll(() => canvas.isPreviewLoaded(), { timeout: 30_000 }).toBe(true);
    // Verify entry script was swapped (check network request for __canvas_preview_standalone__)
    const requests = await canvas.getCapturedRequests();
    expect(requests.some((r) => r.includes('__canvas_preview_standalone__'))).toBe(true);
  });

  test('delete .hyperide/preview.tsx → reverts to App Shell mode', async ({ window, fs }) => {
    await setupPreviewWithDevServer(window, 'react-vite-tw4-twitter');
    await fs.writeFile('.hyperide/preview.tsx', MINIMAL_WRAPPER);
    await window.waitForTimeout(500);
    await fs.deleteFile('.hyperide/preview.tsx');
    await window.waitForTimeout(500);
    // Assert: back to App Shell (route file at /test-preview)
    await expect
      .poll(
        async () => {
          const appFrame = await canvas.getAppFrame();
          return appFrame
            .locator('text=404')
            .isVisible()
            .then((v) => !v);
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});

test.describe('Preview Routing — Git check', { tag: ['@preview', '@routing'] }, () => {
  test('project without git → error screen shown instead of iframe', async ({ window, fs }) => {
    // Remove .git from project (restore via git checkout after test)
    await fs.deleteDir('.git');
    await setupPreviewWithDevServer(window, 'react-vite-tw4-twitter');

    const webview = new WebviewFrame(window);
    const previewContent = await webview.getPreviewPanelContent();
    // Assert: error screen visible, no iframe
    await expect(previewContent.locator('text=Git repository required')).toBeVisible({ timeout: 10_000 });
    await expect(previewContent.locator('button:has-text("Initialize Git")')).toBeVisible();
    await expect(previewContent.locator(`iframe[data-testid="${TID.preview.iframe}"]`)).not.toBeVisible();
  });
});

const MINIMAL_WRAPPER = `
import type { ReactNode } from 'react';
export default function PreviewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
`;
```

### 12.1: Run

```bash
cd /Users/ultra/work/ext-test-projects
bun run test e2e/tests/project-dependent/preview-routing.spec.ts
```

### 12.2: Commit (in ext-test-projects repo)

```bash
git add e2e/tests/project-dependent/preview-routing.spec.ts
git commit -m "feat(e2e): preview routing tests — App Shell, Isolated mode, git check"
```

---

## Verification Checklist

All scenarios covered by Task 12 E2E tests. Manual fallback if E2E infra unavailable:

- [ ] `npx tsc --noEmit` — no TypeScript errors
- [ ] `bun run test` — all unit tests pass
- [ ] `cd ext-test-projects && bun run test e2e/tests/project-dependent/preview-routing.spec.ts` — all E2E pass

---

## Task 11: Git prerequisite check

**Files:**

- Create: `lib/preview-generator/git-check.ts` — `isGitRepo(projectRoot, io): Promise<boolean>`
- Modify: `vscode-extension/hypercanvas-preview/src/extension.ts` — check before preview activation
- Modify: `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx` — git error state
- Modify: `client/components/IframeCanvas.tsx` — git error state (SaaS)
- Add: `server/routes/gitInit.ts` — `POST /api/project/git-init` (SaaS)

**Why:** HyperIDE modifies source files (`App.tsx`, `index.tsx`) with `@hyperide-managed` patches.
Without git, the user has no diff visibility and no safety net. This is a hard requirement, not a suggestion.

### 11.1: `isGitRepo()` utility

```ts
// lib/preview-generator/git-check.ts
import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';

export async function isGitRepo(projectRoot: string, io: FileIO): Promise<boolean> {
  try {
    await io.access(join(projectRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}
```

### 11.2: Extension — block preview if no git

In `extension.ts`, before starting `PreviewProxy` and `PreviewModeManager`:

```ts
const gitOk = await isGitRepo(workspaceRoot, new VSCodeFileIO());
if (!gitOk) {
  previewPanel?.showGitRequiredError();
  return; // skip proxy start, mode manager, everything
}
```

`showGitRequiredError()` sends a message to the preview panel webview which renders the error state instead of the iframe. After the user clicks "Initialize Git", the extension:

1. Runs `vscode.commands.executeCommand('git.init', vscode.Uri.file(workspaceRoot))`
2. Re-runs the activation check
3. If git now present → continues normal preview startup

### 11.3: Error screen UI (shared HTML, used by both extension webview and SaaS React component)

The error screen replaces the preview iframe. Layout:

```
┌─────────────────────────────────────┐
│                                     │
│  📁  Git repository required        │
│                                     │
│  HyperIDE modifies your source      │
│  files to set up preview routing.   │
│  Git lets you review and undo any   │
│  changes safely.                    │
│                                     │
│  [ Initialize Git ]                 │
│                                     │
│  ▸ What is version control?         │ ← collapsible
│    Version control tracks every     │
│    change to your code over time,   │
│    so you can always see what       │
│    changed and roll back if needed. │
│    Learn more →  git-scm.com/book   │
│                                     │
└─────────────────────────────────────┘
```

- Extension: rendered as HTML in the preview panel webview (message from extension host sets `showGitError: true` state in webview)
- SaaS: React component replacing `<IframeCanvas>` when `project.hasGit === false`

### 11.4: SaaS — server-side git check + API

`GET /api/project/:id` response already returns project data — add `hasGit: boolean` field (computed from `fs.access(join(project.path, '.git'))`), no DB column needed.

`POST /api/project/:id/git-init`:

- Protected by `requireEditor`
- Runs `git init` in `project.path` via `execa('git', ['init'], { cwd: project.path })`
- Returns `{ success: true }`
- Client re-fetches project data → `hasGit` becomes `true` → iframe replaces error screen

### 11.5: Verification checklist

- [ ] Extension: open a project without `.git` → preview panel shows error screen (no iframe)
- [ ] Click "Initialize Git" → `.git` appears → preview loads normally
- [ ] Expand "What is version control?" → collapsible opens with explanation and link
- [ ] Extension: project WITH git → no error screen, normal preview
- [ ] SaaS: project without git → error screen in preview panel
- [ ] SaaS: click "Initialize Git" → POST fires → preview loads

### 11.6: Commit

```bash
git add lib/preview-generator/git-check.ts \
        vscode-extension/hypercanvas-preview/src/extension.ts \
        vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx \
        client/components/IframeCanvas.tsx \
        server/routes/gitInit.ts
git commit -m "feat(preview): require git repo — show error screen with git init button if missing"
```
