/**
 * @file Deterministic framework detection from project filesystem.
 *
 * Accessed via: VS Code extension preview panel + SaaS canvas — on component select via
 *               PreviewFileManager.ensurePreviewFiles() and PreviewModeManager.onComponentSelected()
 * Assumptions: detection rules are checked in order; first match wins
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { join, posix } from 'node:path';
import type { FileIO } from '../ast/file-io';

export type FrameworkType =
  | 'nextjs-app-router'
  | 'nextjs-pages-router'
  | 'remix'
  | 'astro'
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

/**
 * Nx project config embedded in package.json. In an nx monorepo `scripts.dev` is usually a
 * passthrough (`nx run <pkg>:dev`) and the REAL host command lives one level deeper, at
 * `nx.targets.dev.options.command`.
 *
 * Exported (HYP-904) so ProjectDetector.ts's own, independent bun/framework detector reads
 * this identical shape instead of re-deriving its own inline cast — the two detectors already
 * drifted once (HYP-885 fixed this file's Bun-app signal; ProjectDetector.ts kept the old,
 * nx-blind one until HYP-904).
 */
export interface NxPackageJson {
  nx?: { targets?: Record<string, { options?: { command?: string } }> };
}

/** The real dev command for an nx-monorepo passthrough package, if present. */
export function readNxDevCommand(pkg: NxPackageJson | undefined): string | undefined {
  return pkg?.nx?.targets?.dev?.options?.command;
}

interface PackageJson extends NxPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** Package scripts — read for the local Bun-app signal (`scripts.dev` running the Bun runtime). */
  scripts?: Record<string, string>;
}

/**
 * HTML files (priority order) that may carry a local app's module entry `<script>`.
 * Single source of truth shared by two consumers so they can never disagree about "does
 * this project have a module HTML entry": PreviewModeManager patches the entry this resolves
 * to, and detectFramework uses the same probe as one of the two local Bun-app signals.
 */
const HTML_MODULE_ENTRY_CANDIDATES = ['index.html', 'src/index.html', 'client/index.html', 'app/index.html'] as const;

/**
 * Resolve a local HTML file's `<script type="module" src="...">` to the ABSOLUTE path of the
 * module it points at, when that module exists on disk. Returns null when no candidate HTML has
 * a module script whose target resolves to a real local .js/.jsx/.ts/.tsx file.
 *
 * Mirrors the heuristic the extension relies on for SPA entry patching (Bun/webpack/parcel):
 * external/absolute-URL and Vite virtual (`/@`) scripts are ignored; the src is resolved
 * relative to the HTML file's own directory. PreviewModeManager._detectHtmlEntryFile delegates
 * here so the classifier and the patcher share exactly one implementation.
 */
