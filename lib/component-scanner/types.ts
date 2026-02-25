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

/** All component groups by category */
export interface ComponentsData {
  atomGroups: ComponentGroup[];
  compositeGroups: ComponentGroup[];
  pageGroups: ComponentGroup[];
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
