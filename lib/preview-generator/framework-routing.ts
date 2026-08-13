/**
 * @file Deterministic framework detection from project filesystem.
 *
 * Accessed via: VS Code extension preview panel + SaaS canvas — on component select via
 *               PreviewFileManager.ensurePreviewFiles() and PreviewModeManager.onComponentSelected()
 * Assumptions: detection rules are checked in order; first match wins
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';

export type FrameworkType =
  | 'nextjs-app-router'
  | 'nextjs-pages-router'
  | 'remix'
  | 'vite-spa-file-based'
  | 'vite-spa-jsx-router'
  | 'astro'
  | 'bun'
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
  /**
   * Astro's `srcDir` from astro.config.* (default 'src'). Set for astro when a non-default
   * srcDir is parsed from the config. The pages root is `<srcDir>/pages`.
   */
  srcDir?: string;
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

const ASTRO_CONFIG_FILES = [
  'astro.config.ts',
  'astro.config.mjs',
  'astro.config.js',
  'astro.config.cjs',
  'astro.config.mts',
  'astro.config.cts',
] as const;

/**
 * Read Astro's `srcDir` from the first astro.config.* found. Astro defaults to 'src';
 * when the config sets a custom srcDir the pages root moves to `<srcDir>/pages`.
 * Returns the normalized dir (leading './' and trailing '/' stripped), or undefined
 * when no config is present or srcDir is absent/unparseable — callers default to 'src'.
 */
