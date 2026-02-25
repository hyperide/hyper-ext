/**
 * Tamagui Style Adapter
 * Reads React Native style props and writes props updates via AST
 */

import type { StyleAdapter } from './StyleAdapter';
import type { ASTNode } from '../types/ast';
import type { ParsedStyles } from './types';
import type { AstOperations } from '@/lib/platform/types';

export class TamaguiAdapter implements StyleAdapter {
	readonly writeMode = 'props' as const;
	private astOps: AstOperations;

	constructor(astOps: AstOperations) {
		this.astOps = astOps;
	}

	/**
	 * Read styles from Tamagui/React Native props
	 */
	read(node: ASTNode, domElement?: HTMLElement): ParsedStyles {
		const props = node.props || {};
		const componentType = node.type;

		// Determine layout type from component type
		let layoutType: 'layout' | 'col' | 'row' | 'grid' = 'layout';
		if (componentType === 'YStack') {
			layoutType = 'col';
		} else if (componentType === 'XStack') {
			layoutType = 'row';
		} else if (componentType === 'Stack') {
			layoutType = 'layout';
		}

		// Parse React Native style props
		const parsed: ParsedStyles = {
			layoutType,
			display: 'flex', // Tamagui components are always flex

			// Position (React Native doesn't support sticky)
			position: this.parsePosition(props.position),
			top: this.parseDimension(props.top),
			right: this.parseDimension(props.right),
			bottom: this.parseDimension(props.bottom),
			left: this.parseDimension(props.left),

			// Size
			width: this.parseDimension(props.width),
			height: this.parseDimension(props.height),
			minWidth: this.parseDimension(props.minWidth),
			minHeight: this.parseDimension(props.minHeight),
			maxWidth: this.parseDimension(props.maxWidth),
			maxHeight: this.parseDimension(props.maxHeight),

			// Spacing
			marginTop: this.parseDimension(props.marginTop || props.mt),
			marginRight: this.parseDimension(props.marginRight || props.mr),
			marginBottom: this.parseDimension(props.marginBottom || props.mb),
			marginLeft: this.parseDimension(props.marginLeft || props.ml),
			paddingTop: this.parseDimension(props.paddingTop || props.pt),
			paddingRight: this.parseDimension(props.paddingRight || props.pr),
			paddingBottom: this.parseDimension(props.paddingBottom || props.pb),
			paddingLeft: this.parseDimension(props.paddingLeft || props.pl),

			// Background
			backgroundColor: this.parseColor(props.backgroundColor || props.bg),

			// Text color
			color: this.parseColor(props.color),

			// Border
			borderTopWidth: this.parseDimension(props.borderTopWidth),
			borderRightWidth: this.parseDimension(props.borderRightWidth),
			borderBottomWidth: this.parseDimension(props.borderBottomWidth),
			borderLeftWidth: this.parseDimension(props.borderLeftWidth),
			borderColor: this.parseColor(props.borderColor),
			borderRadiusTopLeft: this.parseDimension(props.borderTopLeftRadius),
			borderRadiusTopRight: this.parseDimension(props.borderTopRightRadius),
			borderRadiusBottomLeft: this.parseDimension(props.borderBottomLeftRadius),
			borderRadiusBottomRight: this.parseDimension(props.borderBottomRightRadius),

			// Effects
			opacity: this.parseOpacity(props.opacity),
			overflow: props.overflow,
		};

		// Get width/height from DOM if not in props
		if (!parsed.width && domElement) {
			parsed.width = `${domElement.offsetWidth}px Auto`;
		}
		if (!parsed.height && domElement) {
			parsed.height = `${domElement.offsetHeight}px Auto`;
		}

		return parsed;
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
		// Ignore borderStyle - React Native only supports solid borders
		if (styleKey === 'borderStyle') {
			console.log('[TamaguiAdapter] Ignoring borderStyle - React Native only supports solid borders');
			return;
		}

		// Convert CSS-style key to React Native key
		const rnKey = this.cssToRNKey(styleKey);
		const rnValue = this.cssToRNValue(styleKey, styleValue);

		await this.astOps.updateProps({
			elementId,
			filePath,
			props: { [rnKey]: rnValue },
		});
	}

