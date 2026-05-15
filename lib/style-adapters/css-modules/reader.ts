/**
 * @file CssModulesReader stub — returns empty source owners for CSS Modules elements
 *
 * Accessed via: CssModulesAdapter umbrella delegates read() calls here
 * Assumptions: full CSS Modules reading will be implemented when the read pipeline is built;
 *   this stub satisfies the FrameworkStyleReader interface contract
 */
import type { ElementStyleFacts, StyleCondition, StyleSourceOwner } from '@lib/style-read/types';
import type { FrameworkStyleReader } from '@lib/style-write/types';

export class CssModulesReader implements FrameworkStyleReader {
  read(input: { elementFacts: ElementStyleFacts; condition: StyleCondition }): StyleSourceOwner[] {
    void input;
    return [];
  }
}
