/**
 * @file InlineStyleReader stub — returns empty source owners for inline style elements
 *
 * Accessed via: InlineStyleAdapter umbrella delegates read() calls here
 * Assumptions: full inline style reading will be implemented when the read pipeline is built;
 *   this stub satisfies the FrameworkStyleReader interface contract
 */
import type { ElementStyleFacts, StyleCondition, StyleSourceOwner } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class InlineStyleReader implements FrameworkStyleReader {
  read(input: { elementFacts: ElementStyleFacts; condition: StyleCondition }): StyleSourceOwner[] {
    void input;
    return [];
  }
}
