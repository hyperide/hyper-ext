/**
 * AST Node Types
 *
 * Represents the structure of parsed React/JSX components from source files.
 * Used by adapters to read and manipulate component code.
 */

// Type-only import — erased at build, so the babel-based classifier module is never
// pulled into the client bundle (HYP-290h: only the bare category label crosses over).
import type { MapDataSourceCategory } from '@lib/services/map-datasource-classifier';

/**
 * AST Node representing a React/JSX element
 */
export interface ASTNode {
  /** Unique identifier for this AST node */
  id: string;

  /** Component type (div, Button, YStack, etc.) */
  type: string;

  /** Component props */
  props?: Record<string, unknown>;

  /** Child nodes */
  children?: ASTNode[];

  /** Type of text content in props.children */
  childrenType?: 'text' | 'expression' | 'expression-complex' | 'jsx';

  /** Map iteration metadata (if this node is inside a .map()) */
  mapItem?: {
    parentMapId: string;
    depth: number;
    expression?: string;
    /**
     * Data-source category (HYP-290h), set server-side by parse-component. Drives
     * DOM-mode op routing: `props-from-sample` → sample op, `literal-array` → literal op,
     * `hook-derived`/`generator` → DOM mode unsupported (toggle disabled).
     */
    category?: MapDataSourceCategory;
  };

  /** Conditional rendering metadata (if this node is inside a ternary or &&) */
  condItem?: {
    type: 'if-then' | 'if-else' | 'else-if' | 'switch-case';
    condId: string;
    branch: 'then' | 'else' | 'case';
    index?: number;
    expression: string;
  };

  /** Function call metadata (if this node is returned from a local function) */
  functionItem?: {
    functionName: string;
    functionLoc: {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
    callLoc: {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
  };

  /** Source location in the file */
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}
