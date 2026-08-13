/**
 * @file CssModulesAdapter umbrella — adapter for CSS Modules style reads and writes
 *
 * Accessed via: StyleWritePlanner selects this adapter for elements with css-modules ownership
 * Assumptions: reader is a stub returning empty array until the read pipeline is built;
 *   writer produces CssModulesFilePlan with kebab-case CSS declarations
 */
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { CssModulesReader } from './reader';
import { CssModulesWriter } from './writer';

export const cssModulesAdapter: FrameworkStyleAdapter = {
  id: 'css-modules',
  reader: new CssModulesReader(),
  writer: new CssModulesWriter(),
};
