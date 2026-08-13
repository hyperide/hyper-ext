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

/** Directories to always skip during heuristic scanning */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.remix',
  'dist',
  'build',
  '.hyperide',
  'project-preview',
  'public',
  'assets',
  '__tests__',
  'test',
  'tests',
  'coverage',
  '.turbo',
  '.cache',
]);

/** Non-component directories that live alongside components */
const NON_COMPONENT_DIRS = new Set([
  'data',
  'types',
  'hooks',
  'lib',
  'utils',
  'helpers',
  'context',
  'store',
  'stores',
  'styles',
  'theme',
  'config',
  'constants',
  'navigation',
  'assets',
  'fonts',
  'icons',
  'images',
  'server',
  'database',
  'tamagui',
  'emotion',
  'zero',
  'shims',
  'platform',
]);

/** Atom directory names — typically contain small reusable primitives */
const ATOM_DIR_NAMES = new Set(['ui', 'atoms', 'elements', 'primitives']);

/** Page/route directory names */
const PAGE_DIR_NAMES = new Set(['pages', 'routes', 'screens', 'views']);

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
    const loadedPaths = paths;

    if (paths) {
      paths = this.normalizeProjectPaths(paths, projectRoot);
    }

    if (
      !paths ||
      (paths.atomComponentsPaths.length === 0 && paths.compositeComponentsPaths.length === 0) ||
      (loadedPaths !== null && this.shouldAnalyzeConfiguredPaths(loadedPaths, paths, projectRoot))
    ) {
      const structure = await this.analyze(projectRoot);
      paths = {
        atomComponentsPaths: this.normalizePathList(structure.atomComponentsPaths ?? [], projectRoot),
        compositeComponentsPaths: this.normalizePathList(structure.compositeComponentsPaths ?? [], projectRoot),
        pagesPaths: this.normalizePathList(structure.pagesPaths ?? [], projectRoot),
      };
      const hasData =
        paths.atomComponentsPaths.length > 0 ||
        paths.compositeComponentsPaths.length > 0 ||
        paths.pagesPaths.length > 0;
      if (hasData) {
        await this.store.save(projectRoot, paths);
      }
    }

    return this.buildComponentsData(paths, projectRoot);
  }

  private normalizeProjectPaths(paths: ProjectStructurePaths, projectRoot: string): ProjectStructurePaths {
    return {
      atomComponentsPaths: this.normalizePathList(paths.atomComponentsPaths, projectRoot),
      compositeComponentsPaths: this.normalizePathList(paths.compositeComponentsPaths, projectRoot),
      pagesPaths: this.normalizePathList(paths.pagesPaths, projectRoot),
    };
  }

  private normalizePathList(paths: string[], projectRoot: string): string[] {
    return paths.map((rawPath) => this.normalizeProjectPath(rawPath, projectRoot));
  }

  private normalizeProjectPath(rawPath: string, projectRoot: string): string {
    if (!path.isAbsolute(rawPath)) return rawPath;

    const relativeToRoot = path.relative(projectRoot, rawPath);
    if (relativeToRoot && !relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot)) {
      return relativeToRoot;
    }

    const remapped = this.remapForeignAbsolutePath(rawPath, projectRoot);
    return remapped ?? rawPath;
  }

  private remapForeignAbsolutePath(rawPath: string, projectRoot: string): string | null {
    const projectName = path.basename(projectRoot);
    const parts = rawPath.split(/[\\/]+/).filter(Boolean);
    const projectIndex = parts.lastIndexOf(projectName);

    if (projectIndex !== -1 && projectIndex < parts.length - 1) {
      const relative = parts.slice(projectIndex + 1).join(path.sep);
      if (this.projectPathExists(projectRoot, relative)) return relative;
    }

    const sourceRootIndex = parts.findIndex((part) => part === 'src' || part === 'app');
    if (sourceRootIndex !== -1) {
      const relative = parts.slice(sourceRootIndex).join(path.sep);
      if (this.projectPathExists(projectRoot, relative)) return relative;
    }

    return null;
  }

  private projectPathExists(projectRoot: string, relativePath: string): boolean {
    return fs.existsSync(path.join(projectRoot, relativePath));
  }

  private hasExistingConfiguredPath(paths: ProjectStructurePaths, projectRoot: string): boolean {
    return [...paths.atomComponentsPaths, ...paths.compositeComponentsPaths, ...paths.pagesPaths].some((rawPath) => {
      const resolved = path.isAbsolute(rawPath) ? rawPath : path.join(projectRoot, rawPath);
      return fs.existsSync(resolved);
    });
  }

  private shouldAnalyzeConfiguredPaths(
    loadedPaths: ProjectStructurePaths,
    normalizedPaths: ProjectStructurePaths,
    projectRoot: string,
  ): boolean {
    const configuredPaths = [
      ...loadedPaths.atomComponentsPaths,
      ...loadedPaths.compositeComponentsPaths,
      ...loadedPaths.pagesPaths,
    ];
    if (configuredPaths.length === 0) return false;
    if (!configuredPaths.every((rawPath) => path.isAbsolute(rawPath))) return false;
    const hasForeignAbsolutePath = configuredPaths.some((rawPath) => {
      const relativeToRoot = path.relative(projectRoot, rawPath);
      return relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot);
    });
    if (!hasForeignAbsolutePath) return false;
    return !this.hasExistingConfiguredPath(normalizedPaths, projectRoot);
  }

  /**
   * Heuristic-based project structure detection.
   * Detects standard React project layouts without AI.
   *
   * Detected patterns:
   * - src/components/ui/ → atoms (shadcn style)
   * - src/components/ → composites (minus ui/ subdirs)
   * - app/components/ → composites (Remix)
   * - src/pages/, app/routes/, src/screens/ → pages
   * - app/ with page.tsx → Next.js App Router pages
   * - src/ with PascalCase .tsx at root → pages (Vite/React fallback)
   */
  detectProjectStructure(projectRoot: string): ProjectStructure {
    const atoms: string[] = [];
    const composites: string[] = [];
    const pages: string[] = [];

    // Detect framework from package.json
    const framework = this.detectFramework(projectRoot);

    // Determine source roots to scan
    const sourceRoots: string[] = [];
    for (const dir of ['src', 'app', 'client']) {
      const fullPath = path.join(projectRoot, dir);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        sourceRoots.push(fullPath);
      }
    }

    // Monorepo: also scan sub-package source directories.
    // Triggered by nx.json, turbo.json, pnpm-workspace.yaml, or workspaces field.
    const isMonorepo = this.isMonorepoRoot(projectRoot);
    if (isMonorepo) {
      for (const subDir of ['targets', 'apps', 'packages', 'libs', 'services']) {
        const subDirPath = path.join(projectRoot, subDir);
        if (!fs.existsSync(subDirPath)) continue;
        let pkgEntries: fs.Dirent[];
        try {
          pkgEntries = fs.readdirSync(subDirPath, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const pkg of pkgEntries) {
          if (!pkg.isDirectory() || SKIP_DIRS.has(pkg.name)) continue;
          const pkgRoot = path.join(subDirPath, pkg.name);
          let foundNested = false;
          for (const srcDir of ['src', 'app']) {
            const srcPath = path.join(pkgRoot, srcDir);
            if (fs.existsSync(srcPath) && fs.statSync(srcPath).isDirectory()) {
              sourceRoots.push(srcPath);
              foundNested = true;
            }
          }
          // If no src/ or app/ found, check for conventional dirs at package root
          // (e.g. apps/web/pages/, packages/ui/components/).
          if (!foundNested) {
            const hasConventionalDir = ['pages', 'components', 'screens', 'routes'].some((d) => {
              const dp = path.join(pkgRoot, d);
              return fs.existsSync(dp) && fs.statSync(dp).isDirectory();
            });
            if (hasConventionalDir) sourceRoots.push(pkgRoot);
          }
        }
      }
    }

    // If no source roots found, nothing to scan
    if (sourceRoots.length === 0) {
      return this.emptyStructure();
    }

    for (const sourceRoot of sourceRoots) {
      const dirName = path.basename(sourceRoot);

      // Scan immediate children for known patterns
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(sourceRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name) || NON_COMPONENT_DIRS.has(entry.name)) continue;

        const entryPath = path.join(sourceRoot, entry.name);
        const entryName = entry.name.toLowerCase();

        // Pages/routes/screens directories
        if (PAGE_DIR_NAMES.has(entryName)) {
          pages.push(entryPath);
          continue;
        }

        // Components directory — check for atom subdirs
        if (entryName === 'components') {
          this.categorizeComponentsDir(entryPath, atoms, composites);
          continue;
        }

        // features/ → composites
        if (entryName === 'features' || entryName === 'modules') {
          composites.push(entryPath);
          continue;
        }

        // interface/ → could contain atoms (tamagui-free-sample style)
        if (entryName === 'interface') {
          // Scan for atom-like subdirs
          this.categorizeInterfaceDir(entryPath, atoms, composites);
          continue;
        }

        // src/app/ in non-Next.js projects (common Vite+React pattern: all features under src/app/)
        // Treat like components/ — ui/ subdir → atoms, everything else → composites
        if (entryName === 'app' && dirName === 'src' && framework !== 'nextjs') {
          this.categorizeComponentsDir(entryPath, atoms, composites);
          continue;
        }
      }

      // Next.js App Router: app/ itself is pages (if it has page.tsx files)
      if (dirName === 'app' && framework === 'nextjs') {
        // app/ with page.tsx → pages source
        if (this.hasFileRecursive(sourceRoot, 'page.tsx') || this.hasFileRecursive(sourceRoot, 'page.jsx')) {
          pages.push(sourceRoot);
        }
      }

      // Remix: app/routes/ already handled above

      // Fallback for React/Vite projects: if no pages/ directory was found,
      // but src/ has .tsx/.jsx files at top level (e.g. App.tsx), treat src/ as pages source.
      // Also applies to monorepo sub-package src/ directories even when root src/ already found pages —
      // each sub-package's direct .tsx files should be discoverable independently.
      const isSubPackageSrc =
        dirName === 'src' &&
        !sourceRoot.endsWith(path.join(projectRoot, 'src')) &&
        !sourceRoot.endsWith(path.join(projectRoot, 'app')) &&
        !sourceRoot.endsWith(path.join(projectRoot, 'client'));
      if (dirName === 'src' && framework === 'react' && (pages.length === 0 || isSubPackageSrc)) {
        const hasTsxAtRoot = entries.some(
          (e) => e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.jsx')) && /^[A-Z]/.test(e.name),
        );
        if (hasTsxAtRoot) {
          pages.push(sourceRoot);
        }
      }
    }

    return {
      atomComponentsPaths: atoms,
      compositeComponentsPaths: composites,
      pagesPaths: pages,
      textComponentPath: null,
      linkComponentPath: null,
      buttonComponentPath: null,
      imageComponentPath: null,
      containerComponentPath: null,
    };
  }

  private async analyze(projectRoot: string): Promise<ProjectStructure> {
    if (this.analyzeStructure) {
      const result = await this.analyzeStructure(projectRoot);
      // If the analyzer returned actual paths, use them
      const hasData =
        (result.atomComponentsPaths?.length ?? 0) > 0 ||
        (result.compositeComponentsPaths?.length ?? 0) > 0 ||
        (result.pagesPaths?.length ?? 0) > 0;
      if (hasData) {
        return result;
      }
    }
    // No analyzer, or analyzer returned empty — fall back to heuristic detection
    return this.detectProjectStructure(projectRoot);
  }

  /** Return true if projectRoot is a monorepo workspace (Nx, Turbo, pnpm, Lerna, generic). */
  private isMonorepoRoot(projectRoot: string): boolean {
    if (fs.existsSync(path.join(projectRoot, 'nx.json'))) return true;
    if (fs.existsSync(path.join(projectRoot, 'turbo.json'))) return true;
    if (fs.existsSync(path.join(projectRoot, 'pnpm-workspace.yaml'))) return true;
    if (fs.existsSync(path.join(projectRoot, 'lerna.json'))) return true;
    try {
      const pkgPath = path.join(projectRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.nx || deps.turbo) return true;
        if (Array.isArray(pkg.workspaces)) return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  /** Detect framework from package.json dependencies */
  private detectFramework(projectRoot: string): 'nextjs' | 'remix' | 'expo' | 'react' {
    try {
      const pkgPath = path.join(projectRoot, 'package.json');
      if (!fs.existsSync(pkgPath)) return 'react';
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) return 'nextjs';
      if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix';
      if (deps.expo || deps['react-native']) return 'expo';
      return 'react';
    } catch {
      return 'react';
    }
  }

  /** Categorize a components/ directory into atoms and composites */
  private categorizeComponentsDir(componentsPath: string, atoms: string[], composites: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(componentsPath, { withFileTypes: true });
    } catch {
      composites.push(componentsPath);
      return;
    }

    let hasAtomSubdir = false;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryName = entry.name.toLowerCase();
      if (ATOM_DIR_NAMES.has(entryName)) {
        atoms.push(path.join(componentsPath, entry.name));
        hasAtomSubdir = true;
      } else if (entryName === 'layout') {
        // layout/ subdirectory → composites
        composites.push(path.join(componentsPath, entry.name));
      }
    }

    // The components/ dir itself is composites (will scan .tsx files at this level + non-atom subdirs)
    composites.push(componentsPath);

    // If atom subdir found, the composites scanner will still pick up the non-atom files
    // which is correct — files directly in components/ are typically composites
    if (!hasAtomSubdir) {
      // No atom subdirs found — check if the dir has many small generic-named files
      // that might indicate it's an atoms dir itself (rare but possible)
      const tsxFiles = entries.filter((e) => e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.jsx')));
      // If it's a flat directory with many files, it's still composites by default
      // (atoms need an explicit ui/ or atoms/ subdir)
      void tsxFiles;
    }
  }

  /** Categorize an interface/ directory (tamagui-free-sample pattern) */
  private categorizeInterfaceDir(interfacePath: string, atoms: string[], composites: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(interfacePath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryName = entry.name.toLowerCase();
      // Known atom-like subdirs
      if (['buttons', 'forms', 'text', 'image', 'avatars', 'icons'].includes(entryName)) {
        atoms.push(path.join(interfacePath, entry.name));
      } else if (['layout', 'headers', 'dialogs', 'pages', 'app'].includes(entryName)) {
        composites.push(path.join(interfacePath, entry.name));
      }
    }
  }

  /** Check if a directory contains a specific file recursively (max 2 levels) */
  private hasFileRecursive(dirPath: string, fileName: string, depth = 0): boolean {
    if (depth > 2) return false;
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name === fileName) return true;
        if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
          if (this.hasFileRecursive(path.join(dirPath, entry.name), fileName, depth + 1)) return true;
        }
      }
    } catch {
      // Ignore read errors
    }
    return false;
  }

  private emptyStructure(): ProjectStructure {
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
   * @param skipDirs - set of directory names to skip (e.g., atom subdirs already categorized)
   */
  private scanComponentDirectory(
    dirPath: string,
    categoryRoot: string,
    projectRoot: string,
    skipDirs?: Set<string>,
  ): ComponentListItem[] {
    const components: ComponentListItem[] = [];
    if (!fs.existsSync(dirPath)) return components;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Skip subdirectories that are already categorized (e.g., ui/ as atoms)
        if (skipDirs?.has(entry.name)) continue;
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
    // Collect atom directory paths so composites scanner can skip them
    const atomDirPaths = new Set(
      (paths.atomComponentsPaths ?? []).map((p) => {
        const resolved = path.isAbsolute(p) ? p : path.join(projectRoot, p);
        return resolved;
      }),
    );

    const atomGroups = this.buildGroups(paths.atomComponentsPaths, projectRoot, 'component');
    const compositeGroups = this.buildGroups(paths.compositeComponentsPaths, projectRoot, 'component', atomDirPaths);
    const pageGroups = this.buildGroups(paths.pagesPaths, projectRoot, 'page');
    return { atomGroups, compositeGroups, pageGroups };
  }

  private buildGroups(
    categoryPaths: string[] | null | undefined,
    projectRoot: string,
    kind: 'component' | 'page',
    excludeDirs?: Set<string>,
  ): ComponentGroup[] {
    const groups: ComponentGroup[] = [];
    if (!categoryPaths) return groups;

    // Build a set of directory basenames to skip (dirs already categorized elsewhere)
    const skipDirNames = new Set<string>();
    if (excludeDirs) {
      for (const dirPath of excludeDirs) {
        skipDirNames.add(path.basename(dirPath));
      }
    }

    for (const rawPath of categoryPaths) {
      // Resolve relative paths against projectRoot (AI analyzer returns absolute,
      // but heuristic detector or cached JSON may store relative paths)
      const categoryPath = path.isAbsolute(rawPath) ? rawPath : path.join(projectRoot, rawPath);
      if (!fs.existsSync(categoryPath)) continue;

      const stat = fs.statSync(categoryPath);

      // File path is a marker — scan its parent directory instead
      if (stat.isFile()) {
        const dir = path.dirname(categoryPath);
        if (fs.existsSync(dir)) {
          const components =
            kind === 'page'
              ? this.scanPagesDirectory(dir, dir, projectRoot)
              : this.scanComponentDirectory(dir, dir, projectRoot, skipDirNames);
          if (components.length > 0) {
            groups.push({
              dirPath: path.relative(projectRoot, dir),
              components,
            });
          }
        }
        continue;
      }

      // Check if this directory is a parent of an excluded dir — if so, skip the excluded children
      const applicableSkips = new Set<string>();
      if (excludeDirs) {
        for (const excludeDir of excludeDirs) {
          if (excludeDir.startsWith(categoryPath + path.sep)) {
            // excludeDir is a child of categoryPath — skip its basename during recursive scan
            const relative = path.relative(categoryPath, excludeDir);
            const firstSegment = relative.split(path.sep)[0];
            applicableSkips.add(firstSegment);
          }
        }
      }

      const components =
        kind === 'page'
          ? this.scanPagesDirectory(categoryPath, categoryPath, projectRoot)
          : this.scanComponentDirectory(
              categoryPath,
              categoryPath,
              projectRoot,
              applicableSkips.size > 0 ? applicableSkips : undefined,
            );

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
