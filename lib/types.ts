/**
 * Shared types for AST manipulation library
 */

import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';

/**
 * Result of parsing a file
 */
export interface ParsedFile {
  ast: t.File;
  absolutePath: string;
}

/**
 * JSX Element with its path in the AST
 */
export interface JSXElementWithPath {
  node: t.JSXElement;
  path: NodePath<t.JSXElement>;
}

/**
 * Result of finding an element
 */
export interface FindElementResult {
  element: t.JSXElement;
  path: NodePath<t.JSXElement>;
}

/**
 * Options for parsing files
 */
export interface ParseOptions {
  sourceType?: 'module' | 'script';
  plugins?: string[];
}

/**
 * Options for printing AST
 */
export interface PrintOptions {
  tabWidth?: number;
  useTabs?: boolean;
  quote?: 'single' | 'double';
}

// ============================================================================
// Shared Editor State (cross-panel synchronization)
// ============================================================================

/**
 * State shared across all VS Code webview panels (Preview, Left, Right).
 * Extension host is the source of truth; webviews sync via state:* messages.
 */
export interface SharedEditorState {
  /** Currently selected element IDs */
  selectedIds: string[];
  /** Currently hovered element ID */
  hoveredId: string | null;
  /** Item index for hovered element in .map() lists */
  hoveredItemIndex?: number | null;
  /** Per-element item indices for selected elements in .map() lists */
  selectedItemIndices?: Record<string, number | null>;
  /** Currently loaded component */
  currentComponent: { name: string; path: string } | null;
  /** Parsed AST structure of current component */
  astStructure: unknown[] | null;
  /** Canvas mode: single instance or multi-instance board */
  canvasMode: 'single' | 'multi';
  /** Engine mode: design (select/edit) or interact (pass-through to iframe) */
  engineMode: 'design' | 'interact';
  /** Detected UI kit from project dependencies */
  projectUIKit?: 'tailwind' | 'tamagui' | 'none';
  /** Element ID for which the component insertion UI is open */
  insertTargetId?: string | null;
}

// ============================================================================
// Component types (shared between extension host and webview)
// ============================================================================

export interface ComponentInfo {
  name: string;
  /** Relative path from workspace root */
  path: string;
  type: 'atom' | 'composite' | 'page';
  hasDefaultExport: boolean;
  hasSampleRender: boolean;
  props: PropInfo[];
}

export interface PropInfo {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
}

export interface ComponentTree {
  atoms: ComponentInfo[];
  composites: ComponentInfo[];
  pages: ComponentInfo[];
}

// ============================================================================
// Tree Node (shared between extension host and webview)
// ============================================================================

export interface TreeNode {
  id: string;
  type: 'frame' | 'map' | 'component' | 'tree' | 'element' | 'function';
  label: string;
  name?: string;
  collapsed?: boolean;
  children?: TreeNode[];
  /** Function location for navigation (only for type="function") */
  functionLoc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

// ============================================================================
// AST types
// ============================================================================

/**
 * Location of a className string literal found by AI analysis.
 * Used by modifyDynamicClassName to know exactly where to modify
 * in complex className expressions (cn() calls, template literals, etc.)
 */
export interface ClassNameLocation {
  /** CSS property name (e.g., 'backgroundColor', 'width') */
  property: string;
  /** Variable/expression name where classes are defined (e.g., 'baseStyles', 'variants.primary') */
  variableName: string;
  /** Full line of code containing the string literal */
  codeLine: string;
  /** Content of the string literal (e.g., "bg-blue-600 text-white hover:bg-blue-700") */
  literalValue: string;
  /** Approximate line number (1-indexed) - used as hint if multiple matches found */
  startLine: number;
  /** Approximate column number (0-indexed) - used as hint if multiple matches found */
  startColumn: number;
  /** Tailwind classes found at this location */
  containsClasses: string[];
}
