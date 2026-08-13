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

  it('should detect src/app/ as composites for Vite+React projects (conloca pattern)', () => {
    const root = createProject('vite-react-src-app', ['src/app/account', 'src/app/workspace', 'src/app/ui'], {
      'package.json': '{"dependencies":{"react":"19","vite":"5"}}',
      'src/main.tsx': 'import { render } from "react-dom";',
      'src/app/App.tsx': 'export function App() { return <div/>; }',
      'src/app/account/AccountPage.tsx': 'export function AccountPage() { return <div/>; }',
      'src/app/workspace/WorkspaceRouter.tsx': 'export function WorkspaceRouter() { return <div/>; }',
      'src/app/ui/HostField.tsx': 'export function HostField() { return <div/>; }',
    });

    const scanner = new ComponentScanner(createMockStore(null));
    const structure = scanner.detectProjectStructure(root);

    // src/app/ is treated as a composites root (like components/)
    expect(structure.compositeComponentsPaths).toContain(path.join(root, 'src', 'app'));
    // src/app/ui/ gets detected as atoms
    expect(structure.atomComponentsPaths).toContain(path.join(root, 'src', 'app', 'ui'));
    // Must NOT appear as pages (it's not a Next.js project)
    expect(structure.pagesPaths).not.toContain(path.join(root, 'src', 'app'));
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
