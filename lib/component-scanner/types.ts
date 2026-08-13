/**
 * Shared types for component scanning across SaaS and VS Code extension.
 */

/** Component item for directory-grouped list (filename-based) */
export interface ComponentListItem {
  name: string;
  path: string;
}

/** Group of components from same directory */
export interface ComponentGroup {
  dirPath: string;
  components: ComponentListItem[];
}

/** A single sub-project within a monorepo workspace */
export interface SubProject {
  /** Display name — last segment of the sub-package dir (e.g. "web", "admin") */
  name: string;
  /** Relative path from workspace root (e.g. "targets/web") */
  path: string;
  /** Whether HyperIDE can preview this sub-project (React required) */
  supported: boolean;
  /** Human-readable reason when supported=false */
  unsupportedReason?: string;
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
}

/** All component groups by category */
export interface ComponentsData {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
  /** True when the workspace root is a monorepo (Nx, Turbo, pnpm workspaces, Lerna) */
  isMonorepo?: boolean;
  /** One entry per detected sub-package; only present for monorepos */
  subProjects?: SubProject[];
  /**
   * Relative path of the sub-project that should be auto-expanded and scrolled to
   * because it is the folder the user actually opened. Only set when the opened
   * folder is not itself the monorepo root but an ancestor is.
   */
  activeSubProjectPath?: string;
  /**
   * Absolute path of the discovered ancestor monorepo root. Only set alongside
   * activeSubProjectPath (opened folder is a leaf, not the monorepo root itself).
   * Component/group paths in this payload are rebased onto the OPENED folder, so
   * sibling sub-projects surface as `../sibling/...`. Any consumer that enforces a
   * workspace-root safety boundary on absolute file paths (e.g. the VS Code
   * extension's UndoRedoService) must widen that boundary to also accept paths
   * under this root — otherwise editing/undoing a sibling component silently
   * fails outside-workspace checks (HYP-909 follow-up).
   */
  monorepoRoot?: string;
}

/** Cached project structure paths */
export interface ProjectStructurePaths {
  atomComponentsPaths: string[];
  compositeComponentsPaths: string[];
  pagesPaths: string[];
}

/** Full project structure (including UI component paths) */
export interface ProjectStructure extends ProjectStructurePaths {
  textComponentPath: string | null;
  linkComponentPath: string | null;
  buttonComponentPath: string | null;
  imageComponentPath: string | null;
  containerComponentPath: string | null;
}

/** DI interface -- storage adapter for project structure paths */
export interface ProjectStructureStore {
  load(projectRoot: string): Promise<ProjectStructurePaths | null>;
  save(projectRoot: string, paths: ProjectStructurePaths): Promise<void>;
  /** Persist any buffered writes. Called on graceful shutdown. */
  flush(): Promise<boolean>;
}

/** Test info */
export interface TestInfo {
  name: string;
  line: number;
}

export interface TestGroup {
  type: 'unit' | 'e2e' | 'variants';
  path: string;
  relativePath: string;
  tests: TestInfo[];
}
