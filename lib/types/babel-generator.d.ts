declare module '@babel/generator' {
	import type { Node } from '@babel/types';

	interface GeneratorOptions {
		auxiliaryCommentBefore?: string;
		auxiliaryCommentAfter?: string;
		shouldPrintComment?(comment: string): boolean;
		retainLines?: boolean;
		retainFunctionParens?: boolean;
		comments?: boolean;
		compact?: boolean | 'auto';
		minified?: boolean;
		concise?: boolean;
		jsescOption?: object;
		jsonCompatibleStrings?: boolean;
		decoratorsBeforeExport?: boolean;
	}

	interface GeneratorResult {
		code: string;
		map: object | null;
	}

	export default function generate(
		ast: Node,
		opts?: GeneratorOptions,
		code?: string,
	): GeneratorResult;
}
