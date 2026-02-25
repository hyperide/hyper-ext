/**
 * Tailwind CSS Style Adapter
 * Reads className and writes className updates
 */

import type { StyleAdapter } from './StyleAdapter';
import type { ASTNode } from '../types/ast';
import type { ParsedStyles } from './types';
import type { ParsedTailwindStyles } from '../utils/tailwindParser';
import { parseTailwindClasses, getClassNameFromNode } from '../utils/tailwindParser';
import type { AstOperations } from '@/lib/platform/types';

/**
 * Convert rgb/rgba color string to hex format
 * @example 'rgb(255, 0, 0)' => '#ff0000'
 * @example 'rgba(255, 0, 0, 0.5)' => '#ff0000'
 */
function rgbToHex(rgb: string): string | undefined {
	const match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
	if (!match) return undefined;
	const [, r, g, b] = match;
	return `#${Number.parseInt(r).toString(16).padStart(2, '0')}${Number.parseInt(g).toString(16).padStart(2, '0')}${Number.parseInt(b).toString(16).padStart(2, '0')}`;
}

/**
 * Convert ParsedTailwindStyles state to ParsedStyles state
 * Handles type conversions (string -> union types)
 */
function convertStateStyles(
	state: Partial<ParsedTailwindStyles> | undefined,
): Partial<Omit<ParsedStyles, 'hover' | 'focus' | 'active' | 'focusVisible' | 'disabled' | 'groupHover' | 'groupFocus' | 'focusWithin'>> | undefined {
	if (!state) return undefined;

	const converted: Partial<ParsedStyles> = {};

	// Convert flexDirection from string to union type
	if (state.flexDirection) {
		converted.flexDirection = state.flexDirection === 'column' ? 'column' : state.flexDirection === 'row' ? 'row' : undefined;
	}

	// Copy all other properties as-is
	for (const [key, value] of Object.entries(state)) {
		if (key !== 'flexDirection' && key !== 'hover' && key !== 'focus' && key !== 'active' && key !== 'focusVisible' && key !== 'disabled' && key !== 'groupHover' && key !== 'groupFocus' && key !== 'focusWithin') {
			(converted as Record<string, unknown>)[key] = value;
		}
	}

	return converted;
}

export class TailwindAdapter implements StyleAdapter {
	readonly writeMode = 'className' as const;
	private astOps: AstOperations;

	constructor(astOps: AstOperations) {
		this.astOps = astOps;
	}

