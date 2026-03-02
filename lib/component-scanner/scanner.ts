/**
 * ComponentScanner — core scanning logic with DI for storage.
 *
 * Extracted from server/routes/getComponents.ts.
 * Uses ProjectStructureStore for persistence and an optional analyzer callback
 * for AI-based or heuristic-based structure discovery.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ComponentGroup,
  ComponentListItem,
  ComponentsData,
  ProjectStructure,
  ProjectStructurePaths,
  ProjectStructureStore,
} from './types.js';

/** Next.js App Router special files that cannot be rendered in canvas preview */
const NEXTJS_APP_ROUTER_FILES = new Set([
  'layout',
  'loading',
  'error',
  'not-found',
  'template',
  'global-error',
  'default',
  'route',
]);

export class ComponentScanner {
  constructor(
    private store: ProjectStructureStore,
    private analyzeStructure?: (projectRoot: string) => Promise<ProjectStructure>,
  ) {}

  /**
   * Main method — get grouped components data.
   * Loads cached paths from store, or analyzes project structure if not cached.
   */
  async getComponentsData(projectRoot: string): Promise<ComponentsData> {
    let paths = await this.store.load(projectRoot);

    if (!paths || (paths.atomComponentsPaths.length === 0 && paths.compositeComponentsPaths.length === 0)) {
      const structure = await this.analyze(projectRoot);
      paths = {
        atomComponentsPaths: structure.atomComponentsPaths ?? [],
        compositeComponentsPaths: structure.compositeComponentsPaths ?? [],
        pagesPaths: structure.pagesPaths ?? [],
      };
      await this.store.save(projectRoot, paths);
    }

    return this.buildComponentsData(paths, projectRoot);
  }

  private async analyze(projectRoot: string): Promise<ProjectStructure> {
    if (this.analyzeStructure) {
      return this.analyzeStructure(projectRoot);
    }
    // No analyzer callback provided — return empty structure
    return {
      atomComponentsPaths: [],
      compositeComponentsPaths: [],
      pagesPaths: [],
      textComponentPath: null,
      linkComponentPath: null,
      buttonComponentPath: null,
      imageComponentPath: null,
      containerComponentPath: null,
    };
  }

  /**
   * Scan a directory recursively for component .tsx files.
   * @param dirPath - absolute path to scan
   * @param categoryRoot - absolute path of the category root (for computing display name)
   * @param projectRoot - absolute path of the project root (for computing relative path)
   */
  private scanComponentDirectory(dirPath: string, categoryRoot: string, projectRoot: string): ComponentListItem[] {
    const components: ComponentListItem[] = [];
    if (!fs.existsSync(dirPath)) return components;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        components.push(...this.scanComponentDirectory(fullPath, categoryRoot, projectRoot));
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.tsx') &&
        !entry.name.endsWith('.test.tsx') &&
        !entry.name.endsWith('.spec.tsx')
      ) {
        components.push({
          name: path.relative(categoryRoot, fullPath),
          path: path.relative(projectRoot, fullPath),
        });
      }
    }

    return components;
  }

  /**
   * Scan a directory for page files with Next.js special file filtering.
   */
  private scanPagesDirectory(dirPath: string, categoryRoot: string, projectRoot: string): ComponentListItem[] {
    const components: ComponentListItem[] = [];
    if (!fs.existsSync(dirPath)) return components;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        components.push(...this.scanPagesDirectory(fullPath, categoryRoot, projectRoot));
      } else if (entry.isFile()) {
        const baseName = entry.name.replace(/\.(tsx?|jsx?)$/, '');
        if (
          (entry.name.endsWith('.tsx') || entry.name.endsWith('.jsx')) &&
          !entry.name.endsWith('.test.tsx') &&
          !entry.name.endsWith('.test.jsx') &&
          !entry.name.endsWith('.spec.tsx') &&
          !entry.name.endsWith('.spec.jsx') &&
          entry.name !== 'test-preview.tsx' &&
          !entry.name.startsWith('_') &&
          !NEXTJS_APP_ROUTER_FILES.has(baseName) &&
          entry.name !== 'middleware.ts' &&
          entry.name !== 'middleware.js'
        ) {
          components.push({
            name: path.relative(categoryRoot, fullPath),
            path: path.relative(projectRoot, fullPath),
          });
        }
      }
    }

    return components;
  }

  /** Build ComponentsData from absolute paths */
  private buildComponentsData(paths: ProjectStructurePaths, projectRoot: string): ComponentsData {
    const atomGroups = this.buildGroups(paths.atomComponentsPaths, projectRoot, 'component');
    const compositeGroups = this.buildGroups(paths.compositeComponentsPaths, projectRoot, 'component');
    const pageGroups = this.buildGroups(paths.pagesPaths, projectRoot, 'page');
    return { atomGroups, compositeGroups, pageGroups };
  }

  private buildGroups(
    categoryPaths: string[] | null | undefined,
    projectRoot: string,
    kind: 'component' | 'page',
  ): ComponentGroup[] {
    const groups: ComponentGroup[] = [];
    if (!categoryPaths) return groups;

    for (const categoryPath of categoryPaths) {
      if (!fs.existsSync(categoryPath)) continue;

      const stat = fs.statSync(categoryPath);

      // File path is a marker — scan its parent directory instead
      if (stat.isFile()) {
        const dir = path.dirname(categoryPath);
        if (fs.existsSync(dir)) {
          const components =
            kind === 'page'
              ? this.scanPagesDirectory(dir, dir, projectRoot)
              : this.scanComponentDirectory(dir, dir, projectRoot);
          if (components.length > 0) {
            groups.push({
              dirPath: path.relative(projectRoot, dir),
              components,
            });
          }
        }
        continue;
      }

      const components =
        kind === 'page'
          ? this.scanPagesDirectory(categoryPath, categoryPath, projectRoot)
          : this.scanComponentDirectory(categoryPath, categoryPath, projectRoot);

      if (components.length > 0) {
        groups.push({
          dirPath: path.relative(projectRoot, categoryPath),
          components,
        });
      }
    }

    return groups;
  }
}
