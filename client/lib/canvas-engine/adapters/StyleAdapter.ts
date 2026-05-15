/**
 * Style Adapter Interface
 * Provides unified API for reading and writing styles across different UI frameworks
 */

import type { ASTNode } from '../types/ast';
import type { ParsedStyles } from './types';

export interface StyleAdapter {
  /** How this adapter writes styles: 'className' for Tailwind, 'props' for Tamagui/RN */
  readonly writeMode: 'className' | 'props';

  /**
   * Read styles from AST node
   * @param node - AST node to read from
   * @param domElement - Optional DOM element for computed styles
   * @returns Parsed styles in common format
   */
  read(node: ASTNode, domElement?: HTMLElement): ParsedStyles;

  /**
   * Write single style property
   * @param elementId - Element identifier (nodeRef)
   * @param filePath - Path to the file containing the element
   * @param styleKey - Style property name
   * @param styleValue - Style property value
   */
  write(elementId: string, filePath: string, styleKey: string, styleValue: string): Promise<void>;

  /**
   * Write multiple style properties in batch
   * @param elementId - Element identifier (nodeRef)
   * @param filePath - Path to the file containing the element
   * @param styles - Object with style properties
   * @param options - Optional parameters for dynamic className support and state modifiers
   */
  writeBatch(
    elementId: string,
    filePath: string,
    styles: Partial<ParsedStyles>,
    options?: {
      domClasses?: string;
      instanceProps?: Record<string, unknown>;
      instanceId?: string;
      state?: string; // Optional state modifier (hover, focus, etc.)
      selectedSourceTabId?: string;
    },
  ): Promise<void>;

  /**
   * Convert CSS styles to the format needed for writing as props.
   * Used when writeMode is 'props' to convert before passing to engine.updateASTProps().
   */
  convertToProps?(styles: Partial<ParsedStyles>): Record<string, unknown>;

  /**
   * Change layout type (Tailwind changes className, Tamagui changes component type)
   * @param elementId - Element identifier (nodeRef)
   * @param filePath - Path to the file containing the element
   * @param layoutType - Layout type: 'layout', 'col', 'row', 'grid'
   */
  changeLayout(elementId: string, filePath: string, layoutType: 'layout' | 'col' | 'row' | 'grid'): Promise<void>;

  /**
   * Write the `order` style at a specific breakpoint without disturbing other variants.
   *
   * Tailwind: rewrites the className token for `order-*` (or `<bp>:order-*`) only.
   * Tamagui: writes the `order` prop. Non-base breakpoints unsupported until
   * media-query / variant infra is wired.
   *
   * @param elementId - Element identifier (nodeRef)
   * @param value - New order number, or `null` to remove the order class entirely
   * @param opts.filePath - Path to the file containing the element
   * @param opts.breakpoint - Tailwind variant prefix (e.g. 'md', 'lg'); base breakpoint when undefined
   * @param opts.currentClassName - Current className (read from DOM/AST by caller). Required for Tailwind;
   *   ignored by prop-based adapters.
   * @returns success flag and optional error code (`order-not-supported` for adapters that don't impl)
   */
  writeOrder?(
    elementId: string,
    value: number | null,
    opts: {
      filePath: string;
      breakpoint?: string;
      currentClassName?: string;
    },
  ): Promise<{ success: boolean; error?: string }>;
}
