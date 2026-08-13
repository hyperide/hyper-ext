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
  type: "unit" | "e2e" | "variants";
  path: string;
  relativePath: string;
  tests: TestInfo[];
}