export async function detectHtmlModuleEntry(projectRoot: string, io: FileIO): Promise<string | null> {
  for (const htmlRel of HTML_MODULE_ENTRY_CANDIDATES) {
    let html: string;
    try {
      html = await io.readFile(join(projectRoot, htmlRel));
    } catch {
      continue;
    }

    const htmlDir = htmlRel.includes('/') ? htmlRel.slice(0, htmlRel.lastIndexOf('/')) : '';
    // HTML tag names are case-insensitive — match `<SCRIPT>`/`<Script>` too
    // (CodeQL js/bad-tag-filter). Regex HTML parsing is a smell; this only sniffs the
    // module entry script, it does not strip/sanitize markup.
    const scriptTags = html.matchAll(/<script\b[^>]*>/gi);
    for (const match of scriptTags) {
      const tag = match[0];
      if (!/\btype=["']module["']/i.test(tag)) continue;
      const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
      if (!src || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/@')) continue;

      const rel = src.startsWith('/') ? src.slice(1) : posix.normalize(posix.join(htmlDir, src));
      if (!/\.[cm]?[jt]sx?$/.test(rel)) continue;

      const abs = join(projectRoot, rel);
      try {
        await io.readFile(abs);
        return abs;
      } catch {
        /* script target not present */
      }
    }
  }

  return null;
}

/**
 * True when a package script/command string invokes the Bun RUNTIME (`bun …` / `bunx …`) as a
 * real command word — anchored on whitespace or string start/end so it does NOT false-match a
 * hyphenated dependency NAME (`bun-tailwindcss`) or an unrelated word (`bunyan-logger start`).
 * A naive `\bbun\b` fails here: `\b` sits between `n` and `-`, so it WOULD match inside
 * `bun-tailwindcss`. Non-Bun host commands like `astro dev` / `vite` are correctly rejected.
 *
 * Exported (HYP-904) so ProjectDetector.ts's OWN, independent bun/framework detector can share
 * this exact check instead of re-deriving its own (looser) regex that drifts out of sync —
 * ProjectDetector's pre-fix `/\bbun\s+(--hot|--watch|src\/|index\.)/` required a specific flag
 * immediately after `bun`, so it missed `bun --bun --hot dev-server.tsx` (conloca's cms-spa).
 */
export function invokesBunRuntime(command: string | undefined): boolean {
  return command !== undefined && /(?:^|\s)bunx?(?=\s|$)/.test(command);
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
  let pkg: PackageJson = {};
  try {
    const parsed = JSON.parse(await io.readFile(join(projectRoot, 'package.json'))) as unknown;
    // Keep `pkg` an object even for a valid-but-non-object package.json (e.g. literal `null`):
    // `pkg` is read again below (step 7 `pkg.scripts`/`pkg.nx`), and `null.scripts` would throw
    // OUTSIDE this try — regressing the "malformed package.json → unknown" contract.
    pkg = parsed && typeof parsed === 'object' ? (parsed as PackageJson) : {};
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    /* package.json missing or unparseable — fall through to unknown */
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
  //
  // Three OR-ed signals classify a project as 'bun':
  //   • a LOCAL bun.lock/bun.lockb (classic single-repo Bun app), or
  //   • a `bun-plugin-tailwind` dependency (Bun's React+Tailwind starter), or
  //   • a LOCAL Bun-APP signal (HYP-885): BOTH a dev/host script that actually runs through
  //     the Bun runtime AND a real React HTML module entry to patch.
  //
  // The local Bun-APP signal exists for monorepo sub-packages that have NEITHER a per-package
  // lockfile (only the monorepo root has bun.lock) NOR the exact `bun-plugin-tailwind` name
  // (conloca's cms-spa uses the differently-named `bun-tailwindcss`). Both halves are
  // deliberately PER-PACKAGE: we must NOT walk up to a monorepo-root bun.lock, which would
  // misclassify a pure library sub-package (e.g. conloca's `mdx`, no dev script at all) as a
  // Bun app. The dev command is read from BOTH `scripts.dev` and, for nx passthroughs
  // (`nx run <pkg>:dev`), the nested `nx.targets.dev.options.command`.
  const hasBunLock =
    (await exists(io, join(projectRoot, 'bun.lock'))) || (await exists(io, join(projectRoot, 'bun.lockb')));
  const runsBunLocally = invokesBunRuntime(pkg.scripts?.dev) || invokesBunRuntime(readNxDevCommand(pkg));
  // The HTML-entry probe (up to 4 file reads) runs ONLY when the cheap signals warrant it: a
  // local bun dev command is present AND this isn't already Bun by lockfile/plugin. So a plain
  // React library that merely reaches step 7 pays nothing for the second signal.
  const isLocalBunApp =
    runsBunLocally &&
    !hasBunLock &&
    !deps['bun-plugin-tailwind'] &&
    Boolean(deps.react) &&
    (await detectHtmlModuleEntry(projectRoot, io)) !== null;
  if (hasBunLock || deps['bun-plugin-tailwind'] || isLocalBunApp) {
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
      // astro, webpack, parcel, vite-spa-jsx-router, unknown — no file-based route
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
  // app=1 selects app-mode (render the entry root raw); otherwise honor an explicit mode param.
  const mode = params.get('app') === '1' ? 'app' : (params.get('mode') as 'single' | 'multi' | 'app' | null);
  return <CanvasPreview component={params.get('component')} mode={mode} />;
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
    // Render the hyper-canvas scripts as plain <script src> tags DIRECTLY in the SSR JSX.
    //
    // Why not the proxy (PreviewProxy injects them into <head> for every other framework):
    // Remix hydrates the FULL document, so proxy-added <head> nodes the client render does
    // not know about cause a hydration mismatch. So the route must own the markup.
    //
    // Why not a post-hydration effect (the previous approach): the interaction script
    // (which enables the canvas selection round-trip) was appended to <head> from a
    // useEffect that runs several async hops AFTER hydration. Under cold-SSR (slow first
    // compile) the e2e harness read `hasInteractionScript` BEFORE the effect ran → an
    // intermittent race (#77/#45) that timed out the selection round-trip.
    //
    // Rendering them as JSX <script src> inside the route's own body subtree makes them
    // part of the SERVER-rendered HTML: the browser's parser executes a parser-inserted
    // <script src> at load, deterministically, with no useEffect timing dependency. React
    // owns this markup on both server and client (it lives in the route's returned tree,
    // the same children Remix renders inside <body>), so it hydrates cleanly WITHOUT
    // suppressHydrationWarning — server and client emit byte-identical <script> markup.
    //
    // These scripts are classic (no type="module"/async/defer), so the parser executes
    // iframe-interaction.js mid-parse — BEFORE <CanvasPreview> below it is parsed and before
    // Remix's <Scripts> hydration bundle runs. That script imperatively sets up listeners,
    // observers, window.__hyperCanvasState, and calls _disableNativeDraggableIn(document.body)
    // (sets draggable=false on <img>/<a href>). None of that drifts the React-controlled DOM
    // in a way hydration sees: React 18 hydration only reconciles props IT rendered, so a
    // `draggable` attribute (which no component renders) and imperatively-added listeners are
    // invisible to it — it never warns on or strips extra attributes it did not emit. And at
    // mid-parse the #root canvas subtree isn't built yet, so the querySelectorAll touches
    // (at most) nothing React owns. Hence pre-hydration execution is safe — no mismatch.
    //
    // Dedup is intrinsic: the proxy skips Remix and nothing else injects these, so each
    // src loads exactly once. The #51 bridge-ready handshake still fires when the script
    // executes (now earlier and deterministically), so it remains the replay safety net.
    //
    // #79 process-shim: the proxy injects a process-shim <script> into <head> for every
    // NON-Remix framework (defines globalThis.process so a user app reading
    // `process.env`/`process` at module-init doesn't crash the preview with "process is not
    // defined" — see PreviewProxy.ts). The proxy skips Remix, so the route must render the
    // shim itself. It is served at /__hypercanvas/process-shim.js (the same virtual-script
    // path the proxy serves regardless of Remix mode), so we reference it as a <script src>
    // exactly like the others — rendered FIRST, before the interaction/bridge scripts AND
    // before <CanvasPreview>, so `process` is defined before any user code or the bridge runs.
    //
    // Forward-compat caveat: this relies on React 18 (Remix 2) behavior. React 19 HOISTS
    // <script src> to <head> during render, which would move these tags out of <body> on the
    // client and reintroduce a server/client placement mismatch — revisit then (e.g. an
    // explicit non-hoisted script via the route's <Scripts>/links, or a head-managed inject).
    return `${managed}
import { useSearchParams } from '@remix-run/react';
import CanvasPreview from '${previewImportPath}';

export default function TestPreviewRoute() {
  const [params] = useSearchParams();
  const mode = params.get('app') === '1' ? 'app' : (params.get('mode') as 'single' | 'multi' | 'app' | null);

  return (
    <div id="root">
      <script data-hyper-inject="process-shim" src="/__hypercanvas/process-shim.js" />
      <script data-hyper-inject="interaction" src="/__hypercanvas/iframe-interaction.js" />
      <script data-hyper-inject="error-detection" src="/__hypercanvas/iframe-error-detection.js" />
      <script data-hyper-inject="console-capture" src="/__hypercanvas/iframe-console-capture.js" />
      <script data-hyper-inject="chrome-detection" src="/__hypercanvas/chrome-detection.js" />
      <CanvasPreview component={params.get('component')} mode={mode} />
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
