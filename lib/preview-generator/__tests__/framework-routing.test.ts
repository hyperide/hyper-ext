import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import {
  detectFramework,
  generateBlankLayoutContent,
  generateRouteFileContent,
  getRouteFilePaths,
} from '../framework-routing';

function makeIO(pkg: Record<string, unknown>, files: string[] = [], contents: Record<string, string> = {}): FileIO {
  const fileSet = new Set([...files, ...Object.keys(contents)]);
  return {
    async readFile(p: string) {
      if (p.endsWith('package.json')) return JSON.stringify(pkg);
      if (p in contents) return contents[p];
      if (!fileSet.has(p)) throw new Error(`ENOENT: ${p}`);
      return '';
    },
    async writeFile() {},
    async access(p: string) {
      const exists = fileSet.has(p) || files.some((f) => f.startsWith(`${p}/`));
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

  it('detects Remix via "@remix-run/react" dep with src/routes/, returns routesDir: "src/routes"', async () => {
    const io = makeIO({ dependencies: { '@remix-run/react': '^2.0.0' } }, [`${root}/src/routes/home.tsx`]);
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('remix');
    expect(result.routesDir).toBe('src/routes');
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

  it('detects Astro via "astro" dep — takes precedence over vite', async () => {
    const io = makeIO({ dependencies: { astro: '^4.0.0', vite: '^5.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.ts (no dep)', async () => {
    const io = makeIO({ dependencies: {} }, [`${root}/astro.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('returns src/pages/test-preview.astro routeFile for Astro (default srcDir)', () => {
    expect(getRouteFilePaths({ framework: 'astro' }, root).routeFile).toBe(`${root}/src/pages/test-preview.astro`);
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

  it('detects Astro via "astro" dep as astro', async () => {
    const io = makeIO({ devDependencies: { astro: '^4.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.mjs when no deps (monorepo sub-package)', async () => {
    const io = makeIO({}, [`${root}/astro.config.mjs`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.ts', async () => {
    const io = makeIO({}, [`${root}/astro.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.cjs', async () => {
    const io = makeIO({}, [`${root}/astro.config.cjs`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.mts when astro is hoisted (not in this package.json)', async () => {
    const io = makeIO({}, [`${root}/astro.config.mts`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('detects Astro via astro.config.cts', async () => {
    const io = makeIO({}, [`${root}/astro.config.cts`]);
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('Astro takes precedence over bare vite dep', async () => {
    const io = makeIO({ devDependencies: { astro: '^4.0.0', vite: '^5.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('astro');
  });

  it('Astro with no srcDir in config leaves srcDir undefined (default src)', async () => {
    const io = makeIO({ dependencies: { astro: '^4.0.0' } }, [], {
      [`${root}/astro.config.mjs`]: `import { defineConfig } from 'astro/config';\nexport default defineConfig({ integrations: [] });\n`,
    });
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('astro');
    expect(result.srcDir).toBeUndefined();
  });

  it('Astro reads custom srcDir from astro.config.mjs', async () => {
    const io = makeIO({ dependencies: { astro: '^4.0.0' } }, [], {
      [`${root}/astro.config.mjs`]: `import { defineConfig } from 'astro/config';\nexport default defineConfig({ srcDir: 'app' });\n`,
    });
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('astro');
    expect(result.srcDir).toBe('app');
  });

  it('Astro reads custom srcDir from astro.config.ts and normalizes ./ and trailing /', async () => {
    const io = makeIO({}, [], {
      [`${root}/astro.config.ts`]: `export default { srcDir: './source/' };`,
    });
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('astro');
    expect(result.srcDir).toBe('source');
  });

  it('Astro ignores a commented-out srcDir (stays default src)', async () => {
    const io = makeIO({}, [`${root}/astro.config.mjs`], {
      [`${root}/astro.config.mjs`]: `export default defineConfig({\n  // srcDir: 'app',\n  /* srcDir: 'legacy' */\n  integrations: [],\n});\n`,
    });
    const result = await detectFramework(root, io);
    expect(result.framework).toBe('astro');
    expect(result.srcDir).toBeUndefined();
  });

  it('detects Parcel via "parcel" dep', async () => {
    const io = makeIO({ devDependencies: { parcel: '^2.0.0' } });
    expect((await detectFramework(root, io)).framework).toBe('parcel');
  });

  it('detects Bun from its lockfile and dev script', async () => {
    const io = makeIO({ scripts: { dev: 'bun --hot src/index.ts' }, dependencies: { react: '^19.0.0' } }, [
      `${root}/bun.lock`,
    ]);
    expect((await detectFramework(root, io)).framework).toBe('bun');
  });

  it('keeps Vite precedence when a Vite project uses Bun as package manager', async () => {
    const io = makeIO({ dependencies: { vite: '^5.0.0' } }, [`${root}/bun.lock`]);
    expect((await detectFramework(root, io)).framework).toBe('vite-spa-jsx-router');
  });

  it('detects Vite via vite.config.ts when vite is hoisted (monorepo sub-package, no explicit vite dep)', async () => {
    const io = makeIO({ dependencies: { react: '^19.0.0' } }, [`${root}/vite.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('vite-spa-jsx-router');
  });

  it('detects Vite via vite.config.js / .mjs config variants', async () => {
    expect((await detectFramework(root, makeIO({}, [`${root}/vite.config.js`]))).framework).toBe('vite-spa-jsx-router');
    expect((await detectFramework(root, makeIO({}, [`${root}/vite.config.mjs`]))).framework).toBe(
      'vite-spa-jsx-router',
    );
  });

  // HYP-470 adversarial: a vite.config.* present for TESTING (vitest) must not override
  // an explicit bundler dependency. The module contract is "package.json is the primary
  // signal for all frameworks" — a config file beating an explicit react-scripts/webpack/
  // parcel dep is a regression that silently reclassifies the app's previewable framework.
  it('CRA (react-scripts) with a vitest vite.config.ts stays webpack, not vite', async () => {
    const io = makeIO({ dependencies: { 'react-scripts': '^5.0.0' } }, [`${root}/vite.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('webpack');
  });

  it('plain webpack project with a vitest vite.config.ts stays webpack, not vite', async () => {
    const io = makeIO({ devDependencies: { webpack: '^5.0.0' } }, [`${root}/vite.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('webpack');
  });

  it('Parcel project with a vitest vite.config.ts stays parcel, not vite', async () => {
    const io = makeIO({ devDependencies: { parcel: '^2.0.0' } }, [`${root}/vite.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('parcel');
  });

  it('keeps the monorepo hoisted-vite intent: react-only dep + vite.config.ts is still vite', async () => {
    // This is the HYP-470 case the fix must NOT break — no explicit bundler dep present.
    const io = makeIO({ dependencies: { react: '^19.0.0' } }, [`${root}/vite.config.ts`]);
    expect((await detectFramework(root, io)).framework).toBe('vite-spa-jsx-router');
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

  it('returns src/pages/test-preview.astro for astro', () => {
    const paths = getRouteFilePaths({ framework: 'astro' }, '/project');
    expect(paths.routeFile).toBe('/project/src/pages/test-preview.astro');
    expect(paths.layoutFile).toBeUndefined();
  });

  it('returns <srcDir>/pages/test-preview.astro for astro with custom srcDir', () => {
    const paths = getRouteFilePaths({ framework: 'astro', srcDir: 'app' }, '/project');
    expect(paths.routeFile).toBe('/project/app/pages/test-preview.astro');
    expect(paths.layoutFile).toBeUndefined();
  });
});

describe('generateRouteFileContent', () => {
  it('nextjs-app-router route uses useSearchParams + Suspense', () => {
    const content = generateRouteFileContent('nextjs-app-router', '../../src/__canvas_preview__');
    expect(content).toContain("'use client'");
    expect(content).toContain('useSearchParams');
    expect(content).toContain('Suspense');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('id="root"');
    expect(content).toContain('CanvasPreview');
    // Must pass component/mode props to CanvasPreview so it doesn't use window.location.search
    // (window is undefined during SSR in Next.js App Router)
    expect(content).toContain("params.get('component')");
    expect(content).toContain("params.get('mode')");
    // App-mode must propagate too (props bypass CanvasPreview's URL parsing, so the wrapper
    // has to translate ?app=1 into mode='app' itself).
    expect(content).toContain("params.get('app') === '1'");
    expect(content).toContain("'app'");
  });

  it('nextjs-pages-router route renders CanvasPreview directly', () => {
    const content = generateRouteFileContent('nextjs-pages-router', '../src/__canvas_preview__');
    expect(content).toContain('CanvasPreview');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('id="root"');
    expect(content).not.toContain('useSearchParams');
  });

  it('remix route renders CanvasPreview', () => {
    const content = generateRouteFileContent('remix', '../../src/__canvas_preview__');
    expect(content).toContain('CanvasPreview');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('id="root"');
    expect(content).toContain('useEffect');
    expect(content).toContain('useSearchParams');
    expect(content).toContain("params.get('component')");
    expect(content).toContain("params.get('mode')");
    expect(content).toContain("params.get('app') === '1'");
    expect(content).toContain('/__hypercanvas/iframe-interaction.js');
    expect(content).not.toContain('suppressHydrationWarning');
  });

  it('astro route mounts CanvasPreview as a client:only React island', () => {
    const content = generateRouteFileContent('astro', '../__canvas_preview__');
    expect(content).toContain('@hyperide-managed');
    expect(content).toContain('CanvasPreview');
    expect(content).toContain('../__canvas_preview__');
    // Astro frontmatter import + React island directive (no SSR — CanvasPreview reads
    // window.location.search client-side, which is undefined during Astro SSR).
    expect(content).toContain('client:only="react"');
    // Astro components have no React default export — must be frontmatter + template, not JSX export.
    expect(content).not.toContain('export default function');
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
