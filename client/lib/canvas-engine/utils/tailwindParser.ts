/**
 * @file Tailwind CSS Classes Parser — facade
 *
 * Accessed via: Style inspector, CanvasEngine, component props
 * Assumptions: delegates to category-specific parsers in ./parsers/
 */

export type { ParsedTailwindStyles } from './parsers/types';

export { getClassNameFromNode, parseTailwindClasses } from './parsers/facade';
