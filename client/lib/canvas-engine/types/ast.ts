/**
 * AST Node Types
 *
 * Represents the structure of parsed React/JSX components from source files.
 * Used by adapters to read and manipulate component code.
 */

/**
 * AST Node representing a React/JSX element
 */
export interface ASTNode {
	/** Unique identifier (data-uniq-id) */
	id: string;

	/** Component type (div, Button, YStack, etc.) */
	type: string;

	/** Component props */
	props?: Record<string, any>;

	/** Child nodes */
	children?: ASTNode[];

	/** Type of text content in props.children */
	childrenType?: 'text' | 'expression' | 'expression-complex' | 'jsx';

	/** Map iteration metadata (if this node is inside a .map()) */
	mapItem?: {
		parentMapId: string;
		depth: number;
		expression?: string;
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
