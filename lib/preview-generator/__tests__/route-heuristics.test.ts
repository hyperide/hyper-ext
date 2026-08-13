import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../ast/file-io';
import {
  extractRoutesFromSource,
  getRouteSuggestions,
  mergeRouteSuggestions,
  nextAppRouteFromPath,
  nextPagesRouteFromPath,
  remixRouteFromPath,
} from '../route-heuristics/index';

const root = '/project';

/** FileIO over an in-memory tree. `files` maps absolute path → contents; dirs are derived. */
function makeIO(files: Record<string, string>): FileIO {
  const paths = Object.keys(files);
  return {
    async readFile(p: string) {
      if (p in files) return files[p];
      throw new Error(`ENOENT: ${p}`);
    },
    async writeFile() {},
    async access(p: string) {
      if (p in files || paths.some((f) => f.startsWith(`${p}/`))) return;
      throw new Error(`ENOENT: ${p}`);
    },
    async listFiles(dir: string, extensions?: string[]) {
      return paths.filter((p) => p.startsWith(`${dir}/`) && (!extensions || extensions.some((ext) => p.endsWith(ext))));
    },
  };
}

function paths(list: { path: string }[]): string[] {
  return list.map((r) => r.path);
}

describe('extractRoutesFromSource — React Router JSX', () => {
  it('extracts <Route path> declarations, ignoring index/layout routes', () => {
    const src = `
      import { Routes, Route } from 'react-router-dom';
      export default function App() {
        return (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route index element={<Dashboard />} />
            <Route path="/users/:id" element={<User />} />
          </Routes>
        );
      }`;
    expect(paths(extractRoutesFromSource(src)).sort()).toEqual(['/', '/about', '/users/:id']);
  });

  it('extracts paths from createBrowserRouter route objects', () => {
    const src = `
      import { createBrowserRouter } from 'react-router-dom';
      const router = createBrowserRouter([
        { path: '/', element: <Root /> },
        { path: '/settings', element: <Settings />, children: [
          { path: '/settings/profile', element: <Profile /> },
        ]},
      ]);`;
    expect(paths(extractRoutesFromSource(src)).sort()).toEqual(['/', '/settings', '/settings/profile']);
  });
});

describe('extractRoutesFromSource — generic link scan', () => {
  it('extracts <Link to> / <NavLink to> / <a href> absolute paths, dropping external + anchors', () => {
    const src = `
      export function Nav() {
        return (
          <nav>
            <Link to="/dashboard">Dash</Link>
            <NavLink to="/billing">Billing</NavLink>
            <a href="/help">Help</a>
            <a href="https://example.com">External</a>
            <a href="#section">Anchor</a>
            <Link to="relative">Relative</Link>
          </nav>
        );
      }`;
    expect(paths(extractRoutesFromSource(src)).sort()).toEqual(['/billing', '/dashboard', '/help']);
  });
});

describe('file-route filename conventions', () => {
  it('Next.js app router: page.tsx files → routes, dynamic + groups handled', () => {
    expect(nextAppRouteFromPath('page.tsx')?.path).toBe('/');
    expect(nextAppRouteFromPath('about/page.tsx')?.path).toBe('/about');
    expect(nextAppRouteFromPath('users/[id]/page.tsx')?.path).toBe('/users/:id');
    expect(nextAppRouteFromPath('blog/[...slug]/page.tsx')?.path).toBe('/blog/:slug*');
    expect(nextAppRouteFromPath('(marketing)/pricing/page.tsx')?.path).toBe('/pricing');
    expect(nextAppRouteFromPath('about/layout.tsx')).toBeNull();
  });

  it('Next.js pages router: file path → route, index + dynamic + api handled', () => {
    expect(nextPagesRouteFromPath('index.tsx')?.path).toBe('/');
    expect(nextPagesRouteFromPath('about.tsx')?.path).toBe('/about');
    expect(nextPagesRouteFromPath('users/[id].tsx')?.path).toBe('/users/:id');
    expect(nextPagesRouteFromPath('_app.tsx')).toBeNull();
    expect(nextPagesRouteFromPath('api/health.ts')).toBeNull();
  });

  it('Remix flat routes: dotted filename → route, splat + params + index handled', () => {
    expect(remixRouteFromPath('_index.tsx')?.path).toBe('/');
    expect(remixRouteFromPath('about.tsx')?.path).toBe('/about');
    expect(remixRouteFromPath('users.$id.tsx')?.path).toBe('/users/:id');
    expect(remixRouteFromPath('dashboard._index.tsx')?.path).toBe('/dashboard');
    expect(remixRouteFromPath('settings.profile/route.tsx')?.path).toBe('/settings/profile');
  });
});