async function readAstroSrcDir(projectRoot: string, io: FileIO): Promise<string | undefined> {
  for (const configName of ASTRO_CONFIG_FILES) {
    let source: string;
    try {
      source = await io.readFile(join(projectRoot, configName));
    } catch {
      continue; // config file not present — try next extension
    }
    // Strip comments first so a commented example (`// srcDir: 'app'`) isn't
    // mistaken for a real setting (would route /test-preview to a 404 dir).
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (keep `://` in URLs intact)
    const match = stripped.match(/\bsrcDir\s*:\s*['"`]([^'"`]+)['"`]/);
    if (!match) return undefined;
    const normalized = match[1].replace(/^\.\//, '').replace(/\/+$/, '');
    return normalized || undefined;
  }
  return undefined;
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
  if (deps.next) {
    if (await exists(io, join(projectRoot, 'app/layout.tsx'))) {
      return { framework: 'nextjs-app-router', appDir: 'app' };
    }
    if (await exists(io, join(projectRoot, 'src/app/layout.tsx'))) {
      return { framework: 'nextjs-app-router', appDir: 'src/app' };
    }
    if (await exists(io, join(projectRoot, 'pages/_app.tsx'))) {
      return { framework: 'nextjs-pages-router', pagesDir: 'pages' };
    }
    if (await exists(io, join(projectRoot, 'src/pages/_app.tsx'))) {
      return { framework: 'nextjs-pages-router', pagesDir: 'src/pages' };
    }
    return { framework: 'nextjs-app-router', appDir: 'app' }; // modern Next.js default
  }

  // 3. Remix — prefer app/routes/, fallback to src/routes/
  if (deps['@remix-run/react'] || deps['@remix-run/node']) {
    const routesDir = (await exists(io, join(projectRoot, 'src/routes'))) ? 'src/routes' : 'app/routes';
    return { framework: 'remix', routesDir };
  }

  // 3a. Astro — Vite-powered, but no React Router and no JS SPA entry point. It uses
  // its own file-based routing (src/pages/*.astro), so it gets a dedicated route file
  // (test-preview.astro) that mounts CanvasPreview as a `client:only="react"` island.
  // HYP-382 originally mapped Astro to vite-spa-jsx-router, which dead-ended: no router
  // found AND no entry file found → 'needs-patch' → a misleading "JSX router detected" toast.
  let isAstro = Boolean(deps.astro);
  if (!isAstro) {
    for (const configName of ASTRO_CONFIG_FILES) {
      if (await exists(io, join(projectRoot, configName))) {
        isAstro = true;
        break;
      }
    }
  }
  if (isAstro) {
    const srcDir = await readAstroSrcDir(projectRoot, io);
    return srcDir ? { framework: 'astro', srcDir } : { framework: 'astro' };
  }

  // 4. Vite — sub-classify via filesystem, preserve actual routes dir.
  // Detect Vite by config-file presence too, not just deps.vite: in monorepos
  // vite is commonly hoisted to the workspace root, so a sub-package's own
  // package.json lists no `vite` dependency even though `vite dev` runs there.
  //
  // BUT config-file presence is only a FALLBACK signal — it must never override an
  // EXPLICIT bundler dependency. A CRA / webpack / Parcel app commonly carries a
  // `vite.config.ts` purely for vitest unit tests; treating that as a Vite SPA would
  // silently reclassify (and mis-preview) the app. So config-only detection is gated
  // on the absence of an explicit react-scripts/webpack/parcel dep. An explicit
  // `deps.vite` is a strong signal and still wins unconditionally (HYP-470).
  const hasExplicitOtherBundler = Boolean(deps['react-scripts'] || deps.webpack || deps.parcel);
  const hasViteConfig =
    (await exists(io, join(projectRoot, 'vite.config.ts'))) ||
    (await exists(io, join(projectRoot, 'vite.config.js'))) ||
    (await exists(io, join(projectRoot, 'vite.config.mjs'))) ||
    (await exists(io, join(projectRoot, 'vite.config.mts'))) ||
    (await exists(io, join(projectRoot, 'vite.config.cts'))) ||
    (await exists(io, join(projectRoot, 'vite.config.cjs')));
  const isVite = Boolean(deps.vite) || (hasViteConfig && !hasExplicitOtherBundler);
  if (isVite) {
    if (await exists(io, join(projectRoot, 'app/routes'))) {
      return { framework: 'vite-spa-file-based', routesDir: 'app/routes' };
    }
    if (await exists(io, join(projectRoot, 'src/routes'))) {
      return { framework: 'vite-spa-file-based', routesDir: 'src/routes' };
    }
    return { framework: 'vite-spa-jsx-router' };
  }

  // 5. CRA (react-scripts) and plain Webpack — both get webpack treatment
  if (deps['react-scripts'] || deps.webpack) return { framework: 'webpack' };

  // 6. Parcel
  if (deps.parcel) return { framework: 'parcel' };

  // 7. Bun's React template serves index.html through Bun.serve() and does
  // not have a framework router. Patch its browser entry file like a plain SPA.
  const hasBunLock =
    (await exists(io, join(projectRoot, 'bun.lock'))) || (await exists(io, join(projectRoot, 'bun.lockb')));
  if (hasBunLock || deps['bun-plugin-tailwind']) {
    return { framework: 'bun' };
  }

  return { framework: 'unknown' };
}

export interface RouteFilePaths {
  routeFile: string;
  layoutFile?: string;
}

/**
 * Compute paths for framework-specific route files using actual dirs from DetectionResult.
 * Callers must pass the full DetectionResult so paths match the dirs that actually exist on disk.
 */
export function getRouteFilePaths(result: DetectionResult, projectRoot: string): RouteFilePaths {
  const { framework, appDir = 'app', pagesDir = 'pages', routesDir, srcDir = 'src' } = result;
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
    case 'astro':
      // Astro file-based routing: <srcDir>/pages/test-preview.astro. srcDir defaults to
      // 'src' but is configurable via astro.config.* (carried in DetectionResult.srcDir).
      // A static-segment route outranks the CMS catch-all (/[...slug]) in Astro's route
      // priority, and coexists safely with fallback:'passthrough'.
      //
      // NOTE: the generated __canvas_preview__.tsx still follows PreviewFileManager.
      // getPreviewFilePath (default 'src/'), so for a custom srcDir the route imports it
      // via a correct relative path but the module lives outside <srcDir> (a stray src/).
      // Harmless — the import resolves — but co-locating it under <srcDir> is deferred.
      return { routeFile: join(projectRoot, srcDir, 'pages', 'test-preview.astro') };
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
  const params = useSearchParams();
  return <CanvasPreview component={params.get('component')} mode={params.get('mode') as 'single' | 'multi'} />;
}

export default function TestPreviewPage() {
  return <div id="root"><Suspense><PreviewContent /></Suspense></div>;
}
`;
  }

  if (framework === 'nextjs-pages-router') {
    return `${managed}
import CanvasPreview from '${previewImportPath}';

export default function TestPreviewPage() {
  return <div id="root"><CanvasPreview /></div>;
}
`;
  }

  if (framework === 'remix') {
    return `${managed}
import { useEffect as useHyperCanvasEffect } from 'react';
import { useSearchParams } from '@remix-run/react';
import CanvasPreview from '${previewImportPath}';

const hyperCanvasScripts = [
  { id: 'interaction', src: '/__hypercanvas/iframe-interaction.js' },
  { id: 'error-detection', src: '/__hypercanvas/iframe-error-detection.js' },
  { id: 'console-capture', src: '/__hypercanvas/iframe-console-capture.js' },
  { id: 'chrome-detection', src: '/__hypercanvas/chrome-detection.js' },
];

function HyperCanvasScripts() {
  useHyperCanvasEffect(() => {
    const addedScripts: HTMLScriptElement[] = [];
    for (const script of hyperCanvasScripts) {
      if (document.querySelector(\`script[data-hyper-inject="\${script.id}"]\`)) continue;
      const element = document.createElement('script');
      element.dataset.hyperInject = script.id;
      element.src = script.src;
      document.head.appendChild(element);
      addedScripts.push(element);
    }
    return () => {
      for (const element of addedScripts) element.remove();
    };
  }, []);

  return null;
}

export default function TestPreviewRoute() {
  const [params] = useSearchParams();

  return (
    <div id="root">
      <HyperCanvasScripts />
      <CanvasPreview component={params.get('component')} mode={params.get('mode') as 'single' | 'multi'} />
    </div>
  );
}
`;
  }

  if (framework === 'astro') {
    // Astro page: frontmatter import + template that mounts CanvasPreview as a React
    // island. `client:only="react"` skips SSR — CanvasPreview reads window.location.search
    // for the ?component= param, which is undefined during Astro's server render.
    // No props are passed: the island resolves the active component client-side, same as
    // the Vite-file-based route.
    return `---
${managed}
import CanvasPreview from '${previewImportPath}';
---
<div id="root"><CanvasPreview client:only="react" /></div>
`;
  }

  // Vite file-based
  return `${managed}
import CanvasPreview from '${previewImportPath}';

export default function TestPreviewRoute() {
  return <div id="root"><CanvasPreview /></div>;
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

/**
 * Generate a Next.js layout.tsx for Isolated mode (Tier 3).
 * Imports PreviewWrapper from .hyperide/preview.tsx and wraps children with it.
 * @param wrapperImportPath - relative import path from the layout file to .hyperide/preview
 */
export function generateIsolatedLayoutContent(wrapperImportPath: string): string {
  return `// @hyperide-managed
import type { ReactNode } from 'react';
import { PreviewWrapper } from '${wrapperImportPath}';

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return <PreviewWrapper>{children}</PreviewWrapper>;
}
`;
}
