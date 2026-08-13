/**
 * @file Tailwind parser facade — orchestrates category parsers
 *
 * Accessed via: tailwindParser.ts (main entry point)
 */

import type { ParsedTailwindStyles } from './types';
import { parseBorder } from './border';
import { parseColors } from './colors';
import { parseOpacity, parseShadow, parseBlur, parseTransition } from './effects';
import { parseFlexbox, parseOverflow } from './layout';
import { groupClassesByModifier, modifierToCamelCase } from './modifiers';
import { parsePosition } from './position';
import { parseSizing, parsePadding, parseMargin } from './sizing';

export function parseTailwindClasses(className: string): ParsedTailwindStyles {
  if (!className) return {};

  const classes = className.split(/\s+/).filter(Boolean);
  const groups = groupClassesByModifier(classes);

  const result: ParsedTailwindStyles = {};

  if (groups.base && groups.base.length > 0) {
    Object.assign(result, {
      ...parsePosition(groups.base),
      ...parseSizing(groups.base),
      ...parsePadding(groups.base),
      ...parseMargin(groups.base),
      ...parseColors(groups.base),
      ...parseBorder(groups.base),
      ...parseFlexbox(groups.base),
      ...parseOverflow(groups.base),
      ...parseOpacity(groups.base),
      ...parseShadow(groups.base),
      ...parseBlur(groups.base),
      ...parseTransition(groups.base),
    });
  }

  const stateModifiers = [
    'hover',
    'focus',
    'active',
    'focus-visible',
    'disabled',
    'group-hover',
    'group-focus',
    'focus-within',
  ];

  for (const modifier of stateModifiers) {
    if (groups[modifier] && groups[modifier].length > 0) {
      const stateKey = modifierToCamelCase(modifier) as
        | 'hover'
        | 'focus'
        | 'active'
        | 'focusVisible'
        | 'disabled'
        | 'groupHover'
        | 'groupFocus'
        | 'focusWithin';

      result[stateKey] = {
        ...parsePosition(groups[modifier]),
        ...parseSizing(groups[modifier]),
        ...parsePadding(groups[modifier]),
        ...parseMargin(groups[modifier]),
        ...parseColors(groups[modifier]),
        ...parseBorder(groups[modifier]),
        ...parseFlexbox(groups[modifier]),
        ...parseOverflow(groups[modifier]),
        ...parseOpacity(groups[modifier]),
        ...parseShadow(groups[modifier]),
        ...parseBlur(groups[modifier]),
        ...parseTransition(groups[modifier]),
      };
    }
  }

  return result;
}

export function getClassNameFromNode(node: { props?: { className?: string } }): string {
  return node?.props?.className || '';
}
