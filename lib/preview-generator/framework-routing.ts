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

  // 3a. Astro — Vite-powered; no React Router, treat as plain Vite SPA entry
  const isAstro =
    Boolean(deps.astro) ||
    (await exists(io, join(projectRoot, 'astro.config.ts'))) ||
    (await exists(io, join(projectRoot, 'astro.config.mjs'))) ||
    (await exists(io, join(projectRoot, 'astro.config.js')));
  if (isAstro) {
    return { framework: 'vite-spa-jsx-router' };
  }

  // 4. Vite — sub-classify via filesystem, preserve actual routes dir
  if (deps.vite) {
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
