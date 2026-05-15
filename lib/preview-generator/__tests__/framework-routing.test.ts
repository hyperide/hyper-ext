import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import {
  detectFramework,
  generateBlankLayoutContent,
  generateRouteFileContent,
  getRouteFilePaths,
} from '../framework-routing';

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
    // Must pass component/mode props to CanvasPreview so it doesn't use window.location.search
    // (window is undefined during SSR in Next.js App Router)
    expect(content).toContain("params.get('component')");
    expect(content).toContain("params.get('mode')");
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