describe('mergeRouteSuggestions', () => {
  it('dedupes by path keeping the best-ranked source and sorts deterministically', () => {
    const merged = mergeRouteSuggestions([
      { path: '/about', source: 'link' },
      { path: '/about', source: 'route-config' },
      { path: '/', source: 'route-config' },
      { path: '/about/', source: 'link' }, // trailing slash normalizes to /about
      { path: 'relative', source: 'link' }, // dropped (no leading slash)
      { path: 'https://x.com', source: 'link' }, // dropped (external)
    ]);
    expect(merged).toEqual([
      { path: '/', source: 'route-config' },
      { path: '/about', source: 'route-config' },
    ]);
  });

  it("drops the preview's own injected /test-preview route", () => {
    const merged = mergeRouteSuggestions([
      { path: '/', source: 'route-config' },
      { path: '/test-preview', source: 'route-config' },
      { path: '/test-preview/x', source: 'link' },
      { path: '/about', source: 'route-config' },
    ]);
    expect(paths(merged)).toEqual(['/', '/about']);
  });
});

describe('getRouteSuggestions — end to end per framework', () => {
  it('React Router (vite/bun SPA): pulls <Route> declarations from src', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { 'react-router-dom': '^6.0.0', vite: '^5' } }),
      [`${root}/src/App.tsx`]: `
        import { Routes, Route } from 'react-router-dom';
        export default function App() {
          return <Routes><Route path="/" element={<H/>} /><Route path="/about" element={<A/>} /></Routes>;
        }`,
    });
    expect(paths(await getRouteSuggestions(root, io))).toEqual(['/', '/about']);
  });

  it('Remix: pulls routes from app/routes filenames', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { '@remix-run/react': '^2.0.0' } }),
      [`${root}/app/routes/_index.tsx`]: 'export default function I(){return null}',
      [`${root}/app/routes/about.tsx`]: 'export default function A(){return null}',
      [`${root}/app/routes/users.$id.tsx`]: 'export default function U(){return null}',
    });
    expect(paths(await getRouteSuggestions(root, io))).toEqual(['/', '/about', '/users/:id']);
  });

  it('Next.js app router: pulls routes from app/ page files', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { next: '^15.0.0' } }),
      [`${root}/app/layout.tsx`]: 'export default function L(){return null}',
      [`${root}/app/page.tsx`]: 'export default function P(){return null}',
      [`${root}/app/dashboard/page.tsx`]: 'export default function D(){return null}',
    });
    expect(paths(await getRouteSuggestions(root, io))).toEqual(['/', '/dashboard']);
  });

  it('extracts createBrowserRouter routes from a non-JSX .ts data-router file', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { 'react-router-dom': '^6', vite: '^5' } }),
      [`${root}/src/router.ts`]: `
        import { createBrowserRouter } from 'react-router-dom';
        export const router = createBrowserRouter([
          { path: '/', Component: Root },
          { path: '/dashboard', Component: Dashboard },
        ]);`,
    });
    expect(paths(await getRouteSuggestions(root, io))).toEqual(['/', '/dashboard']);
  });

  it('returns [] when nothing is found (no dropdown)', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { vite: '^5' } }),
      [`${root}/src/App.tsx`]: 'export default function App(){return <div>hi</div>;}',
    });
    expect(await getRouteSuggestions(root, io)).toEqual([]);
  });

  it('swallows parse errors in individual files and still returns other routes', async () => {
    const io = makeIO({
      [`${root}/package.json`]: JSON.stringify({ dependencies: { 'react-router-dom': '^6', vite: '^5' } }),
      [`${root}/src/Broken.tsx`]: 'export const x = (((',
      [`${root}/src/App.tsx`]: `import { Route } from 'react-router-dom';
        export default () => <Route path="/ok" element={<O/>} />;`,
    });
    expect(paths(await getRouteSuggestions(root, io))).toEqual(['/ok']);
  });
});