	/**
	 * Write multiple style properties via platform AST operations
	 */
	async writeBatch(
		elementId: string,
		filePath: string,
		styles: Partial<ParsedStyles>,
		_options?: {
			domClasses?: string;
			instanceProps?: Record<string, unknown>;
			instanceId?: string;
			state?: string; // Not used for Tamagui (no state modifiers like Tailwind)
		},
	): Promise<void> {
		// Options are not used for Tamagui (no className)
		const rnProps: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(styles)) {
			if (value !== undefined) {
				// Ignore borderStyle - React Native only supports solid borders
				if (key === 'borderStyle') {
					continue;
				}

				// Handle margin object
				if (key === 'margin' && typeof value === 'object' && value !== null) {
					const m = value as Record<string, string>;
					if ('top' in m) {
						rnProps.marginTop = this.cssToRNValue('marginTop', m.top);
					}
					if ('right' in m) {
						rnProps.marginRight = this.cssToRNValue('marginRight', m.right);
					}
					if ('bottom' in m) {
						rnProps.marginBottom = this.cssToRNValue('marginBottom', m.bottom);
					}
					if ('left' in m) {
						rnProps.marginLeft = this.cssToRNValue('marginLeft', m.left);
					}
				} else if (typeof value === 'string') {
					const rnKey = this.cssToRNKey(key);
					const rnValue = this.cssToRNValue(key, value);
					rnProps[rnKey] = rnValue;
				}
			}
		}

		await this.astOps.updateProps({
			elementId,
			filePath,
			props: rnProps,
		});
	}

	// Helper methods

	private parsePosition(value: unknown): ParsedStyles['position'] {
		if (typeof value === 'string') {
			if (value === 'relative' || value === 'absolute') return value;
		}
		return 'relative'; // Default for React Native
	}

	private parseDimension(value: unknown): string | undefined {
		if (value === undefined || value === null) return undefined;
		if (typeof value === 'number') return `${value}px`;
		if (typeof value === 'string') {
			// Handle Tamagui tokens like '$4'
			if (value.startsWith('$')) return value;
			return value;
		}
		return undefined;
	}

	private parseColor(value: unknown): string | undefined {
		if (value === undefined || value === null) return undefined;
		if (typeof value === 'string') {
			// Handle Tamagui tokens like '$blue10'
			if (value.startsWith('$')) return value;
			return value;
		}
		return undefined;
	}

	private parseOpacity(value: unknown): string | undefined {
		if (value === undefined || value === null) return undefined;
		if (typeof value === 'number') {
			// React Native opacity is 0-1, convert to 0-100
			return `${Math.round(value * 100)}`;
		}
		return undefined;
	}

	private cssToRNKey(cssKey: string): string {
		// Most keys are already in React Native format
		// Just handle special cases
		const mapping: Record<string, string> = {
			borderRadiusTopLeft: 'borderTopLeftRadius',
			borderRadiusTopRight: 'borderTopRightRadius',
			borderRadiusBottomLeft: 'borderBottomLeftRadius',
			borderRadiusBottomRight: 'borderBottomRightRadius',
			// borderRadius stays as borderRadius in React Native
		};
		return mapping[cssKey] || cssKey;
	}

	private cssToRNValue(key: string, cssValue: string): unknown {
		// Handle opacity conversion
		if (key === 'opacity') {
			const num = Number.parseInt(cssValue, 10);
			return num / 100; // Convert 0-100 to 0-1
		}

		// Handle dimensions
		if (cssValue.endsWith('px')) {
			return Number.parseInt(cssValue, 10);
		}

		// Handle auto
		if (cssValue === 'auto') {
			return undefined;
		}

		return cssValue;
	}

	/**
	 * Change layout type by renaming component (Stack/YStack/XStack)
	 */
	async changeLayout(
		elementId: string,
		filePath: string,
		layoutType: 'layout' | 'col' | 'row' | 'grid',
	): Promise<void> {
		// Map layout type to Tamagui component
		const componentMap = {
			layout: 'Stack',
			col: 'YStack',
			row: 'XStack',
			grid: 'View', // Grid not supported in Tamagui, fallback to View
		};

		const newType = componentMap[layoutType];

		await this.astOps.renameElement({
			elementId,
			filePath,
			newType,
		});
	}
}
