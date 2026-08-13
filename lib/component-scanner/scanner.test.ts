import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { ComponentScanner } from './scanner';
import type { ProjectStructurePaths, ProjectStructureStore } from './types';

const TMP_DIR = path.join(import.meta.dir, '__test_fixtures__');

function createMockStore(
  data: ProjectStructurePaths | null,
): ProjectStructureStore & { saved: boolean; savedPaths: ProjectStructurePaths | null } {
  return {
    saved: false,
    savedPaths: null,
    load: async () => data,
    save: async function (_projectRoot: string, paths: ProjectStructurePaths) {
      this.saved = true;
      this.savedPaths = paths;
    },
    flush: async () => false,
  };
}

describe('ComponentScanner.getComponentsData', () => {
  beforeAll(() => {
    // Create test fixture: a simple project with src/App.tsx and src/components/ui/card.tsx
    const projectRoot = path.join(TMP_DIR, 'project');
    fs.mkdirSync(path.join(projectRoot, 'src', 'components', 'ui'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'src', 'App.tsx'), 'export function App() { return <div/>; }');
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'ui', 'card.tsx'),
      'export function Card() { return <div/>; }',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'ui', 'button.tsx'),
      'export function Button() { return <button/>; }',
    );
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  const projectRoot = path.join(TMP_DIR, 'project');

  it('should scan parent directory when file path is given as marker', async () => {
    const store = createMockStore({
      atomComponentsPaths: [path.join(projectRoot, 'src', 'components', 'ui')],
      compositeComponentsPaths: [path.join(projectRoot, 'src', 'App.tsx')],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    // File marker scans parent dir (src/), so picks up App.tsx
    expect(result.compositeGroups).toHaveLength(1);
    expect(result.compositeGroups[0].dirPath).toBe('src');
    const names = result.compositeGroups[0].components.map((c) => c.name);
    expect(names).toContain('App.tsx');
  });

  it('should handle directory paths as before', async () => {
    const store = createMockStore({
      atomComponentsPaths: [path.join(projectRoot, 'src', 'components', 'ui')],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('src/components/ui');
    expect(result.atomGroups[0].components).toHaveLength(2);

    const names = result.atomGroups[0].components.map((c) => c.name);
    expect(names).toContain('button.tsx');
    expect(names).toContain('card.tsx');
  });

  it('should skip non-existent paths', async () => {
    const store = createMockStore({
      atomComponentsPaths: [path.join(projectRoot, 'nonexistent')],
      compositeComponentsPaths: [path.join(projectRoot, 'src', 'Missing.tsx')],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(0);
    expect(result.compositeGroups).toHaveLength(0);
  });

  it('should scan parent directory when non-tsx file is given as marker', async () => {
    // Create a .css file — as a marker, it triggers scanning its parent dir
    fs.writeFileSync(path.join(projectRoot, 'src', 'styles.css'), 'body {}');

    const store = createMockStore({
      atomComponentsPaths: [],
      compositeComponentsPaths: [path.join(projectRoot, 'src', 'styles.css')],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    // Parent dir (src/) has .tsx files, so scanning finds them
    expect(result.compositeGroups).toHaveLength(1);
    expect(result.compositeGroups[0].dirPath).toBe('src');
    const names = result.compositeGroups[0].components.map((c) => c.name);
    expect(names).toContain('App.tsx');

    // Cleanup
    fs.unlinkSync(path.join(projectRoot, 'src', 'styles.css'));
  });

  it('should not save when both analyzer and heuristics return empty paths', async () => {
    // Create a truly empty project (no src/ or app/ dirs) where heuristics find nothing
    const emptyRoot = path.join(TMP_DIR, 'empty-project');
    fs.mkdirSync(emptyRoot, { recursive: true });
    fs.writeFileSync(path.join(emptyRoot, 'package.json'), '{"name":"empty"}');

    const store = createMockStore(null);

    const scanner = new ComponentScanner(store, async () => ({
      atomComponentsPaths: [],
      compositeComponentsPaths: [],
      pagesPaths: [],
      textComponentPath: null,
      linkComponentPath: null,
      buttonComponentPath: null,
      imageComponentPath: null,
      containerComponentPath: null,
    }));

    await scanner.getComponentsData(emptyRoot);
    expect(store.saved).toBe(false);

    // Cleanup
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  });

  it('should fall back to heuristic detection when analyzer returns empty', async () => {
    // Add a direct composite file to src/components/ so heuristic finds composites
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'components', 'Feed.tsx'),
      'export function Feed() { return <div/>; }',
    );

    const store = createMockStore(null);

    const scanner = new ComponentScanner(store, async () => ({
      atomComponentsPaths: [],
      compositeComponentsPaths: [],
      pagesPaths: [],
      textComponentPath: null,
      linkComponentPath: null,
      buttonComponentPath: null,
      imageComponentPath: null,
      containerComponentPath: null,
    }));

    const result = await scanner.getComponentsData(projectRoot);
    // Heuristic finds src/components/ui/ as atoms and src/components/Feed.tsx as composite
    expect(result.atomGroups.length).toBeGreaterThan(0);
    expect(result.compositeGroups.length).toBeGreaterThan(0);
    expect(store.saved).toBe(true);

    // Cleanup
    fs.unlinkSync(path.join(projectRoot, 'src', 'components', 'Feed.tsx'));
  });

  it('should save when analysis returns non-empty paths', async () => {
    const store = createMockStore(null);

    const scanner = new ComponentScanner(store, async () => ({
      atomComponentsPaths: [path.join(projectRoot, 'src', 'components', 'ui')],
      compositeComponentsPaths: [],
      pagesPaths: [],
      textComponentPath: null,
      linkComponentPath: null,
      buttonComponentPath: null,
      imageComponentPath: null,
      containerComponentPath: null,
    }));

    await scanner.getComponentsData(projectRoot);
    expect(store.saved).toBe(true);
  });

  it('should mix file and directory paths in the same category', async () => {
    // Create a features dir
    fs.mkdirSync(path.join(projectRoot, 'src', 'features'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'features', 'Dashboard.tsx'),
      'export function Dashboard() { return <div/>; }',
    );

    const store = createMockStore({
      atomComponentsPaths: [],
      compositeComponentsPaths: [path.join(projectRoot, 'src', 'App.tsx'), path.join(projectRoot, 'src', 'features')],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    // File marker scans src/ (parent of App.tsx) → picks up App.tsx
    // Directory path scans src/features/ → picks up Dashboard.tsx
    // Both produce groups with dirPath 'src' and 'src/features'
    expect(result.compositeGroups).toHaveLength(2);
    // First: file marker → parent dir scan
    const firstNames = result.compositeGroups[0].components.map((c) => c.name);
    expect(firstNames).toContain('App.tsx');
    // Second: directory scan
    expect(result.compositeGroups[1].components[0].name).toBe('Dashboard.tsx');

    // Cleanup
    fs.rmSync(path.join(projectRoot, 'src', 'features'), { recursive: true, force: true });
  });

  it('should resolve relative paths in buildGroups', async () => {
    const store = createMockStore({
      atomComponentsPaths: ['src/components/ui'],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('src/components/ui');
    const names = result.atomGroups[0].components.map((c) => c.name);
    expect(names).toContain('button.tsx');
    expect(names).toContain('card.tsx');
  });

  it('should remap cached absolute paths from a different project root', async () => {
    const foreignRoot = path.join('/workspace', path.basename(projectRoot));
    const store = createMockStore({
      atomComponentsPaths: [path.join(foreignRoot, 'src', 'components', 'ui')],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('src/components/ui');
    const names = result.atomGroups[0].components.map((c) => c.name);
    expect(names).toContain('button.tsx');
    expect(names).toContain('card.tsx');
  });

  it('should remap foreign absolute paths rooted at client/ (HYP-637)', async () => {
    // Project keeps its source under client/ (no src/ or app/); the cached config
    // came from a checkout at a different root with a different basename, so only
    // the client/ source-root segment can anchor the remap. 'widgets' is not a
    // heuristic dir name — losing the remap would also lose the user's
    // atom categorization to re-analysis.
    const clientRoot = path.join(TMP_DIR, 'client-project');
    fs.mkdirSync(path.join(clientRoot, 'client', 'widgets'), { recursive: true });
    fs.writeFileSync(
      path.join(clientRoot, 'client', 'widgets', 'Widget.tsx'),
      'export function Widget() { return <div/>; }',
    );

    const store = createMockStore({
      atomComponentsPaths: [path.join('/workspace', 'old-checkout', 'client', 'widgets')],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(clientRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('client/widgets');
    expect(result.atomGroups[0].components.map((c) => c.name)).toContain('Widget.tsx');

    fs.rmSync(clientRoot, { recursive: true, force: true });
  });

  it('remaps a foreign path whose real source root follows a client/ ancestor (HYP-637)', async () => {
    // The cache came from a checkout nested under .../client/old-checkout/, so a
    // 'client' segment appears as an ANCESTOR before the actual 'src' source root.
    // A first-match anchor would build client/old-checkout/src/components/ui (absent)
    // and drop the group; every anchor must be tried so 'src/components/ui' wins.
    const store = createMockStore({
      atomComponentsPaths: [path.join('/workspace', 'client', 'old-checkout', 'src', 'components', 'ui')],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('src/components/ui');
    expect(result.atomGroups[0].components.map((c) => c.name)).toContain('button.tsx');
  });

  it('preserves a cached path that is the project root itself (HYP-637)', async () => {
    // A repo with root-level components: the analyzer/cache may store the project
    // root (path.join(projectRoot, '.') === projectRoot). It must NOT be dropped —
    // root-level App.tsx would disappear in projects without src/app/client.
    const rootProject = path.join(TMP_DIR, 'root-level-project');
    fs.mkdirSync(rootProject, { recursive: true });
    fs.writeFileSync(path.join(rootProject, 'App.tsx'), 'export function App() { return <div/>; }');

    const store = createMockStore({
      atomComponentsPaths: [],
      compositeComponentsPaths: [rootProject],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(rootProject);

    expect(result.compositeGroups.flatMap((g) => g.components.map((c) => c.name))).toContain('App.tsx');

    fs.rmSync(rootProject, { recursive: true, force: true });
  });

  it('should not scan cached paths that escape the project root via .. segments (HYP-637)', async () => {
    // A workspace-controlled cache entry rooted at the project but escaping it via
    // .. (e.g. ${projectRoot}/client/../../outside) resolves to an EXISTING sibling
    // directory. It must never be enumerated: drop it and force re-analysis instead
    // of falling back to the raw escaped absolute path.
    const trapRoot = path.join(TMP_DIR, 'trap-project');
    const outsideDir = path.join(TMP_DIR, 'outside');
    fs.mkdirSync(path.join(trapRoot, 'client'), { recursive: true });
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, 'Leak.tsx'), 'export function Leak() { return <div/>; }');

    const store = createMockStore({
      // Raw string on purpose — path.join would normalize the .. segments away.
      // Resolves to TMP_DIR/outside, an existing sibling of the project root.
      atomComponentsPaths: [`${trapRoot}/client/../../outside`],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(trapRoot);

    // The outside directory (and its Leak.tsx) must never appear.
    const allComponents = [...result.atomGroups, ...result.compositeGroups, ...result.pageGroups].flatMap(
      (g) => g.components,
    );
    expect(allComponents.map((c) => c.name)).not.toContain('Leak.tsx');
    expect(allComponents.some((c) => c.path.includes('..') || c.path.includes('outside'))).toBe(false);

    fs.rmSync(trapRoot, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it('should re-analyze when cached paths point outside the current project', async () => {
    const store = createMockStore({
      atomComponentsPaths: [path.join('/missing-cache-root', 'configured-components')],
      compositeComponentsPaths: [],
      pagesPaths: [],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(projectRoot);

    expect(result.atomGroups).toHaveLength(1);
    expect(result.atomGroups[0].dirPath).toBe('src/components/ui');
    expect(store.saved).toBe(true);
    expect(store.savedPaths?.atomComponentsPaths).toEqual(['src/components/ui']);
  });

  // HYP-392/393: composite subdirs must not appear in pages scan
  it('should exclude composite subdirs from pages scan', async () => {
    // Project layout:
    //   src/pages/Home.tsx        ← a page
    //   src/pages/components/     ← composites live here; must NOT appear in pages
    //     Card.tsx
    const pagesRoot = path.join(TMP_DIR, 'pages-project');
    fs.mkdirSync(path.join(pagesRoot, 'src', 'pages', 'components'), { recursive: true });
    fs.writeFileSync(path.join(pagesRoot, 'src', 'pages', 'Home.tsx'), 'export function Home() { return <div/>; }');
    fs.writeFileSync(
      path.join(pagesRoot, 'src', 'pages', 'components', 'Card.tsx'),
      'export function Card() { return <div/>; }',
    );

    const compositeDir = path.join(pagesRoot, 'src', 'pages', 'components');
    const pagesDir = path.join(pagesRoot, 'src', 'pages');

    const store = createMockStore({
      atomComponentsPaths: [],
      compositeComponentsPaths: [compositeDir],
      pagesPaths: [pagesDir],
    });

    const scanner = new ComponentScanner(store);
    const result = await scanner.getComponentsData(pagesRoot);

    // Composite group should contain Card.tsx
    expect(result.compositeGroups).toHaveLength(1);
    const compositeNames = result.compositeGroups[0].components.map((c) => c.name);
    expect(compositeNames).toContain('Card.tsx');

    // Pages group should contain Home.tsx but NOT Card.tsx (composite subdir excluded)
    expect(result.pageGroups).toHaveLength(1);
    const pageNames = result.pageGroups[0].components.map((c) => c.name);
    expect(pageNames).toContain('Home.tsx');
    expect(pageNames).not.toContain('components/Card.tsx');
  });
});

describe('ComponentScanner.detectProjectStructure', () => {
  const HEURISTIC_DIR = path.join(TMP_DIR, 'heuristic');

  afterAll(() => {
    fs.rmSync(HEURISTIC_DIR, { recursive: true, force: true });
  });

  function createProject(name: string, dirs: string[], files: Record<string, string> = {}): string {
    const root = path.join(HEURISTIC_DIR, name);
    for (const dir of dirs) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
    }
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(root, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    return root;
  }

  it('should detect src/components/ as composites', () => {
    const root = createProject('react-basic', ['src/components'], {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/App.tsx': 'export function App() { return <div/>; }',
      'src/main.tsx': 'import App from "./App"; render(<App/>);',
      'src/components/Feed.tsx': 'export function Feed() { return <div/>; }',
      'src/components/Sidebar.tsx': 'export function Sidebar() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'components'));
    // Root-level App.tsx is not added — it's a composition entry point, not a reusable component
    expect(structure.atomComponentsPaths).toHaveLength(0);
  });

  it('should detect src/components/ui/ as atoms (shadcn pattern)', () => {
    const root = createProject('shadcn', ['src/components/ui'], {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/App.tsx': 'export function App() { return <div/>; }',
      'src/components/IssueCard.tsx': 'export function IssueCard() { return <div/>; }',
      'src/components/ui/button.tsx': 'export function Button() { return <button/>; }',
      'src/components/ui/card.tsx': 'export function Card() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.atomComponentsPaths).toContain(path.join(root, 'src', 'components', 'ui'));
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'components'));
  });

  it('should detect Remix app/routes/ as pages and app/components/ as composites', () => {
    const root = createProject('remix', ['app/components', 'app/routes'], {
      'package.json': '{"dependencies":{"@remix-run/react":"2","react":"18"}}',
      'app/root.tsx': 'export default function Root() { return <html/>; }',
      'app/components/Sidebar.tsx': 'export function Sidebar() { return <div/>; }',
      'app/routes/_index.tsx': 'export default function Index() { return <div/>; }',
      'app/routes/about.tsx': 'export default function About() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.pagesPaths).toContain(path.join(root, 'app', 'routes'));
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'app', 'components'));
  });

  it('should detect Next.js App Router pages', () => {
    const root = createProject('nextjs', ['app'], {
      'package.json': '{"dependencies":{"next":"14","react":"18"}}',
      'app/page.tsx': 'export default function Home() { return <div/>; }',
      'app/layout.tsx': 'export default function Layout({ children }) { return <html>{children}</html>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.pagesPaths).toContain(path.join(root, 'app'));
  });

  it('should detect Expo/RN src/screens/ as pages', () => {
    const root = createProject('expo', ['src/components', 'src/screens', 'src/navigation'], {
      'package.json': '{"dependencies":{"expo":"49","react":"18","react-native":"0.72"}}',
      'src/components/Card.tsx': 'export function Card() { return <View/>; }',
      'src/screens/HomeScreen.tsx': 'export function HomeScreen() { return <View/>; }',
      'src/navigation/AppNavigator.tsx': 'export function AppNavigator() {}',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.pagesPaths).toContain(path.join(root, 'src', 'screens'));
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'components'));
    // navigation/ should be skipped (it's in NON_COMPONENT_DIRS)
    expect(structure.compositeComponentsPaths).not.toContain(path.join(root, 'src', 'navigation'));
  });

  it('should skip data, types, hooks, and other non-component dirs', () => {
    const root = createProject('with-extras', ['src/components', 'src/data', 'src/types', 'src/hooks'], {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/components/Feed.tsx': 'export function Feed() { return <div/>; }',
      'src/data/mockData.ts': 'export const data = [];',
      'src/types/index.ts': 'export type AppProps = {};',
      'src/hooks/useAuth.ts': 'export function useAuth() {}',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // Only components/ should be detected, not data/types/hooks
    const allPaths = [...structure.atomComponentsPaths, ...structure.compositeComponentsPaths, ...structure.pagesPaths];
    expect(allPaths.some((p) => p.includes('/data'))).toBe(false);
    expect(allPaths.some((p) => p.includes('/types'))).toBe(false);
    expect(allPaths.some((p) => p.includes('/hooks'))).toBe(false);
  });

  it('should return empty for project without src/ or app/', () => {
    const root = createProject('no-source', ['lib'], {
      'package.json': '{"dependencies":{"react":"18"}}',
      'lib/index.ts': 'export const x = 1;',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.atomComponentsPaths).toHaveLength(0);
    expect(structure.compositeComponentsPaths).toHaveLength(0);
    expect(structure.pagesPaths).toHaveLength(0);
  });

  it('should return empty for project with only entry files and no components dir', () => {
    const root = createProject('entry-only', ['src'], {
      'package.json': '{"dependencies":{"react":"18"}}',
      'src/main.tsx': 'import { render } from "react-dom"; render(<App/>);',
      'src/index.tsx': 'export { App } from "./App";',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // No components/ dir → nothing to detect
    expect(structure.compositeComponentsPaths).toHaveLength(0);
  });

  it('should detect client/components/ as composites (bulka-the-dog pattern)', () => {
    const root = createProject('client-root', ['client/components'], {
      'package.json': '{"dependencies":{"react":"18","vite":"5"}}',
      'client/main.tsx': 'import App from "./App"; render(<App/>);',
      'client/App.tsx': 'export function App() { return <div/>; }',
      'client/components/Gallery.tsx': 'export function Gallery() { return <div/>; }',
      'client/components/Header.tsx': 'export function Header() { return <header/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'client', 'components'));
  });

  it('should detect src/app/ as composites for Vite+React projects when no Page/Screen subdirs (conloca pattern)', () => {
    // workspace/ only has WorkspaceRouter.tsx — no *Page.tsx / *Screen.tsx suffix → not a page subdir
    const root = createProject('vite-react-src-app-no-pages', ['src/app/workspace', 'src/app/ui'], {
      'package.json': '{"dependencies":{"react":"19","vite":"5"}}',
      'src/main.tsx': 'import { render } from "react-dom";',
      'src/app/App.tsx': 'export function App() { return <div/>; }',
      'src/app/workspace/WorkspaceRouter.tsx': 'export function WorkspaceRouter() { return <div/>; }',
      'src/app/ui/HostField.tsx': 'export function HostField() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // src/app/ stays in composites (no page-like subdirs detected)
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'app'));
    // src/app/ui/ gets detected as atoms
    expect(structure.atomComponentsPaths).toContain(path.join(root, 'src', 'app', 'ui'));
    // src/app/ itself must NOT appear as pages (it's not a Next.js project)
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app'));
    // workspace/ has no *Page.tsx or *Screen.tsx → not a page subdir either
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app', 'workspace'));
  });

  it('promotes src/app/ subdirs with *Page.tsx / *Screen.tsx to pagesPaths (HYP-758)', () => {
    // Mirrors the conloca-app shape: feature-domain subdirs containing page components
    const root = createProject(
      'vite-react-src-app-pages',
      ['src/app/auth', 'src/app/account', 'src/app/workspace', 'src/app/banners', 'src/app/ui'],
      {
        'package.json': '{"dependencies":{"react":"19","vite":"5"}}',
        'src/main.tsx': 'import App from "./app/App";',
        'src/app/App.tsx': 'export default function App() { return <div/>; }',
        'src/app/CmsHost.tsx': 'export default function CmsHost() { return <div/>; }',
        // auth/ — multiple *Screen.tsx → page subdir
        'src/app/auth/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
        'src/app/auth/SessionExpiredScreen.tsx': 'export function SessionExpiredScreen() { return <div/>; }',
        // account/ — one *Page.tsx → page subdir
        'src/app/account/AccountPage.tsx': 'export function AccountPage() { return <div/>; }',
        'src/app/account/UserGitIdentityForm.tsx': 'export function UserGitIdentityForm() { return <div/>; }',
        // workspace/ — only a plain component, no Page/Screen suffix → NOT a page subdir
        'src/app/workspace/WorkspaceRouter.tsx': 'export function WorkspaceRouter() { return <div/>; }',
        // banners/ — banner components, no Page/Screen suffix → NOT a page subdir
        'src/app/banners/OfflineBanner.tsx': 'export function OfflineBanner() { return <div/>; }',
        // ui/ — atom directory
        'src/app/ui/HostField.tsx': 'export function HostField() { return <input/>; }',
      },
    );

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // Page-like subdirs detected and promoted to pagesPaths
    expect(structure.pagesPaths).toContain(path.join(root, 'src', 'app', 'auth'));
    expect(structure.pagesPaths).toContain(path.join(root, 'src', 'app', 'account'));

    // Non-page subdirs stay reachable via src/app/ composite entry
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'app'));

    // workspace/ and banners/ have no *Page.tsx / *Screen.tsx → not pages
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app', 'workspace'));
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app', 'banners'));

    // INTENTIONAL: directory-level classification means ALL files in a page subdir
    // land in Pages — including UserGitIdentityForm.tsx alongside AccountPage.tsx.
    // This is by design: the whole account/ directory is a page domain; the form
    // lives there and is co-located with the page. File-level filtering is not done.
    expect(structure.pagesPaths).toContain(path.join(root, 'src', 'app', 'account'));

    // ui/ is atoms
    expect(structure.atomComponentsPaths).toContain(path.join(root, 'src', 'app', 'ui'));

    // src/app/ itself must NOT appear as a page (it's not a Next.js app/ dir)
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app'));
  });

  it('pages from src/app/ page-subdirs are in pageGroups, not compositeGroups (no double-listing, HYP-758)', async () => {
    const root = createProject(
      'vite-react-src-app-no-double',
      ['src/app/auth', 'src/app/banners', 'src/app/ui'],
      {
        'package.json': '{"dependencies":{"react":"19","vite":"5"}}',
        'src/main.tsx': 'import App from "./app/App";',
        'src/app/App.tsx': 'export default function App() { return <div/>; }',
        'src/app/auth/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
        'src/app/banners/OfflineBanner.tsx': 'export function OfflineBanner() { return <div/>; }',
        'src/app/ui/HostField.tsx': 'export function HostField() { return <input/>; }',
      },
    );

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    // c.name is path.relative(categoryRoot, fullPath) — exact values:
    //   page scan of src/app/auth/  → 'LoginScreen.tsx'
    //   composite scan of src/app/  → 'App.tsx', 'banners/OfflineBanner.tsx'
    //   atom scan of src/app/ui/    → 'HostField.tsx'
    const pageNames = result.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    const compositeNames = result.compositeGroups.flatMap((g) => g.components.map((c) => c.name));

    // LoginScreen belongs to pages only — exact match, not substring
    expect(pageNames).toContain('LoginScreen.tsx');
    expect(compositeNames).not.toContain('LoginScreen.tsx');

    // App.tsx (top-level in src/app/) stays in composites
    expect(compositeNames).toContain('App.tsx');

    // OfflineBanner (non-page subdir banners/) stays in composites
    // name includes the subdir prefix since categoryRoot is src/app/
    expect(compositeNames).toContain('banners/OfflineBanner.tsx');

    // HostField stays in atoms
    const atomNames = result.atomGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(atomNames).toContain('HostField.tsx');
  });

  it('should NOT treat app/ as composites for Next.js projects (next-router pattern)', () => {
    const root = createProject('nextjs-app-router', ['app/dashboard', 'app/api'], {
      'package.json': '{"dependencies":{"next":"14","react":"18"}}',
      'app/page.tsx': 'export default function Home() { return <div/>; }',
      'app/layout.tsx': 'export default function Layout({ children }) { return <html>{children}</html>; }',
      'app/dashboard/page.tsx': 'export default function Dashboard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // app/ for Next.js is pages, not composites
    expect(structure.pagesPaths).toContain(path.join(root, 'app'));
    expect(structure.compositeComponentsPaths).not.toContain(path.join(root, 'app'));
  });
});

// ─── Monorepo sub-package scanning ───────────────────────────────────────────

describe('ComponentScanner.detectProjectStructure — monorepo', () => {
  const MONO_DIR = path.join(TMP_DIR, 'monorepo');

  afterAll(() => {
    fs.rmSync(MONO_DIR, { recursive: true, force: true });
  });

  function createMonoProject(name: string, dirs: string[], files: Record<string, string> = {}): string {
    const root = path.join(MONO_DIR, name);
    for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(root, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    return root;
  }

  it('Nx with targets/: detects pages AND components in targets/web/src/', () => {
    const root = createMonoProject('nx-targets', ['targets/web/src/components'], {
      'package.json': '{"devDependencies":{"nx":"22","vite":"8"}}',
      'nx.json': '{}',
      'targets/web/package.json': '{"devDependencies":{"tailwindcss":"4"}}',
      'targets/web/src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/web/src/components/Button.tsx': 'export function Button() { return <button/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // LoginScreen.tsx at sub-package src/ root → individual file path in pages
    expect(structure.pagesPaths).toContain(path.join(root, 'targets', 'web', 'src', 'LoginScreen.tsx'));
    expect(structure.pagesPaths).not.toContain(path.join(root, 'targets', 'web', 'src'));
    // Button.tsx in components/ → composites
    expect(
      structure.compositeComponentsPaths.some((p) => p.includes(path.join('targets', 'web', 'src', 'components'))),
    ).toBe(true);
  });

  it('Nx with apps/: detects components in apps/web/src/', () => {
    const root = createMonoProject('nx-apps', ['apps/web/src'], {
      'package.json': '{"devDependencies":{"nx":"22","vite":"8"}}',
      'nx.json': '{}',
      'apps/web/package.json': '{"devDependencies":{"tailwindcss":"4"}}',
      'apps/web/src/Dashboard.tsx': 'export function Dashboard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    const allPaths = [...structure.pagesPaths, ...structure.compositeComponentsPaths, ...structure.atomComponentsPaths];
    expect(allPaths.some((p) => p.includes('apps/web'))).toBe(true);
  });

  it('pnpm workspace: detects components in packages/ui/src/', () => {
    const root = createMonoProject('pnpm-ws', ['packages/ui/src/components/ui'], {
      'package.json': '{"workspaces":["packages/*"]}',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*',
      'packages/ui/package.json': '{"devDependencies":{"tailwindcss":"4"}}',
      'packages/ui/src/components/ui/Button.tsx': 'export function Button() { return <button/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    const allPaths = [...structure.pagesPaths, ...structure.compositeComponentsPaths, ...structure.atomComponentsPaths];
    expect(allPaths.some((p) => p.includes('packages/ui'))).toBe(true);
  });

  it('non-monorepo: no sub-package scan for plain vite projects', () => {
    const root = createMonoProject('plain-vite', ['src'], {
      'package.json': '{"devDependencies":{"vite":"8","react":"19"}}',
      'src/App.tsx': 'export function App() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // src/App.tsx should be found, no sub-package dirs
    const allPaths = [...structure.pagesPaths, ...structure.compositeComponentsPaths, ...structure.atomComponentsPaths];
    expect(allPaths.length).toBeGreaterThan(0);
    // No apps/ targets/ packages/ in paths
    expect(allPaths.every((p) => !p.match(/\/(apps|targets|packages|libs)\//))).toBe(true);
  });
});

describe('ComponentScanner.getComponentsData — sub-project grouping (HYP-391)', () => {
  const SUBPROJ_DIR = path.join(TMP_DIR, 'subproj');

  afterAll(() => {
    fs.rmSync(SUBPROJ_DIR, { recursive: true, force: true });
  });

  function createSubprojProject(name: string, files: Record<string, string>): string {
    const root = path.join(SUBPROJ_DIR, name);
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(root, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    return root;
  }

  it('returns isMonorepo=true and subProjects array for Nx workspace', async () => {
    const root = createSubprojProject('nx-multi', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/web/src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
      'targets/admin/package.json': '{"dependencies":{"react":"19"}}',
      'targets/admin/src/AdminPanel.tsx': 'export function AdminPanel() { return <div/>; }',
      'targets/admin/src/components/DataTable.tsx': 'export function DataTable() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);
    expect(result.subProjects).toBeDefined();
    expect(result.subProjects!.length).toBeGreaterThanOrEqual(2);
  });

  it('each sub-project has name, path, supported=true for React packages', async () => {
    const root = createSubprojProject('nx-react-packages', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/HomePage.tsx': 'export function HomePage() { return <div/>; }',
      'targets/admin/package.json': '{"dependencies":{"react":"19"}}',
      'targets/admin/src/Dashboard.tsx': 'export function Dashboard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    const webProject = result.subProjects?.find((p) => p.name === 'web');
    expect(webProject).toBeDefined();
    expect(webProject!.supported).toBe(true);
    expect(webProject!.path).toMatch(/targets[/\\]web/);

    const adminProject = result.subProjects?.find((p) => p.name === 'admin');
    expect(adminProject).toBeDefined();
    expect(adminProject!.supported).toBe(true);
  });

  it('marks non-React sub-project as unsupported with reason', async () => {
    const root = createSubprojProject('nx-mixed', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/App.tsx': 'export function App() { return <div/>; }',
      'targets/api/package.json': '{"dependencies":{"express":"4","fastify":"4"}}',
      'targets/api/src/server.ts': 'export const app = {};',
      'targets/mobile/package.json': '{"dependencies":{"vue":"3"}}',
      'targets/mobile/src/App.vue': '<template><div/></template>',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    const apiProject = result.subProjects?.find((p) => p.name === 'api');
    expect(apiProject).toBeDefined();
    expect(apiProject!.supported).toBe(false);
    expect(apiProject!.unsupportedReason).toBeTruthy();

    const mobileProject = result.subProjects?.find((p) => p.name === 'mobile');
    expect(mobileProject).toBeDefined();
    expect(mobileProject!.supported).toBe(false);
    expect(mobileProject!.unsupportedReason).toMatch(/vue/i);
  });

  it('each supported sub-project has its own component groups', async () => {
    const root = createSubprojProject('nx-per-project-groups', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/web/src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
      'targets/admin/package.json': '{"dependencies":{"react":"19"}}',
      'targets/admin/src/AdminPanel.tsx': 'export function AdminPanel() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    const webProject = result.subProjects?.find((p) => p.name === 'web');
    expect(webProject).toBeDefined();
    const webComponentNames = [
      ...webProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...webProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    expect(webComponentNames.some((n) => n.includes('LoginScreen'))).toBe(true);
    expect(webComponentNames.some((n) => n.includes('ConlocaCard'))).toBe(true);

    const adminProject = result.subProjects?.find((p) => p.name === 'admin');
    expect(adminProject).toBeDefined();
    const adminComponentNames = [
      ...adminProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...adminProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    expect(adminComponentNames.some((n) => n.includes('AdminPanel'))).toBe(true);
  });

  // HYP-393: sub-package src/ as pages root + src/components/ as composites
  // ConlocaCard must NOT appear in pageGroups — only in compositeGroups
  it('ConlocaCard in src/components/ must not appear in pageGroups (HYP-393)', async () => {
    const root = createSubprojProject('hyp-393-dedup', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/web/src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);
    const webProject = result.subProjects?.find((p) => p.name === 'web');
    expect(webProject).toBeDefined();
    expect(webProject!.supported).toBe(true);

    // LoginScreen (directly in src/) → pageGroups
    const pageNames = webProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(pageNames.some((n) => n.includes('LoginScreen'))).toBe(true);

    // ConlocaCard (in src/components/) → compositeGroups, NOT pageGroups
    const compositeNames = webProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(compositeNames.some((n) => n.includes('ConlocaCard'))).toBe(true);

    // KEY ASSERTION: ConlocaCard must NOT appear in pages
    const pageNamesStr = pageNames.join(',');
    expect(pageNamesStr).not.toContain('ConlocaCard');
  });

  // HYP-419: conloca shape — app target keeps ALL components under src/app/** (deeply nested).
  // The non-scope detectProjectStructure() handles the src/app/ convention, but the sub-project
  // (in-scope) variant did not, so the Explorer showed ZERO components for the target.
  it('conloca app target: components under src/app/** populate sub-project groups (HYP-419)', async () => {
    const root = createSubprojProject('hyp-419-conloca', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22","vite":"7"}}',
      'targets/conloca-app/package.json': '{"dependencies":{"react":"19"},"devDependencies":{"@tailwindcss/vite":"4"}}',
      'targets/conloca-app/src/main.tsx': 'import App from "./app/App";',
      'targets/conloca-app/src/app/App.tsx': 'export default function App() { return <div/>; }',
      'targets/conloca-app/src/app/account/AccountPage.tsx': 'export default function AccountPage() { return <div/>; }',
      'targets/conloca-app/src/app/workspace/WorkspaceRouter.tsx':
        'export default function WorkspaceRouter() { return <div/>; }',
      'targets/conloca-app/src/app/ui/HostField.tsx': 'export function HostField() { return <input/>; }',
      'targets/conloca-app/src/app/slots/org-settings/OrgSettingsSlot.tsx':
        'export function OrgSettingsSlot() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);
    const appProject = result.subProjects?.find((p) => p.name === 'conloca-app');
    expect(appProject).toBeDefined();
    expect(appProject!.supported).toBe(true);

    const allNames = [
      ...appProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...appProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...appProject!.atomGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    // Components are deeply nested under src/app/** — all must surface.
    expect(allNames.some((n) => n.includes('App'))).toBe(true);
    expect(allNames.some((n) => n.includes('AccountPage'))).toBe(true);
    expect(allNames.some((n) => n.includes('WorkspaceRouter'))).toBe(true);
    expect(allNames.some((n) => n.includes('HostField'))).toBe(true);
    // Deeply nested (src/app/slots/org-settings/) must surface too.
    expect(allNames.some((n) => n.includes('OrgSettingsSlot'))).toBe(true);
  });

  // HYP-758: buildSubProject also calls categorizeAppDir + excludes page dirs from
  // composites. Verify the sub-project Groups (not just paths) are correct.
  it('conloca sub-project: *Page/*Screen subdirs land in pageGroups, not compositeGroups (HYP-758)', async () => {
    const root = createSubprojProject('hyp-758-subproj', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22","vite":"7"}}',
      'targets/conloca-app/package.json': '{"dependencies":{"react":"19"},"devDependencies":{"@tailwindcss/vite":"4"}}',
      'targets/conloca-app/src/main.tsx': 'import App from "./app/App";',
      'targets/conloca-app/src/app/App.tsx': 'export default function App() { return <div/>; }',
      // auth/ has Screen-suffix files → promoted to page subdir
      'targets/conloca-app/src/app/auth/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/conloca-app/src/app/auth/SessionExpiredScreen.tsx':
        'export function SessionExpiredScreen() { return <div/>; }',
      // account/ has a Page-suffix file → promoted to page subdir
      'targets/conloca-app/src/app/account/AccountPage.tsx': 'export function AccountPage() { return <div/>; }',
      // workspace/ has no *Page/*Screen → stays in composites via src/app/
      'targets/conloca-app/src/app/workspace/WorkspaceRouter.tsx':
        'export function WorkspaceRouter() { return <div/>; }',
      // ui/ → atoms
      'targets/conloca-app/src/app/ui/HostField.tsx': 'export function HostField() { return <input/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);
    const appProject = result.subProjects?.find((p) => p.name === 'conloca-app');
    expect(appProject).toBeDefined();
    expect(appProject!.supported).toBe(true);

    const pageNames = appProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    const compositeNames = appProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name));
    const atomNames = appProject!.atomGroups.flatMap((g) => g.components.map((c) => c.name));

    // Page-suffix files land in pageGroups
    expect(pageNames).toContain('LoginScreen.tsx');
    expect(pageNames).toContain('SessionExpiredScreen.tsx');
    expect(pageNames).toContain('AccountPage.tsx');

    // Page-suffix files must NOT appear in composites (no double-listing)
    expect(compositeNames).not.toContain('LoginScreen.tsx');
    expect(compositeNames).not.toContain('AccountPage.tsx');

    // Non-page subdir (workspace/) reaches composites via src/app/ composite root
    expect(compositeNames).toContain('workspace/WorkspaceRouter.tsx');

    // ui/ → atoms, not pages
    expect(atomNames).toContain('HostField.tsx');
    expect(pageNames).not.toContain('HostField.tsx');
  });

  it('non-monorepo returns isMonorepo=false and no subProjects', async () => {
    const root = createSubprojProject('plain-react', {
      'package.json': '{"dependencies":{"react":"19"},"devDependencies":{"vite":"6"}}',
      'src/App.tsx': 'export function App() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBeFalsy();
    expect(!result.subProjects || result.subProjects.length === 0).toBe(true);
  });

  // HYP-395: shared library sub-package (react in peerDeps only) — src/ root components → composites, NOT pages
  it('shared lib sub-package with peerDeps react: Button/Input/Modal in compositeGroups not pageGroups (HYP-395)', async () => {
    const root = createSubprojProject('hyp-395-shared-lib', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      // shared: react only in peerDependencies — marks it as a library, not an app
      'targets/shared/package.json': '{"peerDependencies":{"react":"*","react-dom":"*"}}',
      'targets/shared/src/Button.tsx': 'export function Button() { return <button/>; }',
      'targets/shared/src/Input.tsx': 'export function Input() { return <input/>; }',
      'targets/shared/src/Modal.tsx': 'export function Modal() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);
    const sharedProject = result.subProjects?.find((p) => p.name === 'shared');
    expect(sharedProject).toBeDefined();
    expect(sharedProject!.supported).toBe(true);

    // Library src/ root tsx → compositeGroups, never pageGroups
    const compositeNames = sharedProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(compositeNames.some((n) => n.includes('Button'))).toBe(true);
    expect(compositeNames.some((n) => n.includes('Input'))).toBe(true);
    expect(compositeNames.some((n) => n.includes('Modal'))).toBe(true);

    // KEY ASSERTION: must NOT appear in pageGroups
    const pageNames = sharedProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(pageNames).toHaveLength(0);
  });

  // Codex #230: flat consumers (useComponentAutoLoad, FloatingPanels) read only
  // atomGroups/compositeGroups. Monorepo must mirror the union of sub-project
  // atom/composite groups into the flat fields, while leaving pageGroups empty
  // (PagesSection renders flat pageGroups unconditionally → would double-render).
  it('monorepo mirrors sub-project atom/composite groups into flat groups, pageGroups stays empty (Codex #230)', async () => {
    const root = createSubprojProject('flat-compat', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      'targets/web/package.json': '{"dependencies":{"react":"19"}}',
      'targets/web/src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'targets/web/src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
      'targets/web/src/components/ui/Button.tsx': 'export function Button() { return <button/>; }',
      'targets/admin/package.json': '{"dependencies":{"react":"19"}}',
      'targets/admin/src/components/DataTable.tsx': 'export function DataTable() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);

    // Flat groups = union of all sub-project atom + composite groups.
    const flatComponentNames = [
      ...result.atomGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...result.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    expect(flatComponentNames.some((n) => n.includes('ConlocaCard'))).toBe(true);
    expect(flatComponentNames.some((n) => n.includes('Button'))).toBe(true);
    expect(flatComponentNames.some((n) => n.includes('DataTable'))).toBe(true);

    // pageGroups stays empty — no flat consumer reads it and PagesSection would double-render.
    expect(result.pageGroups).toHaveLength(0);
  });

  // Codex #229: a sub-package keeping pages/ or components/ at its package root
  // (no src/ or app/) must still produce Explorer entries.
  it('sub-package with pages/components at package root (no src/) produces groups (Codex #229)', async () => {
    const root = createSubprojProject('pkg-root-dirs', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      // apps/web keeps pages/ at the package root, no src/ or app/
      'apps/web/package.json': '{"dependencies":{"react":"19"}}',
      'apps/web/pages/index.tsx': 'export default function Index() { return <div/>; }',
      'apps/web/pages/About.tsx': 'export default function About() { return <div/>; }',
      // packages/ui keeps components/ at the package root
      'packages/ui/package.json': '{"dependencies":{"react":"19"}}',
      'packages/ui/components/Button.tsx': 'export function Button() { return <button/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);

    const webProject = result.subProjects?.find((p) => p.name === 'web');
    expect(webProject).toBeDefined();
    expect(webProject!.supported).toBe(true);
    const webPageNames = webProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    expect(webPageNames.some((n) => n.includes('About'))).toBe(true);

    const uiProject = result.subProjects?.find((p) => p.name === 'ui');
    expect(uiProject).toBeDefined();
    expect(uiProject!.supported).toBe(true);
    const uiComponentNames = [
      ...uiProject!.atomGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...uiProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    expect(uiComponentNames.some((n) => n.includes('Button'))).toBe(true);
  });

  // Codex #251 (P2): a sub-package with BOTH src/ AND root-level conventional dirs
  // must surface components from both — the root scan must not be skipped just
  // because a nested src/ exists. And nothing must be double-counted.
  it('sub-package with src/ AND root-level components/pages produces groups from both, no dupes (Codex #251)', async () => {
    const root = createSubprojProject('pkg-src-plus-root', {
      'nx.json': '{}',
      'package.json': '{"devDependencies":{"nx":"22"}}',
      // packages/ui keeps a nested src/components/ AND a root-level components/
      'packages/ui/package.json': '{"dependencies":{"react":"19"}}',
      'packages/ui/src/components/Card.tsx': 'export function Card() { return <div/>; }',
      'packages/ui/components/Button.tsx': 'export function Button() { return <button/>; }',
      // apps/web keeps a nested src/ App AND a root-level pages/
      'apps/web/package.json': '{"dependencies":{"react":"19"}}',
      'apps/web/src/App.tsx': 'export function App() { return <div/>; }',
      'apps/web/pages/About.tsx': 'export default function About() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    expect(result.isMonorepo).toBe(true);

    const uiProject = result.subProjects?.find((p) => p.name === 'ui');
    expect(uiProject).toBeDefined();
    const uiComponentNames = [
      ...uiProject!.atomGroups.flatMap((g) => g.components.map((c) => c.name)),
      ...uiProject!.compositeGroups.flatMap((g) => g.components.map((c) => c.name)),
    ];
    // Both the nested src component AND the root-level component are discovered.
    expect(uiComponentNames.filter((n) => n.includes('Card'))).toHaveLength(1);
    expect(uiComponentNames.filter((n) => n.includes('Button'))).toHaveLength(1);

    const webProject = result.subProjects?.find((p) => p.name === 'web');
    expect(webProject).toBeDefined();
    const webPageNames = webProject!.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    // Root-level pages/ discovered even though src/ exists, exactly once.
    expect(webPageNames.filter((n) => n.includes('About'))).toHaveLength(1);
  });
});

// ─── HYP-397: pages fallback — individual files, not whole src/ directory ─────

describe('ComponentScanner — pages fallback adds individual files, not src/ dir (HYP-397)', () => {
  const HYP397_DIR = path.join(TMP_DIR, 'hyp397');

  afterAll(() => {
    fs.rmSync(HYP397_DIR, { recursive: true, force: true });
  });

  function createHyp397Project(name: string, files: Record<string, string>): string {
    const root = path.join(HYP397_DIR, name);
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(root, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    return root;
  }

  it('detectProjectStructure: fallback adds individual file paths, not src/ dir', () => {
    const root = createHyp397Project('detect-fallback', {
      'package.json': '{"dependencies":{"react":"19"},"devDependencies":{"vite":"6"}}',
      'src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // Individual file path, not the src/ directory
    expect(structure.pagesPaths).toContain(path.join(root, 'src', 'LoginScreen.tsx'));
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src'));
    // ConlocaCard is in src/components/ — should NOT appear in pagesPaths
    expect(structure.pagesPaths.join(',')).not.toContain('ConlocaCard');
  });

  it('getComponentsData: LoginScreen in pageGroups, ConlocaCard NOT in pageGroups', async () => {
    const root = createHyp397Project('get-components-fallback', {
      'package.json': '{"dependencies":{"react":"19"},"devDependencies":{"vite":"6"}}',
      'src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    const pageNames = result.pageGroups.flatMap((g) => g.components.map((c) => c.name));
    const compositeNames = result.compositeGroups.flatMap((g) => g.components.map((c) => c.name));

    // LoginScreen directly in src/ → pageGroups
    expect(pageNames.some((n) => n.includes('LoginScreen'))).toBe(true);

    // ConlocaCard in src/components/ → compositeGroups, NOT pageGroups
    expect(compositeNames.some((n) => n.includes('ConlocaCard'))).toBe(true);
    expect(pageNames.join(',')).not.toContain('ConlocaCard');
  });

  it('getComponentsData: multiple direct src/ files → all in pageGroups', async () => {
    const root = createHyp397Project('multi-pages-fallback', {
      'package.json': '{"dependencies":{"react":"19"},"devDependencies":{"vite":"6"}}',
      'src/LoginScreen.tsx': 'export function LoginScreen() { return <div/>; }',
      'src/SignupScreen.tsx': 'export function SignupScreen() { return <div/>; }',
      'src/components/ConlocaCard.tsx': 'export function ConlocaCard() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const result = await scanner.getComponentsData(root);

    const pageNames = result.pageGroups.flatMap((g) => g.components.map((c) => c.name));

    // Both direct files → pageGroups, under a single src/ group
    expect(pageNames.some((n) => n.includes('LoginScreen'))).toBe(true);
    expect(pageNames.some((n) => n.includes('SignupScreen'))).toBe(true);

    // Should be in the same group (dirPath = 'src')
    const srcGroup = result.pageGroups.find((g) => g.dirPath === 'src');
    expect(srcGroup).toBeDefined();
    expect(srcGroup!.components).toHaveLength(2);

    // ConlocaCard must not leak into pages
    expect(pageNames.join(',')).not.toContain('ConlocaCard');
  });
});
