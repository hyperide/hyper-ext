/**
 * ComponentScanner — core scanning logic with DI for storage.
 *
 * Extracted from server/routes/getComponents.ts.
 * Uses ProjectStructureStore for persistence and an optional analyzer callback
 * for AI-based or heuristic-based structure discovery.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SCAN_EXCLUDE_SCANNER } from '../../shared/fs/scan-excludes';
import type {
  ComponentGroup,
  ComponentListItem,
  ComponentsData,
  ProjectStructure,
  ProjectStructurePaths,
  ProjectStructureStore,
  SubProject,
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

/**
 * Directories to always skip during heuristic scanning.
 * Shared single source of truth (see shared/fs/scan-excludes); the scanner variant
 * additionally skips static-asset dirs (public, assets), test dirs, and the
 * .hyperide/project-preview runtime dirs on top of the standard build/tooling set.
 */
const SKIP_DIRS = SCAN_EXCLUDE_SCANNER;

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

  async getComponentsDataWithAncestorFallback(projectRoot: string): Promise<ComponentsData> {
    const data = await this.getComponentsData(projectRoot);
    if (data.isMonorepo) return data;

    const openedRoot = path.resolve(projectRoot);
    const monorepoRoot = this.findMonorepoRootUpward(projectRoot);
    if (!monorepoRoot) return data;

    const monorepoData = await this.getComponentsData(monorepoRoot);
    if (!monorepoData.isMonorepo) return data;

    return {
      ...this.rebaseComponentsDataPaths(monorepoData, monorepoRoot, openedRoot),
      activeSubProjectPath: path.relative(monorepoRoot, openedRoot),
      monorepoRoot,
    };
  }

  /**
   * File-bearing paths are consumed relative to the folder the extension opened
   * (`ComponentService._workspaceRoot`). SubProject.path stays monorepo-root-relative
   * because it is only an accordion identity and must match activeSubProjectPath.
   */
  private rebaseComponentsDataPaths(data: ComponentsData, fromRoot: string, toRoot: string): ComponentsData {
    const rebaseGroups = (groups: ComponentGroup[]): ComponentGroup[] =>
      groups.map((group) => this.rebaseComponentGroupPaths(group, fromRoot, toRoot));

    return {
      ...data,
      atomGroups: rebaseGroups(data.atomGroups),
      compositeGroups: rebaseGroups(data.compositeGroups),
      pageGroups: rebaseGroups(data.pageGroups),
      subProjects: data.subProjects?.map((subProject) => ({
        ...subProject,
        atomGroups: rebaseGroups(subProject.atomGroups),
        compositeGroups: rebaseGroups(subProject.compositeGroups),
        pageGroups: rebaseGroups(subProject.pageGroups),
      })),
    };
  }

  private rebaseComponentGroupPaths(group: ComponentGroup, fromRoot: string, toRoot: string): ComponentGroup {
    return {
      ...group,
      dirPath: this.rebaseProjectRelativePath(group.dirPath, fromRoot, toRoot),
      components: group.components.map((component) => ({
        ...component,
        path: this.rebaseProjectRelativePath(component.path, fromRoot, toRoot),
      })),
    };
  }

  private rebaseProjectRelativePath(relativePath: string, fromRoot: string, toRoot: string): string {
    const absolutePath = path.isAbsolute(relativePath) ? relativePath : path.resolve(fromRoot, relativePath);
    return path.relative(toRoot, absolutePath);
  }

  private normalizeProjectPaths(paths: ProjectStructurePaths, projectRoot: string): ProjectStructurePaths {
    return {
      atomComponentsPaths: this.normalizePathList(paths.atomComponentsPaths, projectRoot),
      compositeComponentsPaths: this.normalizePathList(paths.compositeComponentsPaths, projectRoot),
      pagesPaths: this.normalizePathList(paths.pagesPaths, projectRoot),
    };
  }

  private normalizePathList(paths: string[], projectRoot: string): string[] {
    return paths
      .map((rawPath) => this.normalizeProjectPath(rawPath, projectRoot))
      .filter((p): p is string => p !== null);
  }

  /**
   * Normalize a cached component path to a project-relative form. Cached paths are
   * workspace-controlled, so any path that escapes the project root and cannot be
   * remapped back into it is DROPPED (returns null) rather than preserved as a raw
   * absolute path — preserving it would let buildGroups enumerate files outside the
   * project (HYP-637). A dropped path leaves the path list empty/contained, which
   * forces re-analysis in getComponentsData.
   */
  private normalizeProjectPath(rawPath: string, projectRoot: string): string | null {
    if (!path.isAbsolute(rawPath)) {
      // A relative cache entry must still resolve within the project root.
      return this.pathEscapesRoot(projectRoot, rawPath) ? null : rawPath;
    }

    // Foreign/escaping absolute path: remap into the project when possible, otherwise drop.
    if (this.pathEscapesRoot(projectRoot, rawPath)) {
      return this.remapForeignAbsolutePath(rawPath, projectRoot);
    }

    // Absolute path inside the project root → project-relative form. An empty
    // result means the path IS the project root, which buildGroups scans as '.'.
    const relativeToRoot = path.relative(projectRoot, rawPath);
    return relativeToRoot === '' ? '.' : relativeToRoot;
  }

  private remapForeignAbsolutePath(rawPath: string, projectRoot: string): string | null {
    const projectName = path.basename(projectRoot);
    const parts = rawPath.split(/[\\/]+/).filter(Boolean);
    const projectIndex = parts.lastIndexOf(projectName);

    if (projectIndex !== -1 && projectIndex < parts.length - 1) {
      const remapped = this.containedRemapCandidate(projectRoot, parts.slice(projectIndex + 1).join(path.sep));
      if (remapped !== null) return remapped;
    }

    // Try every source-root anchor, outermost first. A `client` (or `src`/`app`)
    // segment may appear as an ancestor before the real source root
    // (e.g. /workspace/client/old-checkout/src/components), so a first-match
    // anchor would build a non-existent candidate and miss the later one.
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] !== 'src' && parts[i] !== 'app' && parts[i] !== 'client') continue;
      const remapped = this.containedRemapCandidate(projectRoot, parts.slice(i).join(path.sep));
      if (remapped !== null) return remapped;
    }

    return null;
  }

  /**
   * Accept a remap candidate only when it resolves to an existing path INSIDE the
   * project root. `..` segments surviving the anchor split (e.g.
   * `/x/client/../../outside`) must not let the scanner enumerate files outside the
   * project (HYP-637). Returns the normalized project-relative path, or null.
   */
  private containedRemapCandidate(projectRoot: string, candidate: string): string | null {
    if (this.pathEscapesRoot(projectRoot, candidate)) return null;
    const relative = path.relative(projectRoot, path.resolve(projectRoot, candidate));
    return this.projectPathExists(projectRoot, relative) ? relative : null;
  }

  /**
   * True when `candidate` (resolved against projectRoot) lands outside the project
   * root. An empty relative result means the candidate IS the project root, which is
   * contained — only `..`-prefixed or absolute results escape.
   */
  private pathEscapesRoot(projectRoot: string, candidate: string): boolean {
    const relative = path.relative(projectRoot, path.resolve(projectRoot, candidate));
    return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
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

        // src/app/ in non-Next.js projects. When feature-domain subdirs contain
        // *Page.tsx / *Screen.tsx files (conloca pattern: src/app/auth/LoginScreen.tsx,
        // src/app/account/AccountPage.tsx, …), those subdirs become pages. ui/ becomes
        // atoms. src/app/ itself stays in composites for top-level files (App.tsx,
        // CmsHost.tsx, …) and non-page subdirs (banners/, reconcile/, …).
        // buildComponentsData / buildSubProject exclude page dirs from the composite
        // scan to prevent double-listing (HYP-758).
        // Fallback when no page subdirs are found: same as the old categorizeComponentsDir
        // path — whole src/app/ is composites, ui/ is atoms.
        if (entryName === 'app' && dirName === 'src' && framework !== 'nextjs') {
          this.categorizeAppDir(entryPath, atoms, composites, pages);
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
        // Add individual files — fallback is non-recursive (only direct src/ children)
        for (const e of entries) {
          if (
            e.isFile() &&
            (e.name.endsWith('.tsx') || e.name.endsWith('.jsx')) &&
            !e.name.endsWith('.test.tsx') &&
            !e.name.endsWith('.spec.tsx') &&
            !e.name.endsWith('.test.jsx') &&
            !e.name.endsWith('.spec.jsx') &&
            /^[A-Z]/.test(e.name)
          ) {
            pages.push(path.join(sourceRoot, e.name));
          }
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
    return this.hasMonorepoMarkers(projectRoot);
  }

  private hasMonorepoMarkers(dir: string): boolean {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return true;
    if (fs.existsSync(path.join(dir, 'turbo.json'))) return true;
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return true;
    if (fs.existsSync(path.join(dir, 'lerna.json'))) return true;
    try {
      const pkgPath = path.join(dir, 'package.json');
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

  private findMonorepoRootUpward(startPath: string, maxLevels = 6): string | null {
    let current = path.dirname(path.resolve(startPath));

    for (let level = 0; level < maxLevels; level++) {
      if (this.hasMonorepoMarkers(current)) return current;

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return null;
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

  /**
   * True when a directory directly contains at least one file whose name ends with
   * `Page.tsx`, `Screen.tsx`, `Page.jsx`, or `Screen.jsx`. Only looks one level deep
   * (direct children) — enough to classify the directory as a page-domain folder
   * without recursing into nested subdirs (HYP-758).
   */
  private hasPagesOrScreenFiles(dirPath: string): boolean {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.some(
        (e) =>
          e.isFile() &&
          (e.name.endsWith('Page.tsx') ||
            e.name.endsWith('Screen.tsx') ||
            e.name.endsWith('Page.jsx') ||
            e.name.endsWith('Screen.jsx')),
      );
    } catch {
      return false;
    }
  }

  /**
   * Categorize `src/app/` in a non-Next.js Vite/React project whose app directory
   * is a feature-domain hub rather than a plain components folder.
   *
   * Classification of immediate subdirectories:
   *  - ATOM_DIR_NAMES (ui, atoms, …)           → atoms
   *  - PAGE_DIR_NAMES (pages, routes, screens…) → pages
   *  - Subdirs that contain *Page.tsx / *Screen.tsx files → pages (HYP-758)
   *  - NON_COMPONENT_DIRS / SKIP_DIRS           → skipped
   *  - Remaining subdirs                        → implicitly in composites
   *
   * `appPath` itself is always added to composites so that top-level .tsx files
   * (App.tsx, CmsHost.tsx, …) and non-page subdirs (banners/, reconcile/, …) are
   * still reachable. The callers of buildComponentsData / buildSubProject exclude
   * detected page dir paths from the composite recursive scan to prevent pages
   * from appearing in both panels.
   */
  private categorizeAppDir(appPath: string, atoms: string[], composites: string[], pages: string[]): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(appPath, { withFileTypes: true });
    } catch {
      composites.push(appPath);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const entryName = entry.name.toLowerCase();
      if (SKIP_DIRS.has(entry.name) || NON_COMPONENT_DIRS.has(entryName)) continue;

      const entryPath = path.join(appPath, entry.name);

      if (ATOM_DIR_NAMES.has(entryName)) {
        atoms.push(entryPath);
        continue;
      }

      if (PAGE_DIR_NAMES.has(entryName)) {
        pages.push(entryPath);
        continue;
      }

      if (this.hasPagesOrScreenFiles(entryPath)) {
        pages.push(entryPath);
        // Non-page subdirs fall through; they are covered by the composite appPath entry below.
      }
    }

    // Keep appPath in composites: top-level .tsx files (App.tsx, CmsHost.tsx, …) live
    // here, as do non-page feature subdirs (banners/, reconcile/, slots/, …). The
    // buildGroups caller skips any page subdirs it finds in the exclude set, so they
    // won't be double-counted.
    composites.push(appPath);
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
  private scanPagesDirectory(
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
        if (skipDirs?.has(entry.name)) continue;
        components.push(...this.scanPagesDirectory(fullPath, categoryRoot, projectRoot, skipDirs));
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
    const resolvePaths = (rawPaths: string[] | null | undefined): Set<string> =>
      new Set((rawPaths ?? []).map((p) => (path.isAbsolute(p) ? p : path.join(projectRoot, p))));

    // Collect atom directory paths so composites scanner can skip them
    const atomDirPaths = resolvePaths(paths.atomComponentsPaths);
    // Collect page directory paths so the composite scanner skips them — prevents
    // page components (e.g. src/app/auth/LoginScreen.tsx) from appearing in both
    // Pages and Composites when src/app/ is a feature hub (HYP-758).
    const pageDirPaths = resolvePaths(paths.pagesPaths);
    // Collect composite directory paths so pages scanner can skip them
    const compositeDirPaths = resolvePaths(paths.compositeComponentsPaths);

    // Composites must skip both atom dirs AND page dirs to avoid double-listing.
    const compositeExcludeDirs = new Set([...atomDirPaths, ...pageDirPaths]);

    const atomGroups = this.buildGroups(paths.atomComponentsPaths, projectRoot, 'component');
    const compositeGroups = this.buildGroups(
      paths.compositeComponentsPaths,
      projectRoot,
      'component',
      compositeExcludeDirs,
    );
    const pageGroups = this.buildGroups(paths.pagesPaths, projectRoot, 'page', compositeDirPaths);

    const isMonorepo = this.isMonorepoRoot(projectRoot);
    if (!isMonorepo) {
      return { atomGroups, compositeGroups, pageGroups, isMonorepo: false };
    }

    // Monorepo: components live under sub-projects (rendered by SubProjectAccordion).
    // Flat consumers that only read atom/composite groups — useComponentAutoLoad
    // (auto-selects first component) and FloatingPanels — would otherwise see nothing.
    // Mirror the union of sub-project atom/composite groups into the flat fields so
    // those consumers keep working. pageGroups stays empty: no flat consumer reads it,
    // and PagesSection renders flat pageGroups unconditionally — populating it would
    // double-render pages already shown per sub-project in the accordion.
    const subProjects = this.detectSubProjects(projectRoot);
    const flatAtomGroups = subProjects.flatMap((sp) => sp.atomGroups);
    const flatCompositeGroups = subProjects.flatMap((sp) => sp.compositeGroups);
    return {
      atomGroups: flatAtomGroups,
      compositeGroups: flatCompositeGroups,
      pageGroups: [],
      isMonorepo: true,
      subProjects,
    };
  }

  /** Enumerate sub-packages in a monorepo and build per-sub-project component groups. */
  private detectSubProjects(projectRoot: string): SubProject[] {
    const subProjects: SubProject[] = [];
    const WORKSPACE_DIRS = ['targets', 'apps', 'packages', 'libs', 'services'];

    for (const workspaceDir of WORKSPACE_DIRS) {
      const workspacePath = path.join(projectRoot, workspaceDir);
      if (!fs.existsSync(workspacePath)) continue;

      for (const subProject of this.findWorkspaceSubProjects(workspacePath, workspaceDir, projectRoot)) {
        subProjects.push(
          this.buildSubProject(subProject.name, subProject.relativePath, subProject.absPath, projectRoot),
        );
      }
    }

    return subProjects;
  }

  private findWorkspaceSubProjects(
    workspacePath: string,
    workspaceDir: string,
    projectRoot: string,
  ): Array<{ name: string; relativePath: string; absPath: string }> {
    let pkgEntries: fs.Dirent[];
    try {
      pkgEntries = fs.readdirSync(workspacePath, { withFileTypes: true });
    } catch {
      return [];
    }

    const subProjects: Array<{ name: string; relativePath: string; absPath: string }> = [];
    for (const pkg of pkgEntries) {
      if (!pkg.isDirectory() || SKIP_DIRS.has(pkg.name)) continue;

      const subPkgPath = path.join(workspacePath, pkg.name);
      const subPkgRelative = path.join(workspaceDir, pkg.name);
      // A grouping/scope folder (e.g. packages/acme/ holding packages/acme/dashboard/) has
      // neither its own package.json NOR any component source directly reachable through
      // its own src/app (hasOwnComponentSource, the SAME single-level check a real leaf is
      // detected with) — only then is it worth trying to recurse into its children as
      // separately-scoped sub-projects. A directory-NAME check here (own dir literally
      // named 'src'/'app'/etc) is NOT enough in either direction: requiring absence of
      // package.json alone misreads a source-only leaf's own `src/` as a nested package
      // named "src" (packages/foo/src/components/Button.tsx — foo's real components
      // vanished, HYP-909 follow-up); and rejecting scope-recursion whenever the child
      // directory NAME collides with a generic name (an earlier attempt at this fix) misreads
      // a genuinely nested, manifest-less package that happens to be named "app" (e.g.
      // packages/@acme/app/src/App.tsx with no package.json) as the scope's own source
      // folder instead. Checking whether the PARENT already yields components on its own
      // sidesteps both false positives: a source-only leaf's own src/app resolves to real
      // components immediately (so scope-recursion is skipped, no ambiguity to resolve), while
      // a genuine scope folder's src/app conventions stay empty at this level regardless of
      // what its nested children happen to be named.
      //
      // Known, deliberate tradeoff: a folder that is BOTH a source-only leaf (its own
      // src/components/X.tsx) AND a container for a separately-manifested nested package
      // (its own child/package.json) resolves as the LEAF — the nested package is not
      // discovered. This shape doesn't correspond to any known monorepo-tool convention
      // (a package's own src/ holds its own code, not another package), so it's treated as
      // out of scope rather than adding a third heuristic layer for it.
      const hasOwnPackageJson = fs.existsSync(path.join(subPkgPath, 'package.json'));
      if (workspaceDir === 'packages' && !hasOwnPackageJson && !this.hasOwnComponentSource(subPkgPath, projectRoot)) {
        const scopedProjects = this.findScopedPackageSubProjects(subPkgPath, subPkgRelative);
        if (scopedProjects.length > 0) {
          subProjects.push(...scopedProjects);
          continue;
        }
      }

      subProjects.push({ name: pkg.name, relativePath: subPkgRelative, absPath: subPkgPath });
    }

    return subProjects;
  }

  /**
   * Does `subPkgPath` yield any component/page paths of its own via ITS NESTED
   * src/app only (detectNestedSourceStructure — see that method's doc comment
   * for why NOT the merged detectProjectStructureInScope, whose root-level
   * conventional-dirs half would false-positive on a scope folder whose only
   * child happens to be named "pages"/"components"/etc, and wrongly veto
   * scope-recursion for those names).
   */
  private hasOwnComponentSource(subPkgPath: string, projectRoot: string): boolean {
    const structure = this.detectNestedSourceStructure(subPkgPath, projectRoot);
    return (
      structure.atomComponentsPaths.length > 0 ||
      structure.compositeComponentsPaths.length > 0 ||
      structure.pagesPaths.length > 0
    );
  }

  private findScopedPackageSubProjects(
    scopePath: string,
    scopeRelativePath: string,
  ): Array<{ name: string; relativePath: string; absPath: string }> {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(scopePath, { withFileTypes: true });
    } catch {
      return [];
    }

    const subProjects: Array<{ name: string; relativePath: string; absPath: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;

      const absPath = path.join(scopePath, entry.name);
      if (!this.looksLikeSubProjectRoot(absPath)) continue;

      subProjects.push({
        name: entry.name,
        relativePath: path.join(scopeRelativePath, entry.name),
        absPath,
      });
    }

    return subProjects;
  }

  private looksLikeSubProjectRoot(subPkgPath: string): boolean {
    if (fs.existsSync(path.join(subPkgPath, 'package.json'))) return true;
    return ['src', 'app', 'pages', 'components', 'screens', 'routes'].some((dirName) => {
      const dirPath = path.join(subPkgPath, dirName);
      return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    });
  }

  private buildSubProject(name: string, relativePath: string, absPath: string, projectRoot: string): SubProject {
    const { supported, unsupportedReason } = this.checkSubProjectSupport(absPath);

    if (!supported) {
      return {
        name,
        path: relativePath,
        supported: false,
        unsupportedReason,
        atomGroups: [],
        compositeGroups: [],
        pageGroups: [],
      };
    }

    // Detect paths scoped to this sub-project only
    const structure = this.detectProjectStructureInScope(absPath, projectRoot);
    const atomDirPaths = new Set(
      structure.atomComponentsPaths.map((p) => (path.isAbsolute(p) ? p : path.join(projectRoot, p))),
    );
    // Page dirs must also be excluded from the composite scan to prevent double-listing
    // when src/app/ is a feature hub (same rationale as buildComponentsData, HYP-758).
    const pageDirPaths = new Set(structure.pagesPaths.map((p) => (path.isAbsolute(p) ? p : path.join(projectRoot, p))));
    const compositeDirPaths = new Set(
      structure.compositeComponentsPaths.map((p) => (path.isAbsolute(p) ? p : path.join(projectRoot, p))),
    );
    const compositeExcludeDirs = new Set([...atomDirPaths, ...pageDirPaths]);
    const atomGroups = this.buildGroups(structure.atomComponentsPaths, projectRoot, 'component');
    const compositeGroups = this.buildGroups(
      structure.compositeComponentsPaths,
      projectRoot,
      'component',
      compositeExcludeDirs,
    );
    const pageGroups = this.buildGroups(structure.pagesPaths, projectRoot, 'page', compositeDirPaths);

    return { name, path: relativePath, supported: true, atomGroups, compositeGroups, pageGroups };
  }

  /** Check whether a sub-project directory is React-based and HyperIDE-compatible. */
  private checkSubProjectSupport(subPkgPath: string): { supported: boolean; unsupportedReason?: string } {
    const pkgJsonPath = path.join(subPkgPath, 'package.json');
    let deps: Record<string, string> = {};
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
      } catch {
        // ignore parse errors
      }
    }

    if (deps['vue'] || deps['@vue/core']) {
      return { supported: false, unsupportedReason: 'Vue.js projects not supported' };
    }
    if (deps['svelte']) {
      return { supported: false, unsupportedReason: 'Svelte projects not supported' };
    }
    if (deps['@angular/core']) {
      return { supported: false, unsupportedReason: 'Angular projects not supported' };
    }

    // Check for React
    if (deps['react'] || deps['react-native']) {
      return { supported: true };
    }

    // No explicit framework — check if any .tsx/.jsx files exist under src/
    const hasTsx = this.hasFileRecursiveExt(subPkgPath, ['.tsx', '.jsx']);
    if (hasTsx) return { supported: true };

    return { supported: false, unsupportedReason: 'No React components found' };
  }

  /**
   * Returns true when a sub-package is a shared component library.
   * Indicator: react appears in peerDependencies but NOT in dependencies.
   * devDependencies are excluded — a library may list react there for Storybook/testing.
   * Library packages export components for other packages to use — they don't run as standalone apps.
   */
  private isLibrarySubPackage(subPkgRoot: string): boolean {
    const pkgJsonPath = path.join(subPkgRoot, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) return false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      const peerDeps = pkg.peerDependencies ?? {};
      return !!peerDeps['react'] && !pkg.dependencies?.['react'];
    } catch {
      return false;
    }
  }

  /** Detect project structure scoped to a single sub-package directory. */
  private detectProjectStructureInScope(subPkgRoot: string, workspaceRoot: string): ProjectStructurePaths {
    const nested = this.detectNestedSourceStructure(subPkgRoot, workspaceRoot);
    const atoms = [...nested.atomComponentsPaths];
    const composites = [...nested.compositeComponentsPaths];
    const pages = [...nested.pagesPaths];

    // Package-root conventional dirs (e.g. apps/web/pages/, packages/ui/components/).
    // Runs alongside the nested src/app scan above — a package may keep BOTH a nested
    // src/ AND root-level components/pages, and both must surface (Codex #251). src/ and
    // app/ entries are skipped here: they were already handled by detectNestedSourceStructure.
    // No duplication: nested (src/components) and root (components) are distinct dirs,
    // each yielding its own group keyed by relative dirPath.
    {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(subPkgRoot, { withFileTypes: true });
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name) || NON_COMPONENT_DIRS.has(entry.name)) continue;
        const entryName = entry.name.toLowerCase();
        if (entryName === 'src' || entryName === 'app') continue;
        const entryPath = path.join(subPkgRoot, entry.name);

        if (PAGE_DIR_NAMES.has(entryName)) {
          pages.push(entryPath);
          continue;
        }
        if (entryName === 'components') {
          this.categorizeComponentsDir(entryPath, atoms, composites);
          continue;
        }
        if (entryName === 'features' || entryName === 'modules') {
          composites.push(entryPath);
          continue;
        }
      }
    }

    return { atomComponentsPaths: atoms, compositeComponentsPaths: composites, pagesPaths: pages };
  }

  /**
   * Does `subPkgRoot` have its own nested src/ or app/ holding recognizable
   * component structure? Used both by detectProjectStructureInScope (merged
   * with the root-level conventional-dirs scan) and, standalone, by
   * hasOwnComponentSource — the scope-vs-leaf gate in findWorkspaceSubProjects
   * deliberately does NOT use the merged detectProjectStructureInScope for that
   * gate: its root-level conventional-dirs scan below also matches a bare
   * pages/components/etc. directory sitting directly at subPkgRoot's root,
   * which fires just as easily for a genuine scope folder whose ONLY child
   * happens to be named "pages"/"components"/etc. as for a real leaf package —
   * and would wrongly veto scope-recursion for those names. The nested src/app
   * scan here doesn't have that false-positive mode (HYP-909 follow-up).
   */
  private detectNestedSourceStructure(subPkgRoot: string, workspaceRoot: string): ProjectStructurePaths {
    const atoms: string[] = [];
    const composites: string[] = [];
    const pages: string[] = [];
    const framework = this.detectFramework(subPkgRoot);

    for (const srcDirName of ['src', 'app']) {
      const srcPath = path.join(subPkgRoot, srcDirName);
      if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) continue;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(srcPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (SKIP_DIRS.has(entry.name) || NON_COMPONENT_DIRS.has(entry.name)) continue;
        const entryPath = path.join(srcPath, entry.name);
        const entryName = entry.name.toLowerCase();

        if (PAGE_DIR_NAMES.has(entryName)) {
          pages.push(entryPath);
          continue;
        }
        if (entryName === 'components') {
          this.categorizeComponentsDir(entryPath, atoms, composites);
          continue;
        }
        if (entryName === 'features' || entryName === 'modules') {
          composites.push(entryPath);
          continue;
        }

        // src/app/ in non-Next.js sub-packages — same heuristic as the non-scope
        // detectProjectStructure() branch: categorizeAppDir promotes page-like subdirs
        // to pagesPaths while keeping src/app/ in composites for top-level files and
        // non-page subdirs. Without any handling here the in-scope scan finds no known
        // dir and the Explorer shows ZERO components for the target (HYP-419).
        if (entryName === 'app' && srcDirName === 'src' && framework !== 'nextjs') {
          this.categorizeAppDir(entryPath, atoms, composites, pages);
          continue;
        }
      }

      // Fallback: PascalCase .tsx at src/ root.
      // Library sub-packages (react in peerDeps only) → composites (entire src/).
      // App sub-packages → individual PascalCase files to pages.
      const isSubPkgSrc = !srcPath.endsWith(path.join(workspaceRoot, 'src'));
      if (srcDirName === 'src' && framework === 'react' && (pages.length === 0 || isSubPkgSrc)) {
        if (this.isLibrarySubPackage(subPkgRoot)) {
          const hasTsxAtRoot = entries.some(
            (e) => e.isFile() && (e.name.endsWith('.tsx') || e.name.endsWith('.jsx')) && /^[A-Z]/.test(e.name),
          );
          if (hasTsxAtRoot) composites.push(srcPath);
        } else {
          for (const e of entries) {
            if (
              e.isFile() &&
              (e.name.endsWith('.tsx') || e.name.endsWith('.jsx')) &&
              !e.name.endsWith('.test.tsx') &&
              !e.name.endsWith('.spec.tsx') &&
              !e.name.endsWith('.test.jsx') &&
              !e.name.endsWith('.spec.jsx') &&
              /^[A-Z]/.test(e.name)
            ) {
              pages.push(path.join(srcPath, e.name));
            }
          }
        }
      }
    }

    return { atomComponentsPaths: atoms, compositeComponentsPaths: composites, pagesPaths: pages };
  }

  private hasFileRecursiveExt(dir: string, exts: string[]): boolean {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.isFile() && exts.some((ext) => e.name.endsWith(ext))) return true;
        if (e.isDirectory() && this.hasFileRecursiveExt(path.join(dir, e.name), exts)) return true;
      }
    } catch {
      // ignore
    }
    return false;
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

      // File path case
      if (stat.isFile()) {
        if (kind === 'page') {
          // Individual page file — group by parent directory, add single component entry
          const dirPath = path.relative(projectRoot, path.dirname(categoryPath));
          const item: ComponentListItem = {
            name: path.basename(categoryPath),
            path: path.relative(projectRoot, categoryPath),
          };
          const existing = groups.find((g) => g.dirPath === dirPath);
          if (existing) {
            existing.components.push(item);
          } else {
            groups.push({ dirPath, components: [item] });
          }
        } else {
          // For components: scan parent directory (existing behavior)
          const dir = path.dirname(categoryPath);
          if (fs.existsSync(dir)) {
            const components = this.scanComponentDirectory(dir, dir, projectRoot, skipDirNames);
            if (components.length > 0) {
              groups.push({
                dirPath: path.relative(projectRoot, dir),
                components,
              });
            }
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
          ? this.scanPagesDirectory(
              categoryPath,
              categoryPath,
              projectRoot,
              applicableSkips.size > 0 ? applicableSkips : undefined,
            )
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
