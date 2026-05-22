/**
 * @file Babel ESM/CJS interop helpers
 *
 * Accessed via: Any file that imports @babel/traverse or @babel/generator
 * Assumptions: babel packages may be distributed as either ESM or CJS depending
 *   on the bundler and tsconfig settings. The `.default || module` pattern handles both.
 * Tradeoffs: uses `as unknown` to bypass the interop type mismatch. This is isolated
 *   to this file so callers stay clean.
 */

import _traverse from '@babel/traverse';
import _generate from '@babel/generator';

/** Get the babel traverse function regardless of ESM/CJS interop shape. */
export const getTraverse = (): typeof _traverse => (_traverse as unknown as { default: typeof _traverse }).default || _traverse;

/** Get the babel generator function regardless of ESM/CJS interop shape. */
export const getGenerate = (): typeof _generate => (_generate as unknown as { default: typeof _generate }).default || _generate;
