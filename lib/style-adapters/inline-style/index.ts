/**
 * @file InlineStyleAdapter umbrella — universal fallback adapter for JSX style={{}} writes
 *
 * Accessed via: StyleWritePlanner selects this adapter for elements with inline style ownership
 * Assumptions: this is the universal fallback — when no CSS framework adapter matches,
 *   inline-style is always available as a write target
 */
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { InlineStyleReader } from './reader';
import { InlineStyleWriter } from './writer';

export const inlineStyleAdapter: FrameworkStyleAdapter = {
  id: 'inline-style',
  reader: new InlineStyleReader(),
  writer: new InlineStyleWriter(),
};
