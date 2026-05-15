/**
 * @file TailwindV4Reader — stub FrameworkStyleReader for Tailwind v4 elements
 *
 * Accessed via: TailwindV4Adapter.reader
 * Assumptions: Full read logic is Phase 7 — this stub returns empty owners so the
 *   adapter can be wired and the write path works end-to-end without a reader
 */
import type { ElementStyleFacts, StyleCondition, StyleSourceOwner } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class TailwindV4Reader implements FrameworkStyleReader {
  read(_input: { elementFacts: ElementStyleFacts; condition: StyleCondition }): StyleSourceOwner[] {
    return [];
  }
}