	/**
	 * Read styles from className attribute
	 * Prefers DOM classes (actual runtime) over AST (supports dynamic className)
	 */
	read(node: ASTNode, domElement?: HTMLElement): ParsedStyles {
		// Prefer DOM classes - they reflect actual runtime values (including dynamic className)
		// SVG elements have className as SVGAnimatedString, not string
		let className = getClassNameFromNode(node);
		if (domElement) {
			const domClassName = domElement.className;
			if (typeof domClassName === 'string') {
				className = domClassName;
			} else if (domClassName && typeof domClassName === 'object' && 'baseVal' in domClassName) {
				// SVGAnimatedString
				className = (domClassName as SVGAnimatedString).baseVal;
			}
		}
		const parsed = parseTailwindClasses(className);

		// Determine layout type from display and flexDirection
		let layoutType: 'layout' | 'col' | 'row' | 'grid' = 'layout';
		if (parsed.display === 'grid' || parsed.display === 'inline-grid') {
			layoutType = 'grid';
		} else if (parsed.display === 'flex' || parsed.display === 'inline-flex') {
			layoutType = parsed.flexDirection === 'column' ? 'col' : 'row';
		}

		// Get width/height from DOM if not in Tailwind
		let width = parsed.width;
		let height = parsed.height;

		if (!width && domElement) {
			width = `${domElement.offsetWidth}px Auto`;
		}
		if (!height && domElement) {
			height = `${domElement.offsetHeight}px Auto`;
		}

		// Get text color from computed style if not in Tailwind class
		let textColor = parsed.textColor;
		if (!textColor && domElement) {
			const computedColor = window.getComputedStyle(domElement).color;
			textColor = rgbToHex(computedColor);
		}

		// Ensure flexDirection is properly typed
		const flexDirection: 'row' | 'column' | undefined =
			parsed.flexDirection === 'column' ? 'column' : parsed.flexDirection === 'row' ? 'row' : undefined;

		// Convert state styles from ParsedTailwindStyles to ParsedStyles
		const result: ParsedStyles = {
			...parsed,
			flexDirection,
			layoutType,
			width,
			height,
			// Map textColor to color (ParsedStyles uses 'color', ParsedTailwindStyles uses 'textColor')
			color: textColor,
			// Convert nested padding object to flat fields
			paddingTop: parsed.padding?.top,
			paddingRight: parsed.padding?.right,
			paddingBottom: parsed.padding?.bottom,
			paddingLeft: parsed.padding?.left,
			// Convert nested margin object to flat fields
			marginTop: parsed.margin?.top,
			marginRight: parsed.margin?.right,
			marginBottom: parsed.margin?.bottom,
			marginLeft: parsed.margin?.left,
			// Convert state modifiers
			hover: convertStateStyles(parsed.hover),
			focus: convertStateStyles(parsed.focus),
			active: convertStateStyles(parsed.active),
			focusVisible: convertStateStyles(parsed.focusVisible),
			disabled: convertStateStyles(parsed.disabled),
			groupHover: convertStateStyles(parsed.groupHover),
			groupFocus: convertStateStyles(parsed.groupFocus),
			focusWithin: convertStateStyles(parsed.focusWithin),
		};

		return result;
	}

	/**
	 * Write single style property via platform AST operations
	 */
	async write(
		elementId: string,
		filePath: string,
		styleKey: string,
		styleValue: string,
	): Promise<void> {
		await this.astOps.updateStyles({
			elementId,
			filePath,
			styles: { [styleKey]: styleValue },
		});
	}

	/**
	 * Write multiple style properties via platform AST operations
	 */
	async writeBatch(
		elementId: string,
		filePath: string,
		styles: Partial<ParsedStyles> | Record<string, string>,
		options?: {
			domClasses?: string;
			instanceProps?: Record<string, unknown>;
			instanceId?: string;
			state?: string;
		},
	): Promise<void> {
		// Convert margin object to individual properties
		const flatStyles: Record<string, string> = {};
		for (const [key, value] of Object.entries(styles)) {
			if (key === 'margin' && typeof value === 'object' && value !== null) {
				// Expand margin object to individual properties
				const m = value as Record<string, string>;
				if ('top' in m) flatStyles.marginTop = m.top;
				if ('right' in m) flatStyles.marginRight = m.right;
				if ('bottom' in m) flatStyles.marginBottom = m.bottom;
				if ('left' in m) flatStyles.marginLeft = m.left;
			} else if (value !== undefined && typeof value === 'string') {
				flatStyles[key] = value;
			}
		}

		await this.astOps.updateStyles({
			elementId,
			filePath,
			styles: flatStyles,
			domClasses: options?.domClasses,
			instanceProps: options?.instanceProps,
			instanceId: options?.instanceId,
			state: options?.state,
		});
	}

	/**
	 * Change layout type via className update
	 */
	async changeLayout(
		elementId: string,
		filePath: string,
		layoutType: 'layout' | 'col' | 'row' | 'grid',
	): Promise<void> {
		if (layoutType === 'layout') {
			await this.writeBatch(elementId, filePath, { display: '', flexDirection: '' });
		} else if (layoutType === 'col') {
			await this.writeBatch(elementId, filePath, { display: 'flex', flexDirection: 'column' });
		} else if (layoutType === 'row') {
			await this.writeBatch(elementId, filePath, { display: 'flex', flexDirection: '' });
		} else if (layoutType === 'grid') {
			await this.writeBatch(elementId, filePath, { display: 'grid' });
		}
	}
}
