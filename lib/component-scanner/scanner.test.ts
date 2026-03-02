import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { ComponentScanner } from './scanner';
import type { ProjectStructurePaths, ProjectStructureStore } from './types';

const TMP_DIR = path.join(import.meta.dir, '__test_fixtures__');

function createMockStore(data: ProjectStructurePaths | null): ProjectStructureStore {
  return {
    load: async () => data,
    save: async () => {},
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
});
