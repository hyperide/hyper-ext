/**
 * @file TailwindV4Adapter — FrameworkStyleAdapter umbrella wiring reader + writer
 *
 * Accessed via: StyleWritePlanner / adapter registry when project uses tailwind-v4
 * Assumptions: reader is a Phase 7 stub (returns empty owners); writer is fully functional
 */
import type { FrameworkStyleAdapter } from '@lib/style-write/types';
import { TailwindV4Reader } from './reader';
import { TailwindV4Writer } from './writer';

export const tailwindV4Adapter: FrameworkStyleAdapter = {
  id: 'tailwind-v4',
  reader: new TailwindV4Reader(),
  writer: new TailwindV4Writer(),
};
